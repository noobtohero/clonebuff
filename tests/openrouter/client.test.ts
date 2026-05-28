/**
 * Tests for OpenRouter client module.
 *
 * Covers: error classes, message format conversion, tool definitions,
 * client chat/stream/validation with mocked fetch.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import {
  OpenRouterClient,
  getDefaultTools,
  toOpenRouterMessages,
} from '../../src/openrouter/client';
import {
  OpenRouterError,
  RateLimitError,
  AuthError,
} from '../../src/openrouter/types';
import type { ToolCall } from '../../src/openrouter/types';

// ─── Helpers ───────────────────────────────────────────────────────────

/** Create a mock Response for fetch mocks. */
function mockResponse(
  body: string,
  init: ResponseInit = { status: 200 },
): Response {
  return new Response(body, init);
}

/** Create an SSE stream body as a ReadableStream of Uint8Array. */
function sseStream(
  chunks: string[],
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

/** Build a single SSE data chunk. */
function sseData(json: unknown): string {
  return `data: ${JSON.stringify(json)}\n\n`;
}

/** Build a streaming text delta chunk. */
function textChunk(
  text: string,
  finish_reason: string | null = null,
): string {
  return sseData({
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1717000000,
    model: 'test-model',
    choices: [{
      index: 0,
      delta: { content: text },
      finish_reason,
    }],
  });
}

/** Build a streaming tool call delta chunk. */
function toolCallChunk(
  index: number,
  delta: { id?: string; function?: { name?: string; arguments?: string } },
): string {
  return sseData({
    id: 'chunk-tc',
    object: 'chat.completion.chunk',
    created: 1717000000,
    model: 'test-model',
    choices: [{
      index: 0,
      delta: { tool_calls: [{ index, ...delta }] },
      finish_reason: null,
    }],
  });
}

/** Fake messages for toOpenRouterMessages tests. */
function userMsg(content: string) {
  return { role: 'user' as const, content, timestamp: 1, id: 'u1' };
}

function assistantMsg(content: string) {
  return { role: 'assistant' as const, content, timestamp: 2, id: 'a1' };
}

function systemMsg(content: string) {
  return { role: 'system' as const, content, timestamp: 3, id: 's1' };
}

function toolMsg(content: string, toolCallId: string, name?: string) {
  return {
    role: 'tool' as const,
    content,
    toolCallId,
    name,
    timestamp: 4,
    id: 't1',
  };
}

function assistantWithTools(content: string, toolCalls: ToolCall[]) {
  return {
    role: 'assistant' as const,
    content,
    toolCalls,
    timestamp: 5,
    id: 'a2',
  };
}

// ─── Error Classes ──────────────────────────────────────────────────────

describe('OpenRouterError', () => {
  it('creates an error with just a message', () => {
    const err = new OpenRouterError('Something went wrong');
    expect(err.message).toBe('Something went wrong');
    expect(err.name).toBe('OpenRouterError');
    expect(err.statusCode).toBeUndefined();
    expect(err.body).toBeUndefined();
    expect(err).toBeInstanceOf(Error);
  });

  it('creates an error with status code and body', () => {
    const err = new OpenRouterError('API error', 500, '{"error":"Internal"}');
    expect(err.message).toBe('API error');
    expect(err.statusCode).toBe(500);
    expect(err.body).toBe('{"error":"Internal"}');
  });
});

describe('RateLimitError', () => {
  it('creates with retry-after seconds', () => {
    const err = new RateLimitError(30);
    expect(err.name).toBe('RateLimitError');
    expect(err.statusCode).toBe(429);
    expect(err.message).toContain('30');
    expect(err).toBeInstanceOf(OpenRouterError);
  });

  it('creates with unknown retry time when not provided', () => {
    const err = new RateLimitError();
    expect(err.message).toContain('unknown');
  });
});

describe('AuthError', () => {
  it('creates with default message', () => {
    const err = new AuthError();
    expect(err.name).toBe('AuthError');
    expect(err.statusCode).toBe(401);
    expect(err.message).toContain('API key');
    expect(err).toBeInstanceOf(OpenRouterError);
  });

  it('creates with custom message', () => {
    const err = new AuthError('Custom auth error');
    expect(err.message).toBe('Custom auth error');
  });
});

// ─── toOpenRouterMessages ───────────────────────────────────────────────

describe('toOpenRouterMessages', () => {
  it('converts user messages as-is', () => {
    const result = toOpenRouterMessages([userMsg('Hello')]);
    expect(result).toEqual([{ role: 'user', content: 'Hello' }]);
  });

  it('converts system messages as-is', () => {
    const result = toOpenRouterMessages([systemMsg('Be helpful')]);
    expect(result).toEqual([{ role: 'system', content: 'Be helpful' }]);
  });

  it('converts assistant messages as-is', () => {
    const result = toOpenRouterMessages([assistantMsg('Sure!')]);
    expect(result).toEqual([{ role: 'assistant', content: 'Sure!' }]);
  });

  it('sets content to null when assistant message has tool calls', () => {
    const toolCalls: ToolCall[] = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_files', arguments: '{}' },
    }];
    const result = toOpenRouterMessages([assistantWithTools('', toolCalls)]);
    expect(result).toEqual([{
      role: 'assistant',
      content: null,
      tool_calls: toolCalls,
    }]);
  });

  it('converts tool result with tool_call_id', () => {
    const result = toOpenRouterMessages([
      toolMsg('file content', 'call-abc'),
    ]);
    expect(result).toEqual([{
      role: 'tool',
      content: 'file content',
      tool_call_id: 'call-abc',
    }]);
  });

  it('includes name field on tool result when available', () => {
    const result = toOpenRouterMessages([
      toolMsg('file content', 'call-abc', 'read_files'),
    ]);
    expect(result).toEqual([{
      role: 'tool',
      content: 'file content',
      tool_call_id: 'call-abc',
      name: 'read_files',
    }]);
  });

  it('handles a mixed multi-message conversation', () => {
    const toolCalls: ToolCall[] = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_files', arguments: '{}' },
    }];
    const messages = [
      systemMsg('You are a coding assistant.'),
      userMsg('Read the file'),
      assistantWithTools('', toolCalls),
      toolMsg('file content', 'call-1', 'read_files'),
      assistantMsg('Here is the content.'),
    ];
    const result = toOpenRouterMessages(messages);
    expect(result).toHaveLength(5);
    expect(result[0]!.role).toBe('system');
    expect(result[1]!.role).toBe('user');
    expect(result[2]!.role).toBe('assistant');
    expect(result[2]!.content).toBeNull();
    expect(result[2]!.tool_calls).toEqual(toolCalls);
    expect(result[3]!.role).toBe('tool');
    expect(result[3]!.tool_call_id).toBe('call-1');
    expect(result[3]!.name).toBe('read_files');
    expect(result[4]!.role).toBe('assistant');
    expect(result[4]!.content).toBe('Here is the content.');
  });
});

