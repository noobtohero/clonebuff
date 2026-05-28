/**
 * Context Management — handles conversation history compaction and token tracking.
 *
 * Features:
 *  - Token estimation for messages and conversations
 *  - Smart compaction when approaching model context limits
 *  - Non-lossy summaries that preserve key information from old turns
 *  - Fully automatic — no user-facing warnings
 *
 * Compaction strategy:
 *  1. Always keep the system message intact (it's small and critical)
 *  2. Keep the last N turns full fidelity (configurable, default 5)
 *  3. For turns beyond the preserve window, generate a compact text summary
 *  4. The summary captures: user intent, assistant actions, tools used, key results
 *  5. Old tool result messages (which carry file contents) are the bulk of tokens — summarizing them is very effective
 */

import type { ConversationMessage } from '../openrouter/types';

// ─── Constants ──────────────────────────────────────────────────────────────

/** Rough token-to-character ratio (conservative). */
const CHARS_PER_TOKEN = 4;

/** Per-model context windows (in tokens). Extend as needed. */
const MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  // OpenAI
  'openai/gpt-5-nano': 128_000,
  'openai/gpt-5-pro': 128_000,
  'openai/gpt-4o': 128_000,
  'openai/gpt-4o-mini': 128_000,
  // Anthropic
  'anthropic/claude-sonnet-4.6': 200_000,
  'anthropic/claude-haiku-4.6': 200_000,
  'anthropic/claude-opus-4.6': 200_000,
  // DeepSeek
  'deepseek/deepseek-v4-flash': 128_000,
  'deepseek/deepseek-chat': 128_000,
  // Google
  'google/gemini-2.5-flash': 1_048_576,
  'google/gemini-2.5-pro': 1_048_576,
  // Meta
  'meta-llama/llama-4-scout': 256_000,
  'meta-llama/llama-4-maverick': 256_000,
  // Mistral
  'mistralai/mistral-large': 128_000,
  'mistralai/mistral-small': 32_000,
  // Qwen
  'qwen/qwen-3-235b': 32_000,
  'qwen/qwen-2.5-72b': 128_000,
};

/** Default context window when model is unknown. */
const DEFAULT_CONTEXT_WINDOW = 128_000;

/** Default token budget reserved for the model's response. */
const DEFAULT_RESPONSE_BUDGET = 8_192;

/** Minimum number of recent turns to preserve full fidelity. */
const DEFAULT_PRESERVE_TURNS = 5;

/** Minimum number of tokens that must be saved by compaction to make it worthwhile. */
const MIN_COMPACTION_SAVINGS = 1_000;

// ─── Token Estimation ───────────────────────────────────────────────────────

/**
 * Rough token count estimate. Uses character count / 4.
 * Underestimates slightly for code/text, overestimates for whitespace-heavy content.
 * This is a conservative estimate — better to compact slightly early than too late.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a single conversation message.
 * Includes role overhead (~4 tokens per message).
 */
export function estimateMessageTokens(message: ConversationMessage): number {
  let total = 0;

  // Base message overhead (role marker, metadata)
  total += 4;

  // Content
  if (message.content) {
    total += estimateTokens(message.content);
  }

  // Tool calls (function names, arguments JSON)
  if (message.toolCalls) {
    for (const tc of message.toolCalls) {
      total += 2; // id, type overhead
      total += estimateTokens(tc.function.name);
      total += estimateTokens(tc.function.arguments);
    }
  }

  // Tool call ID and name (for tool role messages)
  if (message.toolCallId) total += estimateTokens(message.toolCallId);
  if (message.name) total += estimateTokens(message.name);

  return total;
}

/**
 * Estimate total tokens for the full conversation.
 */
export function estimateTotalTokens(messages: ConversationMessage[]): number {
  return messages.reduce((sum, msg) => sum + estimateMessageTokens(msg), 0);
}

// ─── Context Window ─────────────────────────────────────────────────────────

/**
 * Get the context window size for a given model.
 */
export function getContextWindow(model: string): number {
  // Exact match
  if (MODEL_CONTEXT_WINDOWS[model]) return MODEL_CONTEXT_WINDOWS[model]!;

  // Try prefix match (e.g., "openai/gpt-5-nano:extended" or "anthropic/claude-sonnet-4.6-20260528")
  for (const [key, value] of Object.entries(MODEL_CONTEXT_WINDOWS)) {
    if (model.startsWith(key)) return value;
  }

  return DEFAULT_CONTEXT_WINDOW;
}

