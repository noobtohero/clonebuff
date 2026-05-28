/**
 * Tests for src/agent/context.ts — context management and compaction.
 *
 * Covers:
 *  - estimateTokens: char-to-token ratio
 *  - estimateMessageTokens: message overhead, content, tool calls, IDs
 *  - estimateTotalTokens: sum across messages
 *  - getContextWindow: exact match, prefix match, unknown model fallback
 *  - generateConversationSummary: user/assistant/tool messages, truncation, empty
 *  - compactMessages: budget checks, turn preservation, min savings, system message
 *  - ContextManager: compact, getStats, reset
 */

import { describe, it, expect } from 'bun:test';
import type { ConversationMessage } from '../../src/openrouter/types';

const {
  estimateTokens,
  estimateMessageTokens,
  estimateTotalTokens,
  getContextWindow,
  generateConversationSummary,
  compactMessages,
  ContextManager,
} = await import('../../src/agent/context');

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMsg(overrides: Partial<ConversationMessage> & { role: ConversationMessage['role'] }): ConversationMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    content: '',
    timestamp: Date.now(),
    ...overrides,
  };
}

const userMsg = (content: string) => makeMsg({ role: 'user', content });
const assistantMsg = (content: string) => makeMsg({ role: 'assistant', content });
const toolMsg = (name: string, content: string) => makeMsg({ role: 'tool', content, name, toolCallId: 'tc-1' });
const systemMsg = (content: string) => makeMsg({ role: 'system', content });

// Message with tool calls
function assistantWithTools(content: string, toolNames: string[]): ConversationMessage {
  return makeMsg({
    role: 'assistant',
    content,
    toolCalls: toolNames.map((name) => ({
      id: `call-${name}`,
      type: 'function' as const,
      function: { name, arguments: '{}' },
    })),
  });
}

// ─── estimateTokens ─────────────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('computes ceil(length / 4)', () => {
    expect(estimateTokens('abcd')).toBe(1);    // 4 / 4 = 1
    expect(estimateTokens('abcde')).toBe(2);   // 5 / 4 = 1.25 -> ceil -> 2
    expect(estimateTokens('a')).toBe(1);       // 1 / 4 = 0.25 -> ceil -> 1
    expect(estimateTokens('abcdefgh')).toBe(2); // 8 / 4 = 2
  });

  it('handles long text', () => {
    const text = 'hello '.repeat(100); // 600 chars
    expect(estimateTokens(text)).toBe(150); // 600 / 4 = 150
  });
});

// ─── estimateMessageTokens ──────────────────────────────────────────────────

describe('estimateMessageTokens', () => {
  it('counts base overhead + content tokens', () => {
    const msg = userMsg('hello world'); // 11 chars -> ceil(11/4) = 3 tokens
    // overhead 4 + content 3 = 7
    expect(estimateMessageTokens(msg)).toBe(7);
  });

  it('includes tool call tokens when present', () => {
    const msg = assistantWithTools('', ['read_files', 'str_replace']);
    const tokens = estimateMessageTokens(msg);
    // overhead 4 + content 0 + 2*toolCalls * (2 + name_tokens + args_tokens)
    // each toolCall: id overhead(2) + name("read_files"=10/4=3) + args("{}"=2/4=1) = 6 per call -> 12 total
    // overhead 4 + 12 = 16
    expect(tokens).toBeGreaterThan(10);
    expect(tokens).toBe(16);
  });

  it('includes toolCallId and name for tool role messages', () => {
    const msg = toolMsg('read_files', 'file content here'); // name=10 chars, toolCallId=4 chars + content=17 chars
    const tokens = estimateMessageTokens(msg);
    // overhead 4 + content(17/4=ceil->5 tokens) + toolCallId(4/4=1) + name(10/4=ceil->3)
    // = 4 + 5 + 1 + 3 = 13
    expect(tokens).toBe(13);
  });

  it('handles empty message', () => {
    const msg = assistantMsg('');
    expect(estimateMessageTokens(msg)).toBe(4); // just overhead
  });
});

// ─── estimateTotalTokens ────────────────────────────────────────────────────

