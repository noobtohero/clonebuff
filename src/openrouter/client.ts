/**
 * OpenRouter API client — handles streaming chat completions.
 *
 * Uses Bun's native fetch with SSE stream parsing.
 */

import {
  type ChatCompletionRequest,
  type ChatMessage,
  type StreamChunk,
  type StreamToolCallDelta,
  type ToolCall,
  type ToolDefinition,
  OpenRouterError,
  RateLimitError,
  AuthError,
} from './types';

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_MODEL = 'openai/gpt-5-nano';

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  appTitle?: string;
  appUrl?: string;
  /** Preferred provider for cache stickiness (e.g., "openai", "anthropic"). Empty means auto. */
  providerPreference?: string;
}

export interface StreamResult {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
  /** Token usage from the response, if available */
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export class OpenRouterClient {
  private apiKey: string;
  private baseUrl: string;
  private defaultModel: string;
  private appTitle: string;
  private appUrl: string;
  private providerPreference: string;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? DEFAULT_BASE_URL;
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
    this.appTitle = options.appTitle ?? 'Clonebuff';
    this.appUrl = options.appUrl ?? 'https://github.com/user/clonebuff';
    this.providerPreference = options.providerPreference ?? '';
  }

  /**
   * Send a streaming chat completion request.
   * Returns a Promise that resolves when the stream is complete.
   * @param onToken Called for each text token during streaming (for UI updates).
   */
  async streamChat(
    request: ChatCompletionRequest,
    onToken?: (token: string) => void,
  ): Promise<StreamResult> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
      },
      body: JSON.stringify({
        ...request,
        stream: true,
        // Provider preferences for cache stickiness
        // OpenRouter routes subsequent requests with the same config to the same provider,
        // keeping the prompt cache warm across conversation turns.
        ...(this.providerPreference ? {
          provider: {
            order: [this.providerPreference],
            allow_fallbacks: true,
          },
        } : {}),
      }),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    if (!response.body) {
      throw new OpenRouterError('Response body is null');
    }

    return this.parseStream(response.body, onToken);
  }

  /**
   * Non-streaming chat completion request.
   */
  async chat(
    request: ChatCompletionRequest,
  ): Promise<{ content: string; toolCalls: ToolCall[] }> {
    const url = `${this.baseUrl}/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': this.appUrl,
        'X-Title': this.appTitle,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      await this.handleError(response);
    }

    const data = await response.json() as {
      choices: Array<{
        message: { content: string | null; tool_calls?: ToolCall[] };
        finish_reason: string | null;
      }>;
    };

    const choice = data.choices[0];
    if (!choice) {
      return { content: '', toolCalls: [] };
    }

    return {
      content: choice.message.content ?? '',
      toolCalls: choice.message.tool_calls ?? [],
    };
  }

  /**
   * Parse SSE stream from the response body.
   */
  private async parseStream(
    body: ReadableStream<Uint8Array>,
    onToken?: (token: string) => void,
  ): Promise<StreamResult> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let content = '';
    const toolCallsMap = new Map<number, Partial<ToolCall> & { args: string }>();

    // Track usage from the final stream chunk
    let usage: StreamResult['usage'] = undefined;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue;

          if (trimmed.startsWith('data: ')) {
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;

            try {
              const chunk = JSON.parse(data) as StreamChunk;

              // Capture usage from the final chunk (empty choices with usage data)
              if (chunk.usage) {
                usage = {
                  promptTokens: chunk.usage.prompt_tokens,
                  completionTokens: chunk.usage.completion_tokens,
                  totalTokens: chunk.usage.total_tokens,
                };
              }

              const choice = chunk.choices[0];
              if (!choice) continue;

              const { delta, finish_reason } = choice;

              // Handle text tokens
              if (delta.content) {
                content += delta.content;
                onToken?.(delta.content);
              }

              // Handle tool call deltas (streamed in chunks)
              if (delta.tool_calls) {
                for (const tcDelta of delta.tool_calls) {
                  this.accumulateToolCall(tcDelta, toolCallsMap);
                }
              }

              // Stream finished
              if (finish_reason) {
                const finalToolCalls = this.finalizeToolCalls(toolCallsMap);
                return {
                  content,
                  toolCalls: finalToolCalls,
                  finishReason: finish_reason,
                  usage,
                };
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      }

      // Stream ended without explicit finish_reason
      const finalToolCalls = this.finalizeToolCalls(toolCallsMap);
      return {
        content,
        toolCalls: finalToolCalls,
        finishReason: 'stop',
      };
    } catch (error) {
      // If we have partial content, return it gracefully
      if (content || toolCallsMap.size > 0) {
        const finalToolCalls = this.finalizeToolCalls(toolCallsMap);
        return {
          content,
          toolCalls: finalToolCalls,
          finishReason: 'error',
        };
      }
      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  private accumulateToolCall(
    delta: StreamToolCallDelta,
    map: Map<number, Partial<ToolCall> & { args: string }>,
  ): void {
    const existing = map.get(delta.index) ?? {
      id: '',
      type: 'function' as const,
      function: { name: '', arguments: '' },
      args: '',
    };

    if (delta.id) existing.id = delta.id;
    if (delta.function?.name) existing.function!.name += delta.function.name;
    if (delta.function?.arguments) existing.args += delta.function.arguments;

    map.set(delta.index, existing);
  }

  private finalizeToolCalls(
    map: Map<number, Partial<ToolCall> & { args: string }>,
  ): ToolCall[] {
    const calls: ToolCall[] = [];
    for (const [, value] of map) {
      if (value.id && value.function?.name) {
        calls.push({
          id: value.id,
          type: 'function',
          function: {
            name: value.function.name,
            arguments: value.args || '{}',
          },
        });
      }
    }
    return calls;
  }

  private async handleError(response: Response): Promise<never> {
    const body = await response.text().catch(() => '');

    switch (response.status) {
      case 401:
        throw new AuthError();
      case 429: {
        const retryAfter = response.headers.get('retry-after');
        throw new RateLimitError(retryAfter ? parseInt(retryAfter, 10) : undefined);
      }
      default:
        throw new OpenRouterError(
          `API error: ${response.status} ${response.statusText}`,
          response.status,
          body,
        );
    }
  }

  async validateApiKey(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth/key`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}

