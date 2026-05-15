import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  AlertCircle, Download, FolderOpen,
  Loader2, Play, RotateCcw, Square, Settings2, ArrowLeft,
} from "lucide-react";
import type { Project, ProjectStatus } from "@/types";
import type { ProjectTabView } from "@/App";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
import { installProject, type InstallOutput } from "@/lib/installer";
import { prepareDockerRuntime } from "@/lib/docker";
import { processManager, type RunPhase } from "@/lib/processManager";
import { invoke } from "@tauri-apps/api/core";

// ─── Status helpers ────────────────────────────────────────────────────────────

function deriveStatus(project: Project): ProjectStatus {
  if (!project.path || project.path.trim() === "") return "not-setup";
  return "offline";
}

function StatusBadge({ status, message }: { status: ProjectStatus; message?: string }) {
  if (status === "not-setup") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        Setup required
      </span>
    );
  }
  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        Online
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-red-600 dark:text-red-400">
        <span className="h-2 w-2 rounded-full bg-red-500 shrink-0" />
        {message ?? "Error"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="h-2 w-2 rounded-full bg-muted-foreground/40 shrink-0" />
      Offline
    </span>
  );
}

// ─── Terminal theme ────────────────────────────────────────────────────────────

const TERM_THEME = {
  background:          "#0d0d0d",
  foreground:          "#d4d4d4",
  cursor:              "#7c6af7",
  cursorAccent:        "#0d0d0d",
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
  const [runtimeVersion, setRuntimeVersion] = useState("Node 20 LTS");
  const [packageManager, setPackageManager] = useState("npm");
  const [startupCommand, setStartupCommand] = useState("npm run dev");
  const [autoInstallDeps, setAutoInstallDeps] = useState(true);
  const [enableStrictPorts, setEnableStrictPorts] = useState(false);

  // ── Run state — initialised from the global processManager ───────────────────
  const [runPhase, setRunPhase] = useState<RunPhase>(
    () => processManager.getPhase(project.id),
  );

  // ── Subscribe to phase changes ───────────────────────────────────────────────
  useEffect(() => {
    setRunPhase(processManager.getPhase(project.id));

    const unsub = processManager.subscribePhase(project.id, (phase) => {
      setRunPhase(phase);
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
          preferredHostPort: dockerConfig?.hostPort,
        });
        updateProject(project.id, { docker: dockerConfig });
      }
      await processManager.start(project.id, project.templateId, project.path, dockerConfig);
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

  const baseStatus = deriveStatus(project);
  const isNotSetup = baseStatus === "not-setup";

  const displayStatus: ProjectStatus =
    runPhase === "running"                ? "online"
    : runPhase === "error" && !isNotSetup ? "error"
    : baseStatus;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Info header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-4 px-6 py-3.5 border-b border-border bg-card/60 backdrop-blur-sm">

        {/* Framework icon */}
        {(() => {
          const fw = getFrameworkById(project.templateId);
          return fw ? (
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{
                backgroundColor: `color-mix(in oklch, ${fw.color} 12%, transparent)`,
                boxShadow:       `0 0 0 1px color-mix(in oklch, ${fw.color} 25%, transparent)`,
              }}
            >
              <FrameworkIcon fw={fw} size={20} />
            </div>
          ) : (
            <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-secondary/60 ring-1 ring-border">
              <span className="text-xs font-bold text-muted-foreground">?</span>
            </div>
          );
        })()}

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

          {/* Status badge */}
          <StatusBadge status={displayStatus} />

          {/* ── INSTALL flow ────────────────────────────────────────────── */}
          {isNotSetup && installPhase === "idle" && (
            <button
              onClick={handleInstall}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 transition-all duration-150"
            >
              <Download className="w-3 h-3" />
              Install Project
            </button>
          )}
          {isNotSetup && installPhase === "installing" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Installing…
            </span>
          )}
          {isNotSetup && installPhase === "error" && (
            <button
              onClick={() => { setInstallPhase("idle"); setInstallError(null); }}
              title={installError ?? undefined}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium text-destructive border border-destructive/30 rounded-md hover:bg-destructive/10 active:scale-95 transition-all duration-150"
            >
              <RotateCcw className="w-3 h-3" />
              Retry
            </button>
          )}

          {/* ── RUN flow ────────────────────────────────────────────────── */}
          {!isNotSetup && runPhase === "stopped" && (
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-emerald-600 text-white rounded-md hover:bg-emerald-500 active:scale-95 transition-all duration-150"
            >
              <Play className="w-3 h-3 fill-current" />
              Start
            </button>
          )}
          {!isNotSetup && runPhase === "starting" && (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="w-3 h-3 animate-spin" />
              Starting…
            </span>
          )}
          {!isNotSetup && runPhase === "running" && (
            <button
              onClick={handleStop}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-red-600/90 text-white rounded-md hover:bg-red-500 active:scale-95 transition-all duration-150"
            >
              <Square className="w-3 h-3 fill-current" />
              Stop
            </button>
          )}
          {!isNotSetup && runPhase === "error" && (
            <button
              onClick={handleStart}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium text-amber-600 border border-amber-600/30 rounded-md hover:bg-amber-600/10 active:scale-95 transition-all duration-150"
            >
              <RotateCcw className="w-3 h-3" />
              Restart
            </button>
          )}

          {viewMode === "console" ? (
            <button
              onClick={() => onViewModeChange("settings")}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-secondary border border-border rounded-md text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
            >
              <Settings2 className="w-3 h-3" />
              Project Settings
            </button>
          ) : (
            <button
              onClick={() => onViewModeChange("console")}
              className="inline-flex items-center gap-1.5 h-7 px-3 text-xs font-medium bg-secondary border border-border rounded-md text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Project
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
          className={`h-full min-h-0 relative overflow-hidden ${viewMode === "console" ? "block" : "hidden"}`}
          style={{ backgroundColor: TERM_THEME.background }}
        >
          <div
            ref={termContainerRef}
            className="absolute inset-0"
            style={{ padding: "10px 12px" }}
          />
        </div>

        {viewMode === "settings" && (
          <div className="h-full min-h-0 overflow-y-auto bg-background">
            <div className="max-w-3xl mx-auto px-8 py-8">
              <div className="mb-7">
                <h2 className="text-lg font-semibold text-foreground">Project Settings</h2>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Runtime and Docker options for {project.name}.
                </p>
              </div>

              {project.useDocker && (
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70">
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
                    {dockerError && <p className="text-amber-500">Last Docker error: {dockerError}</p>}
                  </div>
                </section>
              )}

              <div className="space-y-6">
                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Runtime
                    </p>
                  </div>
                  <div className="px-5 py-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Runtime version</span>
                      <select
                        value={runtimeVersion}
                        onChange={(e) => setRuntimeVersion(e.target.value)}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option>Node 20 LTS</option>
                        <option>Node 22 Current</option>
                        <option>Bun latest</option>
                      </select>
                    </label>
                    <label className="space-y-1.5">
                      <span className="text-xs text-muted-foreground">Package manager</span>
                      <select
                        value={packageManager}
                        onChange={(e) => setPackageManager(e.target.value)}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <option>npm</option>
                        <option>pnpm</option>
                        <option>yarn</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="bg-card border border-border rounded-lg overflow-hidden">
                  <div className="px-5 py-3 border-b border-border/70">
                    <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground/60">
                      Dev Server
                    </p>
                  </div>
                  <div className="px-5 py-4 space-y-4">
                    <label className="space-y-1.5 block">
                      <span className="text-xs text-muted-foreground">Startup command</span>
                      <input
                        value={startupCommand}
                        onChange={(e) => setStartupCommand(e.target.value)}
                        className="w-full h-9 px-3 text-sm bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring"
                        placeholder="npm run dev"
                      />
                    </label>
                    <div className="flex flex-wrap gap-5">
                      <label className="inline-flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={autoInstallDeps}
                          onChange={(e) => setAutoInstallDeps(e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-secondary accent-primary"
                        />
                        Auto-install dependencies on first run
                      </label>
                      <label className="inline-flex items-center gap-2 text-sm text-foreground">
                        <input
                          type="checkbox"
                          checked={enableStrictPorts}
                          onChange={(e) => setEnableStrictPorts(e.target.checked)}
                          className="h-4 w-4 rounded border-border bg-secondary accent-primary"
                        />
                        Enforce strict port usage
                      </label>
                    </div>
                  </div>
                </section>

                <div className="flex justify-end">
                  <button
                    onClick={() => onViewModeChange("console")}
                    className="inline-flex items-center gap-1.5 h-9 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 transition-all duration-150"
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
