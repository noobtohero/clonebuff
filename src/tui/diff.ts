/**
 * Diff generation utility — creates unified diffs between file contents.
 *
 * Uses a simple line-based LCS (Longest Common Subsequence) algorithm
 * to compute edit operations between two arrays of lines.
 *
 * Output format is similar to unified diff:
 *   --- a/path
 *   +++ b/path
 *   @@ -start,count +start,count @@
 *    context line
 *   -removed line
 *   +added line
 */

// ─── LCS-based diff ─────────────────────────────────────────────────────────

type EditOp = { type: 'equal'; line: string } | { type: 'delete'; line: string } | { type: 'insert'; line: string };

/**
 * Compute the shortest edit script between two arrays of strings using LCS.
 * Returns an array of edit operations.
 */
function computeDiff(oldLines: string[], newLines: string[]): EditOp[] {
  const m = oldLines.length;
  const n = newLines.length;

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  // Backtrack to get edit operations
  const ops: EditOp[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1]! === newLines[j - 1]!) {
      ops.push({ type: 'equal', line: oldLines[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: 'insert', line: newLines[j - 1]! });
      j--;
    } else {
      ops.push({ type: 'delete', line: oldLines[i - 1]! });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

// ─── Diff chunking ──────────────────────────────────────────────────────────

export interface DiffChunk {
  /** Line number in the original file (1-based) */
  oldStart: number;
  /** Line number in the new file (1-based) */
  newStart: number;
  /** Context lines (unchanged) */
  context: Array<{ lineNumber: number; line: string }>;
  /** Removed lines */
  removed: Array<{ lineNumber: number; line: string }>;
  /** Added lines */
  added: Array<{ lineNumber: number; line: string }>;
}

/**
 * Chunk edit operations into hunks suitable for display.
 * Each hunk contains context lines around changes.
 */
function chunkDiff(ops: EditOp[], contextLines: number = 3): DiffChunk[] {
  const chunks: DiffChunk[] = [];
  let i = 0;

  while (i < ops.length) {
    // Skip to the first change
    while (i < ops.length && ops[i]!.type === 'equal') i++;
    if (i >= ops.length) break;

    // Include context before the change
    const contextBefore = Math.min(contextLines, i);
    const chunkStart = i - contextBefore;

    // Find the end of this change group
    let j = i;
    while (j < ops.length && ops[j]!.type !== 'equal') j++;

    // Include context after the change
    const contextAfter = Math.min(contextLines, ops.length - j);
    const chunkEnd = j + contextAfter;

    // Count lines for line numbers
    let oldLineNum = 0;
    let newLineNum = 0;
    let oldStart = 0;
    let newStart = 0;

    // Count up to chunkStart
    for (let k = 0; k < chunkStart; k++) {
      const opK = ops[k]!;
      if (opK.type === 'equal' || opK.type === 'delete') oldLineNum++;
      if (opK.type === 'equal' || opK.type === 'insert') newLineNum++;
    }

    oldStart = oldLineNum + 1;
    newStart = newLineNum + 1;

    // Build the chunk
    const context: DiffChunk['context'] = [];
    const removed: DiffChunk['removed'] = [];
    const added: DiffChunk['added'] = [];

    for (let k = chunkStart; k < chunkEnd && k < ops.length; k++) {
      const op = ops[k]!;
      if (op.type === 'equal') {
        oldLineNum++;
        newLineNum++;
        context.push({ lineNumber: oldLineNum, line: op.line });
      } else if (op.type === 'delete') {
        oldLineNum++;
        removed.push({ lineNumber: oldLineNum, line: op.line });
      } else {
        newLineNum++;
        added.push({ lineNumber: newLineNum, line: op.line });
      }
    }

    chunks.push({ oldStart, newStart, context, removed, added });
    i = chunkEnd;
  }

  return chunks;
}

// ─── Unified diff string ────────────────────────────────────────────────────

export interface UnifiedDiff {
  /** Path to the file being changed */
  filePath: string;
  /** Whether this is a new file (doesn't exist yet) */
  isNewFile: boolean;
  /** Chunks of the diff for display */
  chunks: DiffChunk[];
  /** Total lines added */
  addedLines: number;
  /** Total lines removed */
  removedLines: number;
}

/**
 * Generate a unified diff between the old and new file content.
 */
export function generateDiff(oldContent: string | null, newContent: string, filePath: string): UnifiedDiff {
  if (oldContent === null) {
    // New file — show all content as additions
    const lines = newContent.split('\n');
    return {
      filePath,
      isNewFile: true,
      chunks: [{
        oldStart: 0,
        newStart: 1,
        context: [],
        removed: [],
        added: lines.map((line, i) => ({ lineNumber: i + 1, line })),
      }],
      addedLines: lines.length,
      removedLines: 0,
    };
  }

  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  if (oldContent === newContent) {
    return { filePath, isNewFile: false, chunks: [], addedLines: 0, removedLines: 0 };
  }

  const ops = computeDiff(oldLines, newLines);
  const chunks = chunkDiff(ops);

  const addedLines = ops.filter((op) => op.type === 'insert').length;
  const removedLines = ops.filter((op) => op.type === 'delete').length;

  return { filePath, isNewFile: false, chunks, addedLines, removedLines };
}

/**
 * Generate a unified diff for a tool call by previewing what it would do.
 * Returns the diff and the resulting content (for write_file/str_replace).
 */
export async function previewToolChange(
  toolName: string,
  args: Record<string, unknown>,
  projectDir: string,
): Promise<{ diff: UnifiedDiff | null; newContent?: string }> {
  switch (toolName) {
    case 'str_replace': {
      const path = args['path'] as string;
      const replacements = args['replacements'] as Array<{
        oldString: string;
        newString: string;
        allowMultiple?: boolean;
      }>;

      const { resolve } = await import('path');
      const absolutePath = resolve(projectDir, path);
      const file = Bun.file(absolutePath);
      const exists = await file.exists();
      if (!exists) {
        return { diff: null };
      }

      const originalContent = await file.text();
      let newContent = originalContent;

      for (const replacement of replacements) {
        if (replacement.allowMultiple) {
          newContent = newContent.replaceAll(replacement.oldString, replacement.newString);
        } else {
          const idx = newContent.indexOf(replacement.oldString);
          if (idx !== -1) {
            newContent = newContent.slice(0, idx) + replacement.newString + newContent.slice(idx + replacement.oldString.length);
          }
        }
      }

      if (originalContent === newContent) {
        return { diff: null };
      }

      return {
        diff: generateDiff(originalContent, newContent, path),
        newContent,
      };
    }

    case 'write_file': {
      const filePath = args['path'] as string;
      const content = args['content'] as string;

      const { resolve } = await import('path');
      const absolutePath = resolve(projectDir, filePath);
      const file = Bun.file(absolutePath);
      const exists = await file.exists();

      if (!exists) {
        return {
          diff: {
            filePath,
            isNewFile: true,
            chunks: [{
              oldStart: 0,
              newStart: 1,
              context: [],
              removed: [],
              added: content.split('\n').map((line, i) => ({ lineNumber: i + 1, line })),
            }],
            addedLines: content.split('\n').length,
            removedLines: 0,
          },
          newContent: content,
        };
      }

      const originalContent = await file.text();
      if (originalContent === content) {
        return { diff: null };
      }

      return {
        diff: generateDiff(originalContent, content, filePath),
        newContent: content,
      };
    }

    case 'run_terminal_command': {
      const command = args['command'] as string;
      const description = (args['description'] as string) ?? '';

      // For terminal commands, we show the command itself as a "diff"
      // since we can't preview the output
      return {
        diff: {
          filePath: `$ ${command}`,
          isNewFile: false,
          chunks: [{
            oldStart: 0,
            newStart: 0,
            context: [],
            removed: [],
            added: [
              ...(description ? [{ lineNumber: 1, line: `# ${description}` }] : []),
              { lineNumber: description ? 2 : 1, line: `$ ${command}` },
            ],
          }],
          addedLines: 1 + (description ? 1 : 0),
          removedLines: 0,
        },
      };
    }

    default:
      return { diff: null };
  }
}
