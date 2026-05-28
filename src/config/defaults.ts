/**
 * Default configuration values for Clonebuff.
 */

export interface ClonebuffConfig {
  /** OpenRouter API key */
  apiKey?: string;
  /** Default model to use */
  model: string;
  /** Temperature for generation */
  temperature: number;
  /** Maximum tokens per response */
  maxTokens: number;
  /** Whether to enable checkpointing */
  checkpointsEnabled: boolean;
  /** Whether to auto-create checkpoints before edits */
  autoCheckpoint: boolean;
  /** Whether to show file diffs before applying */
  confirmChanges: boolean;
  /** Allow terminal command execution */
  allowTerminalCommands: boolean;

  // ── Context Management ─────────────────────────────────────────────

  /** Whether automatic context compaction is enabled. */
  contextCompactionEnabled: boolean;
  /** Number of recent turns to preserve full fidelity during compaction. */
  preserveRecentTurns: number;
  /** Token budget reserved for model responses. */
  responseBudget: number;
  /** Preferred OpenRouter provider for cache stickiness (e.g., "openai", "anthropic"). Empty means auto. */
  providerPreference: string;

  // ── Character / Personality ────────────────────────────────────────

  /** Whether to use the custom character for display and system prompt */
  characterEnabled: boolean;
}

export const DEFAULTS: ClonebuffConfig = {
  model: 'openai/gpt-5-nano',
  temperature: 0.3,
  maxTokens: 8192,
  checkpointsEnabled: true,
  autoCheckpoint: true,
  confirmChanges: false,
  allowTerminalCommands: true,

  // Context management defaults
  contextCompactionEnabled: true,
  preserveRecentTurns: 5,
  responseBudget: 8192,
  providerPreference: '',

  // Character defaults
  characterEnabled: true,
};

/**
 * Paths where config can be stored.
 */
export const CONFIG_PATHS = {
  /** Global config in user's home directory */
  global: '~/.clonebuff/config.json',
  /** Project-level config */
  project: '.clonebuffrc',
  /** Project-level env file */
  envLocal: '.env.local',
  env: '.env',
} as const;

export const CHECKPOINT_DIR = '.clonebuff/checkpoints';
export const HISTORY_DIR = '.clonebuff/history';
