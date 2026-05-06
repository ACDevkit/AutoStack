import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

// ─── Types ────────────────────────────────────────────────────────────────────

export type RunPhase = "stopped" | "starting" | "running" | "error";

export interface OutputLine {
  line: string;
  kind: string;
}

type PhaseListener  = (phase: RunPhase) => void;
type OutputListener = (output: OutputLine) => void;

// ─── Per-project state ────────────────────────────────────────────────────────

interface ProjectState {
  phase:           RunPhase;
  outputBuffer:    OutputLine[];
  /** Set to true while stop() is in flight so the exit-event handler ignores the race. */
  intentionalStop: boolean;
  unlistenOut?:    () => void;
  unlistenExit?:   () => void;
  phaseListeners:  Set<PhaseListener>;
  outputListeners: Set<OutputListener>;
}

/** Maximum lines kept in the output buffer (matches terminal scrollback). */
const MAX_BUFFER = 5_000;

// ─── ProcessManager ───────────────────────────────────────────────────────────

/**
 * Global singleton that manages running dev-server processes across the
 * entire app lifetime.  Components subscribe to it for phase / output updates
 * and unsubscribe when they unmount — but the process and its Tauri listeners
 * stay alive until the user explicitly stops the project.
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
    if (state.outputBuffer.length > MAX_BUFFER) {
      state.outputBuffer.shift();
    }
    for (const cb of state.outputListeners) cb(output);
  }

  private teardownListeners(state: ProjectState) {
    state.unlistenOut?.();
    state.unlistenExit?.();
    state.unlistenOut  = undefined;
    state.unlistenExit = undefined;
  }

  // ── Public reads ───────────────────────────────────────────────────────────

  getPhase(id: string): RunPhase {
    return this.projects.get(id)?.phase ?? "stopped";
  }

  getOutputBuffer(id: string): OutputLine[] {
    return this.projects.get(id)?.outputBuffer ?? [];
  }

  // ── Subscriptions ──────────────────────────────────────────────────────────

  /**
   * Subscribe to run-phase changes for a project.
   * Returns a cleanup function — call it on component unmount.
   */
  subscribePhase(id: string, listener: PhaseListener): () => void {
    const state = this.ensure(id);
    state.phaseListeners.add(listener);
    return () => state.phaseListeners.delete(listener);
  }

  /**
   * Subscribe to new output lines for a project.
   * Returns a cleanup function — call it on component unmount.
   * The subscription is UI-only; removing it does NOT stop buffering.
   */
  subscribeOutput(id: string, listener: OutputListener): () => void {
    const state = this.ensure(id);
    state.outputListeners.add(listener);
    return () => state.outputListeners.delete(listener);
  }

  // ── Process lifecycle ──────────────────────────────────────────────────────

  /**
   * Spawn the dev server for a project.  Registers Tauri event listeners
   * BEFORE invoking Rust to avoid any race condition.  The listeners and the
   * output buffer survive component unmounts — they live until stop() is
   * called or the process exits on its own.
   */
  async start(id: string, frameworkId: string, projectPath: string): Promise<void> {
    const state = this.ensure(id);

    // Tear down any listeners from a previous run
    this.teardownListeners(state);
    state.outputBuffer   = [];
    state.intentionalStop = false;

    this.setPhase(id, "starting");

    const outEvent  = `process_output_${id}`;
    const exitEvent = `process_exit_${id}`;

    // Register listeners BEFORE invoking Rust to avoid race conditions
    state.unlistenOut = await listen<OutputLine>(outEvent, (e) => {
      this.pushOutput(id, e.payload);
    });

    state.unlistenExit = await listen<number | null>(exitEvent, (e) => {
      // Ignore if stop() already handled this (intentional kill)
      if (state.intentionalStop) return;

      const code = e.payload;
      this.teardownListeners(state);

      if (code !== 0 && code !== null) {
        this.pushOutput(id, { line: "", kind: "info" });
        this.pushOutput(id, { line: `  ✗ Process exited with code ${code}`, kind: "err" });
        this.setPhase(id, "error");
      } else {
        this.pushOutput(id, { line: "", kind: "info" });
        this.pushOutput(id, { line: "  Process stopped", kind: "info" });
        this.setPhase(id, "stopped");
      }
    });

    try {
      await invoke<void>("start_project", { projectId: id, frameworkId, projectPath });
      this.setPhase(id, "running");
    } catch (err) {
      this.teardownListeners(state);
      this.setPhase(id, "error");
      throw err;
    }
  }

  /**
   * Kill the dev server for a project.  Sets intentionalStop so the exit-
   * event handler (which fires asynchronously from Rust) is a no-op.
   */
  async stop(id: string): Promise<void> {
    const state = this.ensure(id);

    // Guard: mark as intentional before the async kill so the exit listener
    // ignores the race-condition event that Rust always emits on kill.
    state.intentionalStop = true;

    this.pushOutput(id, { line: "", kind: "info" });
    this.pushOutput(id, { line: "  Stopping\u2026", kind: "info" });

    try {
      await invoke<void>("stop_project", { projectId: id });
    } catch {
      // ignore — process may have already exited
    }

    this.teardownListeners(state);
    state.intentionalStop = false;

    this.pushOutput(id, { line: "  Stopped.", kind: "info" });
    this.setPhase(id, "stopped");
  }
}

/** Singleton — import this everywhere instead of creating new instances. */
export const processManager = new ProcessManager();
