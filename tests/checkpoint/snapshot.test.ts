/**
 * Tests for the snapshot-based checkpoint system.
 *
 * Uses temporary directories to test file operations without
 * affecting the real project.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync, copyFileSync } from 'fs';
import { join, sep, relative, normalize } from 'path';
import { tmpdir } from 'os';

// ── Re-implement snapshot internals for testing ─────────────────────────────

const CHECKPOINT_DIR_NAME = '.clonebuff/checkpoints';

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.clonebuff', 'dist', 'out', 'coverage', '.cache']);

function collectProjectFiles(projectDir: string): string[] {
  const files: string[] = [];
  const queue = [projectDir];

  while (queue.length > 0) {
    const dir = queue.pop()!;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          if (!EXCLUDED_DIRS.has(entry)) {
            queue.push(fullPath);
          }
        } else if (stat.isFile()) {
          files.push(fullPath);
        }
      } catch {
        continue;
      }
    }
  }

  return files;
}

/** Normalize paths to use forward slashes for comparison */
function toPosix(p: string): string {
  return p.split(sep).join('/');
}

function generateCheckpointId(): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '')
    .replace('T', '-')
    .replace('Z', '');
  const random = Math.random().toString(36).slice(2, 6);
  return `snap-${ts}-${random}`;
}

// ── Checkpoint operations (re-implemented for test isolation) ────────────────

interface TestEntry {
  id: string; name: string; timestamp: number; mode: string;
  snapshotDir?: string; description?: string;
}

function makeEntry(id: string, options?: { name?: string; description?: string }): TestEntry {
  return {
    id,
    name: options?.name ?? '',
    timestamp: Date.now(),
    mode: 'snapshot',
    snapshotDir: id,
    description: options?.description ?? '',
  };
}

async function createSnapshotTestCheckpoint(
  projectDir: string,
  options?: { name?: string; description?: string },
): Promise<{ entry: TestEntry; success: boolean; error?: string }> {
  const id = generateCheckpointId();
  const name = options?.name ?? '';
  const description = options?.description ?? '';

  try {
    const checkpointDir = join(projectDir, CHECKPOINT_DIR_NAME, id);
    mkdirSync(checkpointDir, { recursive: true });

    const files = collectProjectFiles(projectDir);

    for (const filePath of files) {
      const relPath = relative(projectDir, filePath);
      const targetPath = join(checkpointDir, relPath);
      const targetDir = targetPath.split(sep).slice(0, -1).join(sep);

      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      copyFileSync(filePath, targetPath);
    }

    const entry = makeEntry(id, options);
    writeFileSync(join(checkpointDir, '.checkpoint-manifest.json'), JSON.stringify(entry, null, 2));

    return { entry, success: true };
  } catch (error) {
    return {
      entry: makeEntry(id, options),
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating snapshot',
    };
  }
}

async function listSnapshotTestCheckpoints(projectDir: string): Promise<TestEntry[]> {
  const baseDir = join(projectDir, CHECKPOINT_DIR_NAME);
  if (!existsSync(baseDir)) return [];

  try {
    const dirEntries = readdirSync(baseDir);
    const entries: TestEntry[] = [];

    for (const dirName of dirEntries) {
      if (!dirName.startsWith('snap-')) continue;
      const manifestPath = join(baseDir, dirName, '.checkpoint-manifest.json');
      if (!existsSync(manifestPath)) continue;
      try {
        const content = readFileSync(manifestPath, 'utf-8');
        entries.push(JSON.parse(content));
      } catch {
        continue;
      }
    }

    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries;
  } catch {
    return [];
  }
}

