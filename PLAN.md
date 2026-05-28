# Clonebuff — Project Plan & Progress

> Last updated: May 2026

---

## 🗺️ Overview

Clonebuff is an open-source, CLI-based AI coding assistant (clone of Codebuff) that connects to OpenRouter API. Built with **Bun + TypeScript + Ink** (React for CLI).

---

## ✅ Completed

### Phase 1: Foundation ✓
| Task | Status | Files |
|------|--------|-------|
| Project scaffolding (Bun + TS + Ink) | ✅ | `package.json`, `tsconfig.json`, `src/index.tsx` |
| OpenRouter API client with streaming | ✅ | `src/openrouter/client.ts` |
| OpenRouter API types | ✅ | `src/openrouter/types.ts` |
| Config loading + interactive setup | ✅ | `src/config/loader.ts`, `src/config/setup.ts` |
| Config defaults | ✅ | `src/config/defaults.ts` |
| Ink TUI: app, input, messages | ✅ | `src/tui/app.tsx`, `src/tui/input.tsx`, `src/tui/messages.tsx` |
| Core agent loop (stream + display) | ✅ | `src/tui/app.tsx` (handleSubmit loop) |

### Phase 2: Tools & Capabilities ✓
| Task | Status | Files |
|------|--------|-------|
| `read_files` tool | ✅ | `src/agent/core.ts` |
| `str_replace` tool | ✅ | `src/agent/core.ts` |
| `write_file` tool | ✅ | `src/agent/core.ts` |
| `run_terminal_command` tool | ✅ | `src/agent/core.ts` |
| Tool call handling in agent loop | ✅ | `src/tui/app.tsx` (executeTools, continueAgentLoop) |
| System prompts + project context | ✅ | `src/agent/prompts.ts` |

### Phase 3: Checkpoints & Safety ✓
| Task | Status | Files |
|------|--------|-------|
| Git-based checkpointing | ✅ | `src/checkpoint/git.ts` |
| Snapshot-based checkpoint fallback | ✅ | `src/checkpoint/snapshot.ts` |
| Checkpoint manager (auto-detect) | ✅ | `src/checkpoint/manager.ts` |
| Checkpoint types | ✅ | `src/checkpoint/types.ts` |
| Auto-checkpoint before edits | ✅ | `src/tui/app.tsx` (createAutoCheckpoint) |

### Phase 4: Context & Polish ✓
| Task | Status | Files |
|------|--------|-------|
| Conversation history management | ✅ | `src/tui/app.tsx` (messages state) |
| Smart compaction & summarization | ✅ | `src/agent/context.ts` |
| Code block syntax highlighting | ✅ | `src/tui/components/syntax-highlighter.tsx` |
| Spinner / loading indicators | ✅ | `src/tui/components/spinner.tsx` |
| Status bar | ✅ | `src/tui/components/status-bar.tsx` |
| Error handling | ✅ | `src/tui/app.tsx` (errorMessage state) |

### Commands Implemented ✓
| Command | Status | Description |
|---------|--------|-------------|
| `/help` | ✅ | Shows all commands and current settings |
| `/clear` | ✅ | Clears conversation + resets usage |
| `/usage` | ✅ | Token stats, API calls, estimated cost |
| `/model <slug>` | ✅ | Switches model + persists to global config |
| `/temperature <0-2>` / `/temp` | ✅ | Sets temperature + persists |
| `/config show` | ✅ | Displays current config |
| `/config toggle confirm` | ✅ | Toggles diff preview + persists |
| `/session save [name]` | ✅ | Saves conversation with optional name |
| `/session list` | ✅ | Lists saved sessions |
| `/session load <id>` | ✅ | Restores a saved session |
| `/session delete <id>` | ✅ | Deletes a saved session |
| `/checkpoint save [name]` | ✅ | Creates codebase checkpoint |
| `/checkpoint list` | ✅ | Lists checkpoints |
| `/checkpoint restore <id>` | ✅ | Restores codebase to checkpoint |
| `/init` / `/init --config` | ✅ | Scaffolds knowledge.md, .agents/types/, .clonebuffrc |
| `/exit` | ✅ | Exits with auto-save |

### Extra Features ✓
| Feature | Status | Description |
|---------|--------|-------------|
| Diff confirmation (y/n/a) | ✅ | Preview changes before applying |
| Session persistence | ✅ | Auto-save on new prompt, /clear, /exit |
| Config persistence | ✅ | /model, /temperature, /config survive restarts |
| Usage tracking | ✅ | Tokens + cost per session |
| Compaction stats in status bar | ✅ | Shows saved tokens after compaction |
| Auto-save on exit | ✅ | Saves session before quitting |

---

## 🚧 Pending (from Spec)

