/**
 * Messages component — displays the conversation history with formatted tool calls,
 * tool results, and syntax-highlighted code blocks.
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { ConversationMessage, ToolCall } from '../openrouter/types';
import { SyntaxHighlighter } from './components/syntax-highlighter';
import { CharacterSpinner, WelcomeBounce } from './components/character-spinner';
import type { AgentCharacter } from '../agent/character';
import { DEFAULT_CHARACTER } from '../agent/character';

interface MessagesProps {
  /** The conversation history (system messages are filtered out) */
  messages: ConversationMessage[];
  /** Streaming text currently being received */
  streamingText?: string;
  /** Whether the AI is currently thinking */
  isThinking?: boolean;
  /** Thinking/status message */
  thinkingMessage?: string;
  /** Tool execution status (shown during processing) */
  toolStatus?: ToolExecutionStatus | null;
  /** Character configuration for display */
  character?: AgentCharacter;
}

export interface ToolExecutionStatus {
  /** Currently executing tool name */
  currentTool: string;
  /** Overall status message */
  message: string;
  /** Completed tool results so far */
  completed: Array<{ name: string; success: boolean; summary: string }>;
}

// ─── Tool call display helpers ──────────────────────────────────────────────

/**
 * Format tool call arguments for display — parse JSON and present nicely.
 */
function formatToolCallArgs(toolCall: ToolCall): string {
  try {
    const args = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
    if (toolCall.function.name === 'read_files') {
      const paths = args['paths'] as string[] | undefined;
      return paths ? paths.join(', ') : '(no paths)';
    }
    if (toolCall.function.name === 'str_replace') {
      const path = args['path'] as string | undefined;
      const count = (args['replacements'] as Array<unknown> | undefined)?.length ?? 0;
      return `${path ?? '?'} (${count} replacement${count !== 1 ? 's' : ''})`;
    }
    if (toolCall.function.name === 'write_file') {
      const path = args['path'] as string | undefined;
      return path ?? '(no path)';
    }
    if (toolCall.function.name === 'run_terminal_command') {
      const cmd = args['command'] as string | undefined;
      return cmd ? cmd.slice(0, 80) + (cmd.length > 80 ? '...' : '') : '(no command)';
    }
    return JSON.stringify(args).slice(0, 100);
  } catch {
    return toolCall.function.arguments.slice(0, 100);
  }
}

/**
 * Format tool result content for display — truncate long outputs.
 */
function formatToolResult(content: string, toolName: string): string {
  // For terminal commands, show a summary
  if (toolName === 'run_terminal_command') {
    const lines = content.split('\n').filter((l) => l.trim());
    const cmdLine = lines.find((l) => l.startsWith('[Command]'));
    const exitLine = lines.find((l) => l.startsWith('[Exit Code]'));
    const stdoutLines = lines.filter((l) => !l.startsWith('[') && l.trim());
    const exitCode = exitLine?.match(/\d+/)?.[0] ?? '?';
    const stdoutSummary = stdoutLines.length > 0 ? ` (${stdoutLines.length} line(s) output)` : ' (no output)';
    return `${cmdLine ?? 'Command'} — exit ${exitCode}${stdoutSummary}`;
  }

  // For read_files, show file count
  if (toolName === 'read_files') {
    const fileCount = content.split('===').length - 1;
    return `Read ${fileCount} file(s)`;
  }

  // For str_replace, show a summary
  if (toolName === 'str_replace') {
    const successLines = content.split('\n').filter((l) => l.startsWith('Replaced'));
    const warningLines = content.split('\n').filter((l) => l.startsWith('Warning'));
    const parts: string[] = [];
    if (successLines.length > 0) parts.push(successLines.join(', '));
    if (warningLines.length > 0) parts.push(`${warningLines.length} warning(s)`);
    return parts.join('; ') || 'No changes made.';
  }

  // For write_file, show the instruction
  if (toolName === 'write_file') {
    const line = content.split('\n')[0] ?? '';
    return line.replace(/^(✓ Written:|Error:)/, '').trim() || 'File written';
  }

  // Truncate long results
  return content.length > 200 ? content.slice(0, 200) + '...' : content;
}

