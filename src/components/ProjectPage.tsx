import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  Container, Cpu, Download, FolderOpen,
  Loader2, Play, RotateCcw, Server, Square, Settings2, ArrowLeft,
  Check, SquareTerminal, Eraser,
} from "lucide-react";
import type { Project } from "@/types";
import type { ProjectTabView } from "@/App";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFrameworkById } from "@/lib/frameworks";
import { installProject, type InstallOutput } from "@/lib/installer";
import { prepareDockerRuntime } from "@/lib/docker";
import { processManager, type RunPhase } from "@/lib/processManager";
import { invoke } from "@tauri-apps/api/core";
import {
  deriveDefaultStartupCommand,
  normalizeRuntimeSettings,
} from "@/lib/projectRuntime";
import { deriveProjectStatus } from "@/lib/status";
import Toggle from "@/components/ui/toggle";
import StatusBadge from "@/components/ui/status-badge";
import FrameworkAvatar from "@/components/ui/framework-avatar";

// ─── Terminal theme ────────────────────────────────────────────────────────────

const TERM_THEME = {
  background:          "#0a0a0a",
  foreground:          "#d4d4d4",
  cursor:              "#7c6af7",
  cursorAccent:        "#0a0a0a",
  selectionBackground: "rgba(124, 106, 247, 0.25)",
  black:               "#1a1a1a",
  red:                 "#f38ba8",
  green:               "#a6e3a1",
  yellow:              "#f9e2af",
  blue:                "#89b4fa",
  magenta:             "#cba6f7",
  cyan:                "#89dceb",
  white:               "#cdd6f4",
  brightBlack:         "#585b70",
  brightRed:           "#f38ba8",
  brightGreen:         "#a6e3a1",
  brightYellow:        "#f9e2af",
  brightBlue:          "#89b4fa",
  brightMagenta:       "#cba6f7",
  brightCyan:          "#89dceb",
  brightWhite:         "#ffffff",
};

// ─── Phase types ───────────────────────────────────────────────────────────────

type InstallPhase = "idle" | "installing" | "error";

// ─── ProjectPage ───────────────────────────────────────────────────────────────

interface ProjectPageProps {
  project: Project;
  isActive: boolean;
  viewMode: ProjectTabView;
  onViewModeChange: (view: ProjectTabView) => void;
}

