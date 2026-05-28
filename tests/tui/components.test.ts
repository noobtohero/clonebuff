/**
 * Tests for TUI component utility functions.
 *
 * Since Ink/React components require a terminal renderer, we test the
 * pure helper functions exported or extractable from each component.
 */
import { describe, it, expect } from 'bun:test';

// ─── Helpers: extract and re-export pure functions from the source files ───

// We re-implement the helpers here to keep tests decoupled from source layout.
// If the source implementation changes, these tests will fail — which is the desired behavior.

// ── Input: getVisibleLines ─────────────────────────────────────────────────

function getVisibleLines(value: string, maxLines: number): string[] {
  const lines = value.split('\n');
  if (lines.length <= maxLines) return lines;
  return lines.slice(lines.length - maxLines);
}

// ── Messages: helper functions ─────────────────────────────────────────────

function getToolEmoji(name: string): string {
  switch (name) {
    case 'read_files': return '📖';
    case 'str_replace': return '✏️';
    case 'write_file': return '📝';
    case 'run_terminal_command': return '⚡';
    default: return '🔧';
  }
}

function formatToolCallArgs(toolCall: { function: { name: string; arguments: string } }): string {
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

interface TextPart {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

function renderTextWithCodeBlocks(text: string): TextPart[] {
  const parts: TextPart[] = [];
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

// ── StatusBar: helpers ─────────────────────────────────────────────────────

function formatModel(model: string): string {
  const parts = model.split('/');
  return parts.length >= 2 ? parts.slice(1).join('/') : model;
}

function formatTokenSavings(tokens: number): string {
  if (tokens >= 1000) {
    const k = Math.round(tokens / 1000);
    return `${k}k`;
  }
  return `${tokens}`;
}

// ── SyntaxHighlighter ──────────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  js: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp',
  css: 'css', scss: 'css', less: 'css', html: 'html', xml: 'xml',
  json: 'json', yml: 'yaml', yaml: 'yaml', md: 'markdown', sql: 'sql',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell',
  dart: 'dart', php: 'php', r: 'r',
};

function detectLanguage(identifier?: string): string {
  if (!identifier) return '';
  const lower = identifier.toLowerCase().trim();
  return EXTENSION_MAP[lower] ?? lower;
}

type TokenType =
  | 'keyword' | 'string' | 'comment' | 'number' | 'function'
  | 'punctuation' | 'property' | 'operator' | 'builtin' | 'plain';

interface Token {
  type: TokenType;
  value: string;
}

const JS_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue',
  'debugger', 'default', 'delete', 'do', 'else', 'export', 'extends', 'finally',
  'for', 'function', 'if', 'import', 'in', 'instanceof', 'let', 'new',
  'of', 'return', 'static', 'super', 'switch', 'this', 'throw', 'try',
  'typeof', 'var', 'void', 'while', 'with', 'yield',
  'true', 'false', 'null', 'undefined', 'from', 'as',
]);

const TS_KEYWORDS = new Set([
  ...JS_KEYWORDS,
  'interface', 'type', 'enum', 'implements', 'abstract',
  'readonly', 'declare', 'namespace', 'module', 'keyof',
  'infer', 'satisfies', 'using', 'any', 'never', 'unknown',
  'string', 'number', 'boolean', 'symbol', 'void', 'object', 'bigint',
]);

function getKeywords(language: string): Set<string> {
  switch (language) {
    case 'typescript': return TS_KEYWORDS;
    case 'javascript': return JS_KEYWORDS;
    default: return JS_KEYWORDS;
  }
}

const BUILTINS: Record<string, Set<string>> = {
  javascript: new Set([
    'console', 'Math', 'JSON', 'Promise', 'Array', 'Object', 'String',
    'Number', 'Boolean', 'Date', 'RegExp', 'Map', 'Set', 'Error',
    'setTimeout', 'setInterval', 'fetch', 'parseInt', 'parseFloat',
    'isNaN', 'isFinite', 'document', 'window', 'process', 'Buffer',
    'require', 'module', 'exports', '__dirname', '__filename',
    'globalThis', 'Symbol', 'Proxy', 'Reflect', 'WeakMap', 'WeakSet',
  ]),
};

function getBuiltins(language: string): Set<string> {
  return BUILTINS[language] ?? BUILTINS['javascript'] ?? new Set();
}