describe('estimateTotalTokens', () => {
  it('sums all message tokens', () => {
    const messages = [userMsg('hi'), assistantMsg('hello there'), userMsg('again')];
    const total = estimateTotalTokens(messages);
    // msg1: 4 + ceil(2/4)=1 = 5
    // msg2: 4 + ceil(11/4)=3 = 7
    // msg3: 4 + ceil(5/4)=2 = 6
    // total = 18
    expect(total).toBe(18);
  });

  it('returns 0 for empty array', () => {
    expect(estimateTotalTokens([])).toBe(0);
  });
});

// ─── getContextWindow ───────────────────────────────────────────────────────

describe('getContextWindow', () => {
  it('returns exact match context window', () => {
    expect(getContextWindow('openai/gpt-5-nano')).toBe(128_000);
    expect(getContextWindow('anthropic/claude-sonnet-4.6')).toBe(200_000);
    expect(getContextWindow('google/gemini-2.5-flash')).toBe(1_048_576);
  });

  it('matches by prefix when exact match fails', () => {
    // Model with version suffix should match prefix
    expect(getContextWindow('openai/gpt-5-nano:extended')).toBe(128_000);
    expect(getContextWindow('anthropic/claude-sonnet-4.6-20260528')).toBe(200_000);
  });

  it('returns default for unknown models', () => {
    expect(getContextWindow('foo/bar-baz')).toBe(128_000);
    expect(getContextWindow('')).toBe(128_000);
    expect(getContextWindow('some-random-model-v42')).toBe(128_000);
  });
});

// ─── generateConversationSummary ────────────────────────────────────────────

describe('generateConversationSummary', () => {
  it('returns placeholder for empty array', () => {
    const summary = generateConversationSummary([]);
    expect(summary).toContain('empty conversation segment');
  });

  it('summarizes user messages with truncated content', () => {
    const messages = [userMsg('Add rate limiting to all API endpoints')];
    const summary = generateConversationSummary(messages);
    expect(summary).toContain('User:');
    expect(summary).toContain('rate limiting');
    expect(summary).toContain('1 conversation turn');
  });

  it('summarizes assistant text responses', () => {
    const messages = [userMsg('hello'), assistantMsg('Hi! How can I help?')];
    const summary = generateConversationSummary(messages);
    expect(summary).toContain('User: hello');
    expect(summary).toContain('Assistant: Hi! How can I help?');
    expect(summary).toContain('1 conversation turn');
  });

  it('summarizes assistant tool calls', () => {
    const msg = assistantWithTools('Reading files...', ['read_files', 'str_replace']);
    const summary = generateConversationSummary([userMsg('fix the bug'), msg]);
    expect(summary).toContain('read_files, str_replace');
    expect(summary).toContain('Reading files...');
  });

  it('summarizes assistant tool calls without thought text', () => {
    const msg = assistantWithTools('', ['read_files']);
    const summary = generateConversationSummary([userMsg('do it'), msg]);
    expect(summary).toContain('Assistant used tools: read_files');
    expect(summary).not.toContain('(used:');
  });

  it('summarizes tool results with truncated content', () => {
    const messages = [userMsg('read file'), assistantWithTools('', ['read_files']), toolMsg('read_files', 'very long file content here that should be truncated at 80 chars...' + 'x'.repeat(100))];
    const summary = generateConversationSummary(messages);
    expect(summary).toContain('-> read_files:');
  });

  it('truncates long user messages at 200 chars', () => {
    const longContent = 'a'.repeat(300);
    const summary = generateConversationSummary([userMsg(longContent)]);
    expect(summary).toContain('...');
    // Summary = "[Summary of 1 conversation turn(s)]:\\nUser: " (44) + 200*a + "..." (3) = 247
    expect(summary.length).toBeGreaterThan(200);
    expect(summary.length).toBeLessThan(260);
    // Should contain the truncated content (200 a's) not the full 300
    expect(summary).toContain('a'.repeat(200));
    expect(summary).not.toContain('a'.repeat(300));
  });

  it('lists turn count', () => {
    const messages = [userMsg('a'), assistantMsg('b'), userMsg('c'), assistantMsg('d')];
    const summary = generateConversationSummary(messages);
    expect(summary).toContain('2 conversation turn');
  });

  it('skips system messages', () => {
    const messages = [systemMsg('system prompt'), userMsg('hello'), assistantMsg('hi')];
    const summary = generateConversationSummary(messages);
    expect(summary).not.toContain('system prompt');
    expect(summary).toContain('User: hello');
  });
});

// ─── compactMessages ────────────────────────────────────────────────────────