/**
 * Default tool definitions for Clonebuff agents.
 */
export function getDefaultTools(): ToolDefinition[] {
  return [
    {
      type: 'function',
      function: {
        name: 'read_files',
        description: 'Read the contents of one or more files from the project. Returns the full file contents.',
        parameters: {
          type: 'object',
          properties: {
            paths: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of file paths to read, relative to the project root.',
            },
          },
          required: ['paths'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'str_replace',
        description: 'Make precise string replacements in an existing file. The oldString must match exactly, including whitespace.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to edit.' },
            replacements: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  oldString: { type: 'string', description: 'The exact string to replace.' },
                  newString: { type: 'string', description: 'The replacement string.' },
                  allowMultiple: { type: 'boolean', description: 'Replace all occurrences.' },
                },
                required: ['oldString', 'newString'],
              },
            },
          },
          required: ['path', 'replacements'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'write_file',
        description: 'Create a new file or completely overwrite an existing file with the given content.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Path to the file to create or overwrite.' },
            instructions: { type: 'string', description: 'A brief description of what this change does.' },
            content: { type: 'string', description: 'The complete file content to write.' },
          },
          required: ['path', 'instructions', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_terminal_command',
        description: 'Execute a terminal command in the project directory. Use this to install packages, run builds, execute tests, or perform git operations.',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'The shell command to execute.' },
            description: { type: 'string', description: 'Brief description of why this command is being run.' },
          },
          required: ['command'],
        },
      },
    },
  ];
}

/**
 * Convert internal messages to OpenRouter (OpenAI-compatible) message format.
 *
 * Critical for tool calling:
 * - Tool result messages MUST include tool_call_id that matches the original tool call id.
 * - Tool result messages should include the tool name for models that expect it.
 * - Assistant messages with tool_calls should have content: null (not empty string).
 */
export function toOpenRouterMessages(
  messages: Array<{ role: string; content: string; toolCalls?: ToolCall[]; toolCallId?: string; name?: string }>,
): ChatMessage[] {
  const result: ChatMessage[] = [];

  for (const msg of messages) {
    if (msg.role === 'tool') {
      // Tool result: must include tool_call_id linking back to the original call
      // Include name field for models that use it (e.g., Anthropic Claude via OpenRouter)
      const toolMsg: ChatMessage = {
        role: 'tool',
        content: msg.content,
        tool_call_id: msg.toolCallId ?? `call-${Date.now()}`,
      };
      if (msg.name) {
        toolMsg.name = msg.name;
      }
      result.push(toolMsg);
    } else if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
      // Assistant message with tool calls: content must be null, not empty string
      result.push({
        role: 'assistant',
        content: msg.content || null,
        tool_calls: msg.toolCalls,
      });
    } else {
      result.push({
        role: msg.role as 'user' | 'assistant' | 'system',
        content: msg.content,
      });
    }
  }

  return result;
}
