# AutoStack — Changelog & Architecture Reference

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

### [v0.1.1] — 2026-05-15  ·  Project Settings UI + React/Vite Scaffolding Fixes

**Affected files:** `src/App.tsx`, `src/components/ProjectCard.tsx`, `src/components/ProjectPage.tsx`, `src/lib/frameworks.ts`, `src/components/FrameworkSelect.tsx`, `src-tauri/src/lib.rs`

#### Added project settings front-end flow (no backend wiring yet)

- Added per-project view mode (`console` / `settings`) so settings can open inside a project tab.
- Dashboard project-card dropdown **Settings** now opens/focuses that project's tab and lands on project settings.
- Added **Project Settings** button on opened project pages and **Back to Project / Done** navigation back to console.
- Added placeholder project settings UI (frontend-only) with sensible defaults for runtime/package manager/dev command/toggles.

#### Fixed React scaffolding behavior and framework options

- `react` scaffolding no longer points to Vite; it now uses default React app creation flow.
- Added `vite` as its own explicit framework option.
- Updated start command mapping so React uses `npm start` while Vite-based projects use `npm run dev`.
- Refined visible framework options to the React-focused set requested (React, Vite, Next.js, Astro, Remix), while keeping backend frameworks available.

#### Fixed installer naming failures (capitalization and invalid chars)

- Added centralized project-name sanitization in install flow (lowercase + safe slug format).
- Installer now auto-corrects invalid names before scaffolding instead of failing (e.g. `"React"` → `react`).
- Added automatic unique suffixing when the target folder already exists (`name-2`, `name-3`, ...).

- Switched to Docker-managed containers for projects with port forwarding.

### [v0.1.0] — 2026-05-06  ·  Full PTY Terminal — Interactive Shell & Real Input

**Affected files:** `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src/lib/processManager.ts`, `src/components/ProjectPage.tsx`

#### Problem being solved

The terminal in each project tab could display output but completely ignored user input. Every keystroke showed "(shell not connected — `<cmd>`)" because there was no real shell connection. Specifically:

1. **No PTY**: Processes were spawned with `Stdio::piped()`, which creates plain OS pipes, not a console. Tools like Vite, Node, and Python detect a non-TTY stdin and disable interactive features (keyboard shortcuts like `q`/`r`/`h` in Vite, readline in Node REPL, etc.).
2. **Ctrl+C broken**: Writing `\x03` to a pipe does NOT deliver SIGINT to the foreground process. Only a real PTY console can do that.
3. **No shell**: When the dev server was stopped there was nothing to type commands into.
4. **`\r` progress bars broken**: Tools that use carriage-return to overwrite lines (npm install progress, Vite rebuild spinner) didn't render because `BufReader::lines()` only released output on `\n`.

#### Solution: PTY-per-project using `portable-pty`

Each opened project tab now gets a real **PTY shell** (`cmd.exe /K` on Windows, `$SHELL` or `bash` on Unix) running in the project directory. All terminal I/O goes through this PTY which means:
- Every keystroke (including arrow keys, Tab completion, Ctrl+C, Ctrl+D, Ctrl+Z) is forwarded to the real shell via `write_shell_input`.
- The shell sees a real console — tools enable interactive mode, color, and keyboard shortcuts.
- Starting a dev server = typing the command into the shell. Stopping = sending `\x03` (Ctrl+C) which the PTY delivers as a SIGINT to the foreground process group.
- A real shell prompt is available whenever the dev server is not running.

#### Changes — `src-tauri/Cargo.toml`

Added: `portable-pty = "0.8"`

`portable-pty` (by the WezTerm team) wraps:
- **Windows**: Windows 10 1809+ ConPTY (`CreatePseudoConsole`) — no winpty.dll needed
- **Unix**: POSIX PTY (openpty/forkpty)

No additional system SDK is required on Windows 10/11.

#### Changes — `src-tauri/src/lib.rs`

**Removed:**
- `RunningProcesses` state and map (was `HashMap<String, Child>`)
- `kill_child()` function (taskkill + child.kill)
- `spawn_dev_server()` function (separate process spawning for dev server)
- `stream_raw()` helper (chunk streaming for the old separate dev server process)
- `Child` import from `std::process` (no longer stored)