// ─── Compaction Options ─────────────────────────────────────────────────────

export interface ContextCompactorOptions {
  /** The model being used (for context window lookup). */
  model: string;
  /** Reserved token budget for the model's response. Default: 8_192. */
  responseBudget?: number;
  /** Number of most recent turns to preserve with full fidelity. Default: 5. */
  preserveRecentTurns?: number;
  /** Whether compaction is enabled at all. Default: true. */
  enabled?: boolean;
  /** Minimum token savings required to trigger compaction. Default: 1_000. */
  minSavings?: number;
}

export interface CompactionResult {
  /** The compacted (or original) message array. */
  messages: ConversationMessage[];
  /** Whether compaction was actually performed. */
  wasCompacted: boolean;
  /** Estimated total tokens after compaction. */
  totalTokens: number;
  /** Estimated tokens before compaction (undefined if not compacted). */
  originalTokens?: number;
  /** The generated summary text (only when compacted). */
  summary?: string;
}

// ─── Summary Generation ─────────────────────────────────────────────────────

/**
 * Generate a compact summary of a set of conversation messages.
 *
 * Captures: user intents, assistant actions, tools used, and key results.
 * This summary replaces the original messages in the conversation.
 */
export function generateConversationSummary(messages: ConversationMessage[]): string {
  if (messages.length === 0) return '(empty conversation segment)';

  const parts: string[] = [];
  let turnCount = 0;

  for (const msg of messages) {
    if (msg.role === 'user') {
      turnCount++;
      // Truncate long user messages in the summary
      const text = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
      parts.push(`User: ${text}`);
    } else if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        const toolNames = msg.toolCalls.map((tc) => tc.function.name).join(', ');
        const thought = msg.content ? msg.content.slice(0, 150) : '';
        if (thought) {
          parts.push(`Assistant (used: ${toolNames}): ${thought}`);
        } else {
          parts.push(`Assistant used tools: ${toolNames}`);
        }
      } else if (msg.content) {
        const text = msg.content.length > 200 ? msg.content.slice(0, 200) + '...' : msg.content;
        parts.push(`Assistant: ${text}`);
      }
    } else if (msg.role === 'tool') {
      // Summarize tool results compactly
      const toolName = msg.name ?? 'tool';
      const contentPreview = msg.content.length > 80 ? msg.content.slice(0, 80) + '...' : msg.content;
      parts.push(`  -> ${toolName}: ${contentPreview}`);
    }
    // Skip system messages (they're handled separately)
  }

  const summary = parts.join('\n');
  return `[Summary of ${turnCount} conversation turn(s)]:\n${summary}`;
}

// ─── Compaction ─────────────────────────────────────────────────────────────

/**
 * Compact the conversation if it exceeds token budget.
 *
 * Strategy:
 *  1. Always keep the system message intact — it's separated before compaction
 *     and prepended back after.
 *  2. Keep the last N turns full fidelity.
 *  3. Everything before that is summarized into a single compact message.
 *  4. The summary message uses role 'system' so it's not displayed in the UI
 *     (Messages component filters role === 'system').
 *
 * A "turn" is defined as: a user message + the corresponding assistant response(s)
 * + any tool messages in between.
 */
