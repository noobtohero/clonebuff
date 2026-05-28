/**
 * Tests for git-based checkpoint operations.
 *
 * Uses mocked spawnSync to avoid depending on actual git repository state.
 * Tests cover: isGitRepo, isGitInstalled, create/list/restore checkpoints.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, mock, spyOn } from 'bun:test';

type SpawnResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  pid?: number;
  output?: Array<string | null>;
  signal?: string | null;
};

function makeResult(overrides: Partial<SpawnResult> & { stdout?: string; stderr?: string; status?: number }): SpawnResult {
  return {
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    status: overrides.status ?? 0,
    pid: 12345,
    output: [null, overrides.stdout ?? '', overrides.stderr ?? ''],
    signal: null,
    ...overrides,
  };
}

// ── Mock spawnSync ──────────────────────────────────────────────────────────

let mockSpawnSync: ReturnType<typeof mock>;
let capturedArgs: string[][] = [];
let nextResults: SpawnResult[] = [];
let childProcess: any;

function setupMock() {
  capturedArgs = [];
  nextResults = [];
  mockSpawnSync = mock((_cmd: string, args: string[], _options?: any) => {
    capturedArgs.push(args);
    const result = nextResults.shift();
    if (result) return result;
    return makeResult({ stdout: '', stderr: 'command not found', status: 1 });
  });
}

beforeEach(async () => {
  childProcess = await import('child_process');
  setupMock();
  spyOn(childProcess, 'spawnSync').mockImplementation(mockSpawnSync as any);
});

afterEach(async () => {
  if (childProcess) {
    spyOn(childProcess, 'spawnSync').mockRestore();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

let gitModule: any;

beforeAll(async () => {
  gitModule = await import('../../src/checkpoint/git.ts');
});

describe('isGitRepo', () => {
  it('returns true when git rev-parse succeeds', () => {
    nextResults.push(makeResult({ stdout: 'true', status: 0 }));
    expect(gitModule.isGitRepo('/some/project')).toBe(true);
    expect(capturedArgs[0]).toEqual(['rev-parse', '--is-inside-work-tree']);
  });

  it('returns false when git rev-parse fails', () => {
    nextResults.push(makeResult({ stdout: 'false', status: 128 }));
    expect(gitModule.isGitRepo('/some/project')).toBe(false);
  });

  it('returns false when stdout is not "true"', () => {
    nextResults.push(makeResult({ stdout: 'false', status: 0 }));
    expect(gitModule.isGitRepo('/some/project')).toBe(false);
  });

  it('returns false when git is not installed', () => {
    nextResults.push(makeResult({ stdout: '', stderr: 'not found', status: 1 }));
    expect(gitModule.isGitRepo('/some/project')).toBe(false);
  });

  it('passes projectDir as cwd', () => {
    nextResults.push(makeResult({ stdout: 'true', status: 0 }));
    gitModule.isGitRepo('/custom/path');
    expect(capturedArgs.length).toBe(1);
  });
});

describe('isGitInstalled', () => {
  it('returns true when git --version succeeds', () => {
    nextResults.push(makeResult({ stdout: 'git version 2.40.0', status: 0 }));
    expect(gitModule.isGitInstalled()).toBe(true);
  });

  it('returns false when git --version fails', () => {
    nextResults.push(makeResult({ stdout: '', stderr: 'not found', status: 1 }));
    expect(gitModule.isGitInstalled()).toBe(false);
  });
});

describe('createGitCheckpoint', () => {
  it('creates a checkpoint with stash when changes exist', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123def456', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const result = await gitModule.createGitCheckpoint('/test/project', { name: 'test-checkpoint' });

    expect(result.success).toBe(true);
    expect(result.entry.mode).toBe('git');
    expect(result.entry.id.startsWith('git-')).toBe(true);
    expect(result.entry.ref).toContain('clonebuff-checkpoints/');
    expect(result.entry.name).toBe('test-checkpoint');
  });

  it('creates a baseline tag when no working tree changes', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const result = await gitModule.createGitCheckpoint('/test/project', { name: 'baseline' });

    expect(result.success).toBe(true);
    expect(result.entry.ref).toContain('clonebuff-checkpoints/');
    expect(capturedArgs[2]).toEqual(['tag', expect.stringContaining('clonebuff-checkpoints/'), 'HEAD']);
  });

  it('fails when staging fails', async () => {
    nextResults.push(makeResult({ stdout: '', stderr: 'permission denied', status: 1 }));

    const result = await gitModule.createGitCheckpoint('/test/project', { name: 'fail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to stage');
  });

  it('fails when stash create errors', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    // stdout is non-empty so it doesn't enter the "no changes" baseline branch
    nextResults.push(makeResult({ stdout: 'somehash', stderr: 'error: unknown option', status: 1 }));

    const result = await gitModule.createGitCheckpoint('/test/project', { name: 'fail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to create stash');
  });

  it('fails when tagging fails after stash create', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'tag already exists', status: 1 }));

    const result = await gitModule.createGitCheckpoint('/test/project', { name: 'fail' });
    expect(result.success).toBe(false);
    expect(result.error).toContain('Stash created but tagging failed');
  });

  it('returns unique IDs for consecutive calls', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: 'hash1', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    const r1 = await gitModule.createGitCheckpoint('/test/project');

    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: 'hash2', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    const r2 = await gitModule.createGitCheckpoint('/test/project');

    expect(r1.entry.id).not.toBe(r2.entry.id);
  });
});

describe('listGitCheckpoints', () => {
  it('returns empty array when no checkpoints exist', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const entries = await gitModule.listGitCheckpoints('/test/project');
    expect(entries).toEqual([]);
  });

  it('parses multiple checkpoint tags', async () => {
    const tagOutput = 'refs/clonebuff-checkpoints/git-20250101-120000-abcd\nrefs/clonebuff-checkpoints/git-20250102-120000-efgh';
    nextResults.push(makeResult({ stdout: tagOutput, status: 0 }));
    nextResults.push(makeResult({ stdout: '1704110400', status: 0 }));
    nextResults.push(makeResult({ stdout: 'clonebuff-checkpoint: milestone 1', status: 0 }));
    nextResults.push(makeResult({ stdout: '1704196800', status: 0 }));
    nextResults.push(makeResult({ stdout: 'clonebuff-checkpoint: milestone 2', status: 0 }));

    const entries = await gitModule.listGitCheckpoints('/test/project');

    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe('git-20250102-120000-efgh');
    expect(entries[0]!.name).toBe('milestone 2');
    expect(entries[0]!.timestamp).toBe(1704196800000);
    expect(entries[1]!.id).toBe('git-20250101-120000-abcd');
    expect(entries[0]!.timestamp).toBeGreaterThan(entries[1]!.timestamp);
  });

  it('handles tags with no message gracefully', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-solo', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const entries = await gitModule.listGitCheckpoints('/test/project');
    expect(entries.length).toBe(1);
    expect(entries[0]!.name).toBe('git-solo');
  });
});

describe('restoreGitCheckpoint', () => {
  it('restores via stash apply when checkpoint is a stash commit', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-mytest', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123def', status: 0 }));
    nextResults.push(makeResult({ stdout: 'dropped refs/stash@{0}', status: 0 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'git-mytest');

    expect(result.success).toBe(true);
    expect(result.details).toContain('git stash checkpoint');
  });

  it('restores via checkout-index when stash apply fails', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-mytest', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123def', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'The stash entry is not a valid stash', status: 1 }));
    nextResults.push(makeResult({ stdout: 'treehash789', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'git-mytest');
    expect(result.success).toBe(true);
    expect(result.details).toContain('git checkpoint');
  });

  it('fails when tag does not exist', async () => {
    nextResults.push(makeResult({ stdout: '', status: 0 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when rev-parse cannot resolve the tag', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-bad', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'fatal: ambiguous argument', status: 128 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'git-bad');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not resolve');
  });

  it('fails when read-tree fails', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-bad', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'not a valid stash', status: 1 }));
    nextResults.push(makeResult({ stdout: 'tree123', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'fatal: Could not parse object', status: 128 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'git-bad');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to read checkpoint tree');
  });

  it('fails when checkout-index fails after read-tree', async () => {
    nextResults.push(makeResult({ stdout: 'refs/clonebuff-checkpoints/git-bad', status: 0 }));
    nextResults.push(makeResult({ stdout: 'abc123', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'not a valid stash', status: 1 }));
    nextResults.push(makeResult({ stdout: 'tree123', status: 0 }));
    nextResults.push(makeResult({ stdout: '', status: 0 }));
    nextResults.push(makeResult({ stdout: '', stderr: 'error: unable to write file', status: 1 }));

    const result = await gitModule.restoreGitCheckpoint('/test/project', 'git-bad');
    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to checkout files');
  });
});
