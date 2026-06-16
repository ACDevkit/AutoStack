# AutoStack — Changelog 

---

## Project Overview

**AutoStack** is a cross-platform desktop application (Tauri 2 + React 19 +
TypeScript) that lets users scaffold, run, and manage development projects from
a single GUI — no separate terminal required.

| Layer | Technology |
|---|---|
| Desktop shell | Tauri 2 (Rust backend, WebView frontend) |
| Frontend UI | React 19, TypeScript, Vite 7, Tailwind CSS 4 |
| State | Zustand 5 |
| Persistence | `@tauri-apps/plugin-store` → `settings.json` / `projects.json` |
| Terminal emulator | xterm.js (`@xterm/xterm` v6, FitAddon, WebLinksAddon) |
| IPC | Tauri `invoke` + `listen` (event-based streaming) |
| Styling | Tailwind CSS 4, `tw-animate-css`, `@fontsource-variable/geist` |

### Key architectural decisions

- **No separate shell / terminal window is ever opened.** All process I/O is
  piped into Rust, serialised to Tauri events, and rendered inside an embedded
  xterm.js terminal in the app window.
- **Processes survive tab switches.** The `ProcessManager` singleton
  (`src/lib/processManager.ts`) owns all Tauri event listeners and output
  buffers independently of which React component is mounted.  When a project
  tab is re-opened the buffer is replayed into the freshly-created xterm
  instance.
- **Two-phase output model:**
  - *Install commands* (`install_output_{id}` events) → line-by-line with
    explicit `kind` tags (`"info"` / `"out"` / `"err"` / `"success"`) so the
    frontend can apply colour annotations over scaffold progress text.
  - *Dev-server commands* (`process_output_{id}` events) → raw byte chunks
    (`kind: "raw"`) forwarded verbatim from the pipe so xterm.js can render
    ANSI colours, cursor sequences, and `\r`-based progress indicators exactly
    as tools like Vite/npm emit them.

---

## File Map (as of 2026-05-06)

```
autostack/
├── src/
│   ├── main.tsx                  Boot: load persistence, hydrate stores, mount React
│   ├── App.tsx                   Root layout: TopNav + tab router (dashboard / project / settings)
│   ├── App.css / index.css       Global styles
│   ├── vite-env.d.ts
│   ├── components/
│   │   ├── ProjectPage.tsx       Per-project view: header controls + xterm.js terminal
│   │   ├── TopNav.tsx            Tab bar + window drag region + window controls
│   │   ├── WindowControls.tsx    Custom min/max/close buttons (decorations: false)
│   │   ├── ProjectCard.tsx       Dashboard card for each project
│   │   ├── CreateProjectModal.tsx New-project dialog (name, framework, optional path)
│   │   ├── SettingsPage.tsx      Settings UI (theme, language, default project path)
│   │   ├── FrameworkSelect.tsx   Framework picker used in CreateProjectModal
│   │   ├── EmptyState.tsx        Dashboard empty state illustration
│   │   └── ui/button.tsx         Shared button component
│   ├── lib/
│   │   ├── processManager.ts     Singleton: owns Tauri listeners + output buffer per project
│   │   ├── installer.ts          installProject(): listen then invoke "install_project"
│   │   ├── process.ts            Alternate session-style API (not imported by ProjectPage)
│   │   ├── frameworks.ts         FRAMEWORKS array + getFrameworkById()
│   │   ├── persistence.ts        load/saveProjects(), load/saveSettings() via plugin-store
│   │   └── utils.ts              cn() Tailwind merge helper
│   ├── stores/
│   │   ├── projectStore.ts       Zustand: projects[], activeProjectId
│   │   └── settingsStore.ts      Zustand: theme, language, autoLaunch, defaultProjectLocation
│   ├── templates/index.ts        (stub — not actively used)
│   └── types/index.ts            Project, Template, ProjectStatus types
├── src-tauri/
│   ├── src/
│   │   ├── main.rs               Binary entry → autostack_lib::run()
│   │   └── lib.rs                ALL Tauri commands + process management (see below)
│   ├── capabilities/default.json Tauri 2 permission grants for the main window
│   ├── tauri.conf.json           App config (window size, decorations, CSP, bundle)
│   ├── Cargo.toml                Rust deps
│   └── build.rs
├── package.json
├── vite.config.ts
├── tsconfig.json / tsconfig.node.json
├── components.json               shadcn config
└── .github/workflows/release.yml GitHub Actions release workflow
```

### Tauri commands (`src-tauri/src/lib.rs`)

