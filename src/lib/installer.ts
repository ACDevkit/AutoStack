import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InstallOutput {
  /** The text line emitted by the process or the install runner. */
  line: string;
  /**
   * "out"     – stdout from the spawned process (normal output)
   * "err"     – stderr from the spawned process (often npm progress, not real errors)
   * "info"    – a status message from the Rust runner itself
   * "success" – final success message from the Rust runner
   */
  kind: "out" | "err" | "info" | "success";
}

export interface InstallParams {
  projectId: string;
  frameworkId: string;
  projectName: string;
  /** Absolute path to the parent directory. Pass "" to use the default (~/AutoStack). */
  installPath: string;
  onOutput: (output: InstallOutput) => void;
}

// ─── installProject ───────────────────────────────────────────────────────────

/**
 * Scaffold a new project on disk for the given framework.
 *
 * Streams stdout/stderr from the scaffolding commands back to `onOutput` in
 * real time via Tauri events, then resolves with the absolute path of the
 * created project directory when complete.
 *
 * Throws (rejects) with a string error message on failure.
 */
export async function installProject(params: InstallParams): Promise<string> {
  const { projectId, frameworkId, projectName, installPath, onOutput } = params;

  const eventName = `install_output_${projectId}`;

  // Register the listener BEFORE invoking so no events are missed.
  const unlisten = await listen<InstallOutput>(eventName, (event) => {
    onOutput(event.payload);
  });

  try {
    const resultPath = await invoke<string>("install_project", {
      projectId,
      frameworkId,
      projectName,
      installPath,
    });
    return resultPath;
  } finally {
    // Always clean up the event listener.
    unlisten();
  }
}
