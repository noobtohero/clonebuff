/**
 * Tests for src/agent/character.ts — character management system.
 *
 * Covers:
 *  - DEFAULT_CHARACTER shape and values
 *  - loadCharacter: no file, saved file, corrupt JSON, partial merge
 *  - saveCharacter: writes file, merges partial updates, preserves tags
 *  - saveCharacter: error handling
 *  - loadCharacter with file system edge cases
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import { spyOn } from 'bun:test';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
  chmodSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Import the os module namespace so we can spyOn its homedir export
import * as osModule from 'os';

const {
  DEFAULT_CHARACTER,
  loadCharacter,
  saveCharacter,
} = await import('../../src/agent/character');

import type { AgentCharacter } from '../../src/agent/character';

// ─── Helpers ────────────────────────────────────────────────────────────────

let tempHomeDir: string;
let homedirSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  // Create a unique temp directory to act as the fake home directory
  tempHomeDir = join(tmpdir(), `clonebuff-test-char-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(tempHomeDir, { recursive: true });

  // Spy on os.homedir to return our temp directory.
  // Since the character module imports { homedir } from 'os' via ESM live binding,
  // this spy replaces the export on the module namespace, and the character module
  // will see the mocked value.
  homedirSpy = spyOn(osModule, 'homedir').mockImplementation(() => tempHomeDir);
});

afterEach(() => {
  // Clean all files inside tempHomeDir between tests
  rmSync(tempHomeDir, { recursive: true, force: true });
  mkdirSync(tempHomeDir, { recursive: true });
});

afterAll(() => {
  homedirSpy?.mockRestore();
  rmSync(tempHomeDir, { recursive: true, force: true });
});

function getCharPath(): string {
  return join(tempHomeDir, '.clonebuff', 'character.json');
}

function ensureClonebuffDir(): void {
  mkdirSync(join(tempHomeDir, '.clonebuff'), { recursive: true });
}

// ─── DEFAULT_CHARACTER ──────────────────────────────────────────────────────

describe('DEFAULT_CHARACTER', () => {
  it('has all required fields', () => {
    expect(DEFAULT_CHARACTER).toBeDefined();
    expect(typeof DEFAULT_CHARACTER.name).toBe('string');
    expect(typeof DEFAULT_CHARACTER.emoji).toBe('string');
    expect(typeof DEFAULT_CHARACTER.color).toBe('string');
    expect(typeof DEFAULT_CHARACTER.personality).toBe('string');
    expect(typeof DEFAULT_CHARACTER.catchphrase).toBe('string');
    expect(Array.isArray(DEFAULT_CHARACTER.tags)).toBe(true);
    expect(typeof DEFAULT_CHARACTER.backstory).toBe('string');
  });

  it('has a non-empty name', () => {
    expect(DEFAULT_CHARACTER.name.length).toBeGreaterThan(0);
  });

  it('has a emoji', () => {
    expect(DEFAULT_CHARACTER.emoji.length).toBeGreaterThan(0);
    expect(DEFAULT_CHARACTER.emoji.trim().length).toBeGreaterThan(0);
  });

  it('has a color', () => {
    expect(DEFAULT_CHARACTER.color.length).toBeGreaterThan(0);
  });

  it('has a personality description', () => {
    expect(DEFAULT_CHARACTER.personality.length).toBeGreaterThan(50);
  });

  it('has tags array', () => {
    expect(DEFAULT_CHARACTER.tags.length).toBeGreaterThan(0);
    expect(DEFAULT_CHARACTER.tags).toContain('moe');
  });

  it('has a backstory', () => {
    expect(DEFAULT_CHARACTER.backstory.length).toBeGreaterThan(20);
  });

  it('is immutable (modifying returned copy does not affect original)', () => {
    const copy = { ...DEFAULT_CHARACTER };
    copy.name = 'Hacked';
    expect(DEFAULT_CHARACTER.name).not.toBe('Hacked');
  });
});

// ─── loadCharacter ──────────────────────────────────────────────────────────

describe('loadCharacter', () => {
  it('returns a character with valid shape', () => {
    const char = loadCharacter();
    expect(char).toBeDefined();
    expect(char.name).toBeTruthy();
    expect(char.emoji).toBeTruthy();
    expect(char.color).toBeTruthy();
    expect(char.personality).toBeTruthy();
    expect(char.catchphrase).toBeTruthy();
    expect(Array.isArray(char.tags)).toBe(true);
    expect(char.backstory).toBeTruthy();
  });

  it('returns default character when no file exists', () => {
    const char = loadCharacter();
    expect(char.name).toBe(DEFAULT_CHARACTER.name);
    expect(char.emoji).toBe(DEFAULT_CHARACTER.emoji);
    expect(char.personality).toBe(DEFAULT_CHARACTER.personality);
    expect(char.tags).toEqual(DEFAULT_CHARACTER.tags);
  });

  it('returns default character when file does not exist in custom home dir', () => {
    const char = loadCharacter();
    expect(char.name).toBe(DEFAULT_CHARACTER.name);
  });

  it('loads saved character from file', () => {
    const customName = 'Test-chan';
    const customEmoji = '🤖';
    ensureClonebuffDir();
    writeFileSync(getCharPath(), JSON.stringify({
      name: customName,
      emoji: customEmoji,
    }), 'utf-8');

    const char = loadCharacter();
    expect(char.name).toBe(customName);
    expect(char.emoji).toBe(customEmoji);
    // Other fields should fall back to defaults
    expect(char.color).toBe(DEFAULT_CHARACTER.color);
    expect(char.personality).toBe(DEFAULT_CHARACTER.personality);
  });

  it('merges partial saved data with defaults', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), JSON.stringify({
      name: 'Partial-chan',
    }), 'utf-8');

    const char = loadCharacter();
    expect(char.name).toBe('Partial-chan');
    expect(char.emoji).toBe(DEFAULT_CHARACTER.emoji);
    expect(char.color).toBe(DEFAULT_CHARACTER.color);
    expect(char.personality).toBe(DEFAULT_CHARACTER.personality);
    expect(char.catchphrase).toBe(DEFAULT_CHARACTER.catchphrase);
    expect(char.tags).toEqual(DEFAULT_CHARACTER.tags);
    expect(char.backstory).toBe(DEFAULT_CHARACTER.backstory);
  });

  it('handles corrupt JSON gracefully', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), 'not valid json at all', 'utf-8');

    expect(() => loadCharacter()).not.toThrow();
    const char = loadCharacter();
    expect(char.name).toBe(DEFAULT_CHARACTER.name);
  });

  it('handles empty JSON file gracefully', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), '', 'utf-8');

    const char = loadCharacter();
    expect(char.name).toBe(DEFAULT_CHARACTER.name);
  });

  it('preserves saved tags when they exist in file', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), JSON.stringify({
      tags: ['custom-tag-1', 'custom-tag-2'],
    }), 'utf-8');

    const char = loadCharacter();
    expect(char.tags).toEqual(['custom-tag-1', 'custom-tag-2']);
  });

  it('falls back to default tags when tags are missing in saved file', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), JSON.stringify({
      name: 'No-Tag-chan',
    }), 'utf-8');

    const char = loadCharacter();
    expect(char.tags).toEqual(DEFAULT_CHARACTER.tags);
  });

  it('handles unreadable file (returns defaults)', () => {
    ensureClonebuffDir();
    writeFileSync(getCharPath(), 'some content', 'utf-8');
    try {
      chmodSync(getCharPath(), 0o000);
      const char = loadCharacter();
      expect(char.name).toBe(DEFAULT_CHARACTER.name);
      // Restore permissions so afterEach cleanup works
      chmodSync(getCharPath(), 0o644);
    } catch {
      // Skip if platform doesn't support chmod (Windows)
      const char = loadCharacter();
      expect(char.name).toBe(DEFAULT_CHARACTER.name);
    }
  });
});

// ─── saveCharacter ──────────────────────────────────────────────────────────

describe('saveCharacter', () => {
  it('saves character to file and returns updated character', () => {
    const result = saveCharacter({ name: 'Custom-chan' });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.name).toBe('Custom-chan');
      expect(result.character.emoji).toBe(DEFAULT_CHARACTER.emoji);
      expect(result.character.color).toBe(DEFAULT_CHARACTER.color);
    }

    // Verify file was written in the temp home directory
    expect(existsSync(getCharPath())).toBe(true);
    const saved = JSON.parse(readFileSync(getCharPath(), 'utf-8'));
    expect(saved.name).toBe('Custom-chan');
  });

  it('merges updates with existing character', () => {
    // First save: set name
    const result1 = saveCharacter({ name: 'First-chan' });
    expect(result1.success).toBe(true);
    if (result1.success) {
      expect(result1.character.name).toBe('First-chan');
    }

    // Second save: update emoji (name should persist)
    const result2 = saveCharacter({ emoji: '🌟' });
    expect(result2.success).toBe(true);
    if (result2.success) {
      expect(result2.character.name).toBe('First-chan');
      expect(result2.character.emoji).toBe('🌟');
    }

    // Verify file has both
    const saved = JSON.parse(readFileSync(getCharPath(), 'utf-8'));
    expect(saved.name).toBe('First-chan');
    expect(saved.emoji).toBe('🌟');
  });

  it('preserves tags when not included in update', () => {
    saveCharacter({ tags: ['custom1', 'custom2'] });

    // Update name, tags should stay
    saveCharacter({ name: 'Tag-Test' });

    const saved = JSON.parse(readFileSync(getCharPath(), 'utf-8'));
    expect(saved.tags).toEqual(['custom1', 'custom2']);
    expect(saved.name).toBe('Tag-Test');
  });

  it('replaces tags when included in update', () => {
    saveCharacter({ tags: ['old-tag'] });
    saveCharacter({ tags: ['new-tag'] });

    const saved = JSON.parse(readFileSync(getCharPath(), 'utf-8'));
    expect(saved.tags).toEqual(['new-tag']);
  });

  it('can update all character fields at once', () => {
    const fullUpdate: AgentCharacter = {
      name: 'Full-chan',
      emoji: '✨',
      color: 'blue',
      personality: 'A cool assistant.',
      catchphrase: "Let's code!",
      tags: ['cool', 'blue'],
      backstory: 'Born from stardust.',
    };

    const result = saveCharacter(fullUpdate);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character).toEqual(fullUpdate);
    }

    const saved = JSON.parse(readFileSync(getCharPath(), 'utf-8'));
    expect(saved).toEqual(fullUpdate);
  });

  it('returns fresh copy — modifying returned character does not affect saved data', () => {
    const result = saveCharacter({ name: 'Fresh-chan' });
    expect(result.success).toBe(true);
    if (result.success) {
      result.character.name = 'Mutated';
    }

    // Reload — should be the original saved value
    const loaded = loadCharacter();
    expect(loaded.name).toBe('Fresh-chan');
  });

  it('persists across multiple load calls', () => {
    saveCharacter({ name: 'Persist-chan' });

    const char1 = loadCharacter();
    expect(char1.name).toBe('Persist-chan');

    const char2 = loadCharacter();
    expect(char2.name).toBe('Persist-chan');
  });

  it('handles save with empty emoji', () => {
    const result = saveCharacter({ emoji: '' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.emoji).toBe('');
    }
    const loaded = loadCharacter();
    expect(loaded.emoji).toBe('');
  });

  it('handles save with empty personality', () => {
    const result = saveCharacter({ personality: '' });
    expect(result.success).toBe(true);
  });

  it('handles save with empty tags array', () => {
    const result = saveCharacter({ tags: [] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.tags).toEqual([]);
    }
  });

  it('handles write errors gracefully', () => {
    // Make the .clonebuff directory a file to cause a write error
    const clonebuffDir = join(tempHomeDir, '.clonebuff');
    ensureClonebuffDir();
    rmSync(clonebuffDir, { recursive: true, force: true });
    writeFileSync(clonebuffDir, 'this is a file not a directory', 'utf-8');

    const result = saveCharacter({ name: 'Fail-chan' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(typeof result.error).toBe('string');
      expect(result.error.length).toBeGreaterThan(0);
    }

    // Clean up: remove the file so afterEach can work
    rmSync(clonebuffDir, { recursive: true, force: true });
  });
});

// ─── Integration: save → load → save → load ────────────────────────────────

describe('save + load integration', () => {
  it('round-trips: save then load returns the same data', () => {
    saveCharacter({ name: 'Roundtrip-chan', color: 'cyan' });

    const loaded = loadCharacter();
    expect(loaded.name).toBe('Roundtrip-chan');
    expect(loaded.color).toBe('cyan');
    expect(loaded.emoji).toBe(DEFAULT_CHARACTER.emoji);
  });

  it('multiple saves accumulate correctly', () => {
    saveCharacter({ name: 'Step1' });
    saveCharacter({ emoji: '🔥' });
    saveCharacter({ personality: 'Firey assistant.' });

    const loaded = loadCharacter();
    expect(loaded.name).toBe('Step1');
    expect(loaded.emoji).toBe('🔥');
    expect(loaded.personality).toBe('Firey assistant.');
  });

  it('save with all defaults restores default character', () => {
    saveCharacter({ name: 'Temp' });
    saveCharacter(DEFAULT_CHARACTER);

    const loaded = loadCharacter();
    expect(loaded).toEqual(DEFAULT_CHARACTER);
  });
});

// ─── Immutability ───────────────────────────────────────────────────────────

describe('loadCharacter immutability', () => {
  it('returns a new object each time', () => {
    const char1 = loadCharacter();
    const char2 = loadCharacter();
    expect(char1).not.toBe(char2);
  });

  it('modifying returned character does not affect subsequent loads', () => {
    // Reset state first
    saveCharacter({ name: DEFAULT_CHARACTER.name });
    const char1 = loadCharacter();
    char1.name = 'Mutated-chan';

    const char2 = loadCharacter();
    expect(char2.name).toBe(DEFAULT_CHARACTER.name);
    expect(char2.name).not.toBe('Mutated-chan');
  });
});