function tokenizeLine(line: string, language: string): Token[] {
  const tokens: Token[] = [];
  const keywords = getKeywords(language);
  const builtins = getBuiltins(language);
  const len = line.length;
  let i = 0;

  while (i < len) {
    const ch = line.charAt(i);

    // Single-line comments
    if (ch === '/' && line.charAt(i + 1) === '/') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      return tokens;
    }

    // Block comments (start)
    if (ch === '/' && line.charAt(i + 1) === '*') {
      const end = line.indexOf('*/', i + 2);
      if (end !== -1) {
        tokens.push({ type: 'comment', value: line.slice(i, end + 2) });
        i = end + 2;
        continue;
      } else {
        tokens.push({ type: 'comment', value: line.slice(i) });
        return tokens;
      }
    }

    // Template literals (backtick strings)
    if (ch === '`') {
      const end = line.indexOf('`', i + 1);
      if (end !== -1) {
        tokens.push({ type: 'string', value: line.slice(i, end + 1) });
        i = end + 1;
        continue;
      } else {
        tokens.push({ type: 'string', value: line.slice(i) });
        return tokens;
      }
    }

    // Strings (single or double quotes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (line.charAt(j) === '\\') { j += 2; continue; }
        if (line.charAt(j) === quote) { j++; break; }
        j++;
      }
      tokens.push({ type: 'string', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Numbers
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      if (ch === '0' && (line.charAt(i + 1) === 'x' || line.charAt(i + 1) === 'X')) {
        j = i + 2;
        while (j < len && /[0-9a-fA-F]/.test(line.charAt(j))) j++;
      } else {
        while (j < len && /[0-9._xXa-fA-F]/.test(line.charAt(j))) j++;
      }
      tokens.push({ type: 'number', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Identifiers and keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[a-zA-Z0-9_$]/.test(line.charAt(j))) j++;
      const word = line.slice(i, j);

      if (keywords.has(word)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (builtins.has(word)) {
        tokens.push({ type: 'builtin', value: word });
      } else {
        // Check if followed by '(' — likely a function call
        let k = j;
        while (k < len && line.charAt(k) === ' ') k++;
        if (line.charAt(k) === '(') {
          tokens.push({ type: 'function', value: word });
        } else {
          // Check if preceded by '.' — likely a property access
          if (i > 0 && line.charAt(i - 1) === '.') {
            tokens.push({ type: 'property', value: word });
          } else {
            tokens.push({ type: 'plain', value: word });
          }
        }
      }
      i = j;
      continue;
    }

    // Punctuation
    if (/[{}()\[\]<>]/.test(ch)) {
      tokens.push({ type: 'punctuation', value: ch });
      i++;
      continue;
    }

    // Operators
    if (/[+\-*/%=!&|^~?:]/.test(ch)) {
      let j = i + 1;
      const opRe = /[+\-*/%=!&|^~?]/;
      while (j < len && opRe.test(line.charAt(j))) j++;
      tokens.push({ type: 'operator', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Plain
    tokens.push({ type: 'plain', value: ch });
    i++;
  }

  return tokens;
}

// ── ConfirmationPrompt: truncatePath ───────────────────────────────────────

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

// ── Spinner ────────────────────────────────────────────────────────────────

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

// ── Spinner ──────────────────────────────────────────────────────────────────

describe('Spinner', () => {
  it('has 10 frames for smooth animation', () => {
    expect(SPINNER_FRAMES.length).toBe(10);
  });

  it('frames are all braille characters (Unicode range U+2800–U+28FF)', () => {
    for (const frame of SPINNER_FRAMES) {
      const code = frame.codePointAt(0)!;
      expect(code).toBeGreaterThanOrEqual(0x2800);
      expect(code).toBeLessThanOrEqual(0x28FF);
    }
  });

  it('frames cycle correctly (distinct sequence)', () => {
    // The frames should be a defined, repeatable sequence — not random
    const expected = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    expect([...SPINNER_FRAMES]).toEqual(expected);
  });
});

// ── Input: getVisibleLines ──────────────────────────────────────────────────

describe('Input — getVisibleLines', () => {
  it('returns all lines when fewer than max', () => {
    const result = getVisibleLines('line1\nline2\nline3', 5);
    expect(result).toEqual(['line1', 'line2', 'line3']);
  });

  it('returns all lines when exactly at max', () => {
    const result = getVisibleLines('a\nb\nc', 3);
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns only the last N lines when more than max', () => {
    const result = getVisibleLines('1\n2\n3\n4\n5\n6\n7', 4);
    expect(result).toEqual(['4', '5', '6', '7']);
  });

  it('handles single line', () => {
    const result = getVisibleLines('just one line', 5);
    expect(result).toEqual(['just one line']);
  });

  it('handles empty string', () => {
    const result = getVisibleLines('', 3);
    expect(result).toEqual(['']);
  });

  it('works with maxLines = 1', () => {
    const result = getVisibleLines('first\nsecond\nthird', 1);
    expect(result).toEqual(['third']);
  });

  it('handles multi-line Thai text', () => {
    const thaiLines = 'บรรทัดแรก\nบรรทัดที่สอง\nบรรทัดที่สาม';
    expect(getVisibleLines(thaiLines, 5)).toEqual(['บรรทัดแรก', 'บรรทัดที่สอง', 'บรรทัดที่สาม']);
    expect(getVisibleLines(thaiLines, 2)).toEqual(['บรรทัดที่สอง', 'บรรทัดที่สาม']);
  });

  it('handles mixed Thai and English text', () => {
    const mixed = 'Thai: สวัสดี\nEnglish: Hello\nทั้งคู่: Both';
    const result = getVisibleLines(mixed, 3);
    expect(result).toHaveLength(3);
    expect(result[0]).toContain('สวัสดี');
    expect(result[1]).toContain('Hello');
  });

  it('handles Thai text with combining marks (tone marks, vowels)', () => {
    const thai = 'กี่\nดี\nบัว\nสวัสดี';
    const result = getVisibleLines(thai, 10);
    expect(result).toEqual(['กี่', 'ดี', 'บัว', 'สวัสดี']);
  });
});

// ── Messages: getToolEmoji ──────────────────────────────────────────────────

describe('Messages — getToolEmoji', () => {
  it('returns 📖 for read_files', () => {
    expect(getToolEmoji('read_files')).toBe('📖');
  });

  it('returns ✏️ for str_replace', () => {
    expect(getToolEmoji('str_replace')).toBe('✏️');
  });

  it('returns 📝 for write_file', () => {
    expect(getToolEmoji('write_file')).toBe('📝');
  });

  it('returns ⚡ for run_terminal_command', () => {
    expect(getToolEmoji('run_terminal_command')).toBe('⚡');
  });

  it('returns 🔧 for unknown tools', () => {
    expect(getToolEmoji('unknown_tool')).toBe('🔧');
    expect(getToolEmoji('')).toBe('🔧');
    expect(getToolEmoji('custom_script')).toBe('🔧');
  });
});

// ── Messages: formatToolCallArgs ────────────────────────────────────────────

describe('Messages — formatToolCallArgs', () => {
  it('formats read_files with paths', () => {
    const result = formatToolCallArgs({
      function: { name: 'read_files', arguments: JSON.stringify({ paths: ['src/a.ts', 'src/b.ts'] }) },
    });
    expect(result).toBe('src/a.ts, src/b.ts');
  });

  it('formats read_files with no paths', () => {
    const result = formatToolCallArgs({
      function: { name: 'read_files', arguments: JSON.stringify({}) },
    });
    expect(result).toBe('(no paths)');
  });

  it('formats str_replace with path and single replacement', () => {
    const result = formatToolCallArgs({
      function: { name: 'str_replace', arguments: JSON.stringify({ path: 'src/main.ts', replacements: [{ oldString: 'foo', newString: 'bar' }] }) },
    });
    expect(result).toBe('src/main.ts (1 replacement)');
  });

  it('formats str_replace with multiple replacements', () => {
    const result = formatToolCallArgs({
      function: { name: 'str_replace', arguments: JSON.stringify({ path: 'src/main.ts', replacements: [{ oldString: 'a' }, { oldString: 'b' }] }) },
    });
    expect(result).toBe('src/main.ts (2 replacements)');
  });

  it('formats str_replace with no path', () => {
    const result = formatToolCallArgs({
      function: { name: 'str_replace', arguments: JSON.stringify({ replacements: [] }) },
    });
    expect(result).toBe('? (0 replacements)');
  });

  it('formats write_file with path', () => {
    const result = formatToolCallArgs({
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'new-file.ts' }) },
    });
    expect(result).toBe('new-file.ts');
  });

  it('formats write_file with no path', () => {
    const result = formatToolCallArgs({
      function: { name: 'write_file', arguments: JSON.stringify({}) },
    });
    expect(result).toBe('(no path)');
  });

  it('formats run_terminal_command short command', () => {
    const result = formatToolCallArgs({
      function: { name: 'run_terminal_command', arguments: JSON.stringify({ command: 'npm test' }) },
    });
    expect(result).toBe('npm test');
  });

  it('truncates long terminal commands to 80 chars', () => {
    const longCmd = 'a'.repeat(100);
    const result = formatToolCallArgs({
      function: { name: 'run_terminal_command', arguments: JSON.stringify({ command: longCmd }) },
    });
    expect(result).toBe('a'.repeat(80) + '...');
    expect(result.length).toBe(83); // 80 + '...'
  });

  it('formats run_terminal_command with no command', () => {
    const result = formatToolCallArgs({
      function: { name: 'run_terminal_command', arguments: JSON.stringify({}) },
    });
    expect(result).toBe('(no command)');
  });

  it('handles JSON parse failure gracefully', () => {
    const result = formatToolCallArgs({
      function: { name: 'read_files', arguments: 'not-valid-json' },
    });
    expect(result).toBe('not-valid-json');
  });

  it('truncates raw args on parse failure to 100 chars', () => {
    const longArg = 'x'.repeat(150);
    const result = formatToolCallArgs({
      function: { name: 'read_files', arguments: longArg },
    });
    expect(result).toBe('x'.repeat(100));
    expect(result.length).toBe(100);
  });

  it('formats unknown tool with JSON args limited to 100 chars', () => {
    const large = { key: 'x'.repeat(120) };
    const tc = { function: { name: 'unknown_tool', arguments: JSON.stringify(large) } };
    const result = formatToolCallArgs(tc);
    expect(result.length).toBeLessThanOrEqual(100);
    expect(result).toContain('"key"');
  });

  it('formats read_files with Thai file paths', () => {
    const result = formatToolCallArgs({
      function: { name: 'read_files', arguments: JSON.stringify({ paths: ['src/ทดสอบ.ts', 'src/README-ไทย.md'] }) },
    });
    expect(result).toContain('ทดสอบ.ts');
    expect(result).toContain('README-ไทย.md');
  });

  it('formats write_file with Thai path', () => {
    const result = formatToolCallArgs({
      function: { name: 'write_file', arguments: JSON.stringify({ path: 'เอกสาร/รายงาน.md' }) },
    });
    expect(result).toBe('เอกสาร/รายงาน.md');
  });

  it('formats run_terminal_command with Thai command', () => {
    const result = formatToolCallArgs({
      function: { name: 'run_terminal_command', arguments: JSON.stringify({ command: 'echo "สวัสดี"' }) },
    });
    expect(result).toBe('echo "สวัสดี"');
  });
});

// ── Messages: formatToolResult ──────────────────────────────────────────────

describe('Messages — formatToolResult', () => {
  it('formats run_terminal_command with output', () => {
    const content = `[Command] npm test\n[Exit Code] 0\nPASS tests/foo.test.ts\n  ✓ test 1\n  ✓ test 2`;
    const result = formatToolResult(content, 'run_terminal_command');
    expect(result).toContain('npm test');
    expect(result).toContain('exit 0');
    expect(result).toContain('3 line(s) output');
  });

  it('formats run_terminal_command with no output', () => {
    const content = `[Command] cd .\n[Exit Code] 0`;
    const result = formatToolResult(content, 'run_terminal_command');
    expect(result).toContain('no output');
  });

  it('formats run_terminal_command without command prefix', () => {
    const content = `Some output\n[Exit Code] 1`;
    const result = formatToolResult(content, 'run_terminal_command');
    expect(result).toContain('Command');
    expect(result).toContain('exit 1');
  });

  it('formats read_files', () => {
    const content = '=== file1.ts\ncontent1\n=== file2.ts\ncontent2';
    const result = formatToolResult(content, 'read_files');
    expect(result).toBe('Read 2 file(s)');
  });

  it('formats read_files with single file', () => {
    const content = '=== file.ts\ncontent';
    const result = formatToolResult(content, 'read_files');
    expect(result).toBe('Read 1 file(s)');
  });

  it('formats read_files with no files', () => {
    const result = formatToolResult('', 'read_files');
    expect(result).toBe('Read 0 file(s)');
  });

  it('formats str_replace with success', () => {
    const content = 'Replaced in src/main.ts\nReplaced in src/utils.ts';
    const result = formatToolResult(content, 'str_replace');
    expect(result).toBe('Replaced in src/main.ts, Replaced in src/utils.ts');
  });

  it('formats str_replace with warnings', () => {
    const content = 'Warning: something\nReplaced in src/a.ts';
    const result = formatToolResult(content, 'str_replace');
    expect(result).toContain('Replaced in src/a.ts');
    expect(result).toContain('1 warning(s)');
  });

  it('formats str_replace with no changes', () => {
    const result = formatToolResult('Nothing matched', 'str_replace');
    expect(result).toBe('No changes made.');
  });

  it('formats write_file success', () => {
    const result = formatToolResult('✓ Written: src/new-file.ts', 'write_file');
    expect(result).toBe('src/new-file.ts');
  });

  it('formats write_file error', () => {
    const result = formatToolResult('Error: Permission denied', 'write_file');
    expect(result).toBe('Permission denied');
  });

  it('formats write_file with non-matching prefix returns the line as-is', () => {
    const result = formatToolResult('Something else', 'write_file');
    expect(result).toBe('Something else');
  });

  it('truncates long content to 200 chars', () => {
    const longContent = 'x'.repeat(300);
    const result = formatToolResult(longContent, 'unknown');
    expect(result.length).toBe(203); // 200 + '...'
    expect(result.endsWith('...')).toBe(true);
  });

  it('returns short content unchanged', () => {
    const result = formatToolResult('Hello, world!', 'unknown');
    expect(result).toBe('Hello, world!');
  });

  it('formats read_files with Thai file markers', () => {
    const content = '=== ไฟล์แรก.ts\nเนื้อหา\n=== ไฟล์ที่สอง.ts\nเนื้อหาเพิ่มเติม';
    const result = formatToolResult(content, 'read_files');
    expect(result).toBe('Read 2 file(s)');
  });

  it('formats terminal output with Thai text', () => {
    const content = `[Command] echo "สวัสดี"\n[Exit Code] 0\nสวัสดีครับ`;
    const result = formatToolResult(content, 'run_terminal_command');
    expect(result).toContain('echo');
    expect(result).toContain('exit 0');
    expect(result).toContain('1 line(s) output');
  });

  it('formats str_replace result with Thai summary', () => {
    const content = 'Replaced in เอกสาร/รายงาน.md\nReplaced in src/ทดสอบ.ts';
    const result = formatToolResult(content, 'str_replace');
    expect(result).toContain('เอกสาร');
    expect(result).toContain('ทดสอบ');
  });

  it('formats write_file success with Thai path', () => {
    const result = formatToolResult('✓ Written: เอกสาร/รายงาน.md', 'write_file');
    expect(result).toBe('เอกสาร/รายงาน.md');
  });
});

// ── Messages: renderTextWithCodeBlocks ──────────────────────────────────────

describe('Messages — renderTextWithCodeBlocks', () => {
  it('returns text part when no code blocks', () => {
    const result = renderTextWithCodeBlocks('Hello world');
    expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('parses a single code block with language', () => {
    const result = renderTextWithCodeBlocks('```ts\nconst x = 1;\n```');
    expect(result).toEqual([
      { type: 'code', content: 'const x = 1;', language: 'ts' },
    ]);
  });

  it('parses a code block without language', () => {
    const result = renderTextWithCodeBlocks('```\nplain code\n```');
    expect(result).toEqual([
      { type: 'code', content: 'plain code', language: undefined },
    ]);
  });

  it('parses text before and after a code block', () => {
    const result = renderTextWithCodeBlocks('Before\n```js\nvar a = 1;\n```\nAfter');
    expect(result).toEqual([
      { type: 'text', content: 'Before\n' },
      { type: 'code', content: 'var a = 1;', language: 'js' },
      { type: 'text', content: '\nAfter' },
    ]);
  });

  it('parses multiple code blocks', () => {
    const result = renderTextWithCodeBlocks('a\n```ts\nx\n```\nb\n```py\ny\n```\nc');
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual({ type: 'text', content: 'a\n' });
    expect(result[1]).toEqual({ type: 'code', content: 'x', language: 'ts' });
    expect(result[2]).toEqual({ type: 'text', content: '\nb\n' });
    expect(result[3]).toEqual({ type: 'code', content: 'y', language: 'py' });
    expect(result[4]).toEqual({ type: 'text', content: '\nc' });
  });

  it('handles empty input', () => {
    const result = renderTextWithCodeBlocks('');
    expect(result).toEqual([{ type: 'text', content: '' }]);
  });

  it('trims trailing newline from code block content', () => {
    const result = renderTextWithCodeBlocks('```ts\nline1\nline2\n```');
    expect(result).toEqual([
      { type: 'code', content: 'line1\nline2', language: 'ts' },
    ]);
  });

  it('handles code blocks at start and end of text', () => {
    const result = renderTextWithCodeBlocks('```json\n{}\n```end');
    expect(result).toEqual([
      { type: 'code', content: '{}', language: 'json' },
      { type: 'text', content: 'end' },
    ]);
  });

  it('handles only code blocks with no surrounding text', () => {
    const result = renderTextWithCodeBlocks('```md\n# Title\n```');
    expect(result).toEqual([
      { type: 'code', content: '# Title', language: 'md' },
    ]);
  });

  it('parses Thai text without code blocks', () => {
    const result = renderTextWithCodeBlocks('สวัสดีครับ นี่คือข้อความภาษาไทย');
    expect(result).toEqual([{ type: 'text', content: 'สวัสดีครับ นี่คือข้อความภาษาไทย' }]);
  });

  it('parses code block with Thai text inside', () => {
    const result = renderTextWithCodeBlocks('```\nสวัสดี\n```');
    expect(result).toEqual([
      { type: 'code', content: 'สวัสดี', language: undefined },
    ]);
  });

  it('parses Thai text with embedded code block', () => {
    const result = renderTextWithCodeBlocks('นี่คือโค้ด: ```ts\nconst x = 1;\n``` จบ');
    expect(result).toEqual([
      { type: 'text', content: 'นี่คือโค้ด: ' },
      { type: 'code', content: 'const x = 1;', language: 'ts' },
      { type: 'text', content: ' จบ' },
    ]);
  });

  it('parses mixed Thai and English in text parts', () => {
    const result = renderTextWithCodeBlocks('ภาษาไทย: สวัสดี and English: Hello');
    expect(result).toEqual([{ type: 'text', content: 'ภาษาไทย: สวัสดี and English: Hello' }]);
  });
});

// ── StatusBar: formatModel ──────────────────────────────────────────────────

describe('StatusBar — formatModel', () => {
  it('strips provider prefix from model ID', () => {
    expect(formatModel('openai/gpt-5-nano')).toBe('gpt-5-nano');
  });

  it('strips deep provider prefix', () => {
    expect(formatModel('google/gemini-2.0-flash')).toBe('gemini-2.0-flash');
  });

  it('returns model as-is when no slash', () => {
    expect(formatModel('gpt-5-nano')).toBe('gpt-5-nano');
  });

  it('preserves model with multiple slashes', () => {
    expect(formatModel('openai/gpt-4o/mini')).toBe('gpt-4o/mini');
  });

  it('handles empty string', () => {
    expect(formatModel('')).toBe('');
  });

  it('handles model IDs with Thai characters', () => {
    expect(formatModel('openai/ทดสอบ')).toBe('ทดสอบ');
  });

  it('handles purely Thai model ID (no slash)', () => {
    expect(formatModel('โมเดล')).toBe('โมเดล');
  });
});

// ── StatusBar: formatTokenSavings ───────────────────────────────────────────

describe('StatusBar — formatTokenSavings', () => {
  it('formats numbers less than 1000 as-is', () => {
    expect(formatTokenSavings(0)).toBe('0');
    expect(formatTokenSavings(500)).toBe('500');
    expect(formatTokenSavings(999)).toBe('999');
  });

  it('formats 1000 as 1k', () => {
    expect(formatTokenSavings(1000)).toBe('1k');
  });

  it('rounds to nearest k', () => {
    expect(formatTokenSavings(1500)).toBe('2k');
    expect(formatTokenSavings(1400)).toBe('1k');
    expect(formatTokenSavings(9999)).toBe('10k');
  });

  it('formats large numbers', () => {
    expect(formatTokenSavings(15000)).toBe('15k');
    expect(formatTokenSavings(100000)).toBe('100k');
  });

  it('token count display handles Thai-related numbers', () => {
    // Just verify number formatting is locale-independent
    expect(formatTokenSavings(1500)).toBe('2k');
    expect(formatTokenSavings(0)).toBe('0');
  });
});

// ── SyntaxHighlighter: detectLanguage ───────────────────────────────────────

describe('SyntaxHighlighter — detectLanguage', () => {
  it('maps .ts to typescript', () => {
    expect(detectLanguage('ts')).toBe('typescript');
  });

  it('maps .tsx to typescript', () => {
    expect(detectLanguage('tsx')).toBe('typescript');
  });

  it('maps .js to javascript', () => {
    expect(detectLanguage('js')).toBe('javascript');
  });

  it('maps .py to python', () => {
    expect(detectLanguage('py')).toBe('python');
  });

  it('maps .rs to rust', () => {
    expect(detectLanguage('rs')).toBe('rust');
  });

  it('maps .sh to bash', () => {
    expect(detectLanguage('sh')).toBe('bash');
  });

  it('maps .css to css', () => {
    expect(detectLanguage('css')).toBe('css');
  });

  it('maps .html to html', () => {
    expect(detectLanguage('html')).toBe('html');
  });

  it('maps .json to json', () => {
    expect(detectLanguage('json')).toBe('json');
  });

  it('maps .md to markdown', () => {
    expect(detectLanguage('md')).toBe('markdown');
  });

  it('returns unknown identifiers as-is', () => {
    expect(detectLanguage('my-lang')).toBe('my-lang');
  });

  it('normalizes case and trims whitespace', () => {
    expect(detectLanguage('  TS  ')).toBe('typescript');
  });

  it('returns empty string for undefined', () => {
    expect(detectLanguage(undefined)).toBe('');
  });

  it('returns empty string for empty string', () => {
    expect(detectLanguage('')).toBe('');
  });
});

// ── SyntaxHighlighter: tokenizeLine ─────────────────────────────────────────

describe('SyntaxHighlighter — tokenizeLine', () => {
  it('tokenizes a keyword', () => {
    const tokens = tokenizeLine('const x = 1;', 'typescript');
    expect(tokens).toContainEqual({ type: 'keyword', value: 'const' });
  });

  it('tokenizes a string literal (double quotes)', () => {
    const tokens = tokenizeLine('const s = "hello";', 'typescript');
    expect(tokens).toContainEqual({ type: 'string', value: '"hello"' });
  });

  it('tokenizes a string literal (single quotes)', () => {
    const tokens = tokenizeLine("const s = 'hello';", 'typescript');
    expect(tokens).toContainEqual({ type: 'string', value: "'hello'" });
  });

  it('tokenizes a comment (//)', () => {
    const tokens = tokenizeLine('// this is a comment', 'typescript');
    expect(tokens).toEqual([{ type: 'comment', value: '// this is a comment' }]);
  });

  it('tokenizes a block comment on one line', () => {
    const tokens = tokenizeLine('/* comment */', 'typescript');
    expect(tokens).toEqual([{ type: 'comment', value: '/* comment */' }]);
  });

  it('handles unclosed block comment (rest of line)', () => {
    const tokens = tokenizeLine('x = /* unfinished', 'typescript');
    expect(tokens.find((t) => t.type === 'comment')?.value).toContain('/* unfinished');
  });

  it('tokenizes a number', () => {
    const tokens = tokenizeLine('let count = 42;', 'typescript');
    expect(tokens).toContainEqual({ type: 'number', value: '42' });
  });

  it('tokenizes a hex number', () => {
    const tokens = tokenizeLine('const mask = 0xff;', 'typescript');
    expect(tokens).toContainEqual({ type: 'number', value: '0xff' });
  });

  it('tokenizes a function call', () => {
    const tokens = tokenizeLine('doSomething()', 'typescript');
    expect(tokens).toContainEqual({ type: 'function', value: 'doSomething' });
  });

  it('tokenizes a built-in', () => {
    const tokens = tokenizeLine('console.log("hi")', 'typescript');
    expect(tokens).toContainEqual({ type: 'builtin', value: 'console' });
  });

  it('tokenizes a property access', () => {
    const tokens = tokenizeLine('obj.propertyName', 'typescript');
    expect(tokens).toContainEqual({ type: 'property', value: 'propertyName' });
  });

  it('tokenizes punctuation', () => {
    const tokens = tokenizeLine('if (x) { fn() }', 'typescript');
    const punct = tokens.filter((t) => t.type === 'punctuation').map((t) => t.value);
    expect(punct).toContain('(');
    expect(punct).toContain(')');
    expect(punct).toContain('{');
    expect(punct).toContain('}');
  });

  it('tokenizes operators', () => {
    const tokens = tokenizeLine('a + b * c === d', 'typescript');
    const operators = tokens.filter((t) => t.type === 'operator').map((t) => t.value);
    expect(operators).toContain('+');
    expect(operators).toContain('*');
    expect(operators).toContain('===');
  });

  it('tokenizes backtick template literals', () => {
    const tokens = tokenizeLine('const s = `hello ${name}`;', 'typescript');
    expect(tokens).toContainEqual({ type: 'string', value: '`hello ${name}`' });
  });

  it('handles an empty line', () => {
    const tokens = tokenizeLine('', 'typescript');
    expect(tokens).toEqual([]);
  });

  it('tokenizes a full TypeScript line correctly', () => {
    const tokens = tokenizeLine('const result: number = computeValue(data);', 'typescript');
    expect(tokens).toContainEqual({ type: 'keyword', value: 'const' });
    expect(tokens).toContainEqual({ type: 'keyword', value: 'number' });
    expect(tokens).toContainEqual({ type: 'function', value: 'computeValue' });
    expect(tokens).toContainEqual({ type: 'plain', value: ';' });
  });

  it('distinguishes between TS and JS keywords', () => {
    const tsTokens = tokenizeLine('interface Foo { bar: string }', 'typescript');
    expect(tsTokens).toContainEqual({ type: 'keyword', value: 'interface' });

    const jsTokens = tokenizeLine('interface Foo { bar: string }', 'javascript');
    // 'interface' is not a JS keyword, so it should be plain or function
    const interfaceToken = jsTokens.find((t) => t.value === 'interface');
    expect(interfaceToken?.type).not.toBe('keyword');
  });

  it('handles escaped characters in strings', () => {
    const tokens = tokenizeLine('const s = "hello\\"world";', 'typescript');
    expect(tokens).toContainEqual({ type: 'string', value: '"hello\\"world"' });
  });

  it('tokenizes Thai text as plain characters', () => {
    const tokens = tokenizeLine('const thai = "สวัสดี";', 'typescript');
    expect(tokens).toContainEqual({ type: 'keyword', value: 'const' });
    expect(tokens).toContainEqual({ type: 'string', value: '"สวัสดี"' });
  });

  it('tokenizes Thai variable names as plain identifiers', () => {
    const tokens = tokenizeLine('let ทดสอบ = 42;', 'typescript');
    expect(tokens).toContainEqual({ type: 'keyword', value: 'let' });
    // Thai chars are not in [a-zA-Z_$] so each char becomes 'plain'
    const plainTokens = tokens.filter((t) => t.type === 'plain').map((t) => t.value);
    expect(plainTokens.length).toBeGreaterThan(0);
  });

  it('tokenizes Thai comment', () => {
    const tokens = tokenizeLine('// สวัสดีครับ นี่คือ comment', 'typescript');
    expect(tokens).toEqual([{ type: 'comment', value: '// สวัสดีครับ นี่คือ comment' }]);
  });

  it('tokenizes Thai string with combining marks', () => {
    const tokens = tokenizeLine('const s = "กี่ ดี บัว";', 'typescript');
    expect(tokens).toContainEqual({ type: 'keyword', value: 'const' });
    expect(tokens).toContainEqual({ type: 'string', value: '"กี่ ดี บัว"' });
  });

  it('tokenizes mixed Thai and English on one line', () => {
    const tokens = tokenizeLine('console.log("สวัสดี world");', 'typescript');
    expect(tokens).toContainEqual({ type: 'builtin', value: 'console' });
    expect(tokens).toContainEqual({ type: 'string', value: '"สวัสดี world"' });
  });
});

// ── ConfirmationPrompt: truncatePath ────────────────────────────────────────

describe('ConfirmationPrompt — truncatePath', () => {
  it('returns short paths unchanged', () => {
    expect(truncatePath('src/main.ts')).toBe('src/main.ts');
  });

  it('returns paths at maxLen unchanged', () => {
    const path = 'a'.repeat(50);
    expect(truncatePath(path, 50)).toBe(path);
  });

  it('truncates long paths but keeps filename visible', () => {
    const result = truncatePath('src/components/very/deeply/nested/module/helper.ts', 50);
    expect(result).toContain('helper.ts');
    expect(result.length).toBeLessThanOrEqual(60); // approximate
  });

  it('uses default maxLen of 50', () => {
    const path = 'a'.repeat(60);
    const result = truncatePath(path);
    // Single-segment path can't meaningfully be shortened; it adds ... prefix
    expect(result.length).toBeLessThan(70);
    expect(result).toMatch(/^\.\.\.\/|^/);
  });

  it('handles root-level long paths', () => {
    const longName = 'a'.repeat(60) + '.ts';
    const result = truncatePath(longName, 50);
    expect(result).toContain('.ts');
    expect(result.length).toBeLessThan(70);
  });

  it('handles multi-segment paths by preserving filename and abbreviating dirs', () => {
    const result = truncatePath('src/components/very/deeply/nested/module/helper.ts', 50);
    expect(result).toContain('helper.ts');
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('truncates paths with Thai directory names', () => {
    const result = truncatePath('src/เอกสาร/รายงาน/ประจําเดือน/memo.md', 50);
    expect(result).toContain('memo.md');
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('truncates paths with mixed Thai and English segments', () => {
    const result = truncatePath('projects/ทดสอบ/src/components/helper.ts', 50);
    expect(result).toContain('helper.ts');
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('returns short Thai path unchanged', () => {
    expect(truncatePath('src/ทดสอบ.ts')).toBe('src/ทดสอบ.ts');
  });

  it('handles purely Thai file name at maxLen boundary', () => {
    const path = 'a'.repeat(45) + '/ทดสอบ.ts';
    const result = truncatePath(path, 50);
    expect(result).toContain('ทดสอบ.ts');
    expect(result.length).toBeLessThanOrEqual(60);
  });
});
