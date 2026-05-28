/**
 * Snapshot-based checkpoint system.
 *
 * Copies project files to .clonebuff/checkpoints/<id>/ for later restoration.
 * Used as a fallback when git is not available in the project directory.
 *
 * Strategy:
 *  - On save: walk the project directory (excluding node_modules, .git, .clonebuff),
 *    copy all files to the checkpoint directory preserving relative paths.
 *  - On restore: copy files back from the checkpoint directory to the project.
 *  - On list: scan .clonebuff/checkpoints/ for checkpoint manifest files.
 */

import { existsSync, mkdirSync, readdirSync, statSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'fs';
import { join, relative, resolve, sep } from 'path';
import type { CheckpointEntry, CheckpointCreateResult, CheckpointRestoreResult } from './types';
import { CHECKPOINT_DIR } from '../config/defaults';

// ─── Paths ──────────────────────────────────────────────────────────────────

function getCheckpointBaseDir(projectDir: string): string {
  return join(projectDir, CHECKPOINT_DIR);
}

function getCheckpointDir(projectDir: string, id: string): string {
  return join(getCheckpointBaseDir(projectDir), id);
}

function getManifestPath(projectDir: string, id: string): string {
  return join(getCheckpointDir(projectDir, id), '.checkpoint-manifest.json');
}

// ─── File / Directory helpers ───────────────────────────────────────────────

const EXCLUDED_DIRS = new Set(['node_modules', '.git', '.clonebuff', 'dist', 'out', 'coverage', '.cache']);

/**
 * Collect all files recursively from projectDir, excluding common ignore dirs.
 */
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
      let stat: ReturnType<typeof statSync>;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry)) {
          queue.push(fullPath);
        }
      } else if (stat.isFile()) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

// ─── CRUD operations ────────────────────────────────────────────────────────

/**
 * Generate a checkpoint ID based on current timestamp.
 */
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

/**
 * Save a checkpoint by copying all project files to a snapshot directory.
 */
export async function createSnapshotCheckpoint(
  projectDir: string,
  options?: { name?: string; description?: string },
): Promise<CheckpointCreateResult> {
  const id = generateCheckpointId();
  const name = options?.name ?? '';
  const description = options?.description ?? '';

  try {
    const checkpointDir = getCheckpointDir(projectDir, id);
    mkdirSync(checkpointDir, { recursive: true });

    // Collect all project files
    const files = collectProjectFiles(projectDir);
    let copiedCount = 0;

    for (const filePath of files) {
      const relPath = relative(projectDir, filePath);
      const targetPath = join(checkpointDir, relPath);
      const targetDir = targetPath.split(sep).slice(0, -1).join(sep);

      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      copyFileSync(filePath, targetPath);
      copiedCount++;
    }

    // Write the manifest
    const entry: CheckpointEntry = {
      id,
      name,
      timestamp: Date.now(),
      mode: 'snapshot',
      snapshotDir: id,
      description,
    };

    writeFileSync(getManifestPath(projectDir, id), JSON.stringify(entry, null, 2));

    return { entry, success: true };
  } catch (error) {
    return {
      entry: {
        id,
        name: options?.name ?? '',
        timestamp: Date.now(),
        mode: 'snapshot',
        description: options?.description ?? '',
      },
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating snapshot',
    };
  }
}

/**
 * List all snapshot checkpoints from the checkpoints directory.
 */
export async function listSnapshotCheckpoints(projectDir: string): Promise<CheckpointEntry[]> {
  const baseDir = getCheckpointBaseDir(projectDir);

  if (!existsSync(baseDir)) {
    return [];
  }

  const entries: CheckpointEntry[] = [];
  let dirEntries: string[];

  try {
    dirEntries = readdirSync(baseDir);
  } catch {
    return [];
  }

  for (const dirName of dirEntries) {
    if (!dirName.startsWith('snap-')) continue;

    const manifestPath = getManifestPath(projectDir, dirName);
    if (!existsSync(manifestPath)) continue;

    try {
      const content = readFileSync(manifestPath, 'utf-8');
      const entry = JSON.parse(content) as CheckpointEntry;
      entries.push(entry);
    } catch {
      // Corrupted manifest — skip
      continue;
    }
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}

/**
 * Restore project files from a snapshot checkpoint.
 */
export async function restoreSnapshotCheckpoint(
  projectDir: string,
  id: string,
): Promise<CheckpointRestoreResult> {
  const checkpointDir = getCheckpointDir(projectDir, id);

  if (!existsSync(checkpointDir)) {
    return { id, success: false, error: `Checkpoint "${id}" not found.` };
  }

  const manifestPath = getManifestPath(projectDir, id);
  if (!existsSync(manifestPath)) {
    return { id, success: false, error: `Checkpoint "${id}" manifest is missing.` };
  }

  try {
    // Read the manifest for metadata
    const manifestContent = readFileSync(manifestPath, 'utf-8');
    const entry = JSON.parse(manifestContent) as CheckpointEntry;

    // Walk the checkpoint directory and copy files back
    const files = collectProjectFiles(checkpointDir);
    let restoredCount = 0;

    for (const filePath of files) {
      // Skip the manifest file itself
      if (filePath.endsWith('.checkpoint-manifest.json')) continue;

      const relPath = relative(checkpointDir, filePath);
      const targetPath = join(projectDir, relPath);
      const targetDir = targetPath.split(sep).slice(0, -1).join(sep);

      if (!existsSync(targetDir)) {
        mkdirSync(targetDir, { recursive: true });
      }

      copyFileSync(filePath, targetPath);
      restoredCount++;
    }

    return {
      id,
      success: true,
      details: `Restored ${restoredCount} file(s) from checkpoint "${entry.name || id}".`,
    };
  } catch (error) {
    return {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error restoring checkpoint',
    };
  }
}

/**
 * Delete a snapshot checkpoint (clean up disk space).
 */
export async function deleteSnapshotCheckpoint(
  projectDir: string,
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const checkpointDir = getCheckpointDir(projectDir, id);

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
