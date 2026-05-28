/**
 * Git-based checkpoint system.
 *
 * Uses git operations to save and restore codebase state.
 * Requires the project to be a git repository.
 *
 * Strategy:
 *  - On save: `git stash create` to create a stash without popping,
 *    then optionally tag with a reference for easy lookup.
 *  - On restore: `git stash apply <ref>` to restore the stashed state.
 *  - On list: scan `git stash list` and parse the output.
 *
 * Fallback: When git is not available or the project has no .git,
 * the CheckpointManager falls back to snapshot-based checkpoints.
 */

import { spawnSync } from 'child_process';
import type { CheckpointEntry, CheckpointCreateResult, CheckpointListResult, CheckpointRestoreResult } from './types';

/**
 * Check whether the project directory is a git repository.
 */
export function isGitRepo(projectDir: string): boolean {
  const result = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  return result.status === 0 && result.stdout.trim() === 'true';
}

/**
 * Check if git is installed on the system.
 */
export function isGitInstalled(): boolean {
  const result = spawnSync('git', ['--version'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
  });
  return result.status === 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function git(args: string[], projectDir: string): { stdout: string; stderr: string; status: number | null } {
  const result = spawnSync('git', args, {
    cwd: projectDir,
    stdio: ['pipe', 'pipe', 'pipe'],
    encoding: 'utf-8',
    timeout: 15000,
  });
  return {
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
    status: result.status,
  };
}

function generateGitCheckpointId(): string {
  const now = new Date();
  const ts = now.toISOString()
    .replace(/[:-]/g, '')
    .replace(/\.\d{3}/, '')
    .replace('T', '-')
    .replace('Z', '');
  const random = Math.random().toString(36).slice(2, 6);
  return `git-${ts}-${random}`;
}

// ─── Operations ─────────────────────────────────────────────────────────────

const CHECKPOINT_REF_PREFIX = 'refs/clonebuff-checkpoints/';

/**
 * Create a git-based checkpoint.
 *
 * Uses `git stash create` to produce a stash commit object without modifying
 * the working tree. Then creates a lightweight tag referencing it so we can
 * look it up later.
 */
export async function createGitCheckpoint(
  projectDir: string,
  options?: { name?: string; description?: string },
): Promise<CheckpointCreateResult> {
  const id = generateGitCheckpointId();
  const name = options?.name ?? '';
  const description = options?.description ?? '';

  // Stage all changes first so the stash includes everything
  const addResult = git(['add', '-A'], projectDir);
  if (addResult.status !== 0) {
    return {
      entry: { id, name, timestamp: Date.now(), mode: 'git', description },
      success: false,
      error: `Failed to stage changes: ${addResult.stderr}`,
    };
  }

  // Create a stash without popping (creates a commit object)
  const stashResult = git(['stash', 'create', '--', `clonebuff-checkpoint: ${name || description || id}`], projectDir);
  if (stashResult.status !== 0 || !stashResult.stdout) {
    // No changes to stash — create an explicit commit as a baseline
    // Try `git stash create` may return empty if no changes
    if (!stashResult.stdout) {
      // No working tree changes — create a lightweight tag at HEAD as a baseline marker
      const tagName = `${CHECKPOINT_REF_PREFIX}${id}`;
      const tagResult = git(['tag', tagName, 'HEAD'], projectDir);
      if (tagResult.status !== 0) {
        return {
          entry: { id, name, timestamp: Date.now(), mode: 'git', description },
          success: false,
          error: `Failed to create reference: ${tagResult.stderr}`,
        };
      }

      // Unstage — we only staged for the stash, don't keep files staged
      git(['reset', 'HEAD'], projectDir);

      return {
        entry: { id, name, timestamp: Date.now(), mode: 'git', ref: tagName, description },
        success: true,
      };
    }

    return {
      entry: { id, name, timestamp: Date.now(), mode: 'git', description },
      success: false,
      error: `Failed to create stash: ${stashResult.stderr}`,
    };
  }

  const stashHash = stashResult.stdout.trim();

  // Create a lightweight tag to reference this stash
  const tagName = `${CHECKPOINT_REF_PREFIX}${id}`;
  const tagResult = git(['tag', tagName, stashHash], projectDir);
  if (tagResult.status !== 0) {
    return {
      entry: { id, name, timestamp: Date.now(), mode: 'git', description },
      success: false,
      error: `Stash created but tagging failed: ${tagResult.stderr}`,
    };
  }

  // Unstage — we only staged for the stash, don't keep files staged
  git(['reset', 'HEAD'], projectDir);

  return {
    entry: { id, name, timestamp: Date.now(), mode: 'git', ref: tagName, description },
    success: true,
  };
}

/**
 * List all git-based checkpoints by scanning for our special tags.
 */
export async function listGitCheckpoints(
  projectDir: string,
): Promise<CheckpointEntry[]> {
  // List all tags with our prefix
  const result = git(['tag', '-l', `${CHECKPOINT_REF_PREFIX}*`], projectDir);
  if (result.status !== 0 || !result.stdout) {
    return [];
  }

  const tagNames = result.stdout.split('\n').filter(Boolean);
  const entries: CheckpointEntry[] = [];

  for (const tagName of tagNames) {
    // Try to get the tag message / metadata
    const id = tagName.replace(CHECKPOINT_REF_PREFIX, '');

    // Get the commit date
    const dateResult = git(
      ['log', '-1', '--format=%ct', tagName],
      projectDir,
    );

    // Get the tag message (or commit subject)
    const msgResult = git(
      ['log', '-1', '--format=%s', tagName],
      projectDir,
    );

    const timestamp = dateResult.stdout
      ? parseInt(dateResult.stdout, 10) * 1000
      : Date.now();

    const msg = msgResult.stdout?.replace(/^clonebuff-checkpoint:\s*/, '') ?? '';

    entries.push({
      id,
      name: msg || id,
      timestamp,
      mode: 'git',
      ref: tagName,
      description: msg,
    });
  }

  // Sort newest first
  entries.sort((a, b) => b.timestamp - a.timestamp);
  return entries;
}

/**
 * Restore from a git-based checkpoint.
 *
 * For stashes: `git stash apply <hash>`
 * For baseline markers: `git checkout <tag>` (files only, not HEAD)
 */
export async function restoreGitCheckpoint(
  projectDir: string,
  id: string,
): Promise<CheckpointRestoreResult> {
  const tagName = `${CHECKPOINT_REF_PREFIX}${id}`;

  // Check if tag exists
  const tagCheck = git(['tag', '-l', tagName], projectDir);
  if (tagCheck.status !== 0 || !tagCheck.stdout) {
    return { id, success: false, error: `Git checkpoint "${id}" not found.` };
  }

  try {
    // Get the object the tag points to
    const refResult = git(['rev-parse', `${tagName}^{}`], projectDir);
    if (refResult.status !== 0 || !refResult.stdout) {
      return { id, success: false, error: `Could not resolve checkpoint "${id}".` };
    }

    const objectHash = refResult.stdout.trim();

    // Check if it's a stash commit (stash commits have a specific tree structure)
    // We try stash apply first; if that fails, use checkout
    const stashApplyResult = git(['stash', 'apply', objectHash], projectDir);

    if (stashApplyResult.status === 0) {
      return {
        id,
        success: true,
        details: `Restored from git stash checkpoint "${id}".`,
      };
    }

    // Fall back to checking out the tree into the working directory
    // Get the tree hash
    const treeResult = git(['rev-parse', `${tagName}^{tree}`], projectDir);
    if (treeResult.status !== 0 || !treeResult.stdout) {
      return { id, success: false, error: `Could not resolve checkpoint tree "${id}".` };
    }

    const treeHash = treeResult.stdout.trim();

    // Use git read-tree + checkout-index to restore files without moving HEAD
    // We read the tree into the index, then check out all files to the working tree
    const readTreeResult = git(['read-tree', treeHash], projectDir);
    if (readTreeResult.status !== 0) {
      return { id, success: false, error: `Failed to read checkpoint tree: ${readTreeResult.stderr}` };
    }

    const checkoutResult = git(['checkout-index', '-f', '-a'], projectDir);
    if (checkoutResult.status !== 0) {
      return { id, success: false, error: `Failed to checkout files: ${checkoutResult.stderr}` };
    }

    return {
      id,
      success: true,
      details: `Restored from git checkpoint "${id}".`,
    };
  } catch (error) {
    return {
      id,
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error restoring git checkpoint',
    };
  }
}