| Command | Direction | Purpose |
|---|---|---|
| `install_project` | invoke → async | Scaffold a framework project, stream install output |
| `start_project` | invoke → sync (spawns threads) | Start dev server, stream output as raw chunks |
| `stop_project` | invoke | Kill running dev server (full process tree on Windows) |
| `open_folder` | invoke | Open project directory in OS file explorer |
| `greet` | invoke | Demo command (unused by UI) |

### Tauri events (frontend listens, Rust emits)

| Event | Payload | Consumer |
|---|---|---|
| `install_output_{projectId}` | `{ line: string, kind: "out"\|"err"\|"info"\|"success" }` | `installer.ts` |
| `process_output_{projectId}` | `{ line: string, kind: "raw"\|"info" }` | `processManager.ts` |
| `process_exit_{projectId}` | `number \| null` (exit code) | `processManager.ts` |

### Supported frameworks

| ID | Name | Category | Scaffold tool |
|---|---|---|---|
| `react` | React | Frontend | `npm create vite@latest -- --template react-ts` |
| `vue` | Vue | Frontend | `npm create vite@latest -- --template vue-ts` |
| `svelte` | Svelte | Frontend | `npm create vite@latest -- --template svelte-ts` |
| `solid` | Solid | Frontend | `npm create vite@latest -- --template solid-ts` |
| `angular` | Angular | Frontend | `npx @angular/cli@latest new --defaults --skip-git` |
| `nextjs` | Next.js | Full-Stack | `npx create-next-app@latest --typescript --no-tailwind …` |
| `nuxt` | Nuxt | Full-Stack | `npx nuxi@latest init` |
| `astro` | Astro | Full-Stack | `npm create astro@latest -- --template minimal` |
| `sveltekit` | SvelteKit | Full-Stack | `npx sv create --template minimal --types ts` |
| `remix` | Remix | Full-Stack | `npx create-remix@latest` |
| `nodejs` | Node.js | Backend | `npm init -y` + hand-written `index.js` HTTP server |
| `fastapi` | FastAPI | Backend | Hand-written `main.py` + `pip install -r requirements.txt` |
| `django` | Django | Backend | `pip install django` + `django-admin startproject` |
| `go` | Go / Gin | Backend | `go mod init` + hand-written `main.go` HTTP server |
| `rust` | Rust / Axum | Backend | `cargo new` + `cargo add axum tokio` |
| `laravel` | Laravel | Backend | `composer create-project laravel/laravel` |
| `dotnet` | .NET | Backend | `dotnet new webapi` |

---

## Changelog

---

# AutoStack Changelog

---

## [v0.1.3] — 2026-06-16

### UI / Theme Revamp — Premium Polish & Motion

**Files:** `index.css`, `App.tsx`, `ProjectCard.tsx`, `TopNav.tsx`, `ProjectPage.tsx`, `CreateProjectModal.tsx`, `FrameworkSelect.tsx`, `SettingsPage.tsx`, `EmptyState.tsx`, `WindowControls.tsx`, `ui/toggle.tsx`, `ui/status-badge.tsx`, `ui/framework-avatar.tsx`, `lib/status.ts`

**Added**
- New design-token system in Tailwind v4 `@theme`: layered surfaces, brand/semantic status colors, elevation shadows, and motion (timing/easing) tokens — full light + dark sets
- Shared UI primitives: `Toggle`, `StatusBadge`, `FrameworkAvatar`, and a `deriveProjectStatus` / run-phase status helper
- Dashboard: grid/list view toggle, status filter (All / Online / Offline / Setup), live online + needs-setup stat chips, and a sticky header that blurs on scroll
- Empty state wired in with a brand-gradient icon, gentle motion, and quick-start framework chips that pre-select in the create modal
- ProjectCard: framework avatar tile, clearer status pills, depth + hover glow, a two-step delete confirm, and a compact list layout
- TopNav: sliding active-tab indicator, per-tab live status dots, and search focus animation
- ProjectPage: terminal toolbar (Console label + Clear), success check-pop, cross-fading run-state action buttons, and a simple back control beside the Project Settings title
- CreateProjectModal: spring entrance/exit, Esc-to-close, focus trap, optional framework pre-selection, and Docker off by default
- FrameworkSelect: in-dropdown search/filter with brand-tinted rows
- SettingsPage: per-row icons and a segmented theme control (Dark / Light / System)
- Motion system: staggered card entrance, hover lift, modal spring, dropdown entrances, and `prefers-reduced-motion` support throughout

