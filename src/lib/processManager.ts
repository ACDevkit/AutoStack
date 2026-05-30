import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import type { DockerRuntimeConfig, ProjectRuntimeSettings } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunPhase = "stopped" | "starting" | "running" | "error";

export interface OutputLine {
  line: string;
  kind: string; // "raw" | "info" | "err" | "success" | "out"
}

type PhaseListener  = (phase: RunPhase) => void;
type OutputListener = (output: OutputLine) => void;

// ─── Startup detection patterns ───────────────────────────────────────────────
// Matched against incoming shell output while phase === "starting".
// A match transitions the project to "running".

const RUNNING_PATTERNS: RegExp[] = [
  /localhost:\d+/i,                             // Vite, Node, most servers
  /127\.0\.0\.1:\d+/i,
  /0\.0\.0\.0:\d+/i,
  /\bLocal:\s+http/i,                           // Vite "Local: http://..."
  /ready in \d+/i,                              // Vite "ready in Xms"
  /running on http/i,                           // Flask, FastAPI
  /uvicorn running/i,                           // FastAPI/uvicorn
  /starting development server/i,               // Django
  /application bundle generation complete/i,    // Angular
  /ready\s*[-–]\s*started server/i,             // Next.js 12
  /✓\s+ready/i,                                 // Next.js 13+
  /now listening on/i,                          // .NET
  /listening on http/i,                         // Go, Rust/Axum
  /development server started/i,               // Laravel
  /server running at/i,                        // Node.js http server
];

const ERROR_PATTERNS: RegExp[] = [
  /failed to connect to the docker api/i,
  /docker engine is not running/i,
  /unable to get image/i,
  /cannot connect to the docker daemon/i,
  /is not recognized as an internal or external command/i,
  /\bcommand not found\b/i,
  /the system cannot find the file specified/i,
];

// ─── Per-project state ────────────────────────────────────────────────────────

interface ProjectState {
  phase:           RunPhase;
  outputBuffer:    OutputLine[];
  intentionalStop: boolean;
  /** True once shell Tauri event listeners have been registered. */
  shellAttached:   boolean;
  unlistenOut?:    () => void;
  unlistenExit?:   () => void;
  phaseListeners:  Set<PhaseListener>;
  outputListeners: Set<OutputListener>;
}

/** Maximum lines kept in the rolling output buffer. */
const MAX_BUFFER = 5_000;

// ─── ProcessManager ───────────────────────────────────────────────────────────

/**
 * Global singleton that owns all shell event subscriptions and output buffers.
 *
 * Lifecycle per project tab:
 *   1. Component mounts  → ProjectPage calls `attachShell(id)` which registers
 *      Tauri event listeners for `shell_output_{id}` and `shell_exit_{id}`.
 *      Returns a cleanup function that MUST be called on unmount.
 *   2. User clicks Start → `start()` writes the dev-server command to the PTY
 *      via `invoke("start_project")`.  Output scanning detects startup patterns
 *      and transitions phase to "running".  A fallback timer fires after 8 s.
 *   3. User clicks Stop  → `stop()` sends Ctrl+C via `invoke("stop_project")`.
 *      Phase transitions to "stopped" immediately.
 *   4. Component unmounts → cleanup function tears down listeners.
 *      The PTY shell itself is closed by ProjectPage via `invoke("close_shell")`.
 */
class ProcessManager {
  private projects = new Map<string, ProjectState>();

  // ── Private helpers ────────────────────────────────────────────────────────

  private ensure(id: string): ProjectState {
    if (!this.projects.has(id)) {
      this.projects.set(id, {
        phase:           "stopped",
        outputBuffer:    [],
        intentionalStop: false,
        shellAttached:   false,
        phaseListeners:  new Set(),
        outputListeners: new Set(),
      });
    }
    return this.projects.get(id)!;
  }

  private setPhase(id: string, phase: RunPhase) {
    const state = this.ensure(id);
    state.phase = phase;
    for (const cb of state.phaseListeners) cb(phase);
  }

  private pushOutput(id: string, output: OutputLine) {
    const state = this.ensure(id);
    state.outputBuffer.push(output);
    if (state.outputBuffer.length > MAX_BUFFER) state.outputBuffer.shift();
    for (const cb of state.outputListeners) cb(output);
  }

  private teardownListeners(state: ProjectState) {
    state.unlistenOut?.();
    state.unlistenExit?.();
    state.unlistenOut   = undefined;
    state.unlistenExit  = undefined;
    state.shellAttached = false;
  }

  // ── Public reads ───────────────────────────────────────────────────────────

  getPhase(id: string): RunPhase {
    return this.projects.get(id)?.phase ?? "stopped";
  }

