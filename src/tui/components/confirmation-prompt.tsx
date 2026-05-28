/**
 * ConfirmationPrompt — displays diffs for pending tool changes and collects y/n/a input.
 *
 * Shows:
 *  - For each pending change, a file path header and unified diff with colored +/- lines
 *  - A summary of additions/removals
 *  - A prompt for y/n/a input
 */

import React from 'react';
import { Box, Text } from 'ink';
import type { UnifiedDiff, PendingToolChange } from '../../openrouter/types';

// ─── Props ─────────────────────────────────────────────────────────────────

interface ConfirmationPromptProps {
  /** The pending tool changes along with their diffs */
  pendingChanges: PendingToolChange[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Truncate a file path to a max length, keeping the filename visible. */
function truncatePath(path: string, maxLen: number = 50): string {
  if (path.length <= maxLen) return path;
  const parts = path.split('/');
  const fileName = parts[parts.length - 1] ?? '';
  const dirParts = parts.slice(0, -1);
  let prefix = '';
  for (const part of dirParts) {
    const candidate = prefix ? `${prefix}/${part[0] ?? ''}` : (part[0] ?? '');
    if (`${candidate}/.../${fileName}`.length > maxLen) break;
    prefix = candidate;
  }
  return `${prefix}/.../${fileName}`;
}

/** Format a unified diff for colored terminal display. */
function DiffDisplay({ diff }: { diff: UnifiedDiff }) {
  const fileLabel = diff.isNewFile
    ? `📄 ${truncatePath(diff.filePath)} (new file)`
    : `✏️  ${truncatePath(diff.filePath)}`;

  // Calculate total change stats
  const totalChunks = diff.chunks.length;
  const totalAdded = diff.addedLines;
  const totalRemoved = diff.removedLines;

  return (
    <Box flexDirection="column" marginLeft={1}>
      {/* File header */}
      <Text bold color="cyan">{fileLabel}</Text>
      <Text color="gray" dimColor>
        {totalChunks} hunk(s) | +{totalAdded}/-{totalRemoved} lines
      </Text>

      {/* Diff chunks */}
      {diff.chunks.map((chunk, ci) => (
        <Box key={ci} flexDirection="column" marginTop={1}>
          {/* Hunk header */}
          <Text color="yellow" dimColor>
            @@ -{chunk.oldStart},{chunk.context.length + chunk.removed.length}
            {' '}+{chunk.newStart},{chunk.context.length + chunk.added.length} @@
          </Text>

          {/* Context lines (gray) */}
          {chunk.context.map((ctx, li) => (
            <Text key={`ctx-${li}`} color="gray" dimColor wrap="wrap">
              {'  '}{ctx.line}
            </Text>
          ))}

          {/* Removed lines (red) */}
          {chunk.removed.map((rem, li) => (
            <Text key={`rem-${li}`} color="red" wrap="wrap">
              {' -'}{rem.line}
            </Text>
          ))}

          {/* Added lines (green) */}
          {chunk.added.map((add, li) => (
            <Text key={`add-${li}`} color="green" wrap="wrap">
              {' +'}{add.line}
            </Text>
          ))}
        </Box>
      ))}

      {/* Separator */}
      {diff.chunks.length > 0 && (
        <Text color="gray" dimColor>───</Text>
      )}
    </Box>
  );
}

// ─── Terminal command display ───────────────────────────────────────────────

function CommandDisplay({ diff }: { diff: UnifiedDiff }) {
  return (
    <Box flexDirection="column" marginLeft={1}>
      <Text bold color="yellow">⚡ {truncatePath(diff.filePath, 80)}</Text>
      {diff.chunks.map((chunk, ci) => (
        <Box key={ci} flexDirection="column">
          {chunk.added.map((add, li) => (
            <Text key={li} wrap="wrap">{add.line}</Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function ConfirmationPrompt({ pendingChanges }: ConfirmationPromptProps) {
  // ── Summary header ──────────────────────────────────────────────────

  const totalAdditions = pendingChanges.reduce(
    (sum, pc) => sum + (pc.diff?.addedLines ?? 0), 0,
  );
  const totalRemovals = pendingChanges.reduce(
    (sum, pc) => sum + (pc.diff?.removedLines ?? 0), 0,
  );
  const fileChanges = pendingChanges.filter(
    (pc) => pc.diff && (pc.diff.addedLines > 0 || pc.diff.removedLines > 0),
  ).length;

  // Don't show anything if all diffs are empty
  if (fileChanges === 0 && pendingChanges.every((pc) => !pc.diff)) {
    return null;
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="yellow"
      paddingX={1}
      paddingY={1}
      marginY={1}
    >
      <Box flexDirection="column">
        {/* Header */}
        <Text bold color="yellow">
          📋 Review Changes ({pendingChanges.length} tool call(s))
        </Text>
        <Text color="gray" dimColor>
          {fileChanges} file(s) will change | +{totalAdditions}/-{totalRemovals} lines
        </Text>
      </Box>

      {/* Diffs */}
      <Box flexDirection="column" marginTop={1}>
        {pendingChanges.map((pc, i) => {
          if (pc.diff && pc.diff.filePath.startsWith('$ ')) {
            // Terminal command
            return <CommandDisplay key={i} diff={pc.diff} />;
          }
          if (pc.diff && (pc.diff.chunks.length > 0)) {
            return <DiffDisplay key={i} diff={pc.diff} />;
          }
          // No changes or unknown
          return (
            <Box key={i} marginLeft={1}>
              <Text color="gray" dimColor>
                {pc.toolCall.function.name}: no changes to preview
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Prompt */}
      <Box marginTop={1}>
        <Text bold color="yellow">
          Apply these changes? </Text>
        <Text color="gray">(</Text>
        <Text color="green">y</Text>
        <Text color="gray">=yes </Text>
        <Text color="red">n</Text>
        <Text color="gray">=no </Text>
        <Text color="cyan">a</Text>
        <Text color="gray">=always (skip confirmations this session))</Text>
      </Box>
    </Box>
  );
}


