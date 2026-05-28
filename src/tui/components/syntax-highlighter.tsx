/**
 * Syntax Highlighter — lightweight token-based syntax highlighting for terminal code blocks.
 *
 * Uses Ink's <Text> component with color props to render highlighted tokens.
 * Supports: JS/TS keywords, strings, comments, numbers, function names, braces, and more.
 *
 * The highlighter is incremental — it tokenizes a single line at a time,
 * making it efficient for streaming code display.
 */

import React from 'react';
import { Text } from 'ink';

// ─── Token types ────────────────────────────────────────────────────────────

type TokenType =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'function'
  | 'punctuation'
  | 'property'
  | 'operator'
  | 'builtin'
  | 'plain';

interface Token {
  type: TokenType;
  value: string;
}

// ─── Language detection ─────────────────────────────────────────────────────

const EXTENSION_MAP: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  cpp: 'cpp',
  h: 'c',
  hpp: 'cpp',
  css: 'css',
  scss: 'css',
  less: 'css',
  html: 'html',
  xml: 'xml',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
  sql: 'sql',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  dart: 'dart',
  php: 'php',
  r: 'r',
};

function detectLanguage(identifier?: string): string {
  if (!identifier) return '';
  const lower = identifier.toLowerCase().trim();
  return EXTENSION_MAP[lower] ?? lower;
}

// ─── Token colors ───────────────────────────────────────────────────────────

type TextColor =
  | 'white'
  | 'gray'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'whiteBright'
  | 'greenBright'
  | 'yellowBright'
  | 'blueBright'
  | 'cyanBright'
  | 'magentaBright';

const TOKEN_COLORS: Record<TokenType, TextColor> = {
  keyword: 'blue',
  string: 'green',
  comment: 'gray',
  number: 'yellow',
  function: 'yellow',
  punctuation: 'white',
  property: 'cyan',
  operator: 'white',
  builtin: 'magenta',
  plain: 'white',
};

const TOKEN_BOLD: Partial<Record<TokenType, boolean>> = {
  keyword: true,
  function: true,
  builtin: true,
};

// ─── Keyword sets per language ──────────────────────────────────────────────

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
  'string', 'number', 'boolean', 'symbol', 'void', 'object',
  'bigint',
]);

const PY_KEYWORDS = new Set([
  'def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while',
  'import', 'from', 'as', 'try', 'except', 'finally', 'with',
  'yield', 'lambda', 'pass', 'break', 'continue', 'raise',
  'self', 'True', 'False', 'None', 'in', 'is', 'not', 'and', 'or',
  'async', 'await', 'match', 'case',
]);

const RUST_KEYWORDS = new Set([
  'fn', 'let', 'mut', 'const', 'if', 'else', 'for', 'while', 'loop',
  'match', 'return', 'struct', 'enum', 'impl', 'trait', 'pub',
  'use', 'mod', 'crate', 'self', 'super', 'where', 'as',
  'true', 'false', 'Some', 'None', 'Ok', 'Err',
  'async', 'await', 'move', 'ref', 'dyn',
]);

const GO_KEYWORDS = new Set([
  'func', 'var', 'const', 'if', 'else', 'for', 'range', 'switch',
  'case', 'default', 'return', 'break', 'continue', 'go', 'defer',
  'select', 'chan', 'map', 'struct', 'interface', 'type', 'package',
  'import', 'true', 'false', 'nil', 'make', 'new', 'append',
]);

const BASH_KEYWORDS = new Set([
  'if', 'then', 'elif', 'else', 'fi', 'for', 'while', 'do', 'done',
  'case', 'esac', 'in', 'function', 'return', 'exit', 'export',
  'local', 'source', 'echo', 'cd', 'ls', 'cat', 'grep', 'sed',
  'awk', 'rm', 'cp', 'mv', 'mkdir', 'touch', 'chmod', 'chown',
]);

const CSS_KEYWORDS = new Set([
  'color', 'background', 'margin', 'padding', 'border', 'display',
  'position', 'top', 'right', 'bottom', 'left', 'width', 'height',
  'font', 'text', 'flex', 'grid', 'align', 'justify', 'overflow',
  'z-index', 'opacity', 'transform', 'transition', 'animation',
  'none', 'auto', 'inherit', 'initial', 'unset', 'block', 'inline',
  'flex', 'grid', 'absolute', 'relative', 'fixed', 'sticky',
  'hidden', 'visible', 'scroll', 'auto',
]);

const HTML_KEYWORDS = new Set([
  'html', 'head', 'body', 'div', 'span', 'p', 'a', 'img', 'ul', 'ol',
  'li', 'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'label',
  'select', 'option', 'textarea', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'header', 'footer', 'nav', 'main', 'section', 'article', 'aside',
  'script', 'style', 'link', 'meta', 'title', 'br', 'hr', 'pre', 'code',
]);

