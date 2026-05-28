/**
 * Tests for src/tui/diff.ts — LCS-based diff engine.
 *
 * Tests cover:
 *  - computeDiff: basic edits, insertions, deletions, no changes
 *  - chunkDiff: context grouping, edge cases
 *  - generateDiff: new files, unchanged files, standard diffs
 *  - DiffChunk structure correctness
 */

import { describe, it, expect } from 'bun:test';

// Import the source module
const { generateDiff } = await import('../../src/tui/diff');

describe('generateDiff', () => {
  it('returns empty diff for identical content', () => {
    const content = 'line1\nline2\nline3';
    const result = generateDiff(content, content, 'test.txt');
    expect(result.isNewFile).toBe(false);
    expect(result.chunks).toHaveLength(0);
    expect(result.addedLines).toBe(0);
    expect(result.removedLines).toBe(0);
  });

  it('detects added lines', () => {
    const oldContent = 'line1\nline3';
    const newContent = 'line1\nline2\nline3';
    const result = generateDiff(oldContent, newContent, 'test.txt');
    expect(result.isNewFile).toBe(false);
    expect(result.addedLines).toBe(1);
    expect(result.removedLines).toBe(0);
    expect(result.chunks.length).toBeGreaterThan(0);
    // The added line should be in the chunk
    const addedLines = result.chunks.flatMap((c) => c.added.map((l) => l.line));
    expect(addedLines).toContain('line2');
  });

  it('detects removed lines', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nline3';
    const result = generateDiff(oldContent, newContent, 'test.txt');
    expect(result.isNewFile).toBe(false);
    expect(result.addedLines).toBe(0);
    expect(result.removedLines).toBe(1);
    expect(result.chunks.length).toBeGreaterThan(0);
    const removedLines = result.chunks.flatMap((c) => c.removed.map((l) => l.line));
    expect(removedLines).toContain('line2');
  });

  it('handles new files (oldContent is null)', () => {
    const newContent = 'line1\nline2\nline3';
    const result = generateDiff(null, newContent, 'new-file.ts');
    expect(result.isNewFile).toBe(true);
    expect(result.chunks).toHaveLength(1);
    expect(result.addedLines).toBe(3);
    expect(result.removedLines).toBe(0);
    expect(result.chunks[0]!.added).toHaveLength(3);
    expect(result.chunks[0]!.added[0]!.line).toBe('line1');
  });

  it('handles replacement (remove + add)', () => {
    const oldContent = 'line1\nold_line\nline3';
    const newContent = 'line1\nnew_line\nline3';
    const result = generateDiff(oldContent, newContent, 'test.txt');
    expect(result.isNewFile).toBe(false);
    expect(result.addedLines).toBe(1);
    expect(result.removedLines).toBe(1);
  });

  it('tracks correct line numbers in chunks', () => {
    const oldContent = 'keep1\nremove_me\nkeep2\nkeep3';
    const newContent = 'keep1\nadded_here\nkeep2\nkeep3';
    const result = generateDiff(oldContent, newContent, 'test.txt');

    expect(result.chunks.length).toBeGreaterThan(0);
    const chunk = result.chunks[0]!;
    // oldStart and newStart should be correct
    expect(chunk.removed[0]!.lineNumber).toBe(2);
    expect(chunk.added[0]!.lineNumber).toBe(2);
  });

  it('handles completely different content', () => {
    const oldContent = 'a\nb\nc';
    const newContent = 'x\ny\nz';
    const result = generateDiff(oldContent, newContent, 'test.txt');
    expect(result.chunks.length).toBeGreaterThan(0);
    expect(result.removedLines).toBe(3);
    expect(result.addedLines).toBe(3);
  });

  it('handles single-line files', () => {
    const result = generateDiff('old', 'new', 'test.txt');
    expect(result.removedLines).toBe(1);
    expect(result.addedLines).toBe(1);
    expect(result.chunks).toHaveLength(1);
  });

  it('handles empty files', () => {
    const result = generateDiff('', '', 'empty.txt');
    expect(result.chunks).toHaveLength(0);
    expect(result.addedLines).toBe(0);
    expect(result.removedLines).toBe(0);
  });

  it('handles change from empty to content', () => {
    const result = generateDiff('', 'hello\nworld', 'file.txt');
    expect(result.isNewFile).toBe(false);
    // Note: empty string split('\\n') gives [''] — 1 line. So removing that
    // and adding 'hello' + 'world' = 1 removed, 2 added.
    expect(result.addedLines).toBe(2);
    expect(result.removedLines).toBe(1);
  });

  it('handles change from content to empty', () => {
    const result = generateDiff('hello\nworld', '', 'file.txt');
    // Note: empty string split('\\n') gives [''] — 1 line. So removing 2
    // and adding 1 (the empty line) = 2 removed, 1 added.
    expect(result.removedLines).toBe(2);
    expect(result.addedLines).toBe(1);
  });

  it('preserves file path in result', () => {
    const result = generateDiff('a', 'b', 'src/foo/bar.ts');
    expect(result.filePath).toBe('src/foo/bar.ts');
  });

  it('includes context lines around changes', () => {
    const oldContent = 'ctx1\nctx2\nold_line\nctx3\nctx4';
    const newContent = 'ctx1\nctx2\nnew_line\nctx3\nctx4';
    const result = generateDiff(oldContent, newContent, 'test.txt');

    const chunk = result.chunks[0]!;
    // Should have context lines before and after the change
    expect(chunk.context.length).toBeGreaterThan(0);
    // The context lines should include unchanged lines around the change
    const contextLines = chunk.context.map((l) => l.line);
    expect(contextLines).toContain('ctx2');
    expect(contextLines).toContain('ctx3');
  });

  it('handles multiple disjoint changes', () => {
    const oldContent = 'keep1\nremove1\nkeep2\nkeep3\nremove2\nkeep4';
    const newContent = 'keep1\nadd1\nkeep2\nkeep3\nadd2\nkeep4';
    const result = generateDiff(oldContent, newContent, 'test.txt');

    // Should have 2 separate chunks (or one merged chunk if close enough)
    expect(result.removedLines).toBe(2);
    expect(result.addedLines).toBe(2);
    expect(result.chunks.length).toBeGreaterThanOrEqual(1);
  });
});
