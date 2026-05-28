/**
 * Input component — captures user keyboard input for prompts.
 * Uses Ink's useInput for raw keyboard handling.
 *
 * Features:
 *  - Multi-line input (Shift+Enter for newline, Enter to submit)
 *  - Cursor positioning with arrow keys, Home, End
 *  - Ctrl+U to clear line, Ctrl+W to delete word backward, Ctrl+A/E for home/end
 *  - Line count and character count indicators
 *  - Visual state changes (focused, disabled, active typing)
 *  - Scrollable input area (shows last few lines when input grows)
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';

interface InputProps {
  /** Called when the user submits a message */
  onSubmit: (value: string) => void;
  /** Whether input is disabled (e.g., while AI is processing) */
  disabled?: boolean;
  /** Placeholder text when empty */
  placeholder?: string;
  /** Focus state */
  focused?: boolean;
  /** History of previous prompts for up/down arrow recall */
  promptHistory?: string[];
}

/**
 * Returns the display lines for the current value, shown from the bottom.
 * If the value has many lines, only the last N fit in the visible area.
 */
function getVisibleLines(value: string, maxLines: number): string[] {
  const lines = value.split('\n');
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

export function Input({
  onSubmit,
  disabled = false,
  placeholder = 'Type your prompt...',
  promptHistory = [],
}: InputProps) {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);

  // ── History navigation state ───────────────────────────────────────────
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [savedDraft, setSavedDraft] = useState('');

  useInput(
    (input, key) => {
      if (disabled) return;

      // ── Submit (Enter without Shift) ────────────────────────────────
      if (key.return && !key.shift) {
        const trimmed = value.trim();
        if (trimmed) {
          onSubmit(trimmed);
          setValue('');
          setCursorPos(0);
          // Reset history navigation state
          setHistoryIndex(null);
          setSavedDraft('');
        }
        return;
      }

      // ── Newline (Shift+Enter) ───────────────────────────────────────
      if (key.return && key.shift) {
        const newValue =
          value.slice(0, cursorPos) + '\n' + value.slice(cursorPos);
        setValue(newValue);
        setCursorPos(cursorPos + 1);
        return;
      }

      // ── Backspace / Delete ──────────────────────────────────────────
      if (key.backspace || key.delete) {
        if (cursorPos > 0) {
          // Handle deleting a newline character (move cursor up one position)
          const charBefore = value[cursorPos - 1];
          const newValue =
            value.slice(0, cursorPos - 1) + value.slice(cursorPos);
          setValue(newValue);
          // If we deleted a newline, the cursor is at the end of the previous line
          setCursorPos(cursorPos - 1);
        }
        return;
      }

      // ── Ctrl+A — Home / start of line ──────────────────────────────
      if (key.ctrl && input === 'a') {
        // Move to the start of the current line
        const lineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
        setCursorPos(lineStart);
        return;
      }

      // ── Ctrl+E — End of line ────────────────────────────────────────
      if (key.ctrl && input === 'e') {
        // Move to the end of the current line
        const nextNewline = value.indexOf('\n', cursorPos);
        const lineEnd = nextNewline >= 0 ? nextNewline : value.length;
        setCursorPos(lineEnd);
        return;
      }

      // ── Ctrl+U — Clear line / delete to start ──────────────────────
      if (key.ctrl && input === 'u') {
        // Delete from cursor to start of line
        const lineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
        const newValue =
          value.slice(0, lineStart) + value.slice(cursorPos);
        setValue(newValue);
        setCursorPos(lineStart);
        return;
      }

      // ── Ctrl+W — Delete word backward ──────────────────────────────
      if (key.ctrl && input === 'w') {
        if (cursorPos > 0) {
          // Find the start of the previous word
          let wordStart = cursorPos - 1;
          // Skip whitespace
          while (wordStart > 0 && /\s/.test(value[wordStart - 1]!)) wordStart--;
          // Skip non-whitespace (the word itself)
          while (wordStart > 0 && !/\s/.test(value[wordStart - 1]!)) wordStart--;
          const newValue =
            value.slice(0, wordStart) + value.slice(cursorPos);
          setValue(newValue);
          setCursorPos(wordStart);
        }
        return;
      }

      // ── Left arrow ──────────────────────────────────────────────────
      if (key.leftArrow) {
        if (cursorPos > 0) setCursorPos(cursorPos - 1);
        return;
      }

      // ── Right arrow ────────────────────────────────────────────────
      if (key.rightArrow) {
        if (cursorPos < value.length) setCursorPos(cursorPos + 1);
        return;
      }

      // ── Up arrow — navigate history backward or move cursor up ─────
      if (key.upArrow) {
        if (promptHistory.length > 0) {
          // Navigate history: save draft on first press, then cycle back
          const newIdx = historyIndex !== null
            ? Math.max(historyIndex - 1, 0)
            : promptHistory.length - 1;
          if (newIdx !== historyIndex) {
            if (historyIndex === null) {
              setSavedDraft(value);
            }
            setHistoryIndex(newIdx);
            setValue(promptHistory[newIdx]!);
            setCursorPos(promptHistory[newIdx]!.length);
          }
        } else {
          // No history — move cursor to previous line (existing behavior)
          const currentLineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
          if (currentLineStart > 0) {
            const prevLineEnd = currentLineStart - 1;
            const prevLineStart = value.lastIndexOf('\n', prevLineEnd - 1) + 1;
            const offset = cursorPos - currentLineStart;
            setCursorPos(Math.min(prevLineStart + offset, prevLineEnd));
          }
        }
        return;
      }

      // ── Down arrow — navigate history forward or move cursor down ───
      if (key.downArrow) {
        if (promptHistory.length > 0 && historyIndex !== null) {
          // Navigate forward through history or restore draft
          const newIdx = historyIndex + 1;
          if (newIdx < promptHistory.length) {
            setHistoryIndex(newIdx);
            setValue(promptHistory[newIdx]!);
            setCursorPos(promptHistory[newIdx]!.length);
          } else {
            // Exhausted history — restore the saved draft
            setHistoryIndex(null);
            setValue(savedDraft);
            setCursorPos(savedDraft.length);
            setSavedDraft('');
          }
        } else {
          // No history or not navigating — move cursor to next line
          const currentLineStart = value.lastIndexOf('\n', cursorPos - 1) + 1;
          const nextNewline = value.indexOf('\n', cursorPos);
          if (nextNewline >= 0) {
            const nextLineEnd = value.indexOf('\n', nextNewline + 1);
            const nextLineEnd_ = nextLineEnd >= 0 ? nextLineEnd : value.length;
            const offset = cursorPos - currentLineStart;
            setCursorPos(Math.min(nextNewline + 1 + offset, nextLineEnd_));
          }
        }
        return;
      }

      // ── Home (start of text) ────────────────────────────────────────
      if (key.home) {
        setCursorPos(0);
        return;
      }

      // ── End (end of text) ───────────────────────────────────────────
      if (key.end) {
        setCursorPos(value.length);
        return;
      }

      // ── Regular character input ─────────────────────────────────────
      if (input.length === 1 && !key.ctrl && !key.meta) {
        const newValue =
          value.slice(0, cursorPos) + input + value.slice(cursorPos);
        setValue(newValue);
        setCursorPos(cursorPos + 1);
      }
    },
  );

  // ── Derived values ──────────────────────────────────────────────────────

  const lineCount = value.length > 0 ? value.split('\n').length : 1;
  const charCount = value.length;
  const currentLine = value.slice(0, cursorPos).split('\n').length; // 1-based
  const currentCol = cursorPos - (value.lastIndexOf('\n', cursorPos - 1) + 1) + 1; // 1-based

  // Determine border color based on state
  const borderColor = disabled ? 'gray' : (historyIndex !== null ? 'green' : value.length > 0 ? 'yellow' : 'cyan');

  // If the input has many lines, show a scroll hint
  const isMultiLine = lineCount > 1;
  const showScrollHint = lineCount > 6;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
    >
      {/* Status info bar (styling only) */}
      <Box>
        <Text color="gray" dimColor>
          {historyIndex !== null && promptHistory.length > 0
            ? `History ${historyIndex + 1}/${promptHistory.length}`
            : isMultiLine
              ? `${lineCount} lines, ${charCount} chars`
              : `${charCount} chars`}
          {' · '}{historyIndex !== null ? '↑↓ history' : `Ln ${currentLine}, Col ${currentCol}`}
          {disabled && ' · processing...'}
        </Text>
      </Box>

      {/* Input box */}
      <Box
        borderStyle="round"
        borderColor={borderColor}
        paddingX={1}
        paddingY={0}
        minHeight={3}
        flexShrink={0}
      >
        <Box flexDirection="column" width="100%">
          {/* Prompt character + value */}
          <Box>
            <Text color="cyan" bold>{'❯ '}</Text>
            {value.length === 0 && !disabled ? (
              <Text color="gray" italic>
                {placeholder}
              </Text>
            ) : (
              <Box flexDirection="column">
                {getVisibleLines(value, 5).map((line, i) => (
                  <Text key={i} wrap="wrap">{line}</Text>
                ))}
              </Box>
            )}
          </Box>
          {/* Scroll hint for very long inputs */}
          {showScrollHint && (
            <Box marginTop={1}>
              <Text color="gray" dimColor>↑ {lineCount - 5} more line(s) above</Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
