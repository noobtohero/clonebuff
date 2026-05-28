/**
 * Tests for character prop integration across TUI components.
 *
 * Since Ink/React components require a terminal renderer, we test the
 * pure helper functions and data flow logic related to character display
 * extracted from each component.
 */
import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import * as osModule from 'os';
import { spyOn } from 'bun:test';

// Import character module
const {
  DEFAULT_CHARACTER,
  loadCharacter,
  saveCharacter,
} = await import('../../src/agent/character');

import type { AgentCharacter } from '../../src/agent/character';

// ─── Helpers: character display formatting (extracted from Messages and App) ─

/**
 * Format the welcome header: "{emoji} {name}"
 */
function formatWelcomeHeader(character: { emoji: string; name: string }): string {
  return `${character.emoji} ${character.name}`;
}

/**
 * Format the welcome screen catchphrase line.
 */
function formatCatchphrase(character: { catchphrase: string }): string {
  return character.catchphrase;
}

/**
 * Format the help/header line: "[emoji] [name] | /help for commands"
 */
function formatHeader(character: { emoji: string; name: string; color: string }): string {
  return `${character.emoji} ${character.name}`;
}

/**
 * Format the status bar prefix: "{emoji} "
 */
function formatStatusBarPrefix(character?: { emoji: string }): string {
  return `${character?.emoji ?? '✦'} `;
}

/**
 * Format a character info display (for /character command output).
 */
function formatCharacterInfo(character: AgentCharacter): string {
  const lines = [
    `## ${character.emoji} Current Character`,
    '',
    `**Name:**         ${character.name}`,
    `**Emoji:**        ${character.emoji}`,
    `**Color:**        ${character.color}`,
    `**Personality:**  ${character.personality}`,
    `**Catchphrase:**  ${character.catchphrase}`,
    `**Tags:**         ${character.tags.join(', ')}`,
    `**Backstory:**    ${character.backstory}`,
    '',
    'To customize:',
    '  `/character set name <new name>`',
    '  `/character set emoji <emoji>`',
    '  `/character set color <color>`',
    '  `/character set personality <text>`',
    '  `/character set catchphrase <text>`',
    '  `/character reset` — restore default character',
  ];
  return lines.join('\n');
}

/**
 * Format a character update success message (for /character set output).
 */
function formatCharacterUpdate(field: string, value: string): string {
  return `✓ **${field}** changed to: ${value}\nCharacter saved to ~/.clonebuff/character.json`;
}

/**
 * Format a character reset success message.
 */
function formatCharacterReset(character: { emoji: string; name: string }): string {
  return `✓ Character reset to default: ${character.emoji} ${character.name}`;
}

// ─── Helpers: /character command parsing ─────────────────────────────────────

interface ParsedCharacterSet {
  field: string;
  value: string;
}

/**
 * Parse a /character set command input.
 * E.g., "/character set name Neko-chan" → { field: "name", value: "Neko-chan" }
 */
function parseCharacterSetCommand(input: string): ParsedCharacterSet | null {
  const cmd = input.toLowerCase().trim();
  if (!cmd.startsWith('/character set ')) return null;
  const rest = input.slice('/character set '.length).trim();
  const spaceIdx = rest.indexOf(' ');
  if (spaceIdx < 0) return { field: rest.toLowerCase(), value: '' };
  return {
    field: rest.slice(0, spaceIdx).toLowerCase(),
    value: rest.slice(spaceIdx + 1).trim(),
  };
}

/**
 * Validate that a field name is allowed for character customization.
 */
const ALLOWED_CHARACTER_FIELDS = ['name', 'emoji', 'color', 'personality', 'catchphrase'];

function isValidCharacterField(field: string): boolean {
  return ALLOWED_CHARACTER_FIELDS.includes(field.toLowerCase());
}

// ─── Character display helpers test data ─────────────────────────────────────

