# Clonebuff — Specification Document

> **Project**: Clonebuff — A clone of Codebuff CLI, an AI coding assistant that operates in the terminal and connects to OpenRouter API.
> **Status**: Draft v1 — Pre-implementation
> **Date**: May 27, 2026

---

## 1. Overview

Clonebuff is an open-source, CLI-based AI coding assistant that edits codebases through natural language instructions. It connects to **OpenRouter API** to access a wide range of LLMs (Claude, GPT, Gemini, DeepSeek, Qwen, etc.) and provides a rich terminal UI built on **Ink** (React for CLI).

### 1.1 Core Philosophy

- **Terminal-native**: The user interacts entirely within their terminal — no IDE plugin, no web UI.
- **Surgical edits**: Make precise, targeted changes to files rather than rewriting them wholesale.
- **Autonomous**: Execute terminal commands (npm install, git operations, test runners) as needed.
- **Conversational**: Natural language chat interface with streaming responses.
- **Safe**: Git-based or snapshot-based checkpoints allow reverting changes.

### 1.2 CLI Name

- **Binary**: `clonebuff`
- Users run: `clonebuff` in their project directory

---

## 2. Tech Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Runtime | **Bun** | Fast startup, TypeScript-native, built-in test runner and package manager |
| Language | **TypeScript** | Type safety, same as Codebuff's ecosystem |
| TUI Framework | **Ink** (React for CLI) | Similar to Codebuff's OpenTUI; component model, hover/click support, flicker-free |
| LLM API | **OpenRouter API** | Unified access to 300+ models via OpenAI-compatible endpoint |
| Package Manager | **bun** | Built into Bun runtime |
| Testing | **bun test** | Built-in test runner |
| Linting | **biome** or **eslint** | To be decided during setup |

---

## 3. Architecture

### 3.1 Overall Architecture (v1)

For v1, Clonebuff follows a **single-agent architecture**:

```
┌──────────────────────────────────────────────┐
│                 Clonebuff CLI                  │
│                                                │
│  ┌─────────────┐    ┌──────────────────────┐  │
│  │  Ink TUI     │    │   OpenRouter Client  │  │
│  │  (React)     │◄──►│   (streaming, tools) │  │
│  └─────────────┘    └──────────────────────┘  │
│         │                    │                 │
│         ▼                    ▼                 │
│  ┌──────────────────────────────────────────┐ │
│  │         Core Agent Logic                  │ │
│  │  ┌────────┐ ┌─────────┐ ┌─────────────┐  │ │
│  │  │File    │ │Terminal │ │Checkpoint    │  │ │
│  │  │Editing │ │Executor │ │Manager       │  │ │
│  │  └────────┘ └─────────┘ └─────────────┘  │ │
│  └──────────────────────────────────────────┘ │
│                                                │
│  ┌──────────────────────────────┐              │
│  │  Context Manager            │              │
│  │  (conversation history,     │              │
│  │   compaction, summaries)    │              │
│  └──────────────────────────────┘              │
└──────────────────────────────────────────────┘
```

### 3.2 Architecture (v2+) — Multi-Agent

v2 introduces the orchestrator-based multi-agent pattern:

```
┌───────────────────────────────────────────────┐
│           Orchestrator Agent                   │
│   (tools: [spawnAgent]; no other tools)        │
│                                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐  │
│  │ File     │ │ Planner  │ │ Code         │  │
│  │ Picker   │ │ Agent    │ │ Searcher     │  │
│  │ (scan    │ │ (plan    │ │ (grep,      │  │
│  │  codebase)│ │  changes) │ │  find refs) │  │
│  └──────────┘ └──────────┘ └──────────────┘  │
│        │                                        │
│        ▼                                        │
│  ┌──────────┐ ┌──────────┐                    │
│  │ Editor   │ │ Reviewer │                    │
│  │ Agent(s) │ │ Agent    │                    │
│  │ (make    │ │ (validate)│                    │
│  │  edits)  │ └──────────┘                    │
│  └──────────┘                                  │
└───────────────────────────────────────────────┘
```

- Agents can be spawned in parallel (MAX mode)
- All agents share a **prompt cache** (pay once for context, reuse across agents)
- Spawned agents return only their final output to the orchestrator, keeping context clean

---

## 4. Feature Specifications

### 4.1 Interactive Chat REPL (v1)

**Description**: A rich, Ink-based terminal interface where the user types prompts and sees AI responses in real-time.

**Requirements**:
- [ ] Prompt input line at the bottom of the terminal
- [ ] Streaming output display — tokens appear as they arrive from OpenRouter
- [ ] Command history (up/down arrow keys to recall prompts)
- [ ] Multi-line input support (Enter for new line, Ctrl+Enter or Esc+Enter to send)
- [ ] Progress indicators or activity spinners during LLM processing
- [ ] Syntax-highlighted code blocks within responses
- [ ] Hover and click support for buttons/links within the TUI
- [ ] No flicker during rerenders (Ink handles this natively)
- [ ] Resize-friendly layout

**Commands** (within the REPL):
| Command | Description |
|---------|-------------|
| `/help` | Show available commands and usage |
| `/usage` | Show OpenRouter API credit usage |
| `/init` | Initialize project config files (knowledge.md, .agents/) |
| `/checkpoint save` | Save current codebase state |
| `/checkpoint list` | List saved checkpoints |
| `/checkpoint restore <id>` | Restore codebase to a checkpoint |
| `/model <model-slug>` | Switch the active OpenRouter model |
| `/clear` | Clear the conversation |
| `/exit` or `Ctrl+C` | Exit Clonebuff |

### 4.2 File Editing Tools (v1)

**Description**: Precise file manipulation capabilities that the AI agent can use to modify the codebase.

**Tools**:

1. **`read_files(paths: string[])`**
   - Read one or more files from disk
   - Return full file contents with line numbers
   - Security: Only allow reading files within the project directory

2. **`str_replace(path: string, replacements: { oldString, newString, allowMultiple? }[])`**
   - Make surgical string replacements within existing files
   - Require exact match of the `oldString`
   - Support multiple replacements in a single call
   - Validate that replacements are within the project directory

3. **`write_file(path: string, instructions: string, content: string)`**
   - Create new files or overwrite existing ones
   - Require `instructions` describing the purpose of the change
   - Security: Only allow writing within the project directory

**Security constraints**:
- All file operations restricted to the project directory (and subdirectories)
- Prevent writing to `.git/` directory
- Prevent operations on files outside the project boundary
- Show a diff/confirmation of changes before applying (optional mode)

### 4.3 Terminal Command Execution (v1)

**Description**: The AI agent can execute terminal commands within the project context.

**Capabilities**:
- Run shell commands in the project directory
- Stream output back to the user in real-time
- Support for long-running commands with configurable timeout
- Commands for: npm/bun package management, git operations, running tests/linters, build scripts, etc.

**Security**:
- Commands run in the project directory as the current user
- Show the command being executed before running
- Capture stdout and stderr separately
- Configurable allowlist/blocklist for commands

### 4.4 Checkpoint System (v1)

**Description**: Save and restore codebase state before/after AI modifications.

**Approach**: Hybrid — use git if available, fall back to file snapshots.

**Git-based**:
- Before applying changes, auto-stash or auto-commit the current state
- Use `git stash create` or `git commit` with a special message
- On restore: `git stash pop` or `git revert` the auto-commit

**Snapshot fallback** (no git repo):
- Copy all files that will be modified to `.clonebuff/checkpoints/<id>/`
- Store the snapshot as a compressed archive
- On restore: copy files back from the snapshot

**CLI interface**:
- `/checkpoint save [name]` — Create a checkpoint with optional name
- `/checkpoint list` — List all checkpoints with timestamps and names
- `/checkpoint restore <id>` — Restore codebase to a checkpoint state
- Automatic checkpoint creation before each AI edit (configurable)

### 4.5 Context Management (v1)

**Description**: Smart management of conversation history to stay within token limits.

**Features**:
- **Prompt caching**: Structure prompts to maximize cache hits across turns
- **Smart compaction**: When approaching token limits, summarize older conversation turns
- **Non-lossy summaries**: Preserve 10-20 roundtrips with full detail in summaries
- **Deterministic strategy**: Keep user messages, assistant messages, and tool calls
- **Immediate re-reading**: After compaction, re-read relevant files if needed
- **No user-facing context warnings**: Handle everything automatically (like Codebuff)

### 4.6 OpenRouter Integration (v1)

**Description**: Connect to OpenRouter API to access LLMs.

**API Configuration**:
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Auth**: Bearer token via `Authorization` header
- **Streaming**: Support SSE streaming via `stream: true` parameter
- **Model selection**: Any model slug from OpenRouter (e.g., `anthropic/claude-sonnet-4.6`, `openai/gpt-5.3`, `deepseek/deepseek-v4-flash`)

**API Key Management** — "Both with priority" approach:
1. Check project-level `.env.local` or `.env` file for `OPENROUTER_API_KEY`
2. Check global config at `~/.clonebuff/config.json` for `apiKey`
3. If neither found, prompt user on first run to enter API key
4. On interactive setup: ask whether to save to `.env.local` (project) or `~/.clonebuff/config.json` (global)

**Request Parameters**:
| Parameter | Support | Notes |
|-----------|---------|-------|
| `model` | ✅ Required | Any OpenRouter model slug |
| `messages` | ✅ Required | Standard OpenAI message format |
| `stream` | ✅ Default: true | Streaming enabled by default |
| `temperature` | ✅ Optional | Passthrough to OpenRouter |
| `max_tokens` | ✅ Optional | Passthrough to OpenRouter |
| `tools` | ✅ Optional | Tool definitions for function calling |
| `tool_choice` | ✅ Optional | `auto`, `none`, or specific tool |
| `provider` | ✅ Optional | Provider routing preferences |
| `reasoning` | ✅ Optional | Reasoning tokens config |
| `top_p` | ✅ Optional | Passthrough to OpenRouter |
| `stop` | ✅ Optional | Passthrough to OpenRouter |

**Headers**:
```http
Authorization: Bearer <OPENROUTER_API_KEY>
Content-Type: application/json
HTTP-Referer: https://github.com/<user>/clonebuff
X-Title: Clonebuff
```

### 4.7 Configuration System (v1)

**Description**: Support both Codebuff-compatible config files and a simplified config format.

**Codebuff-compatible files**:
- `knowledge.md` — Project context for the AI (same format as Codebuff)
- `.agents/` directory — For future custom agent definitions (v2)
- `AGENTS.md` — Agent instructions (if found)
- `CLAUDE.md` — Claude-compatible project instructions (if found)

**Simplified config**:
- `.clonebuffrc` (JSON or YAML) or `clonebuff.json` — Single config file
- Settings: default model, temperature, max tokens, file permissions, checkpoint settings, etc.

**Init command**:
- `/init` creates `knowledge.md`, `.agents/types/`, and optionally `.clonebuffrc`
- Same structure as Codebuff's `/init` command

---

## 5. User Flow (v1)

### 5.1 First Run

1. User runs `clonebuff` in their project directory
2. Clonebuff checks for API key (env → global config → prompt)
3. If no API key found: Show welcome screen with link to openrouter.ai/keys, prompt to enter key
4. After key entry: Ask whether to save locally or globally
5. If no knowledge.md found: Ask if user wants to run `/init`
6. Show the interactive REPL — ready for input

### 5.2 Typical Session

1. User types: _"Add rate limiting to all API endpoints"_
2. Clonebuff sends the request to OpenRouter with current conversation context
3. Response streams in real-time with code blocks rendered with syntax highlighting
4. AI may use tools:
   - `read_files` to understand existing API code
   - `str_replace` or `write_file` to make edits
   - `run_terminal_command` to install packages or run tests
5. Before making changes: Auto-create a checkpoint
6. After changes: Summarize what was done
7. Display clickable follow-up suggestions (v2 feature)
8. User continues conversation or exits with `Ctrl+C`

### 5.3 Session Management

- Conversations persist across session restarts (save to `.clonebuff/history/`)
- Checkpoints persist in `.clonebuff/checkpoints/`
- Config persists in `.clonebuffrc` or `~/.clonebuff/config.json`

---

## 6. Project Structure

```
clonebuff/
├── package.json
├── tsconfig.json
├── clonebuff.json              # Project config (simplified)
├── knowledge.md                # Project context (optional)
├── .agents/
│   └── types/                   # Type definitions (from /init)
│       ├── agent-definition.ts
│       ├── tools.ts
│       └── util-types.ts
├── src/
│   ├── index.ts                 # Entry point — CLI bootstrap
│   ├── cli.ts                   # CLI argument parsing
│   ├── tui/
│   │   ├── app.tsx              # Root Ink component
│   │   ├── input.tsx            # Prompt input component
│   │   ├── messages.tsx         # Message display (chat history)
│   │   ├── streaming.tsx        # Streaming token display
│   │   ├── components/
│   │   │   ├── code-block.tsx   # Syntax-highlighted code
│   │   │   ├── spinner.tsx      # Loading/thinking indicator
│   │   │   └── banner.tsx       # Welcome/branding
│   │   └── hooks/
│   │       └── use-streaming.ts # Stream management hook
│   ├── agent/
│   │   ├── core.ts              # Core agent loop logic
│   │   ├── tools/
│   │   │   ├── read-files.ts    # read_files implementation
│   │   │   ├── str-replace.ts   # str_replace implementation
│   │   │   ├── write-file.ts    # write_file implementation
│   │   │   └── terminal.ts      # Terminal command execution
│   │   └── context.ts           # Context management / compaction
│   ├── openrouter/
│   │   ├── client.ts            # OpenRouter API client
│   │   ├── streaming.ts         # SSE stream parsing
│   │   └── types.ts             # API types
│   ├── checkpoint/
│   │   ├── manager.ts           # Checkpoint orchestration
│   │   ├── git.ts               # Git-based checkpointing
│   │   └── snapshot.ts          # Snapshot-based checkpointing
│   └── config/
│       ├── loader.ts            # Config file loading
│       ├── defaults.ts          # Default settings
│       └── setup.ts             # Interactive setup flow
├── tests/
│   ├── unit/
│   │   ├── openrouter.test.ts
│   │   ├── file-editing.test.ts
│   │   ├── checkpoint.test.ts
│   │   └── context.test.ts
│   └── integration/
│       ├── repl.test.ts
│       └── e2e.test.ts
└── README.md
```

---

## 7. OpenRouter Tool Calling Integration

The OpenRouter API supports OpenAI-compatible tool calling, which Clonebuff uses to enable the AI to interact with the codebase.

### Tool Definitions

Each tool is defined as a JSON schema in the `tools` array sent with each request:

```typescript
const tools = [
  {
    type: "function",
    function: {
      name: "read_files",
      description: "Read one or more files from the project",
      parameters: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Paths to files to read"
          }
        },
        required: ["paths"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "str_replace",
      description: "Make precise string replacements in a file",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "File path" },
          replacements: {
            type: "array",
            items: {
              type: "object",
              properties: {
                oldString: { type: "string" },
                newString: { type: "string" },
                allowMultiple: { type: "boolean" }
              },
              required: ["oldString", "newString"]
            }
          }
        },
        required: ["path", "replacements"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create a new file or overwrite an existing one",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          instructions: { type: "string" },
          content: { type: "string" }
        },
        required: ["path", "instructions", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "run_terminal_command",
      description: "Execute a terminal command in the project directory",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run" }
        },
        required: ["command"]
      }
    }
  }
]
```

### Tool Call Flow

1. Client sends `messages` + `tools` to OpenRouter
2. OpenRouter returns either:
   - **Text response**: Display to user
   - **Tool calls**: `assistant.message.tool_calls` array
3. Client executes each tool call locally (file I/O, terminal commands)
4. Client sends results back as `role: "tool"` messages
5. Repeat until OpenRouter returns a text response or `stop` reason

---

## 8. Error Handling & Edge Cases

| Scenario | Handling |
|----------|----------|
| API key missing/expired | Prompt user to re-enter API key |
| OpenRouter rate limit | Exponential backoff, notify user |
| Network timeout | Retry with backoff, show error to user |
| Model unavailable | Show available alternatives, suggest switching |
| File not found | Clear error message with path |
| Permission denied | Show OS error, suggest fix |
| Invalid file path | Reject with validation error |
| Command execution failed | Show stderr output, ask user how to proceed |
| Checkpoint creation failed | Warn user, continue without checkpoint |
| Context window exceeded | Trigger compaction, retry |
| Terminal resize | Ink handles this automatically |
| Ctrl+C | Graceful shutdown, save state |

---

## 9. Performance Targets

| Metric | Target |
|--------|--------|
| Startup time | < 500ms (cold), < 100ms (warm) |
| First token latency | < 2s (dependent on OpenRouter/provider) |
| Token throughput | Full provider streaming speed |
| Context compaction | < 3s for 50k+ token conversations |
| File read (10 files) | < 200ms |
| File search (glob) | < 100ms |
| Checkpoint creation | < 1s (proportional to file count) |
| Memory usage | < 200MB idle, < 500MB peak |

---

## 10. v2+ Feature Roadmap

After v1 is stable, these features are planned:

| Feature | Priority | Description |
|---------|----------|-------------|
| Multi-Agent Orchestration | High | Orchestrator agent spawning sub-agents (file-picker, planner, editor, reviewer) |
| Tree-based File Discovery | High | Parse codebase → build code tree → identify relevant files in seconds |
| Custom Agent Framework | High | Define custom agents via TypeScript in `.agents/` |
| CLI Modes (DEFAULT/MAX/PLAN) | Medium | DEFAULT: standard; MAX: parallel editors + reviewers; PLAN: plan-only mode |
| Clickable Follow-up Suggestions | Medium | After each response, suggest 3 follow-up prompts |
| Ad Revenue Share / Freebuff | Low | Free tier with ads, earn credits from impressions |
| Agent Store | Low | Publish and consume community agents |
| SDK | Low | Programmatic API for CI/CD integration |

---

## 11. Development Phases

### Phase 1: Foundation
- [ ] Project scaffolding (Bun + TypeScript + Ink setup)
- [ ] OpenRouter API client with streaming
- [ ] Config loading and interactive API key setup
- [ ] Basic Ink TUI with input and message display
- [ ] Core agent loop (send message → stream response → display)

### Phase 2: Tools & Capabilities
- [ ] `read_files` tool implementation
- [ ] `str_replace` tool implementation
- [ ] `write_file` tool implementation
- [ ] `run_terminal_command` tool implementation
- [ ] Tool call handling in the agent loop

### Phase 3: Checkpoints & Safety
- [ ] Git-based checkpoint system
- [ ] Snapshot-based checkpoint fallback
- [ ] Auto-checkpoint before edits
- [ ] Checkpoint listing and restore

### Phase 4: Context & Polish
- [ ] Conversation history management
- [ ] Smart compaction and summarization
- [ ] Code block syntax highlighting in TUI
- [ ] Error handling and edge case coverage
- [ ] `/help`, `/usage`, `/model`, `/clear` commands

### Phase 5: Testing & Release
- [ ] Unit tests for all modules
- [ ] Integration tests for agent loop
- [ ] Manual E2E testing with real OpenRouter API
- [ ] Documentation (README, usage guide)
- [ ] npm/bun package publishing

---

## 12. Security Considerations

- **File system isolation**: All file operations constrained to the project directory
- **No remote code execution**: Terminal commands run as the current user, no sandboxing
- **API key protection**: Keys stored in `.env.local` or `~/.clonebuff/config.json` with appropriate file permissions
- **No telemetry**: No data collection without explicit consent
- **Checkpoint integrity**: Checkpoints are stored as copies, no destructive operations
- **Git safety**: Auto-commits use identifiable messages that can be reverted

---

## 13. Open Questions

- [ ] Should we implement a `--headless` mode for CI/CD usage? (Spec: not yet, v3+)
- [ ] What's the default model for first-time users? (Suggest: `openai/gpt-5-nano` for speed, or `deepseek/deepseek-v4-flash` for cost)
- [ ] Should we support multiple concurrent conversations / tabs? (Spec: not for v1)
- [ ] What terminal dimensions should we optimize for? (Target: 80×24 minimum, 120×40 recommended)

---

## 14. Appendix: Comparison to Codebuff

| Feature | Codebuff | Clonebuff v1 | Clonebuff v2+ |
|---------|----------|--------------|---------------|
| CLI command | `codebuff` | `clonebuff` | `clonebuff` |
| Runtime | Node.js | Bun | Bun |
| TUI | OpenTUI (React) | Ink (React) | Ink (React) |
| LLM API | OpenRouter | OpenRouter | OpenRouter |
| Agent architecture | Multi-agent | Single-agent | Multi-agent (Orchestrator) |
| File editing | ✅ | ✅ | ✅ |
| Terminal execution | ✅ | ✅ | ✅ |
| Checkpoints | ✅ | ✅ | ✅ |
| Context management | ✅ | ✅ | ✅ |
| Tree-based discovery | ✅ | ❌ | ✅ |
| Custom agents | ✅ | ❌ | ✅ |
| Modes (MAX/PLAN) | ✅ | ❌ | ✅ |
| Follow-up suggestions | ✅ | ❌ | ✅ |
| Ad revenue | ✅ | ❌ | ❌ |
| SDK | ✅ | ❌ | ❌ |
