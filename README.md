<div align="center">

# 🐱 Clonebuff

**AI Coding Assistant for Your Terminal**

An intelligent terminal-based AI coding assistant powered by [OpenRouter](https://openrouter.ai/).  
Chat with AI directly in your terminal — it can read, edit, and create files in your project.

[Features](#features) • [Quick Start](#quick-start) • [Commands](#commands) • [Character](#character) • [Architecture](#architecture)

[ภาษาไทย](#-clonebuff-ภาษาไทย)

---

</div>

## 📸 Demo

> **💡 Tip:** All screenshots below are terminal captures — this is exactly what you'll see when running Clonebuff!

### Welcome Screen

```
┌─────────────────────────────────────────────────────────────┐
│ 🐱 Neko-chan                         /help for commands     │
└─────────────────────────────────────────────────────────────┘

                ✨🐱✨
              Neko-chan
    Nyaa~! Ready to code together? ✨

       Type a prompt below to get started.

              Examples:
   "Add error handling to the API routes"
   "Refactor the database layer"
   "Explain how this module works"

───────────────────────────────────────────────────────────────
openai/gpt-5-nano │ snapshot │ 0 msgs │ 0k tokens
───────────────────────────────────────────────────────────────

> Type your prompt... (Enter to send, Shift+Enter for newline)
```

### Chat with AI

```
┌─────────────────────────────────────────────────────────────┐
│ 🐱 Neko-chan                         /help for commands     │
└─────────────────────────────────────────────────────────────┘

You
  12:30 PM
  Can you add error handling to the API routes?

🐱 Neko-chan
  12:30 PM
  Nyaa~! Let me check your current API routes first! ✨

  📖 read_files — src/routes/api.ts, src/utils/errors.ts
  ✏️ str_replace — src/routes/api.ts (2 replacements)

  🐱 Neko-chan  writing... ✨ ▊
```

### Character Customization

```
┌─────────────────────────────────────────────────────────────┐
│ 🐱 Neko-chan                         /help for commands     │
└─────────────────────────────────────────────────────────────┘

You
  /character

🐱 Neko-chan

  ## 🐱 Current Character

  **Name:**         Neko-chan
  **Emoji:**        🐱
  **Color:**        magenta
  **Personality:**  A cheerful catgirl coding assistant...
  **Catchphrase:**  Nyaa~! Ready to code together? ✨
  **Tags:**         catgirl, genki, moe

  To customize:
    `/character set name <new name>`
    `/character set emoji <emoji>`
    `/character set color <color>`
    `/character set personality <text>`
    `/character set catchphrase <text>`
    `/character reset`
```

### CLI Help

```
$ clonebuff --help
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
```

> 📁 More demo captures: [welcome screen](docs/demo/welcome.md) · [chat](docs/demo/chat.md) · [character](docs/demo/character.md) · [help](docs/demo/help.md)

---

<div align="center">

[![Test](https://github.com/your-username/clonebuff/actions/workflows/test.yml/badge.svg)](https://github.com/your-username/clonebuff/actions/workflows/test.yml)

</div>

## ✨ Features

- **💬 AI Chat in Terminal** — Full interactive conversation with streaming responses, syntax-highlighted code blocks, and multi-turn agentic workflows
- **🔧 4 Built-in Tools** — The AI can `read_files`, `str_replace`, `write_file`, and `run_terminal_command` to help you code
- **🔄 Multi-Turn Agent Loop** — Up to 10 autonomous cycles of reading, editing, and executing commands
- **📸 Checkpoint System** — Save and restore codebase state before risky edits. Supports Git stash mode or file snapshot fallback
- **💾 Session Persistence** — Conversations are auto-saved. Load/resume past sessions anytime
- **🎭 Customizable AI Character** — Comes with **Neko-chan 🐱** (a cute catgirl coder!) by default. Change name, emoji, color, personality, and catchphrase via `/character`
- **✨ Character Animations** — Sparkle spinners, gentle bounce effects, and themed loading indicators
- **📊 Usage Tracking** — `/usage` shows tokens consumed, API calls made, and estimated cost
- **🧠 Context Management** — Automatic compaction keeps conversations within model context windows
- **🔍 Diff Preview** — Optionally review file diffs before the AI applies changes
- **⚙️ Full Config Control** — Switch models, adjust temperature, toggle features — all persisted to `~/.clonebuff/config.json`
- **📄 Project Scaffolding** — `/init` creates `knowledge.md` and `.agents/` for giving the AI project context

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime (v1.3+)
- An [OpenRouter API key](https://openrouter.ai/keys) (free to get)

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/clonebuff.git
cd clonebuff

# Install dependencies
bun install

# Run Clonebuff
bun start
```

On first launch, Clonebuff will guide you through setting up your OpenRouter API key.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key (or set via interactive setup) |
| `CLONEBUFF_PROJECT` | Project directory (defaults to current working directory) |

## ⌨️ Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/clear` | Clear the conversation |
| `/usage` | Show token usage and estimated cost |
| `/model <slug>` | Switch AI model (e.g., `openai/gpt-4o`, `anthropic/claude-sonnet-4`) |
| `/temperature <0–2>` | Set response creativity |
| `/config show` | Display current configuration |
| `/config toggle confirm` | Toggle diff preview on/off |
| `/session save [name]` | Save conversation |
| `/session list` | List saved conversations |
| `/session load <id>` | Load a saved conversation |
| `/session delete <id>` | Delete a saved conversation |
| `/checkpoint save [name]` | Save current codebase state |
| `/checkpoint list` | List saved checkpoints |
| `/checkpoint restore <id>` | Restore codebase to checkpoint |
| `/character` | View AI character info |
| `/character set <field> <value>` | Change character (name, emoji, color, personality, catchphrase) |
| `/character reset` | Restore default character |
| `/init` | Scaffold project config files |
| `/exit` | Exit Clonebuff |

## 🎭 Character System

Clonebuff ships with **Neko-chan 🐱**, a cheerful catgirl coding assistant. But you can fully customize the AI's personality:

```
/character set name "Code-chan"
/character set emoji 🤖
/character set color cyan
/character set personality "A cool, efficient robot programmer"
/character set catchphrase "Beep boop! Ready to optimize!"
/character reset
```

The personality description is injected into the AI's system prompt, affecting how it communicates and behaves!

## 🏗️ Architecture

```
src/
├── index.tsx                 # Entry point (Ink render)
├── tui/                      # Terminal UI (React/Ink)
│   ├── app.tsx              # Main orchestrator
│   ├── messages.tsx         # Conversation display
│   ├── input.tsx            # Text input
│   └── components/          # Spinners, status bar, etc.
├── agent/                    # AI agent logic
│   ├── core.ts              # Tool execution engine
│   ├── prompts.ts           # System prompts + character
│   ├── context.ts           # Context compaction
│   └── character.ts         # Character model & persistence
├── openrouter/               # API client (SSE streaming)
├── checkpoint/               # Git + snapshot backends
├── config/                   # Configuration management
└── session/                  # Conversation history

tests/                        # 459+ tests across all modules
```

### Tech Stack

- **Runtime:** [Bun](https://bun.sh)
- **UI:** [Ink](https://github.com/vadimdemedes/ink) (React for CLIs) + [React](https://react.dev)
- **AI Backend:** [OpenRouter API](https://openrouter.ai) (multi-model gateway)
- **Language:** TypeScript

## 🧪 Testing

```bash
# Run all tests
bun test

# Run specific test file
bun test tests/agent/character.test.ts

# Run test suite with coverage
bun test --coverage
```

## 📝 License

[MIT](./LICENSE)

---

<div align="center">

# 🐱 Clonebuff — ภาษาไทย

**ผู้ช่วยเขียนโค้ดด้วย AI ใน Terminal**

---

</div>

## ✨ ความสามารถหลัก

- **💬 แชทกับ AI ใน Terminal** — สนทนาโต้ตอบได้เต็มรูปแบบ พร้อมการแสดงผลแบบเรียลไทม์, การเน้นไวยากรณ์ของโค้ด, และการทำงานแบบหลายรอบ
- **🔧 เครื่องมือ 4 อย่าง** — AI สามารถ `read_files` อ่านไฟล์, `str_replace` แก้ไขไฟล์, `write_file` สร้างไฟล์ใหม่, และ `run_terminal_command` รันคำสั่งใน Terminal
- **🔄 การทำงานอัตโนมัติหลายรอบ** — AI สามารถอ่าน แก้ไข และรันคำสั่งได้เองสูงสุด 10 รอบต่อเนื่อง
- **📸 ระบบ Checkpoint** — บันทึกและกู้คืนสถานะของโปรเจ็กต์ก่อนการแก้ไขที่สำคัญ รองรับทั้ง Git stash และการสำรองไฟล์
- **💾 บันทึกการสนทนา** — การสนทนาจะถูกบันทึกอัตโนมัติ สามารถโหลดกลับมาได้ทุกเมื่อ
- **🎭 ปรับแต่งตัวละคร AI ได้** — มาพร้อม **Neko-chan 🐱** (นักเขียนโค้ดสาวแมวสุดน่ารัก!) เปลี่ยนชื่อ, อิโมจิ, สี, บุคลิก และคำทักทายได้ผ่านคำสั่ง `/character`
- **✨ อนิเมชั่นตัวละคร** — เอฟเฟกต์ประกายดาว, การกระดิก, และตัวบ่งชี้การโหลดที่มีสไตล์
- **📊 ติดตามการใช้งาน** — คำสั่ง `/usage` แสดงจำนวน Token, การเรียกใช้ API, และค่าใช้จ่ายโดยประมาณ
- **🧠 จัดการบริบท** — บีบอัดการสนทนาอัตโนมัติเพื่อให้อยู่ในขอบเขตของโมเดล
- **🔍 ดูตัวอย่าง Diff** — ตรวจสอบการเปลี่ยนแปลงไฟล์ก่อนที่ AI จะนำไปใช้
- **⚙️ ตั้งค่าได้เต็มที่** — เปลี่ยนโมเดล, ปรับ Temperature, เปิด/ปิดฟีเจอร์ต่างๆ — บันทึกไว้ใน `~/.clonebuff/config.json`
- **📄 สร้างโครงสร้างโปรเจ็กต์** — คำสั่ง `/init` สร้าง `knowledge.md` และ `.agents/` เพื่อให้ AI เข้าใจบริบทของโปรเจ็กต์

## 🚀 เริ่มต้นใช้งาน

### สิ่งที่ต้องมี

- [Bun](https://bun.sh) runtime (เวอร์ชัน 1.3+)
- [OpenRouter API key](https://openrouter.ai/keys) (สมัครฟรี)

### การติดตั้ง

```bash
# โคลนโปรเจ็กต์
git clone https://github.com/your-username/clonebuff.git
cd clonebuff

# ติดตั้ง dependencies
bun install

# เริ่มใช้งาน
bun start
```

ในครั้งแรกที่รัน, Clonebuff จะแนะนำขั้นตอนการตั้งค่า API key

### ตัวแปรสภาพแวดล้อม

| ตัวแปร | รายละเอียด |
|---------|-----------|
| `OPENROUTER_API_KEY` | คีย์ API ของ OpenRouter (หรือตั้งค่าผ่านหน้าจอแรกเริ่ม) |
| `CLONEBUFF_PROJECT` | ไดเรกทอรีของโปรเจ็กต์ (ค่าเริ่มต้นคือไดเรกทอรีปัจจุบัน) |

## ⌨️ คำสั่ง

| คำสั่ง | รายละเอียด |
|---------|-----------|
| `/help` | แสดงคำสั่งทั้งหมด |
| `/clear` | ล้างการสนทนา |
| `/usage` | แสดงการใช้งาน Token และค่าใช้จ่าย |
| `/model <slug>` | เปลี่ยนโมเดล AI (เช่น `openai/gpt-4o`, `anthropic/claude-sonnet-4`) |
| `/temperature <0–2>` | ปรับความสร้างสรรค์ของคำตอบ |
| `/config show` | แสดงการตั้งค่าปัจจุบัน |
| `/config toggle confirm` | เปิด/ปิดการดูตัวอย่าง Diff |
| `/session save [ชื่อ]` | บันทึกการสนทนา |
| `/session list` | รายการการสนทนาที่บันทึกไว้ |
| `/session load <id>` | โหลดการสนทนาที่บันทึกไว้ |
| `/session delete <id>` | ลบการสนทนาที่บันทึกไว้ |
| `/checkpoint save [ชื่อ]` | บันทึกสถานะโปรเจ็กต์ปัจจุบัน |
| `/checkpoint list` | รายการ checkpoint ที่บันทึกไว้ |
| `/checkpoint restore <id>` | กู้คืนโปรเจ็กต์จาก checkpoint |
| `/character` | ดูข้อมูลตัวละคร AI |
| `/character set <ฟิลด์> <ค่า>` | เปลี่ยนตัวละคร (ชื่อ, อิโมจิ, สี, บุคลิก, คำทักทาย) |
| `/character reset` | คืนค่าตัวละครเริ่มต้น |
| `/init` | สร้างไฟล์ตั้งค่าโปรเจ็กต์ |
| `/exit` | ออกจาก Clonebuff |

## 🎭 ระบบตัวละคร

Clonebuff มาพร้อมกับ **Neko-chan 🐱** สาวแมวผู้รักการเขียนโค้ด แต่คุณสามารถปรับแต่งบุคลิกของ AI ได้เต็มที่:

```
/character set name "โค้ดจัง"
/character set emoji 🤖
/character set color cyan
/character set personality "นักเขียนโปรแกรมหุ่นยนต์ผู้เยือกเย็นและมีประสิทธิภาพ"
/character set catchphrase "บี๊บ บู๊บ! พร้อมที่จะ Optimize แล้ว!"
/character reset
```

คำอธิบายบุคลิกจะถูกแทรกเข้าไปในระบบ prompt ของ AI ส่งผลต่อวิธีการสื่อสารและพฤติกรรมของมัน!

## 🏗️ สถาปัตยกรรม

```
src/
├── index.tsx                 # จุดเริ่มต้น (Ink render)
├── tui/                      # ส่วนติดต่อผู้ใช้ (React/Ink)
│   ├── app.tsx              # ตัวจัดการหลัก
│   ├── messages.tsx         # แสดงการสนทนา
│   ├── input.tsx            # ช่องป้อนข้อความ
│   └── components/          # Spinner, status bar, ฯลฯ
├── agent/                    # ตรรกะ AI agent
│   ├── core.ts              # เครื่องมือดำเนินการ
│   ├── prompts.ts           # System prompts + ตัวละคร
│   ├── context.ts           # การบีบอัดบริบท
│   └── character.ts         # โมเดลตัวละครและการบันทึก
├── openrouter/               # ไคลเอนต์ API (SSE streaming)
├── checkpoint/               # ระบบสำรองข้อมูล Git + ไฟล์
├── config/                   # การจัดการตั้งค่า
└── session/                  # ประวัติการสนทนา

tests/                        # 459+ การทดสอบครอบคลุมทุกโมดูล
```

### เทคโนโลยีที่ใช้

- **Runtime:** [Bun](https://bun.sh)
- **UI:** [Ink](https://github.com/vadimdemedes/ink) (React สำหรับ CLI) + [React](https://react.dev)
- **AI Backend:** [OpenRouter API](https://openrouter.ai) ( gateway เชื่อมต่อหลายโมเดล)
- **ภาษา:** TypeScript

## 🧪 การทดสอบ

```bash
# รันการทดสอบทั้งหมด
bun test

# รันเฉพาะไฟล์ที่ต้องการ
bun test tests/agent/character.test.ts

# รันพร้อมรายงานครอบคลุมโค้ด
bun test --coverage
```

## 📝 สัญญาอนุญาต

[MIT](./LICENSE)

---

<div align="center">

Made with 🐱 and lots of ✨

</div>