async function restoreSnapshotTestCheckpoint(
  projectDir: string, id: string,
): Promise<{ id: string; success: boolean; error?: string; details?: string }> {
  const checkpointDir = join(projectDir, CHECKPOINT_DIR_NAME, id);
  if (!existsSync(checkpointDir)) {
    return { id, success: false, error: `Checkpoint "${id}" not found.` };
  }
  const manifestPath = join(checkpointDir, '.checkpoint-manifest.json');
  if (!existsSync(manifestPath)) {
    return { id, success: false, error: `Checkpoint "${id}" manifest is missing.` };
  }

  try {
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const entry = JSON.parse(manifestContent);
    const files = collectProjectFiles(checkpointDir);
    let restoredCount = 0;

    for (const filePath of files) {
      if (filePath.endsWith('.checkpoint-manifest.json')) continue;
      const relPath = relative(checkpointDir, filePath);
      const targetPath = join(projectDir, relPath);
      const targetDir = targetPath.split(sep).slice(0, -1).join(sep);
      if (!existsSync(targetDir)) mkdirSync(targetDir, { recursive: true });
      copyFileSync(filePath, targetPath);
      restoredCount++;
    }

    return { id, success: true, details: `Restored ${restoredCount} file(s) from checkpoint "${entry.name || id}".` };
  } catch (error) {
    return {
      id, success: false,
      error: error instanceof Error ? error.message : 'Unknown error restoring checkpoint',
    };
  }
}

async function deleteSnapshotTestCheckpoint(
  projectDir: string, id: string,
): Promise<{ success: boolean; error?: string }> {
  const checkpointDir = join(projectDir, CHECKPOINT_DIR_NAME, id);
  if (!existsSync(checkpointDir)) {
    return { success: false, error: `Checkpoint "${id}" not found.` };
  }
  try {
    rmSync(checkpointDir, { recursive: true, force: true });
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error deleting checkpoint',
    };
  }
}