describe('compactMessages', () => {
  it('does not compact when within budget', () => {
    const messages = [userMsg('hi'), assistantMsg('hello')];
    const result = compactMessages(messages, { model: 'openai/gpt-5-nano', responseBudget: 100_000 });
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toBe(messages); // same reference
  });

  it('does not compact when disabled', () => {
    const messages = [userMsg('hi')];
    const result = compactMessages(messages, { model: 'openai/gpt-5-nano', enabled: false });
    expect(result.wasCompacted).toBe(false);
    expect(result.messages).toBe(messages);
  });

  it('compacts when over budget', () => {
    // Use mistralai/mistral-small (32k context window) and generate enough
    // text to exceed maxPromptTokens (32,000 - responseBudget).
    // Each message has ~8000 chars = ~2000 tokens. 40 messages = ~80k tokens.
    const padding = 'x'.repeat(8000);
    const manyMessages: ConversationMessage[] = [];
    for (let i = 0; i < 20; i++) {
      manyMessages.push(userMsg(`Message ${i}. ${padding}`));
      manyMessages.push(assistantMsg(`Response ${i}. ${padding}`));
    }

    const result = compactMessages(manyMessages, {
      model: 'mistralai/mistral-small',
      responseBudget: 100,
      preserveRecentTurns: 3,
    });

    expect(result.wasCompacted).toBe(true);
    expect(result.totalTokens).toBeLessThan(result.originalTokens!);
    expect(result.messages.length).toBeLessThan(manyMessages.length);
    expect(result.summary).toBeDefined();
    expect(result.summary).toContain('conversation turn');
  });

  it('preserves the system message intact when compacting', () => {
    const sysMsg = systemMsg('You are a helpful assistant.');
    const padding = 'x'.repeat(8000);
    const messages: ConversationMessage[] = [sysMsg];
    for (let i = 0; i < 15; i++) {
      messages.push(userMsg(`Message ${i}. ${padding}`));
      messages.push(assistantMsg(`Response ${i}. ${padding}`));
    }

    const result = compactMessages(messages, {
      model: 'mistralai/mistral-small',
      responseBudget: 100,
      preserveRecentTurns: 2,
    });

    expect(result.wasCompacted).toBe(true);
    // First message should still be the system message
    expect(result.messages[0]!.role).toBe('system');
    expect(result.messages[0]!.content).toBe('You are a helpful assistant.');
  });

  it('preserves recent turns at full fidelity', () => {
    const padding = 'x'.repeat(8000);
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(userMsg(`Turn ${i} query. ${padding}`));
      messages.push(assistantMsg(`Turn ${i} response. ${padding}`));
    }

    const result = compactMessages(messages, {
      model: 'mistralai/mistral-small',
      responseBudget: 100,
      preserveRecentTurns: 3,
    });

    expect(result.wasCompacted).toBe(true);
    // The last 3 user+assistant pairs (6 messages) should be preserved
    const preservedMessages = result.messages.filter(
      (m) => m.id !== result.messages[0]?.id // exclude the summary message
    );
    // The last assistant response should be there
    const lastMsg = preservedMessages[preservedMessages.length - 1]!;
    expect(lastMsg.content).toBe('Turn 9 response. ' + padding);
  });

  it('does not compact when savings are below threshold', () => {
    // Just barely over budget, so savings would be small
    const enoughText = 'a'.repeat(4000); // ~1000 tokens
    const messages = [
      userMsg(enoughText),
      assistantMsg(enoughText),
      userMsg(enoughText),
      assistantMsg(enoughText),
    ];

    const result = compactMessages(messages, {
      model: 'openai/gpt-5-nano',
      responseBudget: 127_000, // tiny room, but savings might be below MIN_COMPACTION_SAVINGS
      preserveRecentTurns: 1,
      minSavings: 5000, // high threshold
    });

    // With high minSavings, compaction should not happen
    expect(result.wasCompacted).toBe(false);
  });

  it('returns totalTokens when not compacted', () => {
    const messages = [userMsg('hello'), assistantMsg('world')];
    const result = compactMessages(messages, { model: 'openai/gpt-5-nano', responseBudget: 100_000 });
    expect(result.totalTokens).toBeGreaterThan(0);
  });

  it('handles conversation with only system message and fewer turns than preserveRecentTurns', () => {
    const messages = [systemMsg('You are helpful.'), userMsg('hello'), assistantMsg('hi')];
    const result = compactMessages(messages, {
      model: 'openai/gpt-5-nano',
      responseBudget: 1, // tiny budget
      preserveRecentTurns: 5, // more than we have turns
    });
    expect(result.wasCompacted).toBe(false);
  });

  it('handles empty message array', () => {
    const result = compactMessages([], { model: 'openai/gpt-5-nano' });
    expect(result.wasCompacted).toBe(false);
    expect(result.totalTokens).toBe(0);
  });

  it('compaction produces a valid summary message with role=system', () => {
    const padding = 'x'.repeat(8000);
    const messages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      messages.push(userMsg(`Query ${i}. ${padding}`));
      messages.push(assistantMsg(`Response ${i}. ${padding}`));
    }

    const result = compactMessages(messages, {
      model: 'mistralai/mistral-small',
      responseBudget: 100,
      preserveRecentTurns: 2,
    });

    expect(result.wasCompacted).toBe(true);
    // The summary message should have role=system
    const summaryMsg = result.messages.find((m) => m.id.startsWith('ctx-summary'));
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.role).toBe('system');
    expect(summaryMsg!.content).toContain('[Compacted Conversation History]');
  });
});