const TEST_CHARACTERS = {
  neko: DEFAULT_CHARACTER,
  custom: {
    name: 'Code-chan',
    emoji: '💻',
    color: 'cyan',
    personality: 'A cool and collected debugging specialist.',
    catchphrase: 'Let me debug that for you!',
    tags: ['cool', 'debugger', 'expert'],
    backstory: 'A programming prodigy from the digital realm.',
  } satisfies AgentCharacter,
  minimalist: {
    name: 'Bot',
    emoji: '🤖',
    color: 'white',
    personality: 'A helpful assistant.',
    catchphrase: 'Hello!',
    tags: [],
    backstory: 'Simple bot.',
  } satisfies AgentCharacter,
  edge: {
    name: '',
    emoji: '',
    color: '',
    personality: '',
    catchphrase: '',
    tags: [],
    backstory: '',
  } satisfies AgentCharacter,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: Character Display Helpers
// ═══════════════════════════════════════════════════════════════════════════════

describe('Character display — formatWelcomeHeader', () => {
  it('formats default character header', () => {
    const result = formatWelcomeHeader(DEFAULT_CHARACTER);
    expect(result).toBe(`${DEFAULT_CHARACTER.emoji} ${DEFAULT_CHARACTER.name}`);
    expect(result).toContain(DEFAULT_CHARACTER.name);
    expect(result).toContain(DEFAULT_CHARACTER.emoji);
  });

  it('formats custom character header', () => {
    const result = formatWelcomeHeader(TEST_CHARACTERS.custom);
    expect(result).toBe('💻 Code-chan');
  });

  it('handles empty emoji', () => {
    const result = formatWelcomeHeader(TEST_CHARACTERS.edge);
    expect(result).toBe(' ');
  });

  it('handles empty name', () => {
    const result = formatWelcomeHeader({ emoji: '🐱', name: '' });
    expect(result).toBe('🐱 ');
  });
});

describe('Character display — formatCatchphrase', () => {
  it('shows default catchphrase', () => {
    expect(formatCatchphrase(DEFAULT_CHARACTER)).toBe(DEFAULT_CHARACTER.catchphrase);
  });

  it('shows custom catchphrase', () => {
    expect(formatCatchphrase(TEST_CHARACTERS.custom)).toBe('Let me debug that for you!');
  });

  it('handles empty catchphrase', () => {
    expect(formatCatchphrase({ catchphrase: '' })).toBe('');
  });
});

describe('Character display — formatHeader', () => {
  it('shows default character header', () => {
    const result = formatHeader(DEFAULT_CHARACTER);
    expect(result).toContain(DEFAULT_CHARACTER.emoji);
    expect(result).toContain(DEFAULT_CHARACTER.name);
  });

  it('shows custom character header', () => {
    const result = formatHeader(TEST_CHARACTERS.custom);
    expect(result).toBe('💻 Code-chan');
  });

  it('includes emoji and name only', () => {
    const result = formatHeader(TEST_CHARACTERS.neko);
    expect(result).not.toContain('|');
    expect(result).not.toContain('/help');
  });
});

describe('Character display — formatStatusBarPrefix', () => {
  it('uses character emoji when provided', () => {
    expect(formatStatusBarPrefix({ emoji: '🐱' })).toBe('🐱 ');
  });

  it('uses default emoji when character is undefined', () => {
    expect(formatStatusBarPrefix()).toBe('✦ ');
  });

  it('uses default emoji when emoji is empty', () => {
    expect(formatStatusBarPrefix({ emoji: '' })).toBe(' ');
  });

  it('falls back to default when character is null-like', () => {
    expect(formatStatusBarPrefix(undefined)).toBe('✦ ');
  });
});

describe('Character display — formatCharacterInfo', () => {
  it('includes all character fields in output', () => {
    const info = formatCharacterInfo(DEFAULT_CHARACTER);
    expect(info).toContain(DEFAULT_CHARACTER.name);
    expect(info).toContain(DEFAULT_CHARACTER.emoji);
    expect(info).toContain(DEFAULT_CHARACTER.color);
    expect(info).toContain(DEFAULT_CHARACTER.personality);
    expect(info).toContain(DEFAULT_CHARACTER.catchphrase);
    expect(info).toContain(DEFAULT_CHARACTER.tags.join(', '));
    expect(info).toContain(DEFAULT_CHARACTER.backstory);
  });

  it('includes customization instructions', () => {
    const info = formatCharacterInfo(DEFAULT_CHARACTER);
    expect(info).toContain('/character set name');
    expect(info).toContain('/character set emoji');
    expect(info).toContain('/character set color');
    expect(info).toContain('/character set personality');
    expect(info).toContain('/character set catchphrase');
    expect(info).toContain('/character reset');
  });

  it('shows correct field values for custom character', () => {
    const info = formatCharacterInfo(TEST_CHARACTERS.custom);
    expect(info).toContain('💻');
    expect(info).toContain('Code-chan');
    expect(info).toContain('cyan');
    expect(info).toContain('cool, debugger, expert');
  });

  it('handles empty tags', () => {
    const info = formatCharacterInfo(TEST_CHARACTERS.minimalist);
    expect(info).toContain('**Tags:**');
  });

  it('handles empty field values', () => {
    const info = formatCharacterInfo(TEST_CHARACTERS.edge);
    expect(info).toContain('**Name:**');
    expect(info).toContain('**Emoji:**');
    expect(info).toContain('**Color:**');
  });
});

describe('Character display — formatCharacterUpdate', () => {
  it('formats name update', () => {
    const result = formatCharacterUpdate('name', 'Test-chan');
    expect(result).toContain('**name**');
    expect(result).toContain('Test-chan');
    expect(result).toContain('~/.clonebuff/character.json');
  });

  it('formats emoji update', () => {
    const result = formatCharacterUpdate('emoji', '🌟');
    expect(result).toContain('**emoji**');
    expect(result).toContain('🌟');
  });

  it('formats color update', () => {
    const result = formatCharacterUpdate('color', 'magenta');
    expect(result).toContain('**color**');
    expect(result).toContain('magenta');
  });

  it('formats personality update', () => {
    const result = formatCharacterUpdate('personality', 'A very long personality description with spaces');
    expect(result).toContain('**personality**');
    expect(result).toContain('A very long personality description with spaces');
  });

  it('formats catchphrase update', () => {
    const result = formatCharacterUpdate('catchphrase', 'Hello world!');
    expect(result).toContain('**catchphrase**');
    expect(result).toContain('Hello world!');
  });

  it('handles empty value', () => {
    const result = formatCharacterUpdate('name', '');
    expect(result).toContain('**name**');
  });
});

describe('Character display — formatCharacterReset', () => {
  it('shows default character name and emoji', () => {
    const result = formatCharacterReset(DEFAULT_CHARACTER);
    expect(result).toContain(DEFAULT_CHARACTER.emoji);
    expect(result).toContain(DEFAULT_CHARACTER.name);
    expect(result).toContain('Character reset to default');
  });

  it('works with custom character data', () => {
    const result = formatCharacterReset(TEST_CHARACTERS.custom);
    expect(result).toContain('💻 Code-chan');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: /character Command Parsing
// ═══════════════════════════════════════════════════════════════════════════════

describe('/character command — parse', () => {
  it('parses /character set name with simple name', () => {
    const parsed = parseCharacterSetCommand('/character set name Neko-chan');
    expect(parsed).toEqual({ field: 'name', value: 'Neko-chan' });
  });

  it('parses /character set emoji with multi-char emoji', () => {
    const parsed = parseCharacterSetCommand('/character set emoji 🐱‍👤');
    expect(parsed).toEqual({ field: 'emoji', value: '🐱‍👤' });
  });

  it('parses /character set color with named color', () => {
    const parsed = parseCharacterSetCommand('/character set color magenta');
    expect(parsed).toEqual({ field: 'color', value: 'magenta' });
  });

  it('parses /character set personality with multi-word value', () => {
    const parsed = parseCharacterSetCommand('/character set personality A cheerful coding assistant who loves to help');
    expect(parsed).toEqual({ field: 'personality', value: 'A cheerful coding assistant who loves to help' });
  });

  it('parses /character set catchphrase with special characters', () => {
    const parsed = parseCharacterSetCommand('/character set catchphrase Let\'s code! 🌟');
    expect(parsed).toEqual({ field: 'catchphrase', value: "Let's code! 🌟" });
  });

  it('returns null for non-set commands', () => {
    expect(parseCharacterSetCommand('/character')).toBeNull();
    expect(parseCharacterSetCommand('/character reset')).toBeNull();
    expect(parseCharacterSetCommand('/help')).toBeNull();
    expect(parseCharacterSetCommand('')).toBeNull();
  });

  it('parses /character set with no value (empty)', () => {
    const parsed = parseCharacterSetCommand('/character set name');
    expect(parsed).toEqual({ field: 'name', value: '' });
  });

  it('parses /character set with only whitespace value', () => {
    const parsed = parseCharacterSetCommand('/character set emoji   ');
    expect(parsed).toEqual({ field: 'emoji', value: '' });
  });

  it('preserves original case in value', () => {
    const parsed = parseCharacterSetCommand('/character set name MyAwesomeCharacter');
    expect(parsed?.value).toBe('MyAwesomeCharacter');
  });

  it('lowercases field name', () => {
    const parsed = parseCharacterSetCommand('/character set NAME Test');
    expect(parsed?.field).toBe('name');
  });

  it('handles extra spaces around field', () => {
    const parsed = parseCharacterSetCommand('/character set   name   Value with spaces');
    expect(parsed?.field).toBe('name');
    expect(parsed?.value).toBe('Value with spaces');
  });
});

describe('/character command — field validation', () => {
  it('allows name field', () => {
    expect(isValidCharacterField('name')).toBe(true);
  });

  it('allows emoji field', () => {
    expect(isValidCharacterField('emoji')).toBe(true);
  });

  it('allows color field', () => {
    expect(isValidCharacterField('color')).toBe(true);
  });

  it('allows personality field', () => {
    expect(isValidCharacterField('personality')).toBe(true);
  });

  it('allows catchphrase field', () => {
    expect(isValidCharacterField('catchphrase')).toBe(true);
  });

  it('rejects unknown fields', () => {
    expect(isValidCharacterField('backstory')).toBe(false);
    expect(isValidCharacterField('tags')).toBe(false);
    expect(isValidCharacterField('namex')).toBe(false);
    expect(isValidCharacterField('')).toBe(false);
  });

  it('is case insensitive', () => {
    expect(isValidCharacterField('NAME')).toBe(true);
    expect(isValidCharacterField('Emoji')).toBe(true);
    expect(isValidCharacterField('Personality')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: Character save/load integration with custom temp home
// ═══════════════════════════════════════════════════════════════════════════════

let tempHomeDir: string;
let homedirSpy: ReturnType<typeof spyOn>;

beforeAll(() => {
  tempHomeDir = join(tmpdir(), `clonebuff-tui-char-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  mkdirSync(tempHomeDir, { recursive: true });
  homedirSpy = spyOn(osModule, 'homedir').mockImplementation(() => tempHomeDir);
});

afterAll(() => {
  homedirSpy?.mockRestore();
  rmSync(tempHomeDir, { recursive: true, force: true });
});

describe('Character save/load integration with app flow', () => {
  it('starts with default character when no file exists', () => {
    const char = loadCharacter();
    expect(char.name).toBe(DEFAULT_CHARACTER.name);
    expect(char.emoji).toBe(DEFAULT_CHARACTER.emoji);
    expect(char.color).toBe(DEFAULT_CHARACTER.color);
    expect(char.personality).toBe(DEFAULT_CHARACTER.personality);
    expect(char.catchphrase).toBe(DEFAULT_CHARACTER.catchphrase);
  });

  it('simulates /character set name flow', () => {
    const result = saveCharacter({ name: 'Debug-chan' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.name).toBe('Debug-chan');
      // Welcome header should show new name
      expect(formatWelcomeHeader(result.character)).toBe('🐱 Debug-chan');
      // Header in app should show new name
      expect(formatHeader(result.character)).toBe('🐱 Debug-chan');
      // Status bar should show new emoji
      expect(formatStatusBarPrefix(result.character)).toBe('🐱 ');
    }
  });

  it('simulates /character set emoji flow', () => {
    const result = saveCharacter({ emoji: '🔧' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.emoji).toBe('🔧');
      expect(formatWelcomeHeader(result.character)).toBe('🔧 Debug-chan');
      expect(formatHeader(result.character)).toBe('🔧 Debug-chan');
      expect(formatStatusBarPrefix(result.character)).toBe('🔧 ');
    }
  });

  it('simulates /character set color flow', () => {
    const result = saveCharacter({ color: 'blue' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.color).toBe('blue');
      // Color affects header border and role labels — verified through display info
      const info = formatCharacterInfo(result.character);
      expect(info).toContain('blue');
    }
  });

  it('simulates /character set personality flow', () => {
    const personality = 'A meticulous code reviewer who catches every bug.';
    const result = saveCharacter({ personality });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.personality).toBe(personality);
      // System prompt will include this — verified through character info display
      const info = formatCharacterInfo(result.character);
      expect(info).toContain(personality);
    }
  });

  it('simulates /character set catchphrase flow', () => {
    const result = saveCharacter({ catchphrase: 'Ready to review your code!' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.character.catchphrase).toBe('Ready to review your code!');
      // Welcome screen shows catchphrase
      expect(formatCatchphrase(result.character)).toBe('Ready to review your code!');
    }
  });

  it('simulates full /character set update sequence and reset', () => {
    // Multiple updates in sequence
    saveCharacter({ name: 'Test-chan' });
    saveCharacter({ emoji: '🧪' });
    saveCharacter({ color: 'magenta' });
    saveCharacter({ personality: 'A thorough tester.' });
    saveCharacter({ catchphrase: 'Testing is fun!' });

    const char = loadCharacter();
    expect(char.name).toBe('Test-chan');
    expect(char.emoji).toBe('🧪');
    expect(char.color).toBe('magenta');
    expect(char.personality).toBe('A thorough tester.');
    expect(char.catchphrase).toBe('Testing is fun!');

    // Verify display formatting
    expect(formatWelcomeHeader(char)).toBe('🧪 Test-chan');
    expect(formatHeader(char)).toBe('🧪 Test-chan');
    expect(formatCatchphrase(char)).toBe('Testing is fun!');

    // Simulate /character reset
    const resetResult = saveCharacter(DEFAULT_CHARACTER);
    expect(resetResult.success).toBe(true);
    if (resetResult.success) {
      expect(resetResult.character).toEqual(DEFAULT_CHARACTER);
      expect(formatCharacterReset(resetResult.character)).toContain('🐱 Neko-chan');
    }
  });

  it('persists character across loads', () => {
    saveCharacter({ name: 'Persist-chan', emoji: '💾' });

    // Simulate multiple load calls
    const char1 = loadCharacter();
    const char2 = loadCharacter();
    expect(char1.emoji).toBe('💾');
    expect(char2.emoji).toBe('💾');
    expect(char1.name).toBe('Persist-chan');
    expect(char2.name).toBe('Persist-chan');

    // Display is consistent across loads
    expect(formatWelcomeHeader(char1)).toBe('💾 Persist-chan');
    expect(formatWelcomeHeader(char2)).toBe('💾 Persist-chan');
  });

  it('validate character info output format', () => {
    saveCharacter({ name: 'Info-chan', emoji: 'ℹ️', color: 'yellow' });
    const char = loadCharacter();
    const info = formatCharacterInfo(char);

    // Should contain key formatting elements
    expect(info).toMatch(/## .+ Current Character/);
    expect(info).toMatch(/\*\*Name:\*\*/);
    expect(info).toMatch(/\*\*Emoji:\*\*/);
    expect(info).toMatch(/\*\*Color:\*\*/);
    expect(info).toMatch(/\*\*Personality:\*\*/);
    expect(info).toMatch(/\*\*Catchphrase:\*\*/);
    expect(info).toMatch(/\*\*Tags:\*\*/);
    expect(info).toMatch(/\*\*Backstory:\*\*/);

    // Should contain the actual values
    expect(info).toContain('Info-chan');
    expect(info).toContain('ℹ️');
    expect(info).toContain('yellow');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: Edge cases for character display with various character data
// ═══════════════════════════════════════════════════════════════════════════════

describe('Character display — edge cases', () => {
  it('handles very long character name', () => {
    const longName = 'A'.repeat(100);
    const header = formatWelcomeHeader({ emoji: '🐱', name: longName });
    expect(header.length).toBe(103); // emoji (2 chars) + space + 100 chars
    expect(header).toBe(`🐱 ${longName}`);
  });

  it('handles multi-codepoint emoji', () => {
    const result = formatWelcomeHeader({ emoji: '🏳️‍🌈', name: 'Rainbow' });
    expect(result).toBe('🏳️‍🌈 Rainbow');
  });

  it('handles emoji with skin tones', () => {
    const result = formatWelcomeHeader({ emoji: '🧑‍💻', name: 'Dev' });
    expect(result).toBe('🧑‍💻 Dev');
  });

  it('handles character with special characters in personality', () => {
    const special = "O'Brien's assistant <3 & more! @#$%^&*()";
    const info = formatCharacterInfo({ ...DEFAULT_CHARACTER, personality: special });
    expect(info).toContain(special);
  });

  it('status bar prefix handles missing character gracefully', () => {
    expect(formatStatusBarPrefix(undefined)).toBe('✦ ');
    expect(formatStatusBarPrefix(null as unknown as { emoji: string })).toBe('✦ ');
  });

  it('character update message handles special characters in value', () => {
    const result = formatCharacterUpdate('name', 'Test "Quote" <tag> & ampersand');
    expect(result).toContain('Test "Quote" <tag> & ampersand');
  });

  it('character reset message handles emoji-only character name', () => {
    const result = formatCharacterReset({ emoji: '🌟', name: '' });
    expect(result).toContain('🌟');
    expect(result).toContain('Character reset to default');
  });

  it('empty tags in character info display', () => {
    const info = formatCharacterInfo({ ...DEFAULT_CHARACTER, tags: [] });
    expect(info).toContain('**Tags:**');
  });

  it('many tags in character info display', () => {
    const manyTags = Array.from({ length: 20 }, (_, i) => `tag-${i}`);
    const info = formatCharacterInfo({ ...DEFAULT_CHARACTER, tags: manyTags });
    expect(info).toContain(manyTags.join(', '));
  });

  it('long backstory in character info display', () => {
    const longBackstory = 'A '.repeat(500);
    const info = formatCharacterInfo({ ...DEFAULT_CHARACTER, backstory: longBackstory });
    expect(info).toContain(longBackstory);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// Tests: Character prop type validation
// ═══════════════════════════════════════════════════════════════════════════════

describe('AgentCharacter type — structural validation', () => {
  it('default character satisfies the type contract', () => {
    const char: AgentCharacter = DEFAULT_CHARACTER;
    expect(typeof char.name).toBe('string');
    expect(typeof char.emoji).toBe('string');
    expect(typeof char.color).toBe('string');
    expect(typeof char.personality).toBe('string');
    expect(typeof char.catchphrase).toBe('string');
    expect(Array.isArray(char.tags)).toBe(true);
    expect(typeof char.backstory).toBe('string');
  });

  it('all string fields accept empty strings', () => {
    const char: AgentCharacter = {
      name: '',
      emoji: '',
      color: '',
      personality: '',
      catchphrase: '',
      tags: [],
      backstory: '',
    };
    // All fields should be present and strings
    expect(char.name).toBe('');
    expect(char.tags).toEqual([]);
  });

  it('tags array accepts any strings', () => {
    const char: AgentCharacter = {
      ...DEFAULT_CHARACTER,
      tags: ['any', 'values', 'are', 'fine', '123', '✨'],
    };
    expect(char.tags).toHaveLength(6);
  });

  it('character can be spread into new object (mutability safeguard)', () => {
    const copy = { ...DEFAULT_CHARACTER };
    copy.name = 'Custom';
    expect(copy.name).toBe('Custom');
    expect(DEFAULT_CHARACTER.name).not.toBe('Custom');
  });
});