  getOutputBuffer(id: string): OutputLine[] {
    return this.projects.get(id)?.outputBuffer ?? [];
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  subscribePhase(id: string, listener: PhaseListener): () => void {
    const state = this.ensure(id);
    state.phaseListeners.add(listener);
    return () => state.phaseListeners.delete(listener);
  }

  subscribeOutput(id: string, listener: OutputListener): () => void {
    const state = this.ensure(id);
    state.outputListeners.add(listener);
    return () => state.outputListeners.delete(listener);
  }

  // ── Shell attachment ───────────────────────────────────────────────────────

  /**
   * Register Tauri event listeners for a project's PTY shell.
   * Should be called once when the project tab mounts (after the terminal is
   * created).  The returned function MUST be called on unmount.
   *
   * Idempotent: if listeners are already registered this is a no-op.
   */
  async attachShell(id: string): Promise<() => void> {
    const state = this.ensure(id);

    // Already attached — return a no-op cleanup to avoid double-subscribing.
    if (state.shellAttached) {
      return () => {};
    }

    const outEvent  = `shell_output_${id}`;
    const exitEvent = `shell_exit_${id}`;

    state.unlistenOut = await listen<OutputLine>(outEvent, (e) => {
      this.pushOutput(id, e.payload);

      // While the dev server is starting, scan for known startup patterns.
      const curState = this.projects.get(id);
      if (curState?.phase === "starting" || curState?.phase === "running") {
        if (ERROR_PATTERNS.some((p) => p.test(e.payload.line))) {
          this.setPhase(id, "error");
          return;
        }
      }
      if (curState?.phase === "starting") {
        if (RUNNING_PATTERNS.some((p) => p.test(e.payload.line))) {
          this.setPhase(id, "running");
        }
      }
    });

    state.unlistenExit = await listen<void>(exitEvent, () => {
      const st = this.projects.get(id);
      if (!st) return;
      this.teardownListeners(st);
      // Only update phase on unexpected exit (not after an intentional stop).
      if (!st.intentionalStop) {
        this.setPhase(id, "stopped");
      }
    });

    state.shellAttached = true;

    return () => {
      const st = this.projects.get(id);
      if (st) this.teardownListeners(st);
    };
  }

  // ── Process lifecycle ──────────────────────────────────────────────────────

  /**
   * Start the dev server.
   *
   * Invokes `start_project` which writes `cd <path> && <cmd>` to the project's
   * PTY shell stdin.  The output arrives through the `shell_output_{id}` stream
   * that `attachShell` is already subscribed to — no new listeners are needed.
   *
   * Phase transitions:
   *   "stopped" → "starting" immediately.
   *   "starting" → "running" when a startup URL/pattern is detected in output.
   *   "starting" → "running" after 8 s fallback (covers frameworks where the
   *   startup message doesn't match our patterns).
   */
  async start(
    id: string,
    frameworkId: string,
    projectPath: string,
    runtimeSettings: ProjectRuntimeSettings,
    dockerConfig?: DockerRuntimeConfig,
  ): Promise<void> {
    const state = this.ensure(id);
    state.intentionalStop = false;
    this.setPhase(id, "starting");

    try {
      await invoke<void>("start_project", {
        projectId:   id,
        frameworkId,
        projectPath,
        runtimeSettings,
        dockerConfig: dockerConfig ?? null,
      });

      // Fallback timer: if no startup pattern is detected within 8 s, assume
      // the server is running (avoids getting stuck in "starting" forever).
      const targetId = id;
      setTimeout(() => {
        const p = this.projects.get(targetId);
        if (p?.phase === "starting") this.setPhase(targetId, "running");
      }, 8_000);
    } catch (err) {
      this.setPhase(id, "error");
      throw err;
    }
  }

  /**
   * Stop the dev server by sending Ctrl+C to the PTY.
   * The PTY delivers SIGINT to the foreground process group exactly as a real
   * Ctrl+C press would.  Phase transitions to "stopped" immediately.
   */
  async stop(id: string, projectPath?: string, dockerConfig?: DockerRuntimeConfig): Promise<void> {
    const state = this.ensure(id);

    state.intentionalStop = true;
    this.pushOutput(id, { line: "", kind: "info" });
    this.pushOutput(id, { line: "  Stopping\u2026", kind: "info" });

    try {
      await invoke<void>("stop_project", {
        projectId: id,
        projectPath: projectPath ?? null,
        dockerConfig: dockerConfig ?? null,
      });
    } catch {
      // Ignore — process may have already exited.
    }

    state.intentionalStop = false;
    this.pushOutput(id, { line: "  Stopped.", kind: "info" });
    this.setPhase(id, "stopped");
  }
}

/** Singleton — import this everywhere instead of creating new instances. */
export const processManager = new ProcessManager();
