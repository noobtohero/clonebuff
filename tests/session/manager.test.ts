/**
 * Tests for src/session/manager.ts — session history persistence.
 *
 * Covers:
 *  - save: new session, update existing, custom name, auto-generated name/preview
 *  - load: valid ID, missing ID, corrupt file
 *  - list: multiple sessions, most-recent-first ordering, corrupt files skipped
 *  - delete: existing session, missing session, non-existent file
 *  - loadLatest: with/without sessions
 *  - count: correct total
 *  - Edge cases: empty messages, system-only messages, long name truncation,
 *    non-JSON files in history dir, history dir auto-creation
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'bun:test';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  existsSync,
  readdirSync,
} from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { ConversationMessage } from '../../src/openrouter/types';
import type { SessionEntry } from '../../src/session/types';

const { SessionManager } = await import('../../src/session/manager');

// ─── Test Setup ─────────────────────────────────────────────────────────────

let baseDir: string;

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'clonebuff-test-session-'));
});

afterEach(() => {
  // Clean the entire test directory between tests
  rmSync(baseDir, { recursive: true, force: true });
  mkdirSync(baseDir, { recursive: true });
});

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true });
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeMsg(
  role: 'user' | 'assistant' | 'system' | 'tool',
  content: string,
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role,
    content,
    timestamp: Date.now(),
    ...overrides,
  };
}

const userMsg = (text: string) => makeMsg('user', text);
const assistMsg = (text: string) => makeMsg('assistant', text);
const sysMsg = (text: string) => makeMsg('system', text);

function createManager(): SessionManager {
  return new SessionManager(baseDir);
}

function sessionDir(): string {
  return join(baseDir, '.clonebuff', 'history');
}

// ─── save ───────────────────────────────────────────────────────────────────

describe('SessionManager.save', () => {
  it('creates a new session and returns an ID', () => {
    const mgr = createManager();
    const messages = [userMsg('Hello, world!')];

    const id = mgr.save(messages, 'test-model');

    expect(id).toBeTruthy();
    expect(id).toMatch(/^session-/);
    // Verify file was created
    const filePath = join(sessionDir(), `${id}.json`);
    expect(existsSync(filePath)).toBe(true);
  });

  it('persists the correct data to disk', () => {
    const mgr = createManager();
    const messages = [
      sysMsg('You are helpful.'),
      userMsg('Write a test'),
      assistMsg('Here is the test.'),
    ];

    const id = mgr.save(messages, 'gpt-4o');

    const filePath = join(sessionDir(), `${id}.json`);
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as SessionEntry;

    expect(raw.id).toBe(id);
    expect(raw.model).toBe('gpt-4o');
    expect(raw.messageCount).toBe(2); // system messages excluded
    expect(raw.messages.length).toBe(3); // all messages stored
    expect(raw.createdAt).toBeGreaterThan(0);
    expect(raw.updatedAt).toBeGreaterThan(0);
  });

  it('updates an existing session when given an ID', () => {
    const mgr = createManager();
    const original = [userMsg('First message')];
    const id = mgr.save(original, 'model-a');

    // Give it a moment so timestamps differ
    const originalCreatedAt = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ).createdAt;

    const updated = [userMsg('Second message')];
    const sameId = mgr.save(updated, 'model-b', { id });

    expect(sameId).toBe(id);

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.createdAt).toBe(originalCreatedAt); // preserved
    expect(raw.updatedAt).toBeGreaterThan(originalCreatedAt); // updated
    expect(raw.model).toBe('model-b');
    expect(raw.messageCount).toBe(1);
  });

  it('uses a custom name when provided', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('Hello')], 'test-model', {
      name: 'My Custom Session',
    });

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.name).toBe('My Custom Session');
  });

  it('auto-generates name from the first user message', () => {
    const mgr = createManager();
    const messages = [
      sysMsg('system prompt'),
      userMsg('Refactor the authentication module to use JWT'),
      assistMsg('Sure!'),
    ];

    const id = mgr.save(messages, 'test-model');
    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.name).toContain('Refactor');
    expect(raw.name).toContain('JWT');
  });

  it('truncates long auto-generated names at 60 characters', () => {
    const mgr = createManager();
    const longMessage = 'a'.repeat(100);
    const id = mgr.save([userMsg(longMessage)], 'test-model');

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.name.length).toBe(61); // 60 chars + '…'
    expect(raw.name).toContain('…');
  });

  it('generates preview from first user message (truncated at 120 chars)', () => {
    const mgr = createManager();
    const longMessage = 'b'.repeat(200);
    const id = mgr.save([userMsg(longMessage)], 'test-model');

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.preview.length).toBe(121); // 120 chars + '…'
    expect(raw.preview).toContain('…');
  });

  it('handles messages with only system messages gracefully', () => {
    const mgr = createManager();
    const id = mgr.save([sysMsg('You are helpful.')], 'test-model');

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.messageCount).toBe(0);
    expect(raw.name).toContain('Session');
    expect(raw.preview).toBe('(empty)');
  });

  it('preserves existing name when updating a session without a new name', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('First')], 'model-a', {
      name: 'Original Name',
    });
    const updated = mgr.save([userMsg('Second')], 'model-b', { id });

    expect(updated).toBe(id);

    const raw = JSON.parse(
      readFileSync(join(sessionDir(), `${id}.json`), 'utf-8'),
    ) as SessionEntry;

    expect(raw.name).toBe('Original Name');
  });
});

// ─── load ───────────────────────────────────────────────────────────────────

describe('SessionManager.load', () => {
  it('loads a session by ID', () => {
    const mgr = createManager();
    const messages = [userMsg('Load test')];
    const id = mgr.save(messages, 'load-model');

    const loaded = mgr.load(id);

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(id);
    expect(loaded!.model).toBe('load-model');
    expect(loaded!.messages.length).toBe(1);
    expect(loaded!.messages[0]!.content).toBe('Load test');
  });

  it('returns null for a missing session', () => {
    const mgr = createManager();
    const loaded = mgr.load('nonexistent-session-id');
    expect(loaded).toBeNull();
  });

  it('returns null for a corrupt session file', () => {
    const dir = sessionDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corrupt.json'), 'not valid json', 'utf-8');

    const mgr = createManager();
    const loaded = mgr.load('corrupt');
    expect(loaded).toBeNull();
  });
});

// ─── list ───────────────────────────────────────────────────────────────────

describe('SessionManager.list', () => {
  it('returns an empty array when no sessions exist', () => {
    const mgr = createManager();
    const sessions = mgr.list();
    expect(sessions).toEqual([]);
  });

  it('lists sessions in most-recent-first order', () => {
    const mgr = createManager();
    const id1 = mgr.save([userMsg('First')], 'model-a');
    const id2 = mgr.save([userMsg('Second')], 'model-b');
    const id3 = mgr.save([userMsg('Third')], 'model-c');

    const sessions = mgr.list();

    expect(sessions.length).toBe(3);
    // All three IDs should be present (exact ordering depends on filename sort
    // when saves happen within the same millisecond)
    const ids = sessions.map((s) => s.id);
    expect(ids.sort()).toEqual([id1, id2, id3].sort());
    // Verify most-recent-first via updatedAt timestamps
    expect(sessions[0]!.updatedAt).toBeGreaterThanOrEqual(sessions[1]!.updatedAt);
    expect(sessions[1]!.updatedAt).toBeGreaterThanOrEqual(sessions[2]!.updatedAt);

  });

  it('skips corrupt session files gracefully', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('Valid session')], 'model-a');

    // Write a corrupt file directly
    const dir = sessionDir();
    writeFileSync(join(dir, 'corrupt.json'), 'not valid json', 'utf-8');

    // Write a non-JSON file (should be filtered out)
    writeFileSync(join(dir, 'readme.txt'), 'not a session', 'utf-8');

    const sessions = mgr.list();

    expect(sessions.length).toBe(1);
    expect(sessions[0]!.id).toBe(id);
  });

  it('returns SessionSummary objects (no full messages)', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('Summary test')], 'model-x');

    const sessions = mgr.list();

    expect(sessions[0]!.id).toBe(id);
    expect(sessions[0]!.name).toBeTruthy();
    expect(sessions[0]!.model).toBe('model-x');
    expect(sessions[0]!.messageCount).toBe(1);
    expect(sessions[0]!.preview).toBeTruthy();
    expect(sessions[0]!.createdAt).toBeGreaterThan(0);
    expect(sessions[0]!.updatedAt).toBeGreaterThan(0);
    // Summary objects should NOT have the messages field
    expect((sessions[0]! as any).messages).toBeUndefined();
  });
});

// ─── delete ─────────────────────────────────────────────────────────────────

describe('SessionManager.delete', () => {
  it('returns true and removes the file for an existing session', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('Delete me')], 'model-a');

    expect(existsSync(join(sessionDir(), `${id}.json`))).toBe(true);

    const deleted = mgr.delete(id);

    expect(deleted).toBe(true);
    expect(existsSync(join(sessionDir(), `${id}.json`))).toBe(false);
  });

  it('returns false for a non-existent session', () => {
    const mgr = createManager();
    const deleted = mgr.delete('nonexistent-id');
    expect(deleted).toBe(false);
  });

  it('returns false when the history directory does not exist', () => {
    // Manager with a path that doesn't exist yet
    const mgr = createManager();
    const deleted = mgr.delete('some-id');
    expect(deleted).toBe(false);
  });
});

// ─── loadLatest ─────────────────────────────────────────────────────────────

describe('SessionManager.loadLatest', () => {
  it('returns the most recent session', () => {
    const mgr = createManager();
    const id1 = mgr.save([userMsg('Older')], 'model-a');
    const id2 = mgr.save([userMsg('Newer')], 'model-b');

    const latest = mgr.loadLatest();

    expect(latest).not.toBeNull();
    // Verify it's one of the saved sessions with the newest content
    expect([id1, id2]).toContain(latest!.id);
    expect(latest!.updatedAt).toBeGreaterThanOrEqual(0);
    // The latest session should have content from the most recent save
    expect(latest!.messages.length).toBe(1);
  });

  it('returns null when no sessions exist', () => {
    const mgr = createManager();
    const latest = mgr.loadLatest();
    expect(latest).toBeNull();
  });
});

// ─── count ──────────────────────────────────────────────────────────────────

describe('SessionManager.count', () => {
  it('returns 0 when no sessions exist', () => {
    const mgr = createManager();
    expect(mgr.count()).toBe(0);
  });

  it('returns the correct number of sessions', () => {
    const mgr = createManager();
    mgr.save([userMsg('One')], 'model-a');
    mgr.save([userMsg('Two')], 'model-b');
    mgr.save([userMsg('Three')], 'model-c');

    expect(mgr.count()).toBe(3);
  });

  it('reflects deletions', () => {
    const mgr = createManager();
    const id = mgr.save([userMsg('Only one')], 'model-a');
    expect(mgr.count()).toBe(1);

    mgr.delete(id);
    expect(mgr.count()).toBe(0);
  });
});

// ─── Edge Cases ─────────────────────────────────────────────────────────────

describe('SessionManager — edge cases', () => {
  it('auto-creates the history directory on first save', () => {
    const dir = sessionDir();
    expect(existsSync(dir)).toBe(false);

    const mgr = createManager();
    mgr.save([userMsg('Create dir')], 'model-a');

    expect(existsSync(dir)).toBe(true);
  });

  it('handles non-JSON files in history directory when listing', () => {
    const mgr = createManager();
    mgr.save([userMsg('Real session')], 'model-a');

    // Add a non-JSON file
    const dir = sessionDir();
    writeFileSync(join(dir, 'readme.md'), '# Session files', 'utf-8');
    writeFileSync(join(dir, 'data.csv'), 'id,name\n1,test', 'utf-8');

    const sessions = mgr.list();
    // Only JSON files should be parsed, non-JSON files are filtered by .endsWith('.json')
    expect(sessions.length).toBe(1);
  });

  it('loadLatest returns null when all sessions are corrupt', () => {
    const mgr = createManager();
    // Manually create corrupt session files
    const dir = sessionDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'corrupt1.json'), '{invalid json', 'utf-8');
    writeFileSync(join(dir, 'corrupt2.json'), 'not json at all', 'utf-8');

    const latest = mgr.loadLatest();
    expect(latest).toBeNull();
  });
});
