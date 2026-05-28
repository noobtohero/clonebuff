/**
 * Tests for src/config/init.ts — /init command scaffolding.
 *
 * runInit and runFullInit are pure file-system operations:
 *  - Creates knowledge.md, .agents/types/*.ts
 *  - Optionally creates .clonebuffrc
 *  - Skips existing files without error
 *  - Returns created/skipped/errors arrays
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// We import the source module; the test runner resolves TS directly via Bun.
const { runInit, runFullInit } = await import('../../src/config/init');

let tempDir: string;

beforeEach(() => {
  // Create a unique temp project directory for each test
  tempDir = join(tmpdir(), `clonebuff-test-init-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(tempDir, { recursive: true });
});

afterEach(() => {
  // Clean up
  rmSync(tempDir, { recursive: true, force: true });
});

describe('runInit', () => {
  it('creates knowledge.md when it does not exist', () => {
    const result = runInit(tempDir);
    expect(result.created).toContain('knowledge.md');
    expect(result.skipped).not.toContain('knowledge.md');
    expect(result.errors).toHaveLength(0);
    expect(existsSync(join(tempDir, 'knowledge.md'))).toBe(true);
  });

  it('creates .agents/types/*.ts files', () => {
    const result = runInit(tempDir);
    expect(result.created).toContain('.agents/types/agent-definition.ts');
    expect(result.created).toContain('.agents/types/tools.ts');
    expect(result.created).toContain('.agents/types/util-types.ts');
    expect(result.errors).toHaveLength(0);

    expect(existsSync(join(tempDir, '.agents/types/agent-definition.ts'))).toBe(true);
    expect(existsSync(join(tempDir, '.agents/types/tools.ts'))).toBe(true);
    expect(existsSync(join(tempDir, '.agents/types/util-types.ts'))).toBe(true);
  });

  it('skips existing files without error', () => {
    // Create files ahead of time
    mkdirSync(join(tempDir, '.agents/types'), { recursive: true });
    writeFileSync(join(tempDir, 'knowledge.md'), 'custom content', 'utf-8');
    writeFileSync(join(tempDir, '.agents/types/tools.ts'), 'custom tools', 'utf-8');

    const result = runInit(tempDir);
    expect(result.skipped).toContain('knowledge.md');
    expect(result.skipped).toContain('.agents/types/tools.ts');
    // But should still create files that don't exist
    expect(result.created).toContain('.agents/types/agent-definition.ts');
    expect(result.created).toContain('.agents/types/util-types.ts');
    expect(result.errors).toHaveLength(0);

    // Verify existing files were NOT overwritten
    expect(readFileSync(join(tempDir, 'knowledge.md'), 'utf-8')).toBe('custom content');
    expect(readFileSync(join(tempDir, '.agents/types/tools.ts'), 'utf-8')).toBe('custom tools');
  });

  it('returns empty created/skipped/errors when all files exist', () => {
    // Create all files
    const firstRun = runInit(tempDir);
    expect(firstRun.created).toHaveLength(4);
    expect(firstRun.errors).toHaveLength(0);

    // Second run should skip everything
    const secondRun = runInit(tempDir);
    expect(secondRun.created).toHaveLength(0);
    expect(secondRun.skipped).toHaveLength(4);
    expect(secondRun.errors).toHaveLength(0);
  });

  it('does not create .clonebuffrc', () => {
    const result = runInit(tempDir);
    expect(result.created).not.toContain('.clonebuffrc');
    expect(existsSync(join(tempDir, '.clonebuffrc'))).toBe(false);
  });

  it('writes valid TypeScript content for agent definition files', () => {
    runInit(tempDir);

    const agentDef = readFileSync(join(tempDir, '.agents/types/agent-definition.ts'), 'utf-8');
    expect(agentDef).toContain('AgentDefinition');
    expect(agentDef).toContain('export interface');
    expect(agentDef).toContain('name: string');
    expect(agentDef).toContain('description: string');

    const tools = readFileSync(join(tempDir, '.agents/types/tools.ts'), 'utf-8');
    expect(tools).toContain('ToolDefinition');
    expect(tools).toContain('read_files');
    expect(tools).toContain('str_replace');
    expect(tools).toContain('write_file');
    expect(tools).toContain('run_terminal_command');

    const utilTypes = readFileSync(join(tempDir, '.agents/types/util-types.ts'), 'utf-8');
    expect(utilTypes).toContain('DeepPartial');
    expect(utilTypes).toContain('AsyncState');
  });
});

describe('runFullInit', () => {
  it('behaves like runInit when createConfig is false', () => {
    const result = runFullInit(tempDir, { createConfig: false });
    expect(result.created).toContain('knowledge.md');
    expect(result.created).toContain('.agents/types/agent-definition.ts');
    expect(result.created).not.toContain('.clonebuffrc');
    expect(result.errors).toHaveLength(0);
  });

  it('creates .clonebuffrc when createConfig is true', () => {
    const result = runFullInit(tempDir, { createConfig: true });
    expect(result.created).toContain('knowledge.md');
    expect(result.created).toContain('.clonebuffrc');
    expect(result.errors).toHaveLength(0);
    expect(existsSync(join(tempDir, '.clonebuffrc'))).toBe(true);

    const configContent = readFileSync(join(tempDir, '.clonebuffrc'), 'utf-8');
    expect(configContent).toContain('openai/gpt-5-nano');
    expect(configContent).toContain('temperature');
  });

  it('skips .clonebuffrc if it already exists', () => {
    // First run with --config
    const firstRun = runFullInit(tempDir, { createConfig: true });
    expect(firstRun.created).toContain('.clonebuffrc');

    // Second run — .clonebuffrc should be skipped
    const secondRun = runFullInit(tempDir, { createConfig: true });
    expect(secondRun.created).not.toContain('.clonebuffrc');
    expect(secondRun.skipped).toContain('.clonebuffrc');
    expect(secondRun.errors).toHaveLength(0);
  });

  it('runs without options object (defaults to no config)', () => {
    const result = runFullInit(tempDir);
    expect(result.created).toContain('knowledge.md');
    expect(result.created).not.toContain('.clonebuffrc');
    expect(result.errors).toHaveLength(0);
  });
});
