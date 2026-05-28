/**
 * Configuration loader — reads config from multiple sources with priority:
 * 1. Environment variable (OPENROUTER_API_KEY)
 * 2. Global config (~/.clonebuff/config.json)
 * 3. Project-level config (.clonebuffrc or .env.local)
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'fs';
import { type ClonebuffConfig, DEFAULTS, CONFIG_PATHS } from './defaults';

export interface LoadedConfig {
  apiKey: string | null;
  config: ClonebuffConfig;
  /** Source of the API key for display purposes */
  keySource: 'env' | 'global' | 'project' | 'setup' | null;
}

interface PartialConfig {
  apiKey?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  [key: string]: unknown;
}

/**
 * Load config from all sources with priority.
 */
export function loadConfig(projectDir: string): LoadedConfig {
  let apiKey: string | null = null;
  let keySource: LoadedConfig['keySource'] = null;
  let config: ClonebuffConfig = { ...DEFAULTS };

  // 1. Environment variable (highest priority for API key)
  const envKey = process.env['OPENROUTER_API_KEY'];
  if (envKey) {
    apiKey = envKey;
    keySource = 'env';
  }

  // 2. Global config (~/.clonebuff/config.json)
  const globalConfigPath = join(homedir(), '.clonebuff', 'config.json');
  const globalConfig = readConfigFile(globalConfigPath);
  if (globalConfig) {
    if (!apiKey && globalConfig.apiKey) {
      apiKey = globalConfig.apiKey;
      keySource = 'global';
    }
    config = mergeConfigs(config, globalConfig);
  }

  // 3. Project-level config (.clonebuffrc or clonebuff.json)
  const rcPaths = ['.clonebuffrc', 'clonebuff.json', '.clonebuffrc.json'];
  for (const rcPath of rcPaths) {
    const fullPath = join(projectDir, rcPath);
    const rcConfig = readConfigFile(fullPath);
    if (rcConfig) {
      if (!apiKey && rcConfig.apiKey) {
        apiKey = rcConfig.apiKey;
        keySource = 'project';
      }
      config = mergeConfigs(config, rcConfig);
      break;
    }
  }

  // 4. Project .env.local (for API key only)
  if (!apiKey) {
    const envLocalKey = readEnvFile(join(projectDir, '.env.local'));
    if (envLocalKey) {
      apiKey = envLocalKey;
      keySource = 'project';
    }
  }

  // 5. Project .env (for API key only)
  if (!apiKey) {
    const envKey = readEnvFile(join(projectDir, '.env'));
    if (envKey) {
      apiKey = envKey;
      keySource = 'project';
    }
  }

  return { apiKey, config, keySource };
}

/**
 * Save API key to a config source.
 */
export function saveApiKey(
  apiKey: string,
  target: 'global' | 'project',
  projectDir: string,
): void {
  if (target === 'global') {
    const configDir = join(homedir(), '.clonebuff');
    const configPath = join(configDir, 'config.json');
    mkdirSync(configDir, { recursive: true });

    const existing = readConfigFile(configPath) ?? {};
    existing.apiKey = apiKey;
    writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
  } else {
    // Save to .env.local in project
    const envPath = join(projectDir, '.env.local');
    const content = `# Clonebuff - OpenRouter API Key\nOPENROUTER_API_KEY=${apiKey}\n`;
    writeFileSync(envPath, content, 'utf-8');
  }
}

/**
 * Read a JSON config file, returning null if it doesn't exist or is invalid.
 */
function readConfigFile(path: string): PartialConfig | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    return JSON.parse(content) as PartialConfig;
  } catch {
    return null;
  }
}

/**
 * Read OPENROUTER_API_KEY from a .env file.
 */
function readEnvFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const content = readFileSync(path, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (trimmed.startsWith('OPENROUTER_API_KEY=')) {
        return trimmed.split('=').slice(1).join('=').replace(/^["']|["']$/g, '');
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Merge a partial config into a full config.
 */
function mergeConfigs(base: ClonebuffConfig, partial: PartialConfig): ClonebuffConfig {
  return {
    ...base,
    ...(partial.model ? { model: partial.model } : {}),
    ...(partial.temperature !== undefined ? { temperature: partial.temperature } : {}),
    ...(partial.maxTokens !== undefined ? { maxTokens: partial.maxTokens } : {}),
  };
}

/**
 * Save one or more config fields to the global config file (~/.clonebuff/config.json).
 * Reads existing config, merges in the new values, and writes back.
 * Only specified fields are updated; all others are preserved.
 */
export function saveConfig(partial: Partial<ClonebuffConfig>): boolean {
  try {
    const configDir = join(homedir(), '.clonebuff');
    const configPath = join(configDir, 'config.json');
    mkdirSync(configDir, { recursive: true });

    const existing = readConfigFile(configPath) ?? {};
    const updated = { ...existing, ...partial };
    writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the project root directory.
 * Uses the current working directory or the CLONEBUFF_PROJECT env var.
 */
export function getProjectDir(): string {
  return process.env['CLONEBUFF_PROJECT'] ?? process.cwd();
}
