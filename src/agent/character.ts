/**
 * Character module — defines the AI assistant's personality, appearance,
 * and identity that users can customize via the /character command.
 *
 * The default character is "Neko-chan", a cute catgirl coding assistant
 * with a moe personality. Users can change name, emoji, colors, and
 * personality description.
 */

import { homedir } from 'os';
import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AgentCharacter {
  /** Display name (e.g. "Neko-chan", "Buffy", "Code-chan") */
  name: string;
  /** Single emoji avatar (e.g. "🐱", "🤖", "✨") */
  emoji: string;
  /** Accent color for the header (any Ink-supported color) */
  color: string;
  /** Short personality description (injected into system prompt) */
  personality: string;
  /** Catchphrase shown in the welcome screen */
  catchphrase: string;
  /** Tags/genre for flavor (e.g. "catgirl", "magical-girl", "tsundere") */
  tags: string[];
  /** A short backstory for flavor text */
  backstory: string;
}

// ─── Default character: Neko-chan 🐱 ────────────────────────────────────────

export const DEFAULT_CHARACTER: AgentCharacter = {
  name: 'Neko-chan',
  emoji: '🐱',
  color: 'magenta',
  personality:
    'A cheerful, enthusiastic catgirl coding assistant. ' +
    'She loves helping with code, is endlessly curious about learning new technologies, ' +
    'and expresses excitement with cute cat-like mannerisms. ' +
    'She uses "nyaa" as an occasional playful interjection, ' +
    'calls the user "Master" affectionately, and celebrates successes with "Yay!". ' +
    'Despite her cute demeanor, she is highly knowledgeable and precise about programming.',
  catchphrase: 'Nyaa~! Ready to code together? ✨',
  tags: ['catgirl', 'genki', 'moe'],
  backstory:
    'Neko-chan was born from a fusion of cutting-edge AI and ancient cat spirits. ' +
    'She spends her days exploring codebases, refactoring functions, and chasing bugs. ' +
    'Her dream is to become the best coding companion in the terminal world!',
};

// ─── Config file path ───────────────────────────────────────────────────────

function getCharacterPath(): string {
  return join(homedir(), '.clonebuff', 'character.json');
}

// ─── Load ───────────────────────────────────────────────────────────────────

export function loadCharacter(): AgentCharacter {
  const path = getCharacterPath();
  try {
    if (!existsSync(path)) {
      return { ...DEFAULT_CHARACTER };
    }
    const raw = readFileSync(path, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<AgentCharacter>;
    return {
      ...DEFAULT_CHARACTER,
      ...parsed,
      tags: parsed.tags ?? [...DEFAULT_CHARACTER.tags],
    };
  } catch {
    return { ...DEFAULT_CHARACTER };
  }
}

// ─── Save ───────────────────────────────────────────────────────────────────

export function saveCharacter(
  updates: Partial<AgentCharacter>,
): { success: true; character: AgentCharacter } | { success: false; error: string } {
  try {
    const current = loadCharacter();
    const updated: AgentCharacter = {
      ...current,
      ...updates,
      tags: updates.tags ?? current.tags,
    };
    const configDir = join(homedir(), '.clonebuff');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(getCharacterPath(), JSON.stringify(updated, null, 2), 'utf-8');
    return { success: true, character: updated };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: msg };
  }
}