// ─── ContextManager ─────────────────────────────────────────────────────────

describe('ContextManager', () => {
  it('starts with zero compactions and no last savings', () => {
    const cm = new ContextManager();
    const stats = cm.getStats();
    expect(stats.totalCompactions).toBe(0);
    expect(stats.lastSavings).toBeNull();
  });

  it('tracks compaction count', () => {
    const cm = new ContextManager();
    const padding = 'x'.repeat(8000);
    const manyMessages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      manyMessages.push(userMsg(`Message ${i}. ${padding}`));
      manyMessages.push(assistantMsg(`Response ${i}. ${padding}`));
    }

    cm.compact(manyMessages, { model: 'mistralai/mistral-small', responseBudget: 100, preserveRecentTurns: 2 });
    const stats1 = cm.getStats();
    expect(stats1.totalCompactions).toBe(1);
    expect(stats1.lastSavings).toBeGreaterThan(0);

    // Second compaction
    const moreMessages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      moreMessages.push(userMsg(`More ${i}. ${padding}`));
      moreMessages.push(assistantMsg(`More response ${i}. ${padding}`));
    }
    cm.compact(moreMessages, { model: 'mistralai/mistral-small', responseBudget: 100, preserveRecentTurns: 2 });
    const stats2 = cm.getStats();
    expect(stats2.totalCompactions).toBe(2);
  });

  it('does not increment compaction count when not compacted', () => {
    const cm = new ContextManager();
    cm.compact([userMsg('hi'), assistantMsg('hello')], { model: 'openai/gpt-5-nano', responseBudget: 100_000 });
    expect(cm.getStats().totalCompactions).toBe(0);
  });

  it('reset clears stats', () => {
    const cm = new ContextManager();
    const padding = 'x'.repeat(8000);
    const manyMessages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      manyMessages.push(userMsg(`Message ${i}. ${padding}`));
      manyMessages.push(assistantMsg(`Response ${i}. ${padding}`));
    }

    cm.compact(manyMessages, { model: 'mistralai/mistral-small', responseBudget: 100, preserveRecentTurns: 2 });
    expect(cm.getStats().totalCompactions).toBe(1);

    cm.reset();
    const stats = cm.getStats();
    expect(stats.totalCompactions).toBe(0);
    expect(stats.lastSavings).toBeNull();
  });

  it('getStats returns null lastSavings when last compaction was skipped', () => {
    const cm = new ContextManager();
    // First call: no compaction needed
    cm.compact([userMsg('hi')], { model: 'openai/gpt-5-nano', responseBudget: 100_000 });
    expect(cm.getStats().lastSavings).toBeNull();

    // Second call: triggers compaction
    const padding = 'x'.repeat(8000);
    const manyMessages: ConversationMessage[] = [];
    for (let i = 0; i < 10; i++) {
      manyMessages.push(userMsg(`Message ${i}. ${padding}`));
      manyMessages.push(assistantMsg(`Response ${i}. ${padding}`));
    }
    cm.compact(manyMessages, { model: 'mistralai/mistral-small', responseBudget: 100, preserveRecentTurns: 2 });
    expect(cm.getStats().lastSavings).toBeGreaterThan(0);
  });
});
