/**
 * OpenRouter API types — compatible with OpenAI chat completions format.
 */

// ─── Messages ───────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

// ─── Tool Definitions ───────────────────────────────────────────────────────

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ─── Request ────────────────────────────────────────────────────────────────

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
}

// ─── Response (non-streaming) ───────────────────────────────────────────────

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: ChatMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// ─── Streaming Chunks ───────────────────────────────────────────────────────

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: string;
      content?: string | null;
      tool_calls?: StreamToolCallDelta[];
    };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
  }[];
  /** Usage info — typically present in the final chunk with empty choices */
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

// ─── Diff types ──────────────────────────────────────────────────────────

export interface DiffChunk {
  oldStart: number;
  newStart: number;
  context: Array<{ lineNumber: number; line: string }>;
  removed: Array<{ lineNumber: number; line: string }>;
  added: Array<{ lineNumber: number; line: string }>;
}

export interface UnifiedDiff {
  filePath: string;
  isNewFile: boolean;
  chunks: DiffChunk[];
  addedLines: number;
  removedLines: number;
}

export interface PendingToolChange {
  toolCall: ToolCall;
  diff: UnifiedDiff | null;
  newContent?: string;
}

// ─── Agent Runtime Types ────────────────────────────────────────────────────

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  timestamp: number;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public body?: string,
  ) {
    super(message);
    this.name = 'OpenRouterError';
  }
}

export class RateLimitError extends OpenRouterError {
  constructor(retryAfter?: number) {
    super(
      `Rate limited. Retry after ${retryAfter ?? 'unknown'} seconds.`,
      429,
    );
    this.name = 'RateLimitError';
  }
}

export class AuthError extends OpenRouterError {
  constructor(message = 'Invalid or missing API key') {
    super(message, 401);
    this.name = 'AuthError';
  }
}