**New type: `SendMaster`**
```rust
struct SendMaster(Box<dyn portable_pty::MasterPty>);
unsafe impl Send for SendMaster {}
```
The `MasterPty` trait does not have `Send` as a supertrait, but all concrete implementations (`ConPtyMaster` on Windows, `UnixMasterPty` on Unix) are in fact thread-safe. This newtype allows moving the master into the master-owning thread while being explicit about the unsafety.

**New type: `MasterMsg` enum**
```rust
enum MasterMsg { Resize(PtySize), Shutdown }
```
Channel messages to the master-owning thread. Resize requests and shutdown are multiplexed through one `mpsc::SyncSender<MasterMsg>`.

**New type: `PtySessionData` + `PtySessions` state**
```rust
struct PtySessionData {
    writer: Box<dyn Write + Send>,      // stdin → shell
    master_tx: SyncSender<MasterMsg>,   // resize / shutdown
}
pub struct PtySessions(Arc<Mutex<HashMap<String, PtySessionData>>>);
```

**New command: `open_shell(project_id, project_path, cols, rows)`**
- Idempotent: if a session already exists for `project_id`, sends a resize message and returns immediately.
- Spawns `cmd.exe /K` (Windows) or `$SHELL` (Unix) via `portable_pty::native_pty_system().openpty()`.
- Sets `TERM=xterm-256color`, `COLORTERM=truecolor`, `FORCE_COLOR=1`, `PYTHONUNBUFFERED=1`.
- Starts **two threads**:
  - *Master-owning thread*: holds `SendMaster` and the `Child` handle; processes `MasterMsg::Resize` and `MasterMsg::Shutdown`.
  - *Reader thread*: reads PTY output in 4 KB raw chunks; emits each as `shell_output_{id}` with `kind="raw"`; on EOF emits `shell_exit_{id}`, removes the session from the map (so a future `open_shell` creates a fresh shell), and signals master thread to shut down.

**New command: `close_shell(project_id)`**
Removes the session from the map and sends `MasterMsg::Shutdown` to the master thread, which kills the child and drops the PTY master.

**New command: `write_shell_input(project_id, data)`**
Writes raw bytes to the PTY master's write end. Called for every `onData` event from xterm.js (including Ctrl+C = `\x03`, arrow keys, Tab, etc.).

**New command: `resize_shell(project_id, cols, rows)`**
Sends `MasterMsg::Resize(PtySize { rows, cols, .. })` to the master thread, which calls `master.resize()`. Without this, line-wrapping breaks after any terminal resize.

**Updated: `start_project(project_id, framework_id, project_path)`**
No longer spawns a separate process. Instead writes a platform-appropriate "navigate then run" string to the shell stdin:
- Windows: `cd /d "{path}"\r\n{cmd}\r\n`
- Unix: `cd '{path}' && {cmd}\n`

The PTY echoes the command, runs it, and all output flows through the existing `shell_output_{id}` stream. No new event channels are needed.

**Updated: `stop_project(project_id)`**
Writes `\x03` (ETX / Ctrl+C) to the PTY write end. The ConPTY (or Unix PTY) delivers this as SIGINT to the foreground process group — exactly what happens when a user presses Ctrl+C in a real terminal. Works correctly for all frameworks.

**Updated: `run()` (app entry)**
`.manage(PtySessions(...))` replaces the old `.manage(RunningProcesses(...))`.
New commands registered: `open_shell`, `close_shell`, `write_shell_input`, `resize_shell`.

#### Changes — `src/lib/processManager.ts`

**New: `RUNNING_PATTERNS` array**
A set of regexes checked against incoming `shell_output_{id}` chunks while phase === `"starting"`. The first match transitions the project to `"running"`. Patterns cover:
- Vite: `Local:\s+http`, `ready in \d+`
- Next.js 12: `ready - started server`
- Next.js 13+: `✓ Ready`
- Angular: `Application bundle generation complete`
- Django: `Starting development server`
- FastAPI/uvicorn: `Uvicorn running`
- .NET: `Now listening on`
- Go/Rust: `Listening on http`
- Laravel: `development server started`
- Generic: `localhost:\d+`, `0.0.0.0:\d+`

**New: `attachShell(id): Promise<() => void>`**
Registers the two permanent Tauri event listeners for a project's PTY shell:
- `shell_output_{id}` → buffers the chunk and pushes it to all in-memory output subscribers. Also scans for `RUNNING_PATTERNS` to detect startup.
- `shell_exit_{id}` → tears down listeners and sets phase to `"stopped"` (unless `intentionalStop` is set).