export function compactMessages(
  conversationMessages: ConversationMessage[],
  options: ContextCompactorOptions,
): CompactionResult {
  // Check if compaction is enabled (default: true)
  const isEnabled = options.enabled ?? true;
  if (!isEnabled) {
    const totalTokens = estimateTotalTokens(conversationMessages);
    return { messages: conversationMessages, wasCompacted: false, totalTokens };
  }

  const contextWindow = getContextWindow(options.model);
  const responseBudget = options.responseBudget ?? DEFAULT_RESPONSE_BUDGET;
  const preserveTurns = options.preserveRecentTurns ?? DEFAULT_PRESERVE_TURNS;
  const minSavings = options.minSavings ?? MIN_COMPACTION_SAVINGS;

  const maxPromptTokens = contextWindow - responseBudget;
  const totalTokens = estimateTotalTokens(conversationMessages);

  // No compaction needed if we're well within budget
  if (totalTokens < maxPromptTokens) {
    return { messages: conversationMessages, wasCompacted: false, totalTokens };
  }

  const originalTokens = totalTokens;

  // ── Separate system message ────────────────────────────────────────
  // The first message might be a system message — extract it so it's
  // preserved intact during compaction.
  let systemMessage: ConversationMessage | null = null;
  let conversationOnly: ConversationMessage[];

  if (conversationMessages.length > 0 && conversationMessages[0]!.role === 'system') {
    systemMessage = conversationMessages[0]!;
    conversationOnly = conversationMessages.slice(1);
  } else {
    conversationOnly = [...conversationMessages];
  }

  // ── Identify turns ──────────────────────────────────────────────────
  // A turn starts with a user message and includes all subsequent messages
  // (assistant responses, tool results) until the next user message.

  const turnBoundaries: number[] = []; // indices of user messages that start a turn
  for (let i = 0; i < conversationOnly.length; i++) {
    if (conversationOnly[i]!.role === 'user') {
      turnBoundaries.push(i);
    }
  }

  // If we have fewer turns than preserveTurns, nothing to compact
  if (turnBoundaries.length <= preserveTurns) {
    return { messages: conversationMessages, wasCompacted: false, totalTokens };
  }

  // ── Decide which turns to compact ───────────────────────────────────
  // Keep the last `preserveTurns` turns intact.
  // Compact everything before the Nth-from-last turn boundary.

  const keepFromIndex = turnBoundaries[turnBoundaries.length - preserveTurns]!;
  const messagesToCompact = conversationOnly.slice(0, keepFromIndex);
  const messagesToKeep = conversationOnly.slice(keepFromIndex);

  // ── Generate summary ────────────────────────────────────────────────
  const summary = generateConversationSummary(messagesToCompact);

  // Create a compact "system" message that replaces the old conversation turns
  // Using role 'system' so it's filtered from the UI display
  const summaryMessage: ConversationMessage = {
    id: `ctx-summary-${Date.now()}`,
    role: 'system',
    content: `[Compacted Conversation History]\n${summary}`,
    timestamp: Date.now(),
  };

  // Build the final array: [system message (if any), summary, preserved turns]
  const compactedMessages: ConversationMessage[] = [];
  if (systemMessage) {
    compactedMessages.push(systemMessage);
  }
  compactedMessages.push(summaryMessage, ...messagesToKeep);

  const compactedTokens = estimateTotalTokens(compactedMessages);

  // Don't compact if savings are minimal (not worth the information loss)
  const savings = originalTokens - compactedTokens;
  if (savings < minSavings) {
    return { messages: conversationMessages, wasCompacted: false, totalTokens };
  }

  return {
    messages: compactedMessages,
    wasCompacted: true,
    totalTokens: compactedTokens,
    originalTokens,
    summary,
  };
}

// ─── Context Manager ────────────────────────────────────────────────────────

/**
 * ContextManager — wraps the compaction logic and caches the last result.
 * Used by the App component to auto-compact before each API call.
 */
export class ContextManager {
  private lastCompaction: CompactionResult | null = null;
  private compactionCount = 0;

  /**
   * Check if the conversation needs compaction and compact if so.
   * Returns the (possibly compacted) message array ready to send to the API.
   *
   * @param conversationMessages The full conversation (including the system message at index 0).
   * @param options Compaction configuration.
   */
  compact(
    conversationMessages: ConversationMessage[],
    options: ContextCompactorOptions,
  ): CompactionResult {
    const result = compactMessages(conversationMessages, options);
    this.lastCompaction = result;
    if (result.wasCompacted) {
      this.compactionCount++;
    }
    return result;
  }

  /**
   * Get stats about compaction history.
   */
  getStats(): { totalCompactions: number; lastSavings: number | null } {
    const lastSavings = this.lastCompaction?.wasCompacted
      ? (this.lastCompaction.originalTokens ?? 0) - this.lastCompaction.totalTokens
      : null;
    return {
      totalCompactions: this.compactionCount,
      lastSavings,
    };
  }

  /**
   * Reset compaction tracking (e.g., on /clear).
   */
  reset(): void {
    this.lastCompaction = null;
    this.compactionCount = 0;
  }
}
