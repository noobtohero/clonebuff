/**
 * /init command — scaffolds project configuration files.
 *
 * Creates the following files if they don't already exist:
 *  - knowledge.md        — Project context for the AI
 *  - .agents/types/       — Agent type definitions (agent-definition.ts, tools.ts, util-types.ts)
 *  - .clonebuffrc         — Simplified project config (optional)
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface InitResult {
  created: string[];
  skipped: string[];
  errors: string[];
}

// ─── Templates ──────────────────────────────────────────────────────────────

const KNOWLEDGE_MD_TEMPLATE = `# Project knowledge

This file gives the AI context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- Setup:
- Dev:
- Test:

## Architecture
- Key directories:
- Data flow:

## Conventions
- Formatting/linting:
- Patterns to follow:
- Things to avoid:
`;

const AGENT_DEFINITION_TS_TEMPLATE = `/**
 * Agent type definitions — defines the shape of custom agents.
 *
 * Each agent has:
 *  - A name and description
 *  - Tools it can use
 *  - A system prompt / instructions
 *  - Output schema for communicating results
 */

export type AgentOutputMode = 'last_message' | 'set_output' | 'append';

export interface AgentDefinition {
  /** Unique agent name (used to spawn via @AgentName) */
  name: string;
  /** Human-readable description */
  description: string;
  /** Tools this agent can use */
  tools?: string[];
  /** Custom system prompt instructions */
  instructions?: string;
  /** How the agent outputs its response */
  outputMode?: AgentOutputMode;
  /** Maximum tokens for the response */
  maxTokens?: number;
}

export interface MCPConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}
`;

const TOOLS_TS_TEMPLATE = `/**
 * Tool definitions — describes the tools available to agents.
 *
 * Each tool specifies:
 *  - name: Unique identifier
 *  - description: What the tool does
 *  - parameters: JSON Schema for the tool's arguments
 *  - returns: Expected output shape
 */

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns?: Record<string, unknown>;
}

export const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'read_files',
    description: 'Read one or more files from the project directory.',
    parameters: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Paths to files to read',
        },
      },
      required: ['paths'],
    },
  },
  {
    name: 'str_replace',
    description: 'Make precise string replacements in an existing file.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path' },
        replacements: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              oldString: { type: 'string' },
              newString: { type: 'string' },
              allowMultiple: { type: 'boolean' },
            },
            required: ['oldString', 'newString'],
          },
        },
      },
      required: ['path', 'replacements'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a new file or overwrite an existing one.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        instructions: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'instructions', 'content'],
    },
  },
  {
    name: 'run_terminal_command',
    description: 'Execute a terminal command in the project directory.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Command to run' },
        description: { type: 'string', description: 'Optional description' },
      },
      required: ['command'],
    },
  },
];
`;

const UTIL_TYPES_TS_TEMPLATE = `/**
 * Utility types — shared helpers for agent definitions.
 */

/** Make a type deeply partial (all properties optional, recursively). */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/** Non-nullable value or null. */
export type Nullable<T> = T | null;

/** A value that may be pending, resolved, or rejected. */
export type AsyncState<T> =
  | { status: 'pending' }
  | { status: 'resolved'; value: T }
  | { status: 'rejected'; error: Error };

/** String literal union for common HTTP methods. */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** Generic key-value map. */
export type Dict<T = unknown> = Record<string, T>;
`;

const CLONEBUFFRC_TEMPLATE = `{
  "model": "openai/gpt-5-nano",
  "temperature": 0.7,
  "confirmChanges": true,
  "checkpointsEnabled": true,
  "autoCheckpoint": true,
  "contextCompactionEnabled": true
}
`;

// ─── Init Logic ────────────────────────────────────────────────────────────

/**
 * Run the /init command — scaffold project configuration files.
 * Only creates files that don't already exist.
 */
export function runInit(projectDir: string): InitResult {
  const result: InitResult = {
    created: [],
    skipped: [],
    errors: [],
  };

  const files: Array<{ path: string; content: string; label: string }> = [
    {
      path: join(projectDir, 'knowledge.md'),
      content: KNOWLEDGE_MD_TEMPLATE,
      label: 'knowledge.md',
    },
    {
      path: join(projectDir, '.agents', 'types', 'agent-definition.ts'),
      content: AGENT_DEFINITION_TS_TEMPLATE,
      label: '.agents/types/agent-definition.ts',
    },
    {
      path: join(projectDir, '.agents', 'types', 'tools.ts'),
      content: TOOLS_TS_TEMPLATE,
      label: '.agents/types/tools.ts',
    },
    {
      path: join(projectDir, '.agents', 'types', 'util-types.ts'),
      content: UTIL_TYPES_TS_TEMPLATE,
      label: '.agents/types/util-types.ts',
    },
  ];

  for (const file of files) {
    try {
      if (existsSync(file.path)) {
        result.skipped.push(file.label);
        continue;
      }

      // Ensure the parent directory exists
      const parentDir = file.path.split(/[/\\]/).slice(0, -1).join('/');
      if (parentDir) {
        mkdirSync(parentDir, { recursive: true });
      }

      writeFileSync(file.path, file.content, 'utf-8');
      result.created.push(file.label);
    } catch (error) {
      result.errors.push(
        `${file.label}: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return result;
}

/**
 * Run the /init command with optional config file creation.
 */
export function runFullInit(
  projectDir: string,
  options?: { createConfig?: boolean },
): InitResult {
  const result = runInit(projectDir);

  // Optionally create .clonebuffrc config
  if (options?.createConfig) {
    const configPath = join(projectDir, '.clonebuffrc');
    try {
      if (existsSync(configPath)) {
        result.skipped.push('.clonebuffrc');
      } else {
        writeFileSync(configPath, CLONEBUFFRC_TEMPLATE, 'utf-8');
        result.created.push('.clonebuffrc');
      }
    } catch (error) {
      result.errors.push(
        `.clonebuffrc: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  return result;
}