**Changed**
- Retuned the dark palette for more depth (layered surfaces, subtle gradients, lit-from-above borders) while keeping the calm near-black base
- Consolidated duplicate toggle and status-badge implementations into single shared components
- Applied semantic color tokens consistently across cards, headers, and status states
- Retuned the terminal theme (`TERM_THEME`) to match the new palette
- Project settings navigation simplified — removed the toolbar “Back to Console” button; back is now an icon beside the settings heading
- Running projects no longer get a green card glow or success flash when returning to the dashboard — status stays in the badge only

**Removed**
- Colored left accent stripe on project cards
- Green celebration overlay on project cards when a server comes online

**Notes**
- Visual + interaction revamp only — no changes to data shapes, persistence, process/PTY wiring, or window controls

---

## [v0.1.2] — 2026-05-29

### Runtime Settings Wiring + Package Manager Reliability

**Files:** `types/index.ts`, `projectRuntime.ts`, `CreateProjectModal.tsx`, `ProjectPage.tsx`, `installer.ts`, `processManager.ts`, `docker.ts`, `persistence.ts`, `lib.rs`

**Added**
- Project runtime settings are now persisted per project (runtime version, package manager, startup command, auto-install dependencies, strict ports)
- New projects receive framework-aware runtime defaults, and existing projects are normalized on load for backward compatibility
- Runtime settings are now passed end-to-end into install/start/Docker flows instead of being UI-only

**Fixed**
- Project Settings runtime controls now affect real behavior (install commands, startup command resolution, and Docker runtime generation)
- Runtime validation now checks environment/tooling before install/start and returns clearer actionable errors when required tools are missing
- Package manager execution is more resilient with fallback paths (`corepack`, `npx`) and improved startup error detection to avoid stuck "running" states
- Auto-install logic now avoids unsafe repeated installs when lockfiles belong to a different package manager
- Project settings and run button re-modified to look better
- Dashboard projects section modified

**Removed**
- Subtitle line in Project Settings header
---

## [v0.1.1] — 2026-05-15

### Project Settings UI + React/Vite Scaffolding Fixes

**Files:** `App.tsx`, `ProjectCard.tsx`, `ProjectPage.tsx`, `frameworks.ts`, `FrameworkSelect.tsx`, `lib.rs`

**Added**
- Per-project view modes (`console` / `settings`) — settings now open inline inside a project tab instead of navigating away
- Settings shortcut from the dashboard card dropdown
- Project Settings button on open project pages with Back / Done navigation
- Placeholder settings UI with defaults for runtime, package manager, dev command, and misc toggles

**Fixed**
- `react` scaffold was incorrectly pointing at Vite; it now uses the standard React creation flow
- Added `vite` as its own explicit framework option
- Start command mapping corrected — React uses `npm start`, Vite projects use `npm run dev`
- Project name sanitization added to the install flow (auto-lowercased + slugified before scaffolding)
- Installer no longer fails on names like `"React"` — auto-corrects instead of erroring
- Duplicate folder names now get auto-suffixed (`name-2`, `name-3`, ...) instead of crashing

---

## [v0.1.0] — 2026-05-06

### Full PTY Terminal — Interactive Shell & Real Input

**Files:** `Cargo.toml`, `lib.rs`, `processManager.ts`, `ProjectPage.tsx`

Previously the terminal could display output but ignored all keyboard input. Ctrl+C didn't work, tools like Vite disabled interactive mode because there was no real TTY, and `\r`-based progress bars never rendered properly.

Each project tab now gets a real PTY shell — `cmd.exe /K` on Windows, `$SHELL` on Unix — via `portable-pty`. All I/O goes through it.

**What this means in practice:**
- Keyboard input (including arrow keys, Tab completion, Ctrl+C, Ctrl+D) works as expected
- Tools detect a real TTY and enable interactive mode, color output, and keyboard shortcuts
- Starting a dev server = typing the command into the shell; stopping = sending Ctrl+C through the PTY
- A shell prompt is available whenever a server isn't running

**Rust (`lib.rs`)**
- Removed `RunningProcesses` state, `kill_child()`, `spawn_dev_server()`, and `stream_raw()` — all replaced by the PTY model
- Added `open_shell`, `close_shell`, `write_shell_input`, `resize_shell` commands
- `start_project` now writes a `cd && run` string to the shell instead of spawning a separate process
- `stop_project` now sends `\x03` to the PTY instead of calling `taskkill`
- Added `SendMaster` newtype to safely move the PTY master across threads

