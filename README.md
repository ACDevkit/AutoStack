<div align="center">

# AutoStack

A desktop app for scaffolding and running dev projects without leaving the window.

</div>

---

AutoStack is a Tauri desktop app with a React UI. You pick a framework, it scaffolds the project, installs dependencies, and runs the dev server, output goes into a built-in terminal. No extra cmd windows popping up on Windows.

Good for keeping a few side projects in one place. Still early, I built it mainly as a portfolio piece and use it when I want to spin something up quickly.

### What it does

- Create projects (React, Vite, Next.js, FastAPI, Django, Go, Rust, Laravel, .NET, and others)
- Install dependencies from the UI
- Start/stop dev servers with a real embedded terminal (keyboard input, Ctrl+C, ANSI colors)
- Optional Docker mode when creating a project
- Per-project runtime settings (package manager, startup command, etc.)
- Dashboard with project status, grid/list view, search

### What doesn't work yet

Early development — some settings are placeholders (auto-launch, updates, release channel, language). Update checking isn't wired up. Expect rough edges.

---

## Install

**Pre-built (easiest)**

1. Go to [Releases](https://github.com/ACDevkit/AutoStack/releases)
2. Download the installer for your OS (Windows `.msi`/`.exe`, macOS `.dmg`, Linux `.AppImage`/`.deb`)
3. Run it

You'll need the usual tooling on your machine for whatever framework you pick (Node/npm for frontend stuff, Python for FastAPI/Django, etc.). AutoStack runs the commands, it doesn't install Node or Python for you.

**From source**

Requirements: [Node.js](https://nodejs.org/) (LTS), [Rust](https://rustup.rs/), and on Windows the MSVC build tools Rust expects.

```bash
git clone https://github.com/ACDevkit/AutoStack.git
cd AutoStack
npm install
npm run tauri dev