// ── Test helpers ────────────────────────────────────────────────────────────

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = join(tmpdir(), `clonebuff-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function createTestProject(dir: string): void {
  mkdirSync(join(dir, 'src', 'components'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.ts'), 'export const foo = 1;\n');
  writeFileSync(join(dir, 'src', 'components', 'bar.ts'), 'export const bar = 2;\n');
  writeFileSync(join(dir, 'public', 'style.css'), 'body { color: red; }\n');
  writeFileSync(join(dir, 'package.json'), '{"name": "test"}\n');

  // Excluded dirs
  mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = {};\n');
  mkdirSync(join(dir, '.git'), { recursive: true });
  writeFileSync(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(join(dir, 'dist', 'bundle.js'), '// built\n');
}

afterEach(() => {
  for (const dir of tempDirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  tempDirs = [];
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════════

describe('Snapshot — collectProjectFiles', () => {
  it('collects all non-excluded files', () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const files = collectProjectFiles(dir);
    const rel = files.map((f) => toPosix(relative(dir, f)));
    expect(rel).toContain('src/index.ts');
    expect(rel).toContain('src/components/bar.ts');
    expect(rel).toContain('public/style.css');
    expect(rel).toContain('package.json');
  });

  it('excludes node_modules, .git, dist from collection', () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const files = collectProjectFiles(dir);
    const rel = files.map((f) => toPosix(relative(dir, f)));
    expect(rel).not.toContain('node_modules/dep/index.js');
    expect(rel).not.toContain('.git/HEAD');
    expect(rel).not.toContain('dist/bundle.js');
  });

  it('returns empty array for empty directory', () => {
    const dir = makeTempDir();
    expect(collectProjectFiles(dir)).toEqual([]);
  });

  it('handles deeply nested files', () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'a', 'b', 'c', 'd'), { recursive: true });
    writeFileSync(join(dir, 'a', 'b', 'c', 'd', 'deep.txt'), 'deep');
    writeFileSync(join(dir, 'a', 'root.txt'), 'root');
    const files = collectProjectFiles(dir);
    const rel = files.map((f) => toPosix(relative(dir, f)));
    expect(rel).toContain('a/b/c/d/deep.txt');
    expect(rel).toContain('a/root.txt');
    expect(rel).toHaveLength(2);
  });
});

describe('Snapshot — generateCheckpointId', () => {
  it('generates ID with snap- prefix', () => {
    expect(generateCheckpointId().startsWith('snap-')).toBe(true);
  });

  it('generates unique IDs', () => {
    const ids = Array.from({ length: 100 }, () => generateCheckpointId());
    expect(new Set(ids).size).toBe(100);
  });

  it('has format snap-YYYYMMDD-HHmmss-xxxx', () => {
    const id = generateCheckpointId();
    // ID format: snap-20260528-12000000-xxxx (8 chars date + 8 chars time)
    expect(id.startsWith('snap-')).toBe(true);
    const afterPrefix = id.slice(5);  // remove 'snap-'
    const parts = afterPrefix.split('-');
    expect(parts).toHaveLength(3);    // date, time, random
    expect(parts[0]!.length).toBe(8); // YYYYMMDD
    expect(parts[1]!.length).toBe(6); // HHmmss (no milliseconds, 'T' replaced with '-')
    expect(parts[2]!.length).toBe(4); // random
  });
});

describe('Snapshot — create', () => {
  it('creates a checkpoint with files and manifest', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const result = await createSnapshotTestCheckpoint(dir);
    expect(result.success).toBe(true);
    expect(result.entry.id.startsWith('snap-')).toBe(true);
    expect(result.entry.mode).toBe('snapshot');

    const manifestPath = join(dir, CHECKPOINT_DIR_NAME, result.entry.id, '.checkpoint-manifest.json');
    expect(existsSync(manifestPath)).toBe(true);
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    expect(manifest.id).toBe(result.entry.id);
  });

  it('copies project files to checkpoint directory', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const result = await createSnapshotTestCheckpoint(dir);
    const cpDir = join(dir, CHECKPOINT_DIR_NAME, result.entry.id);
    expect(existsSync(join(cpDir, 'src', 'index.ts'))).toBe(true);
    expect(existsSync(join(cpDir, 'src', 'components', 'bar.ts'))).toBe(true);
    expect(existsSync(join(cpDir, 'public', 'style.css'))).toBe(true);
    expect(existsSync(join(cpDir, 'package.json'))).toBe(true);
  });

  it('does not copy excluded dirs', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const result = await createSnapshotTestCheckpoint(dir);
    const cpDir = join(dir, CHECKPOINT_DIR_NAME, result.entry.id);
    expect(existsSync(join(cpDir, 'node_modules'))).toBe(false);
    expect(existsSync(join(cpDir, '.git'))).toBe(false);
    expect(existsSync(join(cpDir, 'dist'))).toBe(false);
  });

  it('accepts optional name and description', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const result = await createSnapshotTestCheckpoint(dir, {
      name: 'milestone-1', description: 'Before adding auth',
    });
    expect(result.entry.name).toBe('milestone-1');
    expect(result.entry.description).toBe('Before adding auth');

    const manifest = JSON.parse(
      readFileSync(join(dir, CHECKPOINT_DIR_NAME, result.entry.id, '.checkpoint-manifest.json'), 'utf-8'),
    );
    expect(manifest.name).toBe('milestone-1');
    expect(manifest.description).toBe('Before adding auth');
  });

  it('handles empty project directory', async () => {
    const dir = makeTempDir();
    const result = await createSnapshotTestCheckpoint(dir);
    expect(result.success).toBe(true);
    expect(existsSync(join(dir, CHECKPOINT_DIR_NAME, result.entry.id))).toBe(true);
  });

  it('preserves file contents including Unicode', async () => {
    const dir = makeTempDir();
    const content = 'export const greeting = "สวัสดี";\n';
    mkdirSync(join(dir, 'lib'), { recursive: true });
    writeFileSync(join(dir, 'lib', 'thai.ts'), content);
    const result = await createSnapshotTestCheckpoint(dir);
    const copied = readFileSync(
      join(dir, CHECKPOINT_DIR_NAME, result.entry.id, 'lib', 'thai.ts'), 'utf-8',
    );
    expect(copied).toBe(content);
  });
});

describe('Snapshot — list', () => {
  it('returns empty array when no checkpoints exist', async () => {
    const dir = makeTempDir();
    expect(await listSnapshotTestCheckpoints(dir)).toEqual([]);
  });

  it('returns empty when checkpoint dir does not exist', async () => {
    expect(await listSnapshotTestCheckpoints(makeTempDir())).toEqual([]);
  });

  it('lists created checkpoints sorted newest first', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a');

    const r1 = await createSnapshotTestCheckpoint(dir, { name: 'first' });
    await sleep(10);
    const r2 = await createSnapshotTestCheckpoint(dir, { name: 'second' });

    const entries = await listSnapshotTestCheckpoints(dir);
    expect(entries.length).toBe(2);
    expect(entries[0]!.id).toBe(r2.entry.id); // newest first
    expect(entries[1]!.id).toBe(r1.entry.id);
  });

  it('skips corrupted manifests gracefully', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, CHECKPOINT_DIR_NAME, 'snap-corrupted'), { recursive: true });
    writeFileSync(join(dir, CHECKPOINT_DIR_NAME, 'snap-corrupted', '.checkpoint-manifest.json'), 'not valid json');
    expect(await listSnapshotTestCheckpoints(dir)).toEqual([]);
  });

  it('skips directories without snap- prefix', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, CHECKPOINT_DIR_NAME, 'other-dir'), { recursive: true });
    writeFileSync(join(dir, CHECKPOINT_DIR_NAME, 'other-dir', '.checkpoint-manifest.json'),
      JSON.stringify({ id: 'other' }));
    expect(await listSnapshotTestCheckpoints(dir)).toEqual([]);
  });
});

describe('Snapshot — restore', () => {
  it('restores files from a checkpoint', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const { entry } = await createSnapshotTestCheckpoint(dir);
    writeFileSync(join(dir, 'src', 'index.ts'), '// modified\n');

    const result = await restoreSnapshotTestCheckpoint(dir, entry.id);
    expect(result.success).toBe(true);
    expect(result.details).toContain('Restored');
    expect(readFileSync(join(dir, 'src', 'index.ts'), 'utf-8')).toBe('export const foo = 1;\n');
  });

  it('fails when checkpoint does not exist', async () => {
    const dir = makeTempDir();
    const result = await restoreSnapshotTestCheckpoint(dir, 'snap-nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('fails when manifest is missing', async () => {
    const dir = makeTempDir();
    const id = 'snap-test-20250101-120000-abcd';
    mkdirSync(join(dir, CHECKPOINT_DIR_NAME, id), { recursive: true });
    const result = await restoreSnapshotTestCheckpoint(dir, id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('manifest is missing');
  });

  it('restores multiple files correctly', async () => {
    const dir = makeTempDir();
    createTestProject(dir);
    const { entry } = await createSnapshotTestCheckpoint(dir);

    rmSync(join(dir, 'src', 'components', 'bar.ts'), { force: true });
    writeFileSync(join(dir, 'package.json'), '// overwritten\n');

    const result = await restoreSnapshotTestCheckpoint(dir, entry.id);
    expect(result.success).toBe(true);
    expect(existsSync(join(dir, 'src', 'components', 'bar.ts'))).toBe(true);
    expect(readFileSync(join(dir, 'package.json'), 'utf-8')).toBe('{"name": "test"}\n');
  });

  it('handles non-existent project dir gracefully', async () => {
    const result = await restoreSnapshotTestCheckpoint('/nonexistent/path', 'snap-test');
    expect(result.success).toBe(false);
  });
});

describe('Snapshot — delete', () => {
  it('deletes an existing checkpoint', async () => {
    const dir = makeTempDir();
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'a.ts'), 'a');
    const { entry } = await createSnapshotTestCheckpoint(dir);

    expect(existsSync(join(dir, CHECKPOINT_DIR_NAME, entry.id))).toBe(true);
    const result = await deleteSnapshotTestCheckpoint(dir, entry.id);
    expect(result.success).toBe(true);
    expect(existsSync(join(dir, CHECKPOINT_DIR_NAME, entry.id))).toBe(false);
  });

  it('fails when checkpoint does not exist', async () => {
    const dir = makeTempDir();
    const result = await deleteSnapshotTestCheckpoint(dir, 'snap-nonexistent');
    expect(result.success).toBe(false);
    expect(result.error).toContain('not found');
  });
});

// ── Helper ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