**TypeScript (`processManager.ts`)**
- Added `attachShell()` — registers `shell_output_{id}` and `shell_exit_{id}` Tauri listeners, handles startup detection, and returns a cleanup function
- Added `RUNNING_PATTERNS` — regex set that detects when a dev server is ready (covers Vite, Next.js, Angular, Django, FastAPI, .NET, Go, Rust, Laravel, and generic `localhost:PORT` patterns)
- `start()` and `stop()` no longer manage Tauri listeners directly

**React (`ProjectPage.tsx`)**
- Removed the fake input handler that printed "(shell not connected)"
- `term.onData` now forwards every keystroke to `write_shell_input`
- Added `initShell()` to open the PTY and attach listeners on mount
- Added `ResizeObserver` that calls `resize_shell` only when dimensions actually change
- Cleanup properly closes the shell, removes listeners, and disposes xterm

---

### Settings — Updates UI

**File:** `SettingsPage.tsx`

- Added an Updates section with current version badge (via `getVersion()`)
- Update check states: idle, checking, up-to-date, update available, error — all with appropriate UI
- Added Release Channel selector (Stable / Beta) for future use
- Backend not wired yet; transitions are simulated for UI review

---

### Console & Process Output Overhaul

**Files:** `lib.rs`, `ProjectPage.tsx`

**Fixed**
- On Windows, spawned processes (npm, node, pip, cargo, etc.) were opening visible `cmd.exe` windows — fixed by passing `CREATE_NO_WINDOW` via a `shell_cmd()` helper used across all spawns
- `taskkill` flash on project stop — same fix applied
- `\r`-based progress bars (npm install, Vite rebuild spinner) weren't rendering — switched dev server output from `BufReader::lines()` to 4 KB chunk reads
- npm/npx output was colorless through pipes — added `FORCE_COLOR=1` and `COLORTERM=truecolor` to all spawns
- Python output was buffered instead of streaming — added `PYTHONUNBUFFERED=1`

**Terminal output**
- Added `case "raw": term.write(line)` to `writeLine` and `writeToTerm` — uses `write()` not `writeln()` to avoid corrupting ANSI sequences with extra newlines

---

## [Pre-release] — 2026-05-05

Initial git history, gitignore setup, and GitHub Actions workflow fixes. Core application code predates this history.

---

## Known Issues

| # | Area | Issue |
|---|---|---|
| 1 | `process.ts` | Redundant file, safe to delete — nothing imports it |
| 2 | `package.json` | Both `xterm@5` and `@xterm/xterm@6` listed — `xterm@5` can be removed |
| 3 | `tauri.conf.json` | CSP is disabled (`null`) — fine for now, set before public release |
| 4 | Updater | Updates UI is placeholder only — backend not wired |
| 5 | `logo.png` | Imported by `TopNav.tsx` but may be missing from repo |
| 6 | `greet` command | Registered in Rust but unused — can be removed |

---

## Environment Variables Set on Spawned Processes

| Variable | Value | Why |
|---|---|---|
| `CI` | `true` | Disables interactive prompts in npm/npx (e.g. "would you like to...") |
| `npm_config_yes` | `true` | Answers "yes" to all npm prompts |
| `ADBLOCK` | `true` | Skips npm funding/ad messages |
| `FORCE_COLOR` | `1` | Forces Node.js/chalk/Vite to emit ANSI colour even when stdout is a pipe |
| `COLORTERM` | `truecolor` | Advertises 24-bit colour support to colour-aware tools |
| `PYTHONUNBUFFERED` | `1` | Forces Python to flush stdout/stderr immediately (real-time output) |
| `TERM` | `xterm-256color` | Dev-server only — tells tools the terminal type supports 256 colours |

`CI`, `npm_config_yes`, and `ADBLOCK` are set on **install commands only**.
`FORCE_COLOR`, `COLORTERM`, and `PYTHONUNBUFFERED` are set on **both install and dev-server** spawns.
`TERM` is set on **dev-server only**.

---

## Windows-Specific Notes

AutoStack now uses a PTY-based model on Windows:

- **Interactive shell**: each project tab opens a ConPTY-backed shell
  (`cmd.exe /K`) through `portable-pty`.
- **No extra terminal windows**: shells and child processes run inside the
  hidden pseudo-console managed by ConPTY.
- **Stop behavior**: Stop sends `Ctrl+C` (`\x03`) to the PTY instead of using
  `taskkill`, so foreground processes receive normal terminal interrupts.

Install/scaffold commands still use `cmd /C` with `CREATE_NO_WINDOW` to prevent
standalone cmd windows from appearing during one-shot command execution.

`explorer.exe` (used by `open_folder`) is a GUI subsystem application and
doesn't allocate a console at all; `CREATE_NO_WINDOW` is applied for
consistency but is a no-op there.

---