/**
 * Checkpoint types — metadata for saved codebase checkpoints.
 *
 * Supports two modes:
 *  - Git-based: uses git stash/commit for version control
 *  - Snapshot-based: copies files to .clonebuff/checkpoints/<id>/
 */

export type CheckpointMode = 'git' | 'snapshot';

export interface CheckpointEntry {
  /** Unique checkpoint ID (based on timestamp) */
  id: string;
  /** Human-readable name (optional) */
  name: string;
  /** Timestamp when the checkpoint was created */
  timestamp: number;
  /** Which mechanism was used */
  mode: CheckpointMode;
  /** For git mode: the commit hash or stash ref */
  ref?: string;
  /** For snapshot mode: relative path to the snapshot directory under .clonebuff/checkpoints/ */
  snapshotDir?: string;
  /** Short description of what was happening when checkpoint was created */
  description?: string;
}

export interface CheckpointCreateOptions {
  /** Optional human-readable name */
  name?: string;
  /** Optional description */
  description?: string;
}

export interface CheckpointListResult {
  entries: CheckpointEntry[];
}

export interface CheckpointRestoreResult {
  id: string;
  success: boolean;
  error?: string;
  details?: string;
}

export interface CheckpointCreateResult {
  entry: CheckpointEntry;
  success: boolean;
  error?: string;
}
