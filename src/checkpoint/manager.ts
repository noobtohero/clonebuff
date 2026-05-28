/**
 * CheckpointManager — unified interface for checkpoint operations.
 *
 * Auto-detects whether to use git-based or snapshot-based checkpointing:
 *  - If the project is a git repository: use git (stash/tags).
 *  - Otherwise: fall back to file snapshots in .clonebuff/checkpoints/.
 *
 * The manager exposes three operations:
 *  - create() — Save current codebase state
 *  - list()   — List all saved checkpoints
 *  - restore() — Restore codebase to a checkpoint
 */

import { isGitRepo, createGitCheckpoint, listGitCheckpoints, restoreGitCheckpoint, isGitInstalled } from './git';
import { createSnapshotCheckpoint, listSnapshotCheckpoints, restoreSnapshotCheckpoint } from './snapshot';
import type {
  CheckpointEntry,
  CheckpointCreateOptions,
  CheckpointCreateResult,
  CheckpointRestoreResult,
} from './types';

export class CheckpointManager {
  private projectDir: string;
  private useGit: boolean;

  constructor(projectDir: string) {
    this.projectDir = projectDir;
    this.useGit = isGitRepo(projectDir) && isGitInstalled();
  }

  /**
   * Check whether git-based checkpointing is available.
   */
  get mode(): 'git' | 'snapshot' {
    return this.useGit ? 'git' : 'snapshot';
  }

  /**
   * Check whether checkpointing is configured and enabled.
   * The manager always works — if git is absent, snapshot fallback kicks in.
   */
  get isAvailable(): boolean {
    return true;
  }

  /**
   * Create a new checkpoint of the current codebase state.
   */
  async create(options?: CheckpointCreateOptions): Promise<CheckpointCreateResult> {
    if (this.useGit) {
      return createGitCheckpoint(this.projectDir, options);
    }
    return createSnapshotCheckpoint(this.projectDir, options);
  }

  /**
   * List all existing checkpoints (newest first).
   */
  async list(): Promise<CheckpointEntry[]> {
    if (this.useGit) {
      return listGitCheckpoints(this.projectDir);
    }
    return listSnapshotCheckpoints(this.projectDir);
  }

  /**
   * Restore the codebase to a checkpoint state.
   */
  async restore(id: string): Promise<CheckpointRestoreResult> {
    if (this.useGit) {
      return restoreGitCheckpoint(this.projectDir, id);
    }
    return restoreSnapshotCheckpoint(this.projectDir, id);
  }
}