Returns a cleanup function that must be called on component unmount.

Idempotent: if `state.shellAttached` is already true, returns a no-op cleanup immediately.

**Updated: `start(id, frameworkId, projectPath)`**
- No longer sets up Tauri event listeners (that's `attachShell`'s responsibility).
- Sets phase to `"starting"`, invokes `start_project` (which writes to the shell), then starts an 8-second fallback timer that transitions to `"running"` if no startup pattern was detected.

**Updated: `stop(id)`**
- No longer tears down event listeners (listeners stay alive while the PTY shell is open).
- Sets `intentionalStop = true`, invokes `stop_project` (Ctrl+C to PTY), then sets phase to `"stopped"`.

**Updated: `ProjectState` interface**
Added `shellAttached: boolean` field (initialized `false`). Set to `true` by `attachShell`, reset to `false` by `teardownListeners`.

#### Changes — `src/components/ProjectPage.tsx`

**Removed:**
- The fake `term.onData` handler that displayed "(shell not connected — `<cmd>`)" and the `line` buffer used for local editing.
- The `Reconnected` buffer-replay logic (the shell now starts fresh on every mount; no buffer replay is needed).
- The final `❯` prompt write (the real PTY shell shows its own prompt).
- The "Shell integration coming soon." hint message.

**Updated: terminal `useEffect`**

The single `useEffect` (keyed on `project.id`) now does:

1. **Create xterm** — unchanged.
2. **Write banner** — updated copy: "Click Start above or type commands below."
3. **`writeLine` helper** — unchanged (handles `raw`/`info`/`err`/`success`/`out`).
4. **Subscribe to processManager** — unchanged (in-memory callback → xterm write).
5. **NEW: `term.onData(data => invoke("write_shell_input", ...))`** — every keystroke from xterm is forwarded verbatim to the PTY. This includes:
   - Printable characters
   - Arrow keys, Home, End, PageUp/Down (escape sequences)
   - Tab (→ shell completion)
   - Ctrl+C (`\x03` → SIGINT to foreground process)
   - Ctrl+D (`\x04` → EOF → exits shell or Python REPL)
   - Ctrl+Z (`\x1a` → SIGTSTP on Unix)
   - Ctrl+L (`\x0c` → clear screen)
6. **NEW: `initShell()` async function** — called inside the effect:
   - Calls `processManager.attachShell(project.id)` to register Tauri listeners.
   - Calls `invoke("open_shell", { projectId, projectPath, cols, rows })`.
   - If component unmounts before async completes, the cleanup runs immediately.
7. **NEW: `ResizeObserver`** — after `fit.fit()`, checks if `cols`/`rows` actually changed (tracked in `lastCols`/`lastRows`) before calling `invoke("resize_shell")` to avoid flooding the Rust side with redundant resize messages.

**Cleanup (return value of `useEffect`):**
- Calls `detachShell()` (processManager listener cleanup).
- Calls `unsubOutput()` (in-memory xterm callback cleanup).
- Disconnects `ResizeObserver`.
- Disposes xterm terminal.
- Calls `invoke("close_shell", { projectId })` to kill the PTY shell.

**Updated: `isActive` resize `useEffect`**
Now also calls `invoke("resize_shell", ...)` after `fit.fit()` when the tab becomes visible, keeping PTY dimensions in sync after tab switches.

**Updated: `handleInstall()`**
After install completes and the project path is known, calls `open_shell` again with the new path. Since `open_shell` is idempotent, this updates the existing shell's cwd via a resize message. (The shell was already running in a temp/home dir during install; the `cd` embedded in `start_project` ensures the dev server runs in the correct directory regardless.)

---

### [v0.1.0] — 2026-05-06  ·  Settings Updates UI (Version + Check Button)

**Affected file:** `src/components/SettingsPage.tsx`

#### What changed

- Added a dedicated **Updates** section styled with the same `Section` and
  `SettingRow` patterns used across the Settings page.
- Renamed the first update row label from **"Application Update"** to
  **"AutoStack Updates"** for better product fit.
- Added a persistent **current version** badge (`Current vX.Y.Z`) in the update
  row, loaded via `getVersion()` from `@tauri-apps/api/app`.