/**
 * Get a character-flavored streaming label for the typing indicator.
 */
function getStreamingLabel(character: AgentCharacter): string {
  const labels = [
    'writing... ✨',
    'typing...',
    'thinking... 💭',
    'working... ⚡',
  ];
  // Use a deterministic hash of the character name to pick a consistent label
  const hash = character.name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return labels[hash % labels.length] ?? labels[0]!;
}

function getToolEmoji(name: string): string {
  switch (name) {
    case 'read_files': return '📖';
    case 'str_replace': return '✏️';
    case 'write_file': return '📝';
    case 'run_terminal_command': return '⚡';
    default: return '🔧';
  }
}

// ─── Code block ─────────────────────────────────────────────────────────────

function CodeBlock({ language, code, isStreaming }: { language?: string; code: string; isStreaming?: boolean }) {
  // Determine the visible language name for the label
  const langLabel = language || 'code';
  const lineCount = code.split('\n').length;

  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      {/* Header bar with language label and line count */}
      <Box>
        <Box>
          <Text color="cyan" bold>{'<'}</Text>
          <Text color="cyan">{langLabel}</Text>
          <Text color="cyan" bold>{'>'}</Text>
        </Box>
        <Text color="gray" dimColor>  {lineCount} line{lineCount !== 1 ? 's' : ''}</Text>
        {isStreaming && (
          <Text color="yellow" dimColor>  ● streaming</Text>
        )}
      </Box>

      {/* Syntax-highlighted code */}
      <Box>
        <SyntaxHighlighter code={code} language={langLabel} />
      </Box>
    </Box>
  );
}

// ─── Text parser ────────────────────────────────────────────────────────────

function renderTextWithCodeBlocks(text: string) {
  const parts: Array<{ type: 'text' | 'code'; content: string; language?: string }> = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: 'text', content: text.slice(lastIndex, match.index) });
    }
    parts.push({
      type: 'code',
      content: match[2]!.trim(),
      language: match[1] || undefined,
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ type: 'text', content: text.slice(lastIndex) });
  }

  if (parts.length === 0) {
    parts.push({ type: 'text', content: text });
  }

  return parts;
}

// ─── Tool call display ──────────────────────────────────────────────────────

function ToolCallBlock({ toolCalls }: { toolCalls: ToolCall[] }) {
  return (
    <Box flexDirection="column" marginLeft={2} marginY={1}>
      {toolCalls.map((tc, i) => (
        <Box key={i} marginY={0}>
          <Text color="yellow">
            {getToolEmoji(tc.function.name)} {tc.function.name}
          </Text>
          <Text color="gray" dimColor> — </Text>
          <Text color="white">{formatToolCallArgs(tc)}</Text>
        </Box>
      ))}
    </Box>
  );
}

// ─── Tool result display ────────────────────────────────────────────────────

function ToolResultBlock({ message }: { message: ConversationMessage }) {
  const summary = formatToolResult(message.content, message.name ?? 'tool');

  return (
    <Box flexDirection="column" marginLeft={2} marginY={0}>
      <Box>
        <Text color="green" dimColor>{getToolEmoji(message.name ?? 'tool')}</Text>
        <Text color="gray" dimColor> {summary}</Text>
      </Box>
    </Box>
  );
}

// ─── Message item ───────────────────────────────────────────────────────────

function MessageItem({ message, character }: { message: ConversationMessage; character: AgentCharacter }) {
  // Don't render system messages
  if (message.role === 'system') return null;

  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Role label */}
      <Box>
        <Text bold color={isUser ? 'green' : isTool ? 'yellow' : character.color}>
          {isUser ? 'You' : isTool ? '  Tool' : character.name}
        </Text>
        {!isTool && (
          <Text color="gray" dimColor>
            {' '}
            {new Date(message.timestamp).toLocaleTimeString()}
          </Text>
        )}
      </Box>

      {/* Message content */}
      <Box flexDirection="column" marginLeft={2}>
        {message.content && !isTool ? (
          renderTextWithCodeBlocks(message.content).map((part, i) =>              part.type === 'code' ? (
                <CodeBlock key={i} language={part.language} code={part.content} />
              ) : (
                <Text key={i} wrap="wrap">
                  {part.content}
                </Text>
              ),
            )
        ) : message.toolCalls && message.toolCalls.length > 0 ? (
          <ToolCallBlock toolCalls={message.toolCalls} />
        ) : isTool ? (
          <ToolResultBlock message={message} />
        ) : null}
      </Box>
    </Box>
  );
}

