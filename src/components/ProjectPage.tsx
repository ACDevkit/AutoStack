import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import {
  AlertCircle, Download, FolderOpen,
  Loader2, Play, RotateCcw, Square,
} from "lucide-react";
import type { Project, ProjectStatus } from "@/types";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
import { installProject, type InstallOutput } from "@/lib/installer";
import { processManager, type RunPhase } from "@/lib/processManager";

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
}

export default function ProjectPage({ project, isActive }: ProjectPageProps) {
  const termContainerRef = useRef<HTMLDivElement>(null);
  const termRef          = useRef<Terminal | null>(null);
  const fitRef           = useRef<FitAddon | null>(null);

  const updateProject          = useProjectStore((s) => s.updateProject);
  const defaultProjectLocation = useSettingsStore((s) => s.defaultProjectLocation);

  // ── Install state ────────────────────────────────────────────────────────────
  const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
  const [installError, setInstallError] = useState<string | null>(null);

  // ── Run state — initialised from the global processManager ───────────────────
  const [runPhase, setRunPhase] = useState<RunPhase>(
    () => processManager.getPhase(project.id),
  );

  // ── Subscribe to phase changes from the global processManager ────────────────
  // When the process exits naturally (crash or normal exit) while the tab is
  // closed, the manager fires this listener so the badge / buttons update as
  // soon as the tab is re-opened.
  useEffect(() => {
    // Sync the initial phase on every mount (covers re-opens where the process
    // changed state while the tab was hidden / unmounted).
    setRunPhase(processManager.getPhase(project.id));

    const unsub = processManager.subscribePhase(project.id, (phase) => {
      setRunPhase(phase);
      // Write the shell prompt after the process finishes
      if (phase === "stopped" || phase === "error") {
        termRef.current?.writeln("");
        termRef.current?.write("\x1b[38;5;63m❯\x1b[0m ");
      }
    });

    return unsub;
  }, [project.id]);

  // ── Terminal init (per project id) ───────────────────────────────────────────
  // Each time the component mounts (or project.id changes) we create a fresh
  // xterm instance.  If there is buffered output from a previous run the
  // buffer is replayed so the user can see historical process output.
  useEffect(() => {
    if (!termContainerRef.current) return;

    const term = new Terminal({
      cursorBlink:       true,
      cursorStyle:       "block",
      fontFamily:        '"Cascadia Code", "Cascadia Mono", "Fira Code", "JetBrains Mono", Menlo, Consolas, monospace',
      fontSize:          13,
      lineHeight:        1.5,
      letterSpacing:     0,
      scrollback:        10000,
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

    // Helper that writes a single buffered / streamed line into this terminal
    function writeLine(line: string, kind: string) {
      switch (kind) {
        case "info":    term.writeln(`\x1b[38;5;245m${line}\x1b[0m`); break;
        case "err":     term.writeln(`\x1b[33m${line}\x1b[0m`);       break;
        case "success": term.writeln(`\x1b[32m${line}\x1b[0m`);       break;
        default:        term.writeln(line);
      }
    }

    // Welcome banner
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
    } else {
      term.writeln(
        `\x1b[38;5;245m  Path       \x1b[0m\x1b[33mnot set — click \x1b[1mInstall Project\x1b[0m\x1b[33m above to scaffold\x1b[0m`,
      );
    }
    term.writeln("");

    // Replay historical output if the process was already run before this
    // component mounted (e.g. the user closed and re-opened the tab).
    const buffer       = processManager.getOutputBuffer(project.id);
    const currentPhase = processManager.getPhase(project.id);

    if (buffer.length > 0) {
      term.writeln("\x1b[38;5;63m  ── Reconnected ─────────────────────────────────\x1b[0m");
      term.writeln("");
      for (const item of buffer) {
        writeLine(item.line, item.kind);
      }
      // Show the prompt only when the process is not still running
      if (currentPhase !== "running" && currentPhase !== "starting") {
        term.writeln("");
        term.write("\x1b[38;5;63m❯\x1b[0m ");
      }
    } else {
      // Fresh session — show the standard hint and shell prompt
      if (project.path) {
        term.writeln("\x1b[38;5;245m  Click \x1b[1mStart\x1b[0m\x1b[38;5;245m above to run the dev server.\x1b[0m");
      } else {
        term.writeln("\x1b[38;5;245m  Shell integration coming soon.\x1b[0m");
      }
      term.writeln("");
      term.write("\x1b[38;5;63m❯\x1b[0m ");
    }

    // Basic line editing (while no real shell is connected)
    let line = "";
    term.onData((data) => {
      switch (data) {
        case "\r": {
          term.writeln("");
          if (line.trim()) {
            term.writeln(
              `\x1b[38;5;245m  (shell not connected — \x1b[0m\x1b[97m${line.trim()}\x1b[38;5;245m)\x1b[0m`,
            );
            term.writeln("");
          }
          line = "";
          term.write("\x1b[38;5;63m❯\x1b[0m ");
          break;
        }
        case "\u007F": {
          if (line.length > 0) { line = line.slice(0, -1); term.write("\b \b"); }
          break;
        }
        case "\u0003": {
          term.writeln("^C"); line = ""; term.write("\x1b[38;5;63m❯\x1b[0m ");
          break;
        }
        default: {
          if (data >= " " || data === "\t") { line += data; term.write(data); }
        }
      }
    });

    // Subscribe to live output from the global processManager.
    // This listener is removed when the terminal is destroyed (on unmount),
    // but the processManager continues buffering output so it can be replayed.
    const unsubOutput = processManager.subscribeOutput(project.id, (output) => {
      writeLine(output.line, output.kind);
    });

    const ro = new ResizeObserver(() => { try { fit.fit(); } catch { /* noop */ } });
    ro.observe(termContainerRef.current!);

    return () => {
      unsubOutput();
      ro.disconnect();
      term.dispose();
      termRef.current = null;
      fitRef.current  = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project.id]);

  // Re-fit when tab becomes visible
  useEffect(() => {
    if (isActive && fitRef.current) {
      requestAnimationFrame(() => { try { fitRef.current?.fit(); } catch { /* noop */ } });
    }
  }, [isActive]);

  // ── Terminal write helpers ───────────────────────────────────────────────────

  function writeToTerm(line: string, kind: string) {
    const term = termRef.current;
    if (!term) return;
    switch (kind) {
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
      setInstallPhase("idle");
      termRef.current?.writeln("");
      termRef.current?.write("\x1b[38;5;63m❯\x1b[0m ");
    } catch (err) {
      const msg = String(err);
      setInstallError(msg);
      setInstallPhase("error");
      writeToTerm("", "info");
      writeToTerm(`  ✗ Installation failed`, "err");
      writeToTerm(`  ${msg}`, "info");
      termRef.current?.writeln("");
      termRef.current?.write("\x1b[38;5;63m❯\x1b[0m ");
    }
  }

  // ── Start handler ────────────────────────────────────────────────────────────

  async function handleStart() {
    // Use processManager.getPhase (synchronous) to avoid double-click races
    // where React state might not have updated yet.
    const current = processManager.getPhase(project.id);
    if (current === "starting" || current === "running") return;

    const fw = getFrameworkById(project.templateId);
    termBanner(`Starting ${fw?.name ?? project.templateId}`);

    try {
      await processManager.start(project.id, project.templateId, project.path);
      // runPhase is updated via the subscribePhase subscription above
    } catch (err) {
      writeToTerm("", "info");
      writeToTerm(`  ✗ Failed to start: ${String(err)}`, "err");
      termRef.current?.writeln("");
      termRef.current?.write("\x1b[38;5;63m❯\x1b[0m ");
    }
  }

  // ── Stop handler ─────────────────────────────────────────────────────────────

  async function handleStop() {
    const current = processManager.getPhase(project.id);
    if (current !== "running" && current !== "starting") return;

    try {
      await processManager.stop(project.id);
      // runPhase and terminal output updated via subscriptions
    } catch {
      // ignore — processManager already handles errors internally
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────

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

          {/* Status badge — reflects global run state */}
          <StatusBadge status={displayStatus} />

          {/* ── INSTALL flow (project has no path yet) ─────────────────── */}
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

          {/* ── RUN flow (project is set up) ───────────────────────────── */}
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
        </div>

        {/* Divider */}
        <div className="w-px h-5 bg-border/60 shrink-0" />

        {/* Path */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0 max-w-xs shrink-0">
          <FolderOpen className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate" title={project.path || "No path set"}>
            {project.path || "No path set"}
          </span>
        </div>
      </div>

      {/* ── Terminal ────────────────────────────────────────────────────── */}
      <div
        className="flex-1 min-h-0 relative overflow-hidden"
        style={{ backgroundColor: TERM_THEME.background }}
      >
        <div
          ref={termContainerRef}
          className="absolute inset-0"
          style={{ padding: "10px 12px" }}
        />
      </div>
    </div>
  );
}