- Added placeholder update-check states with themed UI:
  - idle: `Check for Updates` button
  - checking: spinner + "Checking for updates..."
  - up-to-date: success badge
  - available: version-available indicator + `Download & Install` button
  - error: warning text + `Retry` button
- Added a placeholder **Release Channel** selector (`Stable`, `Beta`) for future
  backend wiring.

#### Notes

- This is intentionally UI-only for now. No updater backend commands are wired
  yet; the check action uses simulated status transitions so the interface can
  be reviewed and polished first.

---

### [v.0.1.0] — 2026-05-06  ·  Console & Process Output Overhaul

**Affected files:** `src-tauri/src/lib.rs`, `src/components/ProjectPage.tsx`

#### Problem being solved

1. On Windows, every process AutoStack spawned (npm, node, vite, cargo, pip,
   etc.) was causing the OS to open a visible `cmd.exe` console window.  This
   was confusing and looked broken — users saw a black cmd window flash or stay
   open beside the app.
2. The dev-server output streamer used `BufReader::lines()` which only releases
   a line when a `\n` character arrives.  Tools like Vite write progress
   indicators and server-ready banners using `\r` (carriage return) to rewrite
   the same line in-place.  With line-based reading those sequences never
   flushed correctly, making the terminal look stuck.
3. Install commands were missing `FORCE_COLOR`, `COLORTERM`, and
   `PYTHONUNBUFFERED` environment variables, so npm/npx output arrived without
   ANSI colour and Python tools buffered their output instead of streaming it.
4. `taskkill.exe` (used to kill the process tree on Windows) was also spawned
   without `CREATE_NO_WINDOW`, causing a brief cmd flash on every Stop.

#### Changes — `src-tauri/src/lib.rs`

**New: `shell_cmd(cmd_str) -> Command` helper**
- Replaces the repeated `#[cfg(windows)] Command::new("cmd").args(["/C", …])` /
  `#[cfg(not)] Command::new("sh").args(["-c", …])` pattern used in both
  `run_command` and `spawn_dev_server`.
- On Windows, calls `.creation_flags(0x0800_0000)` (`CREATE_NO_WINDOW`) via the
  `std::os::windows::process::CommandExt` trait.  This flag tells the OS to
  create the process with a hidden console that is never shown as a window.
  Child processes that inherit this console (npm → node, pip, cargo, etc.)
  also have no visible window.
- On non-Windows, produces `sh -c "…"` unchanged.

**Updated: `run_command` (install commands)**
- Now uses `shell_cmd` instead of the old duplicated cfg blocks.
- Added environment variables to every install spawn:
  - `FORCE_COLOR=1` — Node.js/npm/npx honour this flag and emit ANSI colour
    even when stdout is a pipe (not a real TTY).
  - `COLORTERM=truecolor` — tells colour-aware tools the terminal supports 24-bit.
  - `PYTHONUNBUFFERED=1` — Python writes stdout immediately instead of
    buffering 8 KB before flushing; required for real-time pip output.
- Streaming strategy kept as `BufReader::lines()` (line-by-line) because
  install output is plain progress text that the frontend annotates with colour
  tags.  This is correct and intentional for the install use-case.

**Updated: `kill_child` (Windows branch)**
- Added `.creation_flags(0x0800_0000)` to the `taskkill` `Command` spawn.
- Prevents the brief black "taskkill" flash that appeared every time a project
  was stopped.

**New: `stream_raw(app, event, pipe) -> JoinHandle` helper**
- Reads the given pipe in 4 KB byte chunks using `Read::read()` in a loop.
- Converts each chunk to a `String` with `String::from_utf8_lossy()` (invalid
  UTF-8 bytes are replaced with `U+FFFD` — no panic on binary noise).
- Emits each chunk as a Tauri event with `kind: "raw"` so the frontend can
  forward it verbatim to xterm.js.
- Replacing `BufReader::lines()` with chunked `read()` means:
  - `\r`-based progress bars (npm install progress, Vite rebuild indicator)
    render correctly in xterm.
  - ANSI escape sequences that span a `\n` boundary are never split mid-sequence.
  - Output appears as soon as the OS makes it available, not after a newline.

**Updated: `spawn_dev_server`**
- Now uses `shell_cmd` (gets `CREATE_NO_WINDOW` automatically on Windows).
- Added `TERM=xterm-256color` environment variable so tools that inspect `$TERM`
  know to use colour and cursor sequences.