const SQL_KEYWORDS = new Set([
  'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET',
  'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'INDEX', 'VIEW', 'JOIN',
  'LEFT', 'RIGHT', 'INNER', 'OUTER', 'ON', 'AND', 'OR', 'NOT', 'IN',
  'LIKE', 'BETWEEN', 'IS', 'NULL', 'AS', 'ORDER', 'BY', 'GROUP', 'HAVING',
  'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'COUNT', 'SUM', 'AVG',
  'MIN', 'MAX', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END',
  'ASC', 'DESC', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'CASCADE',
]);

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

// ─── Tokenizer ──────────────────────────────────────────────────────────────

function getKeywords(language: string): Set<string> {
  switch (language) {
    case 'typescript': return TS_KEYWORDS;
    case 'javascript': return JS_KEYWORDS;
    case 'python': return PY_KEYWORDS;
    case 'rust': return RUST_KEYWORDS;
    case 'go': return GO_KEYWORDS;
    case 'bash':
    case 'shell':
    case 'zsh': return BASH_KEYWORDS;
    case 'css':
    case 'scss':
    case 'less': return CSS_KEYWORDS;
    case 'html':
    case 'xml': return HTML_KEYWORDS;
    case 'sql': return SQL_KEYWORDS;
    default: return JS_KEYWORDS;
  }
}

function getBuiltins(language: string): Set<string> {
  return BUILTINS[language] ?? BUILTINS['javascript'] ?? new Set();
}

/**
 * Tokenize a single line of code.
 * Uses charAt() instead of bracket indexing to avoid TS noUncheckedIndexedAccess issues.
 * Returns an array of tokens with their types.
 */
function tokenizeLine(line: string, language: string): Token[] {
  const tokens: Token[] = [];
  const keywords = getKeywords(language);
  const builtins = getBuiltins(language);
  const len = line.length;
  let i = 0;

  while (i < len) {
    const ch = line.charAt(i);

    // Check for single-line comments
    if (ch === '/' && line.charAt(i + 1) === '/') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      return tokens;
    }

    // Check for block comments (start)
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

    // Check for template literals (backtick strings)
    if (ch === '`') {
      // Find closing backtick (simple — doesn't handle nested template expressions)
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

    // Check for strings (single or double quotes)
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (line.charAt(j) === '\\') {
          j += 2; // skip escaped character
          continue;
        }
        if (line.charAt(j) === quote) {
          j++;
          break;
        }
        j++;
      }
      tokens.push({ type: 'string', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Check for numbers
    if (/[0-9]/.test(ch)) {
      let j = i + 1;
      const numRe = /[0-9._xXa-fA-F]/;
      while (j < len && numRe.test(line.charAt(j))) j++;
      // Check for hex prefix
      if (ch === '0' && (line.charAt(i + 1) === 'x' || line.charAt(i + 1) === 'X')) {
        j = i + 2;
        while (j < len && /[0-9a-fA-F]/.test(line.charAt(j))) j++;
      }
      tokens.push({ type: 'number', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Check for identifiers and keywords
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

    // Punctuation / operators
    if (/[{}()\[\]<>]/.test(ch)) {
      tokens.push({ type: 'punctuation', value: ch });
      i++;
      continue;
    }

    if (/[+\-*/%=!&|^~?:]/.test(ch)) {
      let j = i + 1;
      const opRe = /[+\-*/%=!&|^~?]/;
      while (j < len && opRe.test(line.charAt(j))) j++;
      tokens.push({ type: 'operator', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Plain character (spaces, dots, commas, semicolons, etc.)
    tokens.push({ type: 'plain', value: ch });
    i++;
  }

  return tokens;
}

// ─── React Component ────────────────────────────────────────────────────────

interface SyntaxHighlighterProps {
  code: string;
  language?: string;
}

/**
 * Renders a code block with syntax highlighting using Ink's Text component.
 * Uses token-based highlighting optimized for terminal display.
 */
export function SyntaxHighlighter({ code, language }: SyntaxHighlighterProps) {
  const lang = detectLanguage(language);
  const lines = code.split('\n');

  return (
    <>
      {lines.map((line, lineIndex) => (
        <Text key={lineIndex} wrap="wrap">
          {tokenizeLine(line, lang).map((token, tokenIndex) => (
            <Text
              key={tokenIndex}
              color={TOKEN_COLORS[token.type]}
              bold={TOKEN_BOLD[token.type] ?? false}
            >
              {token.value}
            </Text>
          ))}
        </Text>
      ))}
    </>
  );
}