// ─── Tool execution status inline display ───────────────────────────────────

function ToolExecutionDisplay({ status }: { status: ToolExecutionStatus }) {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text bold color="yellow">
          🔧 Tools
        </Text>
      </Box>
      <Box flexDirection="column" marginLeft={2}>
        {/* Completed tools */}
        {status.completed.map((c, i) => (
          <Box key={i}>
            <Text color="green" dimColor>
              ✓ {getToolEmoji(c.name)} {c.summary}
            </Text>
          </Box>
        ))}
        {/* Currently executing */}
        <Box>
          <Text color="yellow">
            ⏳ {getToolEmoji(status.currentTool)} {status.currentTool}...
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

// ─── Main Messages component ────────────────────────────────────────────────

export function Messages({
  messages,
  streamingText,
  isThinking,
  thinkingMessage,
  toolStatus,
  character = DEFAULT_CHARACTER,
}: MessagesProps) {
  // Filter out system messages for display
  const displayMessages = messages.filter((m) => m.role !== 'system');

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      overflowY="hidden"
      paddingX={1}
    >
      {/* Welcome message */}
      {displayMessages.length === 0 && !streamingText && !isThinking && (
        <Box
          flexDirection="column"
          alignItems="center"
          justifyContent="center"
          flexGrow={1}
          marginTop={5}
        >
          <WelcomeBounce emoji={character.emoji} color={character.color} />
          <Text bold color={character.color}>
            {character.name}
          </Text>
          <Text color="gray" dimColor>
            {character.catchphrase}
          </Text>
          <Box marginTop={2}>
            <Text color="gray" italic>
              Type a prompt below to get started.
            </Text>
          </Box>
          <Box marginTop={1}>
            <Text color="gray" dimColor>
              Examples:
            </Text>
          </Box>
          <Box>
            <Text color="cyan">  "Add error handling to the API routes"</Text>
          </Box>
          <Box>
            <Text color="cyan">  "Refactor the database layer"</Text>
          </Box>
          <Box>
            <Text color="cyan">  "Explain how this module works"</Text>
          </Box>
        </Box>
      )}

      {/* Message list */}
      {displayMessages.map((message) => (
        <MessageItem key={message.id} message={message} character={character} />
      ))}

      {/* Tool execution status (shown during tool execution between streaming turns) */}
      {toolStatus && !streamingText && (
        <ToolExecutionDisplay status={toolStatus} />
      )}

      {/* Streaming message */}
      {streamingText && (
        <Box flexDirection="column" marginY={1}>
          <Box>
            <Text bold color={character.color}>
              {character.emoji} {character.name}
            </Text>
            <Text color="gray" dimColor>
              {' '}{getStreamingLabel(character)}
            </Text>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            {renderTextWithCodeBlocks(streamingText).map((part, i) =>
              part.type === 'code' ? (
                <CodeBlock key={i} language={part.language} code={part.content} isStreaming />
              ) : (
                <Text key={i} wrap="wrap">
                  {part.content}
                </Text>
              ),
            )}
            {/* Cursor */}
            <Text color="cyan">▊</Text>
          </Box>
        </Box>
      )}

      {/* Thinking indicator with character animation */}
      {isThinking && !streamingText && !toolStatus && (
        <Box marginY={1} marginLeft={2}>
          <CharacterSpinner
            emoji={character.emoji}
            message={thinkingMessage ?? 'Thinking...'}
            sparkleColor={character.color}
          />
        </Box>
      )}

      {/* Spacer */}
      <Box minHeight={1} />
    </Box>
  );
}
