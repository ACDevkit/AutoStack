import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProcessOutput {
  /** The text line emitted. */
  line: string;
  /**
   * "out"  – stdout from the process
   * "err"  – stderr from the process (often progress/info from npm/vite etc.)
   * "info" – status message from the Rust runner
   */
  kind: "out" | "err" | "info";
}

/**
 * Handle returned by `startProject`. Holds cleanup and stop helpers so the
 * caller can manage the process lifecycle from React.
 */
export interface ProjectSession {
  /** Invoke `stop_project` in Rust (kills process tree). */
  stop: () => Promise<void>;
  /**
   * Unsubscribe the Tauri event listeners without stopping the process.
   * Call this on component unmount if the process should keep running.
   * For a full teardown use `stop()` first.
   */
  cleanup: () => void;
}

// ─── startProject ─────────────────────────────────────────────────────────────

/**
 * Spawn the dev server for a project and subscribe to its output/exit events.
 *
 * - Resolves with a `ProjectSession` immediately after the process is spawned.
 * - Output lines stream to `onOutput` in real time.
 * - When the process exits `onExit` is called with the exit code (or `null` if
 *   it was killed by `stop()`). The event listeners are cleaned up automatically
 *   on exit.
 * - Throws if the process fails to spawn.
 */
export async function startProject(params: {
  projectId: string;
  frameworkId: string;
  projectPath: string;
  onOutput: (output: ProcessOutput) => void;
  onExit: (code: number | null) => void;
}): Promise<ProjectSession> {
  const { projectId, frameworkId, projectPath, onOutput, onExit } = params;

  const outEvent  = `process_output_${projectId}`;
  const exitEvent = `process_exit_${projectId}`;

  // Keep references so the exit handler can clean up, and cleanup() can as well.
  let unlistenOut:  (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;

  function cleanupListeners() {
    unlistenOut?.();
    unlistenExit?.();
    unlistenOut  = null;
    unlistenExit = null;
  }

  // Register listeners BEFORE invoking to avoid any race condition.
  unlistenOut = await listen<ProcessOutput>(outEvent, (e) => {
    onOutput(e.payload);
  });

  unlistenExit = await listen<number | null>(exitEvent, (e) => {
    onExit(e.payload);
    cleanupListeners(); // self-clean on exit
  });

  // Fire the Rust command. It returns quickly once the process is spawned.
  try {
    await invoke<void>("start_project", { projectId, frameworkId, projectPath });
  } catch (err) {
    cleanupListeners();
    throw err;
  }

  return {
    stop: async () => {
      await invoke<void>("stop_project", { projectId });
    },
    cleanup: cleanupListeners,
  };
}

// ─── stopProject (convenience) ────────────────────────────────────────────────

/** Direct stop without needing a `ProjectSession` reference. */
export async function stopProject(projectId: string): Promise<void> {
  await invoke<void>("stop_project", { projectId });
}