- Removed the old duplicated `#[cfg(windows)]` / `#[cfg(not)]` spawn blocks.

**Updated: `start_project` command**
- Now calls `stream_raw(…, stdout)` and `stream_raw(…, stderr)` instead of
  two `thread::spawn(|| BufReader::lines())` closures.
- Both stdout and stderr are forwarded with `kind: "raw"`.  Previously stderr
  was tagged `"err"` and rendered in amber; now the tool's own ANSI colours
  take precedence (Vite, for example, colours its server URL in cyan).
- The `▶  npm run dev` banner is still emitted as `kind: "info"` (dimmed grey)
  before the process is spawned, which is correct since it's a status message
  from the runner, not output from the tool.

**Updated: `open_folder`**
- Restructured from `let result = …; result.map(…)` to proper `#[cfg]` blocks
  each returning directly.
- Added `CREATE_NO_WINDOW` to the Windows `explorer` spawn for consistency
  (no-op since explorer is a GUI app, but makes the pattern uniform).

**Imports added:**
- `std::io::Read` (for `pipe.read(&mut buf)` in `stream_raw`)

#### Changes — `src/components/ProjectPage.tsx`

**Updated: `writeLine` (inside terminal `useEffect`)**
- Added `case "raw": term.write(line); break;` as the first branch.
- `term.write()` (not `term.writeln()`) is critical here: `writeln` appends
  `\r\n` which would corrupt raw ANSI sequences and double-newline every chunk.
- xterm.js maintains full ANSI parser state across successive `write()` calls,
  so split escape sequences that span chunk boundaries are handled correctly.
- Used for: buffer replay, live output subscription (both call `writeLine`).

**Updated: `writeToTerm` (outside `useEffect`)**
- Same `case "raw": term.write(line)` addition.
- Used for: install output forwarding and the start/stop banner writes.

#### What was NOT changed (intentional)

- `processManager.ts` — The `OutputLine` interface `{ line: string, kind: string }`
  already accommodates `kind: "raw"` without any changes.  The buffer stores raw
  chunks the same as any other line, and replays them identically on tab reopen.
- `installer.ts` — Install still uses the line-based `"out"/"err"/"info"/"success"`
  kind system.  This is intentional: install output is annotated status text,
  not raw terminal output.
- `process.ts` — This file is a duplicate/alternate API that is NOT imported by
  `ProjectPage.tsx`.  It exists but is inert.  Left as-is.
- `default.json` (capabilities) — No permission changes needed.
- `Cargo.toml` — No new dependencies needed; `std::os::windows::process` and
  `std::io::Read` are part of the Rust standard library.

---

### [Pre-release] — 2026-05-05  ·  Initial Git history cleanup

**Commits (oldest → newest):**

| Hash | Message | What happened |
|---|---|---|
| `ae68aaf` | File system fix git | Initial tracked state; gitignore corrected |
| `738437a` | Gitignore v2 | Refined `.gitignore` |
| `8c6bc36` | fix gitignore | Additional gitignore fix |
| `d0fec2a` | Fixing files & workflow | File and GitHub Actions workflow corrections |
| `e338695` | Git ignore and workflow fix v2 | Final gitignore + workflow stabilisation |

These commits represent the project's initial file-system and CI setup phase.
The core application code (Rust backend, React frontend, all components) was
already written before this git history begins.

---

## Current Known Issues / Future Work

| # | Area | Issue | Notes |
|---|---|---|---|
| 1 | `process.ts` | Redundant file — same API as `processManager.ts` | Safe to delete, nothing imports it |
| 2 | `package.json` | Both `xterm@5` (legacy) and `@xterm/xterm@6` listed | `xterm@5` can be removed; the codebase imports only from `@xterm/xterm` |
| 3 | `tauri.conf.json` | `"csp": null` — Content Security Policy is disabled | Fine for dev/internal; should be set before public distribution |
| 4 | Updater backend | Updates UI is currently placeholder-only | `SettingsPage` check/install actions are simulated; wire to real updater commands later |
| 5 | `src/assets/logo.png` | Imported by `TopNav.tsx` but not visible in search | May be untracked or missing; could cause build failure |
| 6 | `greet` command | Registered in `invoke_handler!` but unused by any UI | Can be removed |

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

*Last updated: 2026-05-06 by AI assistant (Cursor, Codex 5.3)*
