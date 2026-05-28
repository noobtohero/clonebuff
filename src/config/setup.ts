/**
 * Interactive API key setup flow — prompts the user to enter their OpenRouter API key
 * and optionally save it to a config file.
 */

import { OpenRouterClient } from '../openrouter/client';
import { saveApiKey } from './loader';
import { DEFAULTS } from './defaults';

export interface SetupResult {
  apiKey: string;
  /** Whether the key was validated */
  validated: boolean;
  /** Where the key was saved */
  savedTo: 'global' | 'project' | 'none';
}

/**
 * Prompt the user to enter their OpenRouter API key.
 * This is used by the TUI setup screen.
 * Returns the result when the user has completed the flow.
 */
export async function runSetupFlow(
  onPrompt: (message: string) => void,
  onQuestion: (question: string) => Promise<string>,
  projectDir: string,
): Promise<SetupResult> {
  onPrompt('Welcome to Clonebuff! 🚀\n');
  onPrompt('Clonebuff needs an OpenRouter API key to work.\n');
  onPrompt(
    'Get your free API key at: https://openrouter.ai/keys\n',
  );

  // Ask for the API key
  const apiKey = await onQuestion(
    'Paste your OpenRouter API key:',
  );

  const trimmedKey = apiKey.trim();

  if (!trimmedKey) {
    return { apiKey: '', validated: false, savedTo: 'none' };
  }

  // Validate the key
  onPrompt('\nValidating API key...');

  const client = new OpenRouterClient({ apiKey: trimmedKey });
  const isValid = await client.validateApiKey();

  if (!isValid) {
    return { apiKey: trimmedKey, validated: false, savedTo: 'none' };
  }

  onPrompt(' ✓\n');

  // Ask where to save
  const saveLocation = await onQuestion(
    'Where would you like to save your API key?\n' +
    '  1) Project (.env.local) — only this project\n' +
    '  2) Global (~/.clonebuff/config.json) — all projects\n' +
    '  3) Don\'t save — I\'ll use an environment variable\n' +
    '\nEnter 1, 2, or 3:',
  );

  let savedTo: SetupResult['savedTo'] = 'none';

  if (saveLocation.trim() === '1') {
    saveApiKey(trimmedKey, 'project', projectDir);
    savedTo = 'project';
    onPrompt('Saved to .env.local ✓\n');
  } else if (saveLocation.trim() === '2') {
    saveApiKey(trimmedKey, 'global', projectDir);
    savedTo = 'global';
    onPrompt('Saved to ~/.clonebuff/config.json ✓\n');
  } else {
    onPrompt(
      'OK, you can set OPENROUTER_API_KEY environment variable later.\n',
    );
  }

  onPrompt(`\nUsing model: ${DEFAULTS.model}\n`);
  onPrompt('Ready! Type your prompt below.\n');

  return {
    apiKey: trimmedKey,
    validated: true,
    savedTo,
  };
}

/**
 * Show a quick-start guide message.
 */
export function getWelcomeMessage(model: string): string {
  return [
    '╔══════════════════════════════════════════════════╗',
    '║              Clonebuff 🚀                        ║',
    '║  AI coding assistant for your terminal           ║',
    '╠══════════════════════════════════════════════════╣',
    `║  Model: ${model.padEnd(35)} ║`,
    '║                                                  ║',
    '║  Commands:                                       ║',
    '║  /help     Show help                             ║',
    '║  /model    Switch model                          ║',
    '║  /usage    Show usage stats                      ║',
    '║  /clear    Clear conversation                    ║',
    '║  /exit     Exit Clonebuff                        ║',
    '║                                                  ║',
    '║  Ctrl+C or type /exit to quit                    ║',
    '╚══════════════════════════════════════════════════╝',
  ].join('\n');
}
