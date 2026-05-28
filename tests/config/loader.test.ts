/**
 * Tests for src/config/loader.ts — configuration loading and saving.
 *
 * Tests cover:
 *  - loadConfig with various sources (env, global, project)
 *  - saveConfig persistence to global config
 *  - saveApiKey (global and project targets)
 *  - Config merging priorities
 *  - Missing/invalid config files
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from 'bun:test';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// Dynamically import to reset module state per test
let loader: typeof import('../../src/config/loader');

// ── Global config file isolation ──────────────────────────────────────────
// saveConfig and saveApiKey write to ~/.clonebuff/config.json which persists
// across tests. Clean it before and after all tests in this file.
const GLOBAL_CONFIG_DIR = join(homedir(), '.clonebuff');
const GLOBAL_CONFIG_PATH = join(GLOBAL_CONFIG_DIR, 'config.json');

beforeEach(() => {
  // Remove global config before each test to prevent cross-test leakage
  try { rmSync(GLOBAL_CONFIG_DIR, { recursive: true, force: true }); } catch {}
});

afterAll(() => {
  // Final cleanup
  try { rmSync(GLOBAL_CONFIG_DIR, { recursive: true, force: true }); } catch {}
});

describe('loadConfig', () => {
  let tempDir: string;
  let originalHome: string;
  let originalCwd: string;
  let originalApiKeyEnv: string | undefined;

  beforeEach(async () => {
    // We need to mock homedir and cwd by pointing them at temp directories
    // Bun doesn't support jest.mock, so we use temp dirs and env vars
    tempDir = join(tmpdir(), `clonebuff-test-loader-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempDir, { recursive: true });

    // Save original env to restore later
    originalHome = process.env['HOME'] ?? '';
    originalCwd = process.cwd();

    // Bun auto-loads .env at startup, so clear the env var for clean test isolation
    originalApiKeyEnv = process.env['OPENROUTER_API_KEY'];
    delete process.env['OPENROUTER_API_KEY'];

    // Re-import for fresh state
    loader = await import('../../src/config/loader');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    // Restore the original env var so other tests can use it
    if (originalApiKeyEnv) {
      process.env['OPENROUTER_API_KEY'] = originalApiKeyEnv;
    }
  });

  it('returns defaults when no config sources exist', () => {
    const result = loader.loadConfig(tempDir);
    expect(result.apiKey).toBeNull();
    expect(result.keySource).toBeNull();
    expect(result.config.model).toBe('openai/gpt-5-nano');
    expect(result.config.temperature).toBe(0.3);
    expect(result.config.checkpointsEnabled).toBe(true);
  });

  it('does not pick up global config from other test suites', () => {
    // This test verifies isolation: even if ~/.clonebuff/config.json exists
    // from another test, the first call to loadConfig should not see it
    // because beforeEach cleans it.
    // But let's also verify: write something, then clean, then verify defaults
    mkdirSync(GLOBAL_CONFIG_DIR, { recursive: true });
    writeFileSync(GLOBAL_CONFIG_PATH, JSON.stringify({ apiKey: 'sk-leaked' }), 'utf-8');
    // The beforeEach already ran, so this file exists now. But the beforeEach
    // of the NEXT test will clean it again.
    rmSync(GLOBAL_CONFIG_DIR, { recursive: true, force: true });
    const result = loader.loadConfig(tempDir);
    expect(result.apiKey).toBeNull();
  });

  it('loads API key from environment variable', () => {
    process.env['OPENROUTER_API_KEY'] = 'sk-env-key-123';
    try {
      const result = loader.loadConfig(tempDir);
      expect(result.apiKey).toBe('sk-env-key-123');
      expect(result.keySource).toBe('env');
    } finally {
      delete process.env['OPENROUTER_API_KEY'];
    }
  });

  it('loads API key from global config file', () => {
    const globalConfigDir = join(homedir(), '.clonebuff');
    mkdirSync(globalConfigDir, { recursive: true });
    writeFileSync(
      join(globalConfigDir, 'config.json'),
      JSON.stringify({ apiKey: 'sk-global-key' }),
      'utf-8',
    );
    try {
      const result = loader.loadConfig(tempDir);
      expect(result.apiKey).toBe('sk-global-key');
      expect(result.keySource).toBe('global');
    } finally {
      rmSync(globalConfigDir, { recursive: true, force: true });
    }
  });

  it('loads model from global config', () => {
    const globalConfigDir = join(homedir(), '.clonebuff');
    mkdirSync(globalConfigDir, { recursive: true });
    writeFileSync(
      join(globalConfigDir, 'config.json'),
      JSON.stringify({ model: 'anthropic/claude-sonnet-4' }),
      'utf-8',
    );
    try {
      const result = loader.loadConfig(tempDir);
      expect(result.config.model).toBe('anthropic/claude-sonnet-4');
      expect(result.apiKey).toBeNull();
    } finally {
      rmSync(globalConfigDir, { recursive: true, force: true });
    }
  });

  it('loads config from project .clonebuffrc', () => {
    writeFileSync(
      join(tempDir, '.clonebuffrc'),
      JSON.stringify({ model: 'deepseek/deepseek-v4-flash', temperature: 0.7 }),
      'utf-8',
    );
    const result = loader.loadConfig(tempDir);
    expect(result.config.model).toBe('deepseek/deepseek-v4-flash');
    expect(result.config.temperature).toBe(0.7);
  });

  it('env var has priority over global config for API key', () => {
    // Set up global config with a key
    const globalConfigDir = join(homedir(), '.clonebuff');
    mkdirSync(globalConfigDir, { recursive: true });
    writeFileSync(
      join(globalConfigDir, 'config.json'),
      JSON.stringify({ apiKey: 'sk-global-key' }),
      'utf-8',
    );

    process.env['OPENROUTER_API_KEY'] = 'sk-env-key';
    try {
      const result = loader.loadConfig(tempDir);
      expect(result.apiKey).toBe('sk-env-key');
      expect(result.keySource).toBe('env');
    } finally {
      delete process.env['OPENROUTER_API_KEY'];
      rmSync(globalConfigDir, { recursive: true, force: true });
    }
  });

  it('reads API key from project .env.local', () => {
    writeFileSync(
      join(tempDir, '.env.local'),
      'OPENROUTER_API_KEY=sk-project-env\nOTHER_VAR=hello',
      'utf-8',
    );
    const result = loader.loadConfig(tempDir);
    expect(result.apiKey).toBe('sk-project-env');
    expect(result.keySource).toBe('project');
  });

  it('reads API key from project .env (fallback if .env.local missing)', () => {
    writeFileSync(
      join(tempDir, '.env'),
      'OPENROUTER_API_KEY=sk-dot-env\n',
      'utf-8',
    );
    const result = loader.loadConfig(tempDir);
    expect(result.apiKey).toBe('sk-dot-env');
    expect(result.keySource).toBe('project');
  });

  it('handles missing config files gracefully', () => {
    // No files exist
    const result = loader.loadConfig(tempDir);
    expect(result.apiKey).toBeNull();
    expect(result.config).toBeDefined();
    expect(result.config.model).toBe('openai/gpt-5-nano');
  });

  it('handles corrupt JSON config files gracefully', () => {
    writeFileSync(join(tempDir, '.clonebuffrc'), 'not valid json{{{', 'utf-8');
    const result = loader.loadConfig(tempDir);
    // Should fall back to defaults
    expect(result.config.model).toBe('openai/gpt-5-nano');
    expect(result.apiKey).toBeNull();
  });
});

describe('saveConfig', () => {
  let originalHome: string;

  beforeEach(async () => {
    loader = await import('../../src/config/loader');
  });

  it('saves a partial config to global config file', async () => {
    const result = loader.saveConfig({ model: 'anthropic/claude-sonnet-4' });
    expect(result).toBe(true);

    // Verify it was saved
    const globalConfigPath = join(homedir(), '.clonebuff', 'config.json');
    const { existsSync, readFileSync } = await import('fs');
    expect(existsSync(globalConfigPath)).toBe(true);
    const saved = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(saved.model).toBe('anthropic/claude-sonnet-4');
  });

  it('preserves existing config fields when saving partial', async () => {
    // First save model and temperature
    loader.saveConfig({ model: 'gpt-4', temperature: 0.5 });
    // Then save only temperature change
    loader.saveConfig({ temperature: 0.8 });

    const globalConfigPath = join(homedir(), '.clonebuff', 'config.json');
    const { readFileSync } = await import('fs');
    const saved = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    // Model should still be preserved
    expect(saved.model).toBe('gpt-4');
    expect(saved.temperature).toBe(0.8);
  });

  it('returns true on success', async () => {
    const result = loader.saveConfig({ model: 'test-model' });
    expect(result).toBe(true);
  });
});

describe('saveApiKey', () => {
  let tempDir: string;

  beforeEach(async () => {
    loader = await import('../../src/config/loader');
    tempDir = join(tmpdir(), `clonebuff-test-saveapikey-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    mkdirSync(tempDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('saves API key to global config', async () => {
    loader.saveApiKey('sk-global-saved', 'global', tempDir);

    const globalConfigPath = join(homedir(), '.clonebuff', 'config.json');
    const { existsSync, readFileSync } = await import('fs');
    expect(existsSync(globalConfigPath)).toBe(true);
    const saved = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(saved.apiKey).toBe('sk-global-saved');
  });

  it('saves API key to project .env.local', async () => {
    loader.saveApiKey('sk-project-saved', 'project', tempDir);

    const envPath = join(tempDir, '.env.local');
    const { existsSync, readFileSync } = await import('fs');
    expect(existsSync(envPath)).toBe(true);
    const content = readFileSync(envPath, 'utf-8');
    expect(content).toContain('OPENROUTER_API_KEY=sk-project-saved');
  });

  it('preserves existing global config when saving API key', async () => {
    // Pre-set a model in global config
    loader.saveConfig({ model: 'existing-model' });
    // Now save an API key
    loader.saveApiKey('sk-key', 'global', tempDir);

    const globalConfigPath = join(homedir(), '.clonebuff', 'config.json');
    const { readFileSync } = await import('fs');
    const saved = JSON.parse(readFileSync(globalConfigPath, 'utf-8'));
    expect(saved.apiKey).toBe('sk-key');
    expect(saved.model).toBe('existing-model');
  });
});