### Phase 5: Testing & Release ⬜
| Task | Priority | Effort | Notes |
|------|----------|--------|-------|
| Unit tests: openrouter | 🔴 High | Medium | Test client.ts: parseStream, validation, error handling |
| Unit tests: agent/core.ts | 🔴 High | Medium | Test executeToolCall for all 4 tools, path validation |
| Unit tests: agent/context.ts | 🔴 High | Medium | Test estimateTokens, compactMessages, generateSummary |
| Unit tests: checkpoint/* | 🟡 Medium | Medium | Test git.ts + snapshot.ts with temp directories |
| Unit tests: config/* | 🟡 Medium | Small | Test loadConfig, saveConfig, runInit |
| Unit tests: session/manager.ts | 🟡 Medium | Small | Test save/load/list/delete with temp dirs |
| Unit tests: tui/diff.ts | 🟡 Medium | Small | Test computeDiff, chunkDiff, generateDiff |
| Integration: agent loop | 🔴 High | Large | Mock OpenRouter, test multi-turn tool calls |
| Integration: config load chain | 🟡 Medium | Small | Env var → global → project priority |
| E2E manual test | 🟡 Medium | Large | Real OpenRouter API, verify streaming + tools |
| Documentation (README) | 🟡 Medium | Medium | Setup guide, command reference, architecture |
| bun package publishing | 🟢 Low | Small | npm/bun publish setup |

### Phase 5a: Missing Features ⬜
| Task | Priority | Effort | Notes |
|------|----------|--------|-------|
| Command history (↑/↓ arrows) | 🔴 High | Medium | input.tsx lacks up/down history recall |
| Multi-line submit (Ctrl+Enter) | 🟡 Medium | Small | Currently Enter=submit, Shift+Enter=newline |
| `/checkpoint delete <id>` | 🟢 Low | Small | snapshot.ts has deleteSnapshotCheckpoint, but no CLI command |
| `--headless` mode | 🟢 Low | Large | For CI/CD usage (spec says v3+) |
| Retry with backoff (rate limits) | 🟡 Medium | Medium | Spec §8 mentions exponential backoff |

---

## 🔮 v2+ Roadmap (Future)

| Feature | Priority | Description |
|---------|----------|-------------|
| Multi-Agent Orchestration | 🔴 High | Orchestrator agent spawning sub-agents (picker, planner, editor, reviewer) |
| Tree-based File Discovery | 🔴 High | Parse codebase → build code tree → identify relevant files |
| Custom Agent Framework | 🔴 High | Define custom agents via TypeScript in `.agents/` |
| CLI Modes (DEFAULT/MAX/PLAN) | 🟡 Medium | DEFAULT: standard; MAX: parallel editors; PLAN: plan-only |
| Clickable Follow-up Suggestions | 🟡 Medium | After each response, suggest 3 follow-up prompts |
| MCP Server Support | 🟡 Medium | Model Context Protocol for agent-to-tool communication |
| Ad Revenue / Freebuff | 🟢 Low | Free tier with ads |
| Agent Store | 🟢 Low | Community agent marketplace |
| SDK | 🟢 Low | Programmatic API for CI/CD integration |

---

## 📊 Source Files (24 total)

```
src/
├── index.tsx                           # Entry point
├── agent/
│   ├── context.ts                      # Context compaction + token estimation
│   ├── core.ts                         # Tool execution (read_files, str_replace, write_file, run_command)
│   └── prompts.ts                      # System prompt generation + project context loading
├── checkpoint/
│   ├── git.ts                          # Git-based checkpoint (stash create/apply, tags)
│   ├── manager.ts                      # CheckpointManager — unified interface
│   ├── snapshot.ts                     # Snapshot-based checkpoint (file copy)
│   └── types.ts                        # CheckpointEntry, CreateOptions, results
├── config/
│   ├── defaults.ts                     # ClonebuffConfig interface + DEFAULTS
│   ├── init.ts                         # /init scaffolding (knowledge.md, .agents/, .clonebuffrc)
│   ├── loader.ts                       # loadConfig, saveConfig, saveApiKey, getProjectDir
│   └── setup.ts                        # Interactive API key setup flow + welcome message
├── openrouter/
│   ├── client.ts                       # OpenRouterClient (streamChat, validateApiKey, parseStream)
│   └── types.ts                        # StreamChunk, ToolCall, ConversationMessage, etc.
├── session/
│   ├── manager.ts                      # SessionManager (save/load/list/delete/loadLatest/count)
│   └── types.ts                        # SessionEntry, SessionSummary
└── tui/
    ├── app.tsx                         # Root Ink component (agent loop, commands, state)
    ├── diff.ts                         # LCS diff engine (computeDiff, chunkDiff, previewToolChange)
    ├── input.tsx                       # Prompt input (multi-line, cursor, key bindings)
    ├── messages.tsx                    # Chat display (code blocks, tool calls/results, streaming)
    └── components/
        ├── confirmation-prompt.tsx     # Diff confirmation UI (y/n/a)
        ├── spinner.tsx                 # Loading/thinking indicator
        ├── status-bar.tsx              # Bottom status bar (model, checkpoints, tokens)
        └── syntax-highlighter.tsx      # Code block syntax highlighting
```

---

## 🎯 Recommended Next Steps

1. **Unit tests** — Start with `src/config/init.ts` (self-contained, no network) and `src/agent/context.ts` (pure functions)
2. **Command history** — Add ↑/↓ arrow key history recall to `src/tui/input.tsx` (high UX impact)
3. **Integration tests** — Mock OpenRouter responses and test the full agent loop flow
