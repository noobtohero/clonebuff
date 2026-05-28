/**
 * Session history manager — saves, loads, lists, and deletes conversation sessions.
 *
 * Sessions are stored as individual JSON files under `.clonebuff/history/`.
 */

import { join } from 'path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import type { ConversationMessage } from '../openrouter/types';
import type { SessionEntry, SessionSummary } from './types';

/**
 * Number of characters to keep for session preview text.
 */
const PREVIEW_LENGTH = 120;

export class SessionManager {
  private readonly historyDir: string;

  constructor(baseDir?: string) {
    // Use project-local .clonebuff/history by default, fall back to global ~/.clonebuff/history
    this.historyDir = baseDir
      ? join(baseDir, '.clonebuff', 'history')
      : join(homedir(), '.clonebuff', 'history');
  }

  /**
   * Get the path to a session file by ID.
   */
  private sessionPath(id: string): string {
    return join(this.historyDir, `${id}.json`);
  }

  /**
   * Ensure the history directory exists.
   */
  private ensureDir(): void {
    mkdirSync(this.historyDir, { recursive: true });
  }

  /**
   * Generate a short human-readable name from a timestamp and optional label.
   */
  private static generateName(messages: ConversationMessage[], label?: string): string {
    if (label) return label;

    // Use the first user message as the name, truncated
    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) {
      const text = firstUser.content.replace(/\n/g, ' ').trim();
      return text.length > 60 ? text.slice(0, 60) + '…' : text;
    }

    return `Session ${new Date().toLocaleDateString()}`;
  }

  /**
   * Generate a preview string from the conversation.
   */
  private static generatePreview(messages: ConversationMessage[]): string {
    const firstUser = messages.find((m) => m.role === 'user');
    if (firstUser) {
      const text = firstUser.content.replace(/\n/g, ' ').trim();
      return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH) + '…' : text;
    }
    return '(empty)';
  }

  /**
   * Save the current conversation as a session.
   * If an ID is provided, it updates an existing session; otherwise creates a new one.
   * Returns the session ID.
   */
  save(
    messages: ConversationMessage[],
    model: string,
    options?: { id?: string; name?: string },
  ): string {
    this.ensureDir();

    const id = options?.id ?? `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const path = this.sessionPath(id);

    // Filter out system messages for display purposes, but keep them in storage
    const nonSystem = messages.filter((m) => m.role !== 'system');

    const existing = this.loadRaw(id);
    const now = Date.now();

    const entry: SessionEntry = {
      id,
      name: options?.name ?? SessionManager.generateName(nonSystem, existing?.name),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      model,
      messageCount: nonSystem.length,
      preview: SessionManager.generatePreview(nonSystem),
      messages,
    };

    writeFileSync(path, JSON.stringify(entry, null, 2), 'utf-8');
    return id;
  }

  /**
   * Load a session by ID. Returns null if not found.
   */
  load(id: string): SessionEntry | null {
    return this.loadRaw(id);
  }

  /**
   * Internal: read a session file from disk.
   */
  private loadRaw(id: string): SessionEntry | null {
    const path = this.sessionPath(id);
    try {
      if (!existsSync(path)) return null;
      const content = readFileSync(path, 'utf-8');
      return JSON.parse(content) as SessionEntry;
    } catch {
      return null;
    }
  }

  /**
   * List all saved sessions, most recent first.
   */
  list(): SessionSummary[] {
    this.ensureDir();

    try {
      const files = readdirSync(this.historyDir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first (timestamps in filenames)

      const sessions: SessionSummary[] = [];

      for (const file of files) {
        try {
          const content = readFileSync(join(this.historyDir, file), 'utf-8');
          const entry = JSON.parse(content) as SessionEntry;
          sessions.push({
            id: entry.id,
            name: entry.name,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            model: entry.model,
            messageCount: entry.messageCount,
            preview: entry.preview,
          });
        } catch {
          // Skip corrupt files
          continue;
        }
      }

      return sessions;
    } catch {
      return [];
    }
  }

  /**
   * Delete a session by ID. Returns true if deleted, false if not found.
   */
  delete(id: string): boolean {
    const path = this.sessionPath(id);
    try {
      if (!existsSync(path)) return false;
      unlinkSync(path);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get the most recent session, if any.
   */
  loadLatest(): SessionEntry | null {
    const sessions = this.list();
    if (sessions.length === 0) return null;
    return this.load(sessions[0]!.id);
  }

  /**
   * Get the total number of saved sessions.
   */
  count(): number {
    return this.list().length;
  }
}
