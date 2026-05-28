# Project knowledge

This file gives Codebuff context about your project: goals, commands, conventions, and gotchas.

## Quickstart
- Setup: `bun install` (requires Bun v1.3+)
- Dev: `bun start` (runs the Ink TUI)
- Test: `bun test` (or `bun test <file>`)

## Architecture
- Key directories:
  - `src/tui/` Ink UI (app loop, input, messages, components)
  - `src/agent/` tool execution + prompts + context compaction
  - `src/openrouter/` API client + types (SSE streaming)
  - `src/checkpoint/` git/snapshot checkpoints
  - `src/config/` config load/save + init scaffolding
  - `src/session/` session history persistence
- Data flow:
  1) TUI (`app.tsx`) captures user input
  2) Agent builds prompt + context
  3) OpenRouter client streams response
  4) Tool calls executed (read/replace/write/run)
  5) UI updates + session saved

## Conventions
- Formatting/linting: TypeScript + Prettier-style formatting (follow existing code style)
- Patterns to follow:
  - Keep tool implementations in `src/agent/core.ts`
  - UI logic stays in `src/tui/`
  - Use checkpoint before risky edits
- Things to avoid:
  - Mixing UI rendering with tool execution logic
  - Writing files outside the project root
  - Large diffs without diff preview
