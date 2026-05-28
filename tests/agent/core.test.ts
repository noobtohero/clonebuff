/**
 * Tests for src/agent/core.ts — tool execution engine.
 *
 * Covers:
 *  - read_files: single file, multiple files, file not found, path traversal, empty file
 *  - str_replace: single replacement, multi-occurrence (allowMultiple), no match, file not found
 *  - write_file: new file, overwrite, parent directory creation, empty content
 *  - run_terminal_command: basic command, non-zero exit, command with description
 *  - Unknown tool fallback
 *  - Invalid JSON arguments
 *  - Path safety: ../ traversal, absolute path outside, .git directory
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ToolCall } from '../../src/openrouter/types';

const { executeToolCall } = await import('../../src/agent/core');

// ─── Test Setup ─────────────────────────────────────────────────────────────

let baseDir: string;
let projectDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'clonebuff-test-core-'));
  projectDir = join(baseDir, 'project');
  mkdirSync(projectDir, { recursive: true });
});

afterEach(() => {
  // Clean all files inside projectDir between tests
  rmSync(projectDir, { recursive: true, force: true });
  mkdirSync(projectDir, { recursive: true });
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `call-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: 'function',
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

function makeToolCallWithRawArgs(name: string, rawJson: string): ToolCall {
  return {
    id: `call-${Date.now()}`,
    type: 'function',
    function: {
      name,
      arguments: rawJson,
    },
  };
}

// ─── read_files ─────────────────────────────────────────────────────────────

describe('executeToolCall — read_files', () => {
  it('reads a single existing file', async () => {
    const filePath = 'hello.txt';
    writeFileSync(join(projectDir, filePath), 'Hello, world!', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: [filePath] }),
      projectDir,
    );

    expect(result.name).toBe('read_files');
    expect(result.content).toContain('=== hello.txt ===');
    expect(result.content).toContain('Hello, world!');
  });

  it('reads multiple files', async () => {
    writeFileSync(join(projectDir, 'a.txt'), 'File A', 'utf-8');
    writeFileSync(join(projectDir, 'b.txt'), 'File B', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['a.txt', 'b.txt'] }),
      projectDir,
    );

    expect(result.content).toContain('=== a.txt ===');
    expect(result.content).toContain('File A');
    expect(result.content).toContain('=== b.txt ===');
    expect(result.content).toContain('File B');
  });

  it('returns error when file is not found', async () => {
    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['nonexistent.txt'] }),
      projectDir,
    );

    expect(result.content).toContain('File not found');
    expect(result.content).toContain('nonexistent.txt');
  });

  it('rejects path outside the project directory', async () => {
    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['../outside.txt'] }),
      projectDir,
    );

    expect(result.content).toContain('outside the project directory');
  });

  it('handles mixed results (one valid, one invalid)', async () => {
    writeFileSync(join(projectDir, 'exists.txt'), 'exists', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['exists.txt', '../outside.txt'] }),
      projectDir,
    );

    expect(result.content).toContain('=== exists.txt ===');
    expect(result.content).toContain('outside the project directory');
  });

  it('reads an empty file', async () => {
    const filePath = 'empty.txt';
    writeFileSync(join(projectDir, filePath), '', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: [filePath] }),
      projectDir,
    );

    expect(result.content).toContain('=== empty.txt ===');
    // Content after the header should be empty
    const contentAfterHeader = result.content.split('=== empty.txt ===\n')[1];
    expect(contentAfterHeader).toBe('');
  });

  it('returns error on invalid JSON arguments', async () => {
    const result = await executeToolCall(
      makeToolCallWithRawArgs('read_files', 'not valid json'),
      projectDir,
    );

    expect(result.content).toContain('Invalid JSON');
  });
});

// ─── str_replace ────────────────────────────────────────────────────────────

describe('executeToolCall — str_replace', () => {
  it('replaces a single occurrence', async () => {
    const filePath = 'greeting.txt';
    writeFileSync(join(projectDir, filePath), 'Hello, world!', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: filePath,
        replacements: [{ oldString: 'world', newString: 'friend' }],
      }),
      projectDir,
    );

    expect(result.content).toContain('Replaced 1 occurrence');
    // Verify file was actually written
    const content = readFileSync(join(projectDir, filePath), 'utf-8');
    expect(content).toBe('Hello, friend!');
  });

  it('replaces multiple occurrences with allowMultiple', async () => {
    const filePath = 'repeat.txt';
    writeFileSync(join(projectDir, filePath), 'foo foo foo', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: filePath,
        replacements: [
          { oldString: 'foo', newString: 'bar', allowMultiple: true },
        ],
      }),
      projectDir,
    );

    expect(result.content).toContain('Replaced 3 occurrence');
    const content = readFileSync(join(projectDir, filePath), 'utf-8');
    expect(content).toBe('bar bar bar');
  });

  it('reports warning when no match is found', async () => {
    const filePath = 'greeting.txt';
    writeFileSync(join(projectDir, filePath), 'Hello, world!', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: filePath,
        replacements: [{ oldString: 'nonexistent', newString: 'anything' }],
      }),
      projectDir,
    );

    expect(result.content).toContain('No match found');
  });

  it('returns error when file is not found', async () => {
    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: 'nonexistent.txt',
        replacements: [{ oldString: 'x', newString: 'y' }],
      }),
      projectDir,
    );

    expect(result.content).toContain('File not found');
  });

  it('rejects path outside the project directory', async () => {
    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: '../outside.txt',
        replacements: [{ oldString: 'x', newString: 'y' }],
      }),
      projectDir,
    );

    expect(result.content).toContain('outside the project directory');
  });

  it('performs a single replacement without allowMultiple (first match only)', async () => {
    const filePath = 'first.txt';
    writeFileSync(join(projectDir, filePath), 'a a a', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('str_replace', {
        path: filePath,
        replacements: [{ oldString: 'a', newString: 'b' }],
      }),
      projectDir,
    );

    expect(result.content).toContain('Replaced 1 occurrence');
    const content = readFileSync(join(projectDir, filePath), 'utf-8');
    expect(content).toBe('b a a');
  });

  it('returns error on invalid JSON arguments', async () => {
    const result = await executeToolCall(
      makeToolCallWithRawArgs('str_replace', 'not valid json'),
      projectDir,
    );

    expect(result.content).toContain('Invalid JSON');
  });
});

// ─── write_file ─────────────────────────────────────────────────────────────

describe('executeToolCall — write_file', () => {
  it('creates a new file with content', async () => {
    const filePath = 'newfile.txt';
    const content = 'Hello from write_file!';

    const result = await executeToolCall(
      makeToolCall('write_file', { path: filePath, content, instructions: 'Test file creation' }),
      projectDir,
    );

    expect(result.content).toContain('Written: ' + filePath);
    expect(existsSync(join(projectDir, filePath))).toBe(true);
    expect(readFileSync(join(projectDir, filePath), 'utf-8')).toBe(content);
  });

  it('overwrites an existing file', async () => {
    const filePath = 'overwrite.txt';
    writeFileSync(join(projectDir, filePath), 'original content', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('write_file', {
        path: filePath,
        content: 'new content',
        instructions: 'Overwrite test',
      }),
      projectDir,
    );

    expect(result.content).toContain('Written: ' + filePath);
    expect(readFileSync(join(projectDir, filePath), 'utf-8')).toBe('new content');
  });

  it('creates parent directories automatically', async () => {
    const filePath = 'sub/deep/newfile.txt';
    const content = 'nested file';

    const result = await executeToolCall(
      makeToolCall('write_file', { path: filePath, content, instructions: '' }),
      projectDir,
    );

    expect(result.content).toContain('Written: ' + filePath);
    expect(readFileSync(join(projectDir, filePath), 'utf-8')).toBe(content);
  });

  it('writes empty content', async () => {
    const filePath = 'empty.txt';

    const result = await executeToolCall(
      makeToolCall('write_file', { path: filePath, content: '', instructions: '' }),
      projectDir,
    );

    expect(result.content).toContain('Written: ' + filePath);
    expect(readFileSync(join(projectDir, filePath), 'utf-8')).toBe('');
  });

  it('rejects path outside the project directory', async () => {
    const result = await executeToolCall(
      makeToolCall('write_file', {
        path: '../outside.txt',
        content: 'should not write',
        instructions: '',
      }),
      projectDir,
    );

    expect(result.content).toContain('outside the project directory');
    // Verify the outside file was NOT created
    expect(existsSync(join(baseDir, 'outside.txt'))).toBe(false);
  });

  it('returns error on invalid JSON arguments', async () => {
    const result = await executeToolCall(
      makeToolCallWithRawArgs('write_file', 'not valid json'),
      projectDir,
    );

    expect(result.content).toContain('Invalid JSON');
  });
});

// ─── run_terminal_command ───────────────────────────────────────────────────

describe('executeToolCall — run_terminal_command', () => {
  it('executes a simple echo command and captures stdout', async () => {
    const result = await executeToolCall(
      makeToolCall('run_terminal_command', { command: 'echo "hello world"' }),
      projectDir,
    );

    expect(result.name).toBe('run_terminal_command');
    expect(result.content).toContain('[Command]');
    expect(result.content).toContain('[Exit Code] 0');
    expect(result.content).toContain('hello world');
  });

  it('captures stderr and non-zero exit code', async () => {
    const result = await executeToolCall(
      makeToolCall('run_terminal_command', { command: 'ls /nonexistent_path_12345 2>&-; exit 1' }),
      projectDir,
    );

    expect(result.content).toContain('[Exit Code] 1');
  });

  it('includes description in output when provided', async () => {
    const result = await executeToolCall(
      makeToolCall('run_terminal_command', {
        command: 'echo "test"',
        description: 'A test command',
      }),
      projectDir,
    );

    expect(result.content).toContain('[Description]');
    expect(result.content).toContain('A test command');
  });

  it('returns error on invalid JSON arguments', async () => {
    const result = await executeToolCall(
      makeToolCallWithRawArgs('run_terminal_command', 'not valid json'),
      projectDir,
    );

    expect(result.content).toContain('Invalid JSON');
  });
});

// ─── Unknown Tool ───────────────────────────────────────────────────────────

describe('executeToolCall — unknown tool', () => {
  it('returns error listing available tools', async () => {
    const result = await executeToolCall(
      makeToolCall('some_unknown_tool', {}),
      projectDir,
    );

    expect(result.content).toContain('Unknown tool');
    expect(result.content).toContain('some_unknown_tool');
    expect(result.content).toContain('read_files');
    expect(result.content).toContain('str_replace');
    expect(result.content).toContain('write_file');
    expect(result.content).toContain('run_terminal_command');
  });

  it('returns error on invalid JSON with unknown tool', async () => {
    const result = await executeToolCall(
      makeToolCallWithRawArgs('some_unknown_tool', 'not valid json'),
      projectDir,
    );

    expect(result.content).toContain('Invalid JSON');
  });
});

// ─── Path Safety ────────────────────────────────────────────────────────────

describe('executeToolCall — path safety', () => {
  it('rejects ../ traversal for read_files', async () => {
    // Create a file outside the project to verify it's NOT read
    writeFileSync(join(baseDir, 'secret.txt'), 'SECRET', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['../secret.txt'] }),
      projectDir,
    );

    expect(result.content).toContain('outside the project directory');
    expect(result.content).not.toContain('SECRET');
  });

  it('rejects absolute path outside project for read_files', async () => {
    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['/etc/hostname'] }),
      projectDir,
    );

    // The absolute path will resolve through resolve(), but isPathWithinProject
    // will check if it starts with projectDir
    expect(result.content).toContain('outside the project directory');
  });

  it('rejects .git paths for read_files', async () => {
    // Create a .git directory inside the project
    mkdirSync(join(projectDir, '.git'), { recursive: true });
    writeFileSync(join(projectDir, '.git', 'config'), 'git config', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: ['.git/config'] }),
      projectDir,
    );

    expect(result.content).toContain('outside the project directory');
  });

  it('allows normal paths within the project', async () => {
    const filePath = 'safe/deep/file.txt';
    mkdirSync(join(projectDir, 'safe/deep'), { recursive: true });
    writeFileSync(join(projectDir, filePath), 'safe content', 'utf-8');

    const result = await executeToolCall(
      makeToolCall('read_files', { paths: [filePath] }),
      projectDir,
    );

    expect(result.content).toContain('safe content');
    expect(result.content).not.toContain('outside the project directory');
  });
});
