/**
 * StatusBar — persistent bottom bar showing contextual info about the current session.
 *
 * Displays:
 *  - Current model name
 *  - Checkpoint mode (git/snapshot)
 *  - Message count
 *  - Context compaction stats
 *  - Turn info during multi-turn tool calls
 */

import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  /** Current model slug */
  model: string;
  /** Active checkpoint mode (e.g., 'git', 'snapshot') */
  checkpointMode: string;
  /** Number of visible (non-system) messages in the conversation */
  messageCount: number;
  /** Context compaction stats */
  contextStats?: {
    totalCompactions: number;
    lastSavings: number | null;
  } | null;
  /** Current multi-turn tool call info */
  turnInfo?: {
    currentTurn: number;
    maxTurns: number;
  } | null;
  /** Character config for display */
  character?: {
    emoji: string;
  };
}

/**
 * Format a model ID for compact display.
 * E.g., "openai/gpt-5-nano" → "gpt-5-nano"
 */
function formatModel(model: string): string {
  const parts = model.split('/');
  return parts.length >= 2 ? parts.slice(1).join('/') : model;
}

/**
 * Format token savings for display.
 * E.g., 15000 → "15k", 800 → "800"
 */
function formatTokenSavings(tokens: number): string {
  if (tokens >= 1000) {
    const k = Math.round(tokens / 1000);
    return `${k}k`;
  }
  return `${tokens}`;
}

export function StatusBar({
  model,
  checkpointMode,
  messageCount,
  contextStats,
  turnInfo,
  character,
}: StatusBarProps) {
  return (
    <Box
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      paddingY={0}
      flexShrink={0}
      width="100%"
    >
      {/* Character emoji + Model */}
      <Box>
        <Text>{character?.emoji ?? '✦'} </Text>
        <Text color="white" bold>{formatModel(model)}</Text>
      </Box>

      {/* Separator */}
      <Text color="gray" dimColor> │ </Text>

      {/* Checkpoint mode */}
      <Box>
        <Text color={checkpointMode === 'git' ? 'green' : 'yellow'}>
          {checkpointMode === 'git' ? '●' : '○'}
        </Text>
        <Text color="gray" dimColor> {checkpointMode}</Text>
      </Box>

      {/* Separator */}
      <Text color="gray" dimColor> │ </Text>

      {/* Message count */}
      {messageCount > 0 && (
        <>
          <Text color="gray" dimColor>
            {messageCount} msg{messageCount !== 1 ? 's' : ''}
          </Text>
          <Text color="gray" dimColor> │ </Text>
        </>
      )}

      {/* Context compaction info */}
      {contextStats && contextStats.totalCompactions > 0 && (
        <>
          <Text color="magenta" dimColor>
            📐 {contextStats.totalCompactions}x
            {contextStats.lastSavings ? ` (-${formatTokenSavings(contextStats.lastSavings)})` : ''}
          </Text>
          <Text color="gray" dimColor> │ </Text>
        </>
      )}

      {/* Turn info */}
      {turnInfo && (
        <>
          <Text color="yellow" dimColor>
            ↻ turn {turnInfo.currentTurn}/{turnInfo.maxTurns}
          </Text>
          <Text color="gray" dimColor> │ </Text>
        </>
      )}

      {/* Spacer to fill remaining width */}
      <Box flexGrow={1} />
    </Box>
  );
}