export default function ProjectPage({
  project,
  isActive,
  viewMode,
  onViewModeChange,
}: ProjectPageProps) {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef          = useRef<Terminal | null>(null);
  const fitRef           = useRef<FitAddon | null>(null);

  const updateProject          = useProjectStore((s) => s.updateProject);
  const defaultProjectLocation = useSettingsStore((s) => s.defaultProjectLocation);

  // ── Install state ────────────────────────────────────────────────────────────
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installError, setInstallError] = useState<string | null>(null);
  const [dockerError, setDockerError] = useState<string | null>(null);
  const runtime = normalizeRuntimeSettings(project.runtime, project.templateId);

  function updateRuntime(patch: Partial<typeof runtime>) {
    const next = { ...runtime, ...patch };
    updateProject(project.id, { runtime: next });
  }

  // ── Run state — initialised from the global processManager ───────────────────
  const [runPhase, setRunPhase] = useState<RunPhase>(
    () => processManager.getPhase(project.id),
  );

  // One-shot success "check pop" shown when install finishes or the server starts.
  const [successPop, setSuccessPop] = useState(0);
  const triggerSuccessPop = () => setSuccessPop((k) => k + 1);

  // ── Subscribe to phase changes ───────────────────────────────────────────────
  useEffect(() => {
    setRunPhase(processManager.getPhase(project.id));

    const unsub = processManager.subscribePhase(project.id, (phase) => {
      setRunPhase((prev) => {
        // Celebrate the transition into a live server.
        if (phase === "running" && prev !== "running") triggerSuccessPop();
        return phase;
      });
      // Write a shell prompt decoration after the process finishes so the user
      // has a clear visual boundary between server output and the next prompt.
      if (phase === "stopped" || phase === "error") {
        termRef.current?.writeln("");
      }
    });

    return unsub;
  }, [project.id]);

  // ── Terminal init ────────────────────────────────────────────────────────────
  //
  // This effect runs once per project tab open.  It:
  //   1. Creates the xterm.js instance and writes the project banner.
  //   2. Registers processManager's in-memory output subscription so live
  //      shell output appears in the terminal as it arrives.
  //   3. Wires `term.onData` → `invoke("write_shell_input")` so every
  //      keystroke (including Ctrl+C) is forwarded to the PTY shell.
  //   4. Calls `processManager.attachShell` to register Tauri event listeners
  //      for `shell_output_{id}` / `shell_exit_{id}`.
  //   5. Calls `invoke("open_shell")` to start (or resize) the PTY shell.
  //   6. Sets up a ResizeObserver that fits the terminal and notifies the PTY
  //      of the new dimensions so line-wrapping and cursor stay correct.
  //
  // Cleanup: detaches processManager listeners, closes the PTY shell, disposes
  // the xterm instance.
  useEffect(() => {
    if (!termContainerRef.current) return;

    // ── 1. Create xterm instance ─────────────────────────────────────────────
    const term = new Terminal({
      cursorBlink:       true,
      cursorStyle:       "block",
      fontFamily:        '"Cascadia Code", "Cascadia Mono", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize:          13,
      lineHeight:        1.5,
      letterSpacing:     0,
      scrollback:        10_000,
      theme:             TERM_THEME,
      allowTransparency: false,
      convertEol:        true,
    });

    const fit      = new FitAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(webLinks);
    term.open(termContainerRef.current);
    requestAnimationFrame(() => { try { fit.fit(); } catch { /* noop */ } });

    termRef.current = term;
    fitRef.current  = fit;

    // ── Write banner ─────────────────────────────────────────────────────────
    const fw      = getFrameworkById(project.templateId);
    const fwLabel = fw ? fw.name : project.templateId || "Unknown";

    term.writeln("\x1b[38;5;63m  ╭──────────────────────────────────╮\x1b[0m");
    const namePad = Math.max(0, 34 - project.name.length);
    term.writeln(
      `\x1b[38;5;63m  │\x1b[0m  \x1b[1;97m${project.name}\x1b[0m${" ".repeat(namePad)}\x1b[38;5;63m│\x1b[0m`,
    );
    term.writeln("\x1b[38;5;63m  ╰──────────────────────────────────╯\x1b[0m");
    term.writeln("");
    term.writeln(`\x1b[38;5;245m  Framework  \x1b[0m\x1b[97m${fwLabel}\x1b[0m`);
    if (project.path) {
      term.writeln(`\x1b[38;5;245m  Path       \x1b[0m\x1b[38;5;110m${project.path}\x1b[0m`);
      term.writeln("");
      term.writeln("\x1b[38;5;245m  Click \x1b[1mStart\x1b[0m\x1b[38;5;245m above to run the dev server, or type commands below.\x1b[0m");
    } else {
      term.writeln(
        `\x1b[38;5;245m  Path       \x1b[0m\x1b[33mnot set — click \x1b[1mInstall Project\x1b[0m\x1b[33m above to scaffold\x1b[0m`,
      );
      term.writeln("");
      term.writeln("\x1b[38;5;245m  A shell will open below once the project is installed.\x1b[0m");
    }
    term.writeln("");

    // ── Helper: write a single output line ───────────────────────────────────
    // kind="raw" → verbatim PTY chunk (may contain ANSI + \r progress rewinds)
    // Other kinds → coloured text for install/status messages
    function writeLine(line: string, kind: string) {
      switch (kind) {
        case "raw":     term.write(line);                              break;
        case "info":    term.writeln(`\x1b[38;5;245m${line}\x1b[0m`); break;
        case "err":     term.writeln(`\x1b[33m${line}\x1b[0m`);       break;
        case "success": term.writeln(`\x1b[32m${line}\x1b[0m`);       break;
        default:        term.writeln(line);
      }
    }

    // ── 2. Subscribe to processManager output ────────────────────────────────
    // (In-memory only — this drives live terminal rendering.  The actual Tauri
    // event listener is registered by attachShell below.)
    const unsubOutput = processManager.subscribeOutput(project.id, (output) => {
      writeLine(output.line, output.kind);
    });

    // ── 3. Wire keyboard input to PTY ────────────────────────────────────────
    // Every character, control sequence, and special key (arrows, Ctrl+C, Tab,
    // etc.) that xterm.js produces is forwarded verbatim to the shell via
    // write_shell_input.  The PTY delivers it to the foreground process.
    term.onData((data) => {
      invoke("write_shell_input", { projectId: project.id, data }).catch(() => {});
    });

    // ── 4 & 5. Async shell setup ─────────────────────────────────────────────
    // attachShell registers the Tauri event listeners; open_shell starts
    // (or resizes) the PTY process.  Both must complete before shell output
    // or exit events can be processed.
    let isMounted = true;
    let detachShell: (() => void) | null = null;

    const initShell = async () => {
      // Register listeners FIRST so no early output is missed.
      detachShell = await processManager.attachShell(project.id);
      if (!isMounted) {
        detachShell();
        detachShell = null;
        return;
      }

      // Derive initial PTY size from the current terminal dimensions.
      const dim  = fit.proposeDimensions() ?? { cols: 80, rows: 24 };
      const cols = Math.max(dim.cols, 20);
      const rows = Math.max(dim.rows, 5);

      await invoke("open_shell", {
        projectId:   project.id,
        projectPath: project.path ?? "",
        cols,
        rows,
      }).catch((err: unknown) => {
        term.writeln(`\x1b[31m  Shell error: ${String(err)}\x1b[0m`);
      });
    };

    initShell().catch(console.error);

    // ── 6. Resize observer ───────────────────────────────────────────────────
    // Tracks the terminal container size, fits xterm.js, and tells the PTY
    // about the new dimensions so column wrap / cursor positioning stays right.
    let lastCols = 0;
    let lastRows = 0;

    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* noop */ }
      const dim = fit.proposeDimensions();
      if (dim && (dim.cols !== lastCols || dim.rows !== lastRows)) {
        lastCols = dim.cols;
        lastRows = dim.rows;
        invoke("resize_shell", {
          projectId: project.id,
          cols: dim.cols,
          rows: dim.rows,
        }).catch(() => {});
      }
    });
    ro.observe(termContainerRef.current!);

    // ── Cleanup ──────────────────────────────────────────────────────────────
    return () => {
      isMounted = false;
      detachShell?.();
      unsubOutput();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
      // Close the PTY shell so it doesn't linger after the tab is closed.
      invoke("close_shell", { projectId: project.id }).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Re-fit + re-notify PTY when tab becomes visible ─────────────────────────
  useEffect(() => {
    if (!isActive || viewMode !== "console" || !fitRef.current) return;
    requestAnimationFrame(() => {
      try {
        fitRef.current?.fit();
        const dim = fitRef.current?.proposeDimensions();
        if (dim) {
          invoke("resize_shell", {
            projectId: project.id,
            cols: dim.cols,
            rows: dim.rows,
          }).catch(() => {});
        }
      } catch { /* noop */ }
    });
  }, [isActive, project.id, viewMode]);

  // ── Terminal write helpers (used by install + start/stop handlers) ────────

  function writeToTerm(line: string, kind: string) {
    const term = termRef.current;
    if (!term) return;
    switch (kind) {
      case "raw":     term.write(line);                              break;
      case "info":    term.writeln(`\x1b[38;5;245m${line}\x1b[0m`); break;
      case "err":     term.writeln(`\x1b[33m${line}\x1b[0m`);       break;
      case "success": term.writeln(`\x1b[32m${line}\x1b[0m`);       break;
      default:        term.writeln(line);
    }
  }

  function termBanner(label: string) {
    const term = termRef.current;
    if (!term) return;
    term.write("\r\n");
    term.writeln("\x1b[38;5;63m  ────────────────────────────────────────\x1b[0m");
    term.writeln(`\x1b[1;97m  ${label}\x1b[0m`);
    term.writeln("\x1b[38;5;63m  ────────────────────────────────────────\x1b[0m");
    term.writeln("");
  }

  // ── Install handler ──────────────────────────────────────────────────────────

  async function handleInstall() {
    if (installPhase !== "idle") return;
    setInstallPhase("installing");
    setInstallError(null);
    termBanner("Installing Project");

    try {
      const installedPath = await installProject({
        projectId:   project.id,
        frameworkId: project.templateId,
        projectName: project.name,
        installPath: defaultProjectLocation,
        runtimeSettings: runtime,
        onOutput:    (o: InstallOutput) => writeToTerm(o.line, o.kind),
      });
      updateProject(project.id, { path: installedPath });
      if (project.useDocker) {
        try {
          writeToTerm("  Preparing Docker runtime...", "info");
          const docker = await prepareDockerRuntime({
            projectPath: installedPath,
            frameworkId: project.templateId,
            projectName: project.name,
            runtimeSettings: runtime,
          });
          updateProject(project.id, { docker });
          setDockerError(null);
          writeToTerm(
            `  Docker ready: localhost:${docker.hostPort} -> container:${docker.containerPort}`,
            "success",
          );
        } catch (err) {
          const message = String(err);
          setDockerError(message);
          writeToTerm(`  Docker setup failed: ${message}`, "err");
        }
      }
      setInstallPhase("idle");
      triggerSuccessPop();
      termRef.current?.writeln("");
      // Re-open the shell in the newly created project directory.
      const dim  = fitRef.current?.proposeDimensions() ?? { cols: 80, rows: 24 };
      await invoke("open_shell", {
        projectId:   project.id,
        projectPath: installedPath,
        cols: Math.max(dim.cols, 20),
        rows: Math.max(dim.rows, 5),
      }).catch(() => {});
    } catch (err) {
      const msg = String(err);
      setInstallError(msg);
      setInstallPhase("error");
      writeToTerm("", "info");
      writeToTerm(`  ✗ Installation failed`, "err");
      writeToTerm(`  ${msg}`, "info");
      termRef.current?.writeln("");
    }
  }

  // ── Start handler ────────────────────────────────────────────────────────────

  async function handleStart() {
    const current = processManager.getPhase(project.id);
    if (current === "starting" || current === "running") return;

    const fw = getFrameworkById(project.templateId);
    termBanner(`Starting ${fw?.name ?? project.templateId}`);

    try {
      let dockerConfig = project.docker;
      if (project.useDocker) {
        writeToTerm("  Preparing Docker compose runtime...", "info");
        dockerConfig = await prepareDockerRuntime({
          projectPath: project.path,
          frameworkId: project.templateId,
          projectName: project.name,
          runtimeSettings: runtime,
          preferredHostPort: dockerConfig?.hostPort,
        });
        updateProject(project.id, { docker: dockerConfig });
      }
      await processManager.start(
        project.id,
        project.templateId,
        project.path,
        runtime,
        dockerConfig,
      );
    } catch (err) {
      writeToTerm("", "info");
      writeToTerm(`  ✗ Failed to start: ${String(err)}`, "err");
      termRef.current?.writeln("");
    }
  }

  // ── Stop handler ─────────────────────────────────────────────────────────────

  async function handleStop() {
    const current = processManager.getPhase(project.id);
    if (current !== "running" && current !== "starting") return;
    try {
      await processManager.stop(project.id, project.path, project.docker);
    } catch {
      // processManager handles errors internally
    }
  }

  // ── Derived state ─────────────────────────────────────────────────────────────

  const displayStatus = deriveProjectStatus(project, runPhase);
  const isNotSetup    = displayStatus === "not-setup";

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Info header ─────────────────────────────────────────────────── */}
      <div className="relative shrink-0 flex items-center gap-4 px-6 py-3.5 border-b border-border bg-card/60 backdrop-blur-sm">

        {/* Live accent line while the dev server is running */}
        {runPhase === "running" && (
          <div
            aria-hidden
            className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-success/60 to-transparent animate-in fade-in duration-500 pointer-events-none"
          />
        )}

        {/* Framework icon */}
        <FrameworkAvatar templateId={project.templateId} />


        {/* Name + framework label */}
        {(() => {
          const fw = getFrameworkById(project.templateId);
          return (
            <div className="min-w-0 flex-1">
              <h1 className="text-[15px] font-semibold text-foreground leading-tight truncate">
                {project.name}
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                {fw && <span className="text-xs font-medium" style={{ color: fw.color }}>{fw.name}</span>}
                {fw && <span className="text-muted-foreground/30 text-[10px] select-none">·</span>}
                <span className="text-[11px] text-muted-foreground/60">
                  {getFrameworkById(project.templateId)?.category ?? "Unknown"}
                </span>
              </div>
            </div>
          );
        })()}

        {/* ── Status + action group ───────────────────────────────────── */}
        <div className="flex items-center gap-2 shrink-0">

          {/* One-shot success check-pop (install done / server started) */}
          {successPop > 0 && (
            <span
              key={successPop}
              aria-hidden
              className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-success-soft text-success animate-success-pop"
            >
              <Check className="w-3 h-3" />
            </span>
          )}

          {!isNotSetup && <StatusBadge status={displayStatus} size="md" />}

          {/* ── INSTALL flow ────────────────────────────────────────────── */}
          {isNotSetup && installPhase === "idle" && (
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-emphasis active:scale-95 transition-all duration-150 animate-in fade-in zoom-in-95"
              style={{
                boxShadow:
                  "0 2px 10px -2px color-mix(in oklch, var(--primary) 40%, transparent)",
              }}
            >
              <Download className="w-3 h-3" />
              Install Project
            </button>
          )}
          {isNotSetup && installPhase === "installing" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground animate-in fade-in zoom-in-95">
              <Loader2 className="w-3 h-3 animate-spin" />
              Installing…
            </span>
          )}
          {isNotSetup && installPhase === "error" && (
            <button
              onClick={() => { setInstallPhase("idle"); setInstallError(null); }}
              title={installError ?? undefined}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium text-danger border border-danger/30 rounded-md hover:bg-danger-soft active:scale-95 transition-all duration-150 animate-in fade-in zoom-in-95"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          )}

          {/* ── RUN flow ────────────────────────────────────────────────── */}
          {!isNotSetup && runPhase === "stopped" && (
            <button
              onClick={handleStart}
              aria-label="Start project"
              title="Start project"
              className="inline-flex items-center justify-center h-7 w-7 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-500 active:scale-95 transition-all duration-150 animate-in fade-in zoom-in-95"
              style={{
                boxShadow:
                  "0 2px 10px -2px color-mix(in oklch, var(--success) 35%, transparent)",
              }}
            >
              <Play className="w-3 h-3 fill-current" />
            </button>
          )}
          {!isNotSetup && runPhase === "starting" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground animate-in fade-in zoom-in-95">
              <Loader2 className="w-3 h-3 animate-spin" />
              Starting…
            </span>
          )}
          {!isNotSetup && runPhase === "running" && (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-red-600/90 text-white rounded-md hover:bg-red-500 active:scale-95 transition-all duration-150 animate-in fade-in zoom-in-95"
              style={{
                boxShadow:
                  "0 2px 10px -2px color-mix(in oklch, var(--danger) 35%, transparent)",
              }}
            >
              <Square className="w-3 h-3 fill-current" />
              Stop
            </button>
          )}
          {!isNotSetup && runPhase === "error" && (
            <button
              onClick={handleStart}
              aria-label="Restart project"
              title="Restart project"
              className="inline-flex items-center justify-center h-7 w-7 text-xs font-medium text-warning border border-warning/30 rounded-md hover:bg-warning-soft active:scale-95 transition-all duration-150 animate-in fade-in zoom-in-95"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          )}

          {viewMode === "console" && (
            <button
              onClick={() => onViewModeChange("settings")}
              aria-label="Project settings"
              title="Project settings"
              className="inline-flex items-center justify-center h-7 w-7 text-xs font-medium bg-secondary border border-border rounded-md text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
            >
              <Settings2 className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-border/60 shrink-0" />

        {/* Path — clickable when set */}
        {project.path ? (
          <button
            onClick={() => invoke("open_folder", { path: project.path }).catch(() => {})}
            title={`Open in file explorer\n${project.path}`}
            className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 max-w-xs shrink-0 rounded px-1 -mx-1 hover:text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors duration-100 cursor-pointer"
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{project.path}</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 max-w-xs shrink-0">
            <FolderOpen className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">No path set</span>
          </div>
        )}
      </div>

      {/* ── Project content ─────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        <div
          className={`h-full min-h-0 flex flex-col ${viewMode === "console" ? "" : "hidden"}`}
          style={{ backgroundColor: TERM_THEME.background }}
        >
          {/* Terminal toolbar */}
          <div className="flex items-center justify-between px-3 h-8 shrink-0 border-b border-white/[0.06] select-none">
            <span className="flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-white/40">
              <SquareTerminal className="w-3.5 h-3.5" />
              Console
            </span>
            <button
              onClick={() => termRef.current?.clear()}
              title="Clear console"
              className="inline-flex items-center gap-1.5 h-6 px-2 rounded text-[11px] font-medium text-white/40 hover:text-white/80 hover:bg-white/[0.06] active:scale-95 transition-all duration-150"
            >
              <Eraser className="w-3 h-3" />
              Clear
            </button>
          </div>

          {/* Terminal surface */}
          <div className="relative flex-1 min-h-0">
            <div
              ref={termContainerRef}
              className="absolute inset-0"
              style={{ padding: "10px 12px" }}
            />
          </div>
        </div>

        {viewMode === "settings" && (
          <div className="h-full min-h-0 overflow-y-auto bg-background">
            <div className="max-w-3xl mx-auto px-8 py-8">
              <div className="mb-7 flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => onViewModeChange("console")}
                  aria-label="Back to console"
                  title="Back to console"
                  className="w-8 h-8 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0 -ml-1"
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <h2 className="text-lg font-semibold text-foreground">Project Settings</h2>
              </div>

              {project.useDocker && (
                <section className="surface-card rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70 flex items-center gap-2">
                    <Container className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Container Runtime
                    </p>
                  </div>
                  <div className="px-5 py-4 text-sm text-muted-foreground space-y-1">
                    <p>
                      Mode: <span className="text-foreground">Docker compose</span>
                    </p>
                    {project.docker ? (
                      <>
                        <p>
                          Port forwarding:{" "}
                          <span className="text-foreground">
                            localhost:{project.docker.hostPort} -&gt; container:{project.docker.containerPort}
                          </span>
                        </p>
                        <p>
                          Compose file: <span className="text-foreground">{project.docker.composeFile}</span>
                        </p>
                      </>
                    ) : (
                      <p>Docker runtime metadata will be generated after install/start.</p>
                    )}
                    {dockerError && <p className="text-warning">Last Docker error: {dockerError}</p>}
                  </div>
                </section>
              )}

              <div className="space-y-6">
                <section className="surface-card rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70 flex items-center gap-2">
                    <Cpu className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Runtime
                    </p>
                  </div>
                  <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Runtime version</span>
                      <select
                        value={runtime.runtimeVersion}
                        onChange={(e) => {
                          const nextRuntime = e.target.value as typeof runtime.runtimeVersion;
                          const currentDefault = deriveDefaultStartupCommand(
                            project.templateId,
                            runtime.packageManager,
                          );
                          const nextPackageManager =
                            nextRuntime === "bun-latest" ? "bun" : runtime.packageManager;
                          const nextDefault = deriveDefaultStartupCommand(
                            project.templateId,
                            nextPackageManager,
                          );
                          const shouldUpdateStartup = runtime.startupCommand === currentDefault;
                          updateRuntime({
                            runtimeVersion: nextRuntime,
                            ...(nextPackageManager !== runtime.packageManager
                              ? { packageManager: nextPackageManager }
                              : {}),
                            ...(shouldUpdateStartup ? { startupCommand: nextDefault } : {}),
                          });
                        }}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="node-20-lts">Node 20 LTS</option>
                        <option value="node-22-current">Node 22 Current</option>
                        <option value="bun-latest">Bun latest</option>
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Package manager</span>
                      <select
                        value={runtime.packageManager}
                        onChange={(e) => {
                          const nextPm = e.target.value as typeof runtime.packageManager;
                          const currentDefault = deriveDefaultStartupCommand(
                            project.templateId,
                            runtime.packageManager,
                          );
                          const nextDefault = deriveDefaultStartupCommand(project.templateId, nextPm);
                          const shouldUpdateStartup = runtime.startupCommand === currentDefault;
                          updateRuntime({
                            packageManager: nextPm,
                            ...(shouldUpdateStartup ? { startupCommand: nextDefault } : {}),
                          });
                        }}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option value="npm">npm</option>
                        <option value="pnpm">pnpm</option>
                        <option value="yarn">yarn</option>
                        <option value="bun">bun</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="surface-card rounded-xl overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70 flex items-center gap-2">
                    <Server className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Dev Server
                    </p>
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-muted-foreground">Startup command</span>
                      <input
                        value={runtime.startupCommand}
                        onChange={(e) => updateRuntime({ startupCommand: e.target.value })}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="npm run dev"
                      />
                    </label>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border bg-secondary/30">
                        <div>
                          <p className="text-sm font-medium text-foreground">Auto-install dependencies</p>
                          <p className="text-xs text-muted-foreground">Install dependencies automatically on first run.</p>
                        </div>
                        <Toggle
                          checked={runtime.autoInstallDeps}
                          onChange={(next) => updateRuntime({ autoInstallDeps: next })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-4 p-3 rounded-md border border-border bg-secondary/30">
                        <div>
                          <p className="text-sm font-medium text-foreground">Strict port mode</p>
                          <p className="text-xs text-muted-foreground">Prefer fixed framework ports when supported.</p>
                        </div>
                        <Toggle
                          checked={runtime.enableStrictPorts}
                          onChange={(next) => updateRuntime({ enableStrictPorts: next })}
                        />
                      </div>
                    </div>
                  </div>
                </section>

                <div className="flex justify-end">
                  <button
                    onClick={() => onViewModeChange("console")}
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-emphasis active:scale-95 transition-all duration-150"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
