#!/usr/bin/env bun
/**
 * Clonebuff — AI coding assistant for your terminal.
 *
 * Entry point: renders the Ink-based terminal UI and starts the agent loop.
 *
 * Usage:
 *   clonebuff                 # Start interactive mode
 *   clonebuff --help          # Show help
 *   clonebuff --version       # Show version
 */

import React from 'react';
import { render } from 'ink';
import { App } from './tui/app';

async function main() {
  const args = process.argv.slice(2);

  // Parse CLI arguments
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Clonebuff — AI coding assistant for your terminal

USAGE:
  clonebuff                  Start interactive mode
  clonebuff --help           Show this help
  clonebuff --version        Show version

COMMANDS (inside Clonebuff):
  /help     Show available commands
  /clear    Clear the conversation
  /model    Switch AI model
  /usage    Show usage
  /exit     Exit Clonebuff

ENVIRONMENT:
  OPENROUTER_API_KEY    Your OpenRouter API key (or set via interactive setup)
  CLONEBUFF_PROJECT     Project directory (defaults to current working directory)

Visit https://openrouter.ai/keys to get a free API key.
`);
    process.exit(0);
  }

  if (args.includes('--version') || args.includes('-v')) {
    const pkg = await Bun.file('./package.json').json();
    console.log(`Clonebuff v${pkg.version ?? '0.1.0'}`);
    process.exit(0);
  }

  // Render the Ink app
  const { waitUntilExit } = render(<App />);

  // Wait for the app to exit
  await waitUntilExit();
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