// ─── getDefaultTools ────────────────────────────────────────────────────

describe('getDefaultTools', () => {
  it('returns exactly 4 tool definitions', () => {
    const tools = getDefaultTools();
    expect(tools).toHaveLength(4);
  });

  it('each tool has type, function.name, description, and parameters', () => {
    const tools = getDefaultTools();
    const names = tools.map((t) => t.function.name);
    expect(names).toContain('read_files');
    expect(names).toContain('str_replace');
    expect(names).toContain('write_file');
    expect(names).toContain('run_terminal_command');

    for (const tool of tools) {
      expect(tool.type).toBe('function');
      expect(tool.function.name).toBeTruthy();
      expect(tool.function.description).toBeTruthy();
      expect(tool.function.parameters).toBeTruthy();
      expect(tool.function.parameters.type).toBe('object');
    }
  });

  it('each tool definition has required fields in parameters', () => {
    const tools = getDefaultTools();
    for (const tool of tools) {
      const params = tool.function.parameters as Record<string, unknown>;
      expect(params.required).toBeDefined();
      expect(Array.isArray(params.required)).toBe(true);
      expect((params.required as string[]).length).toBeGreaterThan(0);
    }
  });
});

// ─── OpenRouterClient — validateApiKey ──────────────────────────────────

describe('OpenRouterClient.validateApiKey', () => {
  let client: OpenRouterClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new OpenRouterClient({ apiKey: 'sk-test-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns true for 200 OK', async () => {
    globalThis.fetch = () => Promise.resolve(mockResponse('ok'));
    const result = await client.validateApiKey();
    expect(result).toBe(true);
  });

  it('returns false for 401', async () => {
    globalThis.fetch = () => Promise.resolve(mockResponse('unauthorized', { status: 401 }));
    const result = await client.validateApiKey();
    expect(result).toBe(false);
  });

  it('returns false on network error', async () => {
    globalThis.fetch = () => Promise.reject(new Error('Network failure'));
    const result = await client.validateApiKey();
    expect(result).toBe(false);
  });

  it('sends the auth header to /auth/key', async () => {
    let capturedUrl = '';
    let capturedHeaders: Record<string, string> = {};
    globalThis.fetch = (url: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      return Promise.resolve(mockResponse('ok'));
    };
    await client.validateApiKey();
    expect(capturedUrl).toContain('/auth/key');
    expect(capturedHeaders['Authorization']).toBe('Bearer sk-test-key');
  });
});

// ─── OpenRouterClient — chat (non-streaming) ────────────────────────────

describe('OpenRouterClient.chat', () => {
  let client: OpenRouterClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new OpenRouterClient({ apiKey: 'sk-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns content from a successful response', async () => {
    globalThis.fetch = () =>
      Promise.resolve(mockResponse(JSON.stringify({
        choices: [{
          message: { content: 'Hello, world!' },
          finish_reason: 'stop',
        }],
      })));

    const result = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('Hello, world!');
    expect(result.toolCalls).toEqual([]);
  });

  it('returns tool calls from response', async () => {
    const toolCalls: ToolCall[] = [{
      id: 'call-1',
      type: 'function',
      function: { name: 'read_files', arguments: '{"paths":["test.ts"]}' },
    }];
    globalThis.fetch = () =>
      Promise.resolve(mockResponse(JSON.stringify({
        choices: [{
          message: { content: null, tool_calls: toolCalls },
          finish_reason: 'tool_calls',
        }],
      })));

    const result = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Read file' }],
    });
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual(toolCalls);
  });

  it('returns empty result when choices array is empty', async () => {
    globalThis.fetch = () =>
      Promise.resolve(mockResponse(JSON.stringify({ choices: [] })));

    const result = await client.chat({
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('');
    expect(result.toolCalls).toEqual([]);
  });

  it('throws AuthError on 401', async () => {
    globalThis.fetch = () =>
      Promise.resolve(mockResponse('unauthorized', { status: 401 }));

    await expect(
      client.chat({ model: 'm', messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow(AuthError);
  });

  it('throws RateLimitError on 429 with retry-after', async () => {
    globalThis.fetch = () =>
      Promise.resolve(new Response('rate limited', {
        status: 429,
        headers: { 'retry-after': '15' },
      }));

    await expect(
      client.chat({ model: 'm', messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow(RateLimitError);
  });

  it('throws OpenRouterError on 500', async () => {
    globalThis.fetch = () =>
      Promise.resolve(mockResponse('Internal error', { status: 500 }));

    await expect(
      client.chat({ model: 'm', messages: [{ role: 'user', content: 'Hi' }] }),
    ).rejects.toThrow(OpenRouterError);
  });
});

// ─── OpenRouterClient — streamChat ──────────────────────────────────────

describe('OpenRouterClient.streamChat', () => {
  let client: OpenRouterClient;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    client = new OpenRouterClient({ apiKey: 'sk-key' });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function mockStream(body: ReadableStream<Uint8Array>) {
    globalThis.fetch = () =>
      Promise.resolve(new Response(body, {
        headers: { 'Content-Type': 'text/event-stream' },
      }));
  }

  it('streams a single text chunk', async () => {
    mockStream(sseStream([textChunk('Hello!', 'stop')]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(result.content).toBe('Hello!');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
  });

  it('streams multiple text chunks and calls onToken', async () => {
    mockStream(sseStream([
      textChunk('Hello'),
      textChunk(' '),
      textChunk('World!', 'stop'),
    ]));

    const tokens: string[] = [];
    const result = await client.streamChat(
      { model: 'm', messages: [{ role: 'user', content: 'Hi' }] },
      (token) => { tokens.push(token); },
    );

    expect(result.content).toBe('Hello World!');
    expect(tokens).toEqual(['Hello', ' ', 'World!']);
    expect(result.finishReason).toBe('stop');
  });

  it('accumulates tool calls from multiple deltas', async () => {
    mockStream(sseStream([
      toolCallChunk(0, { id: 'call-1', function: { name: 'read_' } }),
      toolCallChunk(0, { function: { name: 'files' } }),
      toolCallChunk(0, { function: { arguments: '{"paths"' } }),
      toolCallChunk(0, { function: { arguments: ':["test.ts"]}' } }),
      sseData({
        id: 'chunk-done',
        object: 'chat.completion.chunk',
        created: 1717000000,
        model: 'm',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'tool_calls',
        }],
      }),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Read file' }],
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.id).toBe('call-1');
    expect(result.toolCalls[0]!.function.name).toBe('read_files');
    expect(result.toolCalls[0]!.function.arguments).toBe('{"paths":["test.ts"]}');
    expect(result.finishReason).toBe('tool_calls');
  });

  it('returns usage from the final chunk', async () => {
    mockStream(sseStream([
      textChunk('Hello'),
      sseData({
        id: 'final',
        object: 'chat.completion.chunk',
        created: 1717000000,
        model: 'm',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.usage).toBeDefined();
    expect(result.usage!.promptTokens).toBe(10);
    expect(result.usage!.completionTokens).toBe(5);
    expect(result.usage!.totalTokens).toBe(15);
  });

  it('skips [DONE] signal', async () => {
    mockStream(sseStream([
      textChunk('Hello'),
      'data: [DONE]\n\n',
      textChunk(' World', 'stop'),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Hello World');
  });

  it('skips malformed JSON lines gracefully', async () => {
    mockStream(sseStream([
      textChunk('Hello'),
      'data: {not-json}\n\n',
      textChunk(' World', 'stop'),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Hello World');
  });

  it('handles stream ending without explicit finish_reason', async () => {
    mockStream(sseStream([textChunk('Hello')]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Hello');
    expect(result.finishReason).toBe('stop');
  });

  it('returns partial content when stream ends gracefully after partial data', async () => {
    mockStream(sseStream([
      sseData({
        id: 'chunk',
        object: 'chat.completion.chunk',
        created: 1717000000,
        model: 'm',
        choices: [{ index: 0, delta: { content: 'Partial ' }, finish_reason: null }],
      }),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    // Stream ended without finish_reason, returns what it got with finish_reason 'stop'
    expect(result.content).toBe('Partial ');
    expect(result.finishReason).toBe('stop');
  });

  it('throws OpenRouterError when response body is null', async () => {
    globalThis.fetch = () => Promise.resolve(new Response(null));

    await expect(
      client.streamChat({
        model: 'm',
        messages: [{ role: 'user', content: 'Hi' }],
      }),
    ).rejects.toThrow(OpenRouterError);
  });

  it('returns partial content with finish_reason error when reader throws mid-stream', async () => {
    // Mock getReader to throw on the second read
    let readCount = 0;
    const errorReader = {
      read: async () => {
        readCount++;
        if (readCount === 1) {
          const chunk = 'data: ' + JSON.stringify({
            id: 'chunk',
            object: 'chat.completion.chunk',
            created: 1717000000,
            model: 'm',
            choices: [{ index: 0, delta: { content: 'Partial ' }, finish_reason: null }],
          }) + '\n\n';
          return { done: false, value: new TextEncoder().encode(chunk) };
        }
        throw new Error('Stream connection lost');
      },
      releaseLock: () => {},
    };

    // Create a real stream so Response accepts it, then override getReader
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('dummy'));
        controller.close();
      },
    });
    stream.getReader = () => errorReader as unknown as ReadableStreamDefaultReader<Uint8Array>;

    globalThis.fetch = () => Promise.resolve(new Response(stream));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Partial ');
    expect(result.finishReason).toBe('error');
  });

  it('handles multiple tool call indices in parallel', async () => {
    mockStream(sseStream([
      toolCallChunk(0, { id: 'call-read', function: { name: 'read_files' } }),
      toolCallChunk(1, { id: 'call-write', function: { name: 'write_file' } }),
      toolCallChunk(0, { function: { arguments: '{"paths":["a.ts"]}' } }),
      toolCallChunk(1, { function: { arguments: '{"path":"b.ts"}' } }),
      sseData({
        id: 'chunk-done',
        object: 'chat.completion.chunk',
        created: 1717000000,
        model: 'm',
        choices: [{
          index: 0,
          delta: {},
          finish_reason: 'tool_calls',
        }],
      }),
    ]));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Read and write' }],
    });

    expect(result.toolCalls).toHaveLength(2);
    const names = result.toolCalls.map((tc) => tc.function.name).sort();
    expect(names).toEqual(['read_files', 'write_file']);
  });

  it('handles SSE data split across read boundaries', async () => {
    // Simulate an SSE event whose JSON string is split across two reader.read() calls.
    // The SSE format uses \n\n as event delimiter, but a single TCP packet may split
    // the JSON mid-string. The buffer accumulator should reassemble it.
    const encoder = new TextEncoder();
    const jsonPayload = JSON.stringify({
      id: 'chunk-1',
      object: 'chat.completion.chunk',
      created: 1717000000,
      model: 'm',
      choices: [{
        index: 0,
        delta: { content: 'Hello World!' },
        finish_reason: 'stop',
      }],
    });

    // Split the full SSE line mid-JSON (after 40 chars of the payload)
    const splitAt = 40;
    const firstPart = 'data: ' + jsonPayload.slice(0, splitAt);
    const secondPart = jsonPayload.slice(splitAt) + '\n\n';

    let pullCount = 0;
    const splitStream = new ReadableStream({
      pull(controller) {
        pullCount++;
        if (pullCount === 1) {
          // First read: partial SSE line — no \n at end, so it stays in buffer
          controller.enqueue(encoder.encode(firstPart));
        } else if (pullCount === 2) {
          // Second read: rest of the JSON + \n\n event delimiter
          controller.enqueue(encoder.encode(secondPart));
          controller.close();
        }
      },
    });

    globalThis.fetch = () => Promise.resolve(new Response(splitStream));

    const result = await client.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    expect(result.content).toBe('Hello World!');
    expect(result.finishReason).toBe('stop');
  });

  it('includes provider preference in the streamChat request body', async () => {
    const clientWithProvider = new OpenRouterClient({
      apiKey: 'sk-key',
      providerPreference: 'openai',
    });

    let requestBody = '';
    globalThis.fetch = (_url: RequestInfo | URL, init?: RequestInit) => {
      requestBody = String(init?.body ?? '');
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(
            'data: ' + JSON.stringify({
              id: 'chunk',
              object: 'chat.completion.chunk',
              created: 1717000000,
              model: 'm',
              choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }],
            }) + '\n\n',
          ));
          controller.close();
        },
      }), { headers: { 'Content-Type': 'text/event-stream' } }));
    };

    await clientWithProvider.streamChat({
      model: 'm',
      messages: [{ role: 'user', content: 'Hi' }],
    });

    const parsed = JSON.parse(requestBody);
    expect(parsed.provider).toBeDefined();
    expect(parsed.provider.order).toEqual(['openai']);
    expect(parsed.provider.allow_fallbacks).toBe(true);
  });
});
