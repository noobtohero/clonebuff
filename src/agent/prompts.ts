/**
 * System prompts and project context for Clonebuff agents.
 *
 * Builds the system message that tells the AI what it can do,
 * and loads project context (knowledge.md) into the conversation.
 *
 * Cache efficiency: The static (tool-agnostic) portion is kept at the top
 * so OpenRouter's prompt cache sees a consistent prefix across turns.
 * Dynamic content (project context) is appended at the end.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Get the static (cacheable) portion of the system prompt.
 * This part stays consistent across all turns and sessions,
 * maximizing OpenRouter's automatic prompt cache hits.
 */
export function getStaticSystemPrompt(): string {
  return [
    'You are Clonebuff, an AI coding assistant operating in the user\'s terminal.',
    '',
    '## Your Capabilities',
    '',
    'You have access to tools that let you read and edit files in the project,',
    'and execute terminal commands. Use them to help the user with their coding tasks.',
    '',
    '## Tool Usage Guidelines',
    '',
    '- **read_files**: Use to understand existing code before making changes.',
    '  Read multiple related files in a single call when possible.',
    '',
    '- **str_replace**: For precise, surgical edits to existing files.',
    '  The oldString must match *exactly* — include all whitespace.',
    '  Prefer this over write_file when only a section needs changing.',
    '',
    '- **write_file**: For creating new files or completely rewriting existing ones.',
    '  Always provide clear instructions describing what the file does.',
    '',
    '- **run_terminal_command**: For installing packages, running tests/linters,',
    '  builds, git operations, or any CLI command in the project directory.',
    '  Avoid destructive commands (rm -rf, git push --force, etc.).',
    '',
    '## Multi-turn Workflow',
    '',
    'You may need multiple turns to complete a task:',
    '1. First, read relevant files to understand the codebase',
    '2. Make your edits using str_replace or write_file',
    '3. Optionally run tests to verify your changes work',
    '4. Provide a clear summary of what was done',
    '',
    '## Response Guidelines',
    '',
    '- After making changes, briefly summarize what was modified and why.',
    '- If a tool call fails, explain the error and try an alternative approach.',
    '- If you need clarification, ask the user directly in your response.',
    '- Keep code samples concise — show only the relevant parts.',
    '- When reading files, focus on understanding the structure and patterns.',
  ].join('\n');
}

/**
 * Get the character personality section for the system prompt.
 * This tells the AI how to behave and speak.
 */
export function getCharacterPrompt(character: { name: string; personality: string; emoji: string }): string {
  return [
    '## Your Character',
    '',
    `Your name is **${character.name}**.`,
    `Your emoji avatar is: ${character.emoji}`,
    '',
    '### Personality',
    '',
    character.personality,
    '',
    '### Speaking Style',
    '',
    `- Sign off messages with your name as "— ${character.name}" when appropriate.`,
    `- Use your avatar ${character.emoji} occasionally to add personality.`,
    '- Keep responses professional but warm — you are a coding assistant first, character second.',
    '- The character is a layer of personality, not a roleplay mode.',
  ].join('\n');
}

/**
 * Get the full system prompt including character and project-specific context.
 * The static portion comes first (cacheable prefix), then character, then dynamic project context.
 */
export function getSystemPrompt(
  projectDir: string,
  character?: { name: string; personality: string; emoji: string },
  projectContext?: string,
): string {
  const parts: string[] = [
    getStaticSystemPrompt(),
  ];

  // Include character personality if available
  if (character) {
    parts.push(
      '',
      getCharacterPrompt(character),
    );
  }

  // Include project context if available (appended at the end for cache efficiency)
  if (projectContext) {
    parts.push(
      '',
      '## Project Context',
      '',
      'The following is project-specific context provided by the user:',
      projectContext,
    );
  }

  return parts.join('\n');
}

/**
 * Load project context from knowledge.md or other project instruction files.
 * Returns the content if found, or undefined if no context file exists.
 */
export function loadProjectContext(projectDir: string): string | undefined {
  const candidates = [
    'knowledge.md',
    'CLAUDE.md',
    'AGENTS.md',
    '.github/instructions.md',
  ];

  for (const name of candidates) {
    const path = join(projectDir, name);
    try {
      if (existsSync(path)) {
        const content = readFileSync(path, 'utf-8');
        if (content.trim()) {
          return `--- From ${name} ---\n${content.trim()}`;
        }
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return undefined;
}

/**
 * Get the system-level ConversationMessage to prepend to the conversation.
 * Accepts an optional character to inject into the system prompt.
 */
export function getSystemMessage(projectDir: string, character?: { name: string; personality: string; emoji: string }): {
  id: string;
  role: 'system';
  content: string;
  timestamp: number;
} {
  const projectContext = loadProjectContext(projectDir);
  return {
    id: 'system',
    role: 'system',
    content: getSystemPrompt(projectDir, character, projectContext),
    timestamp: Date.now(),
  };
}
