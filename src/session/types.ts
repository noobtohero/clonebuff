/**
 * Session history types — for persisting conversations to disk.
 */

import type { ConversationMessage } from '../openrouter/types';

/**
 * A saved session entry — stored as a JSON file under `.clonebuff/history/`.
 */
export interface SessionEntry {
  /** Unique session ID (timestamp-based) */
  id: string;
  /** Human-readable name (optional, defaults to date) */
  name: string;
  /** When the session was first created */
  createdAt: number;
  /** When the session was last saved/updated */
  updatedAt: number;
  /** AI model used during this session */
  model: string;
  /** Number of messages (excluding system messages) */
  messageCount: number;
  /** Preview text — first user message or truncated excerpt */
  preview: string;
  /** All conversation messages */
  messages: ConversationMessage[];
}

/**
 * Summary info for listing sessions (no full messages).
 */
export interface SessionSummary {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  model: string;
  messageCount: number;
  preview: string;
}
