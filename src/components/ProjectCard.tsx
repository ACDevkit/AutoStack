import { useState, useRef, useEffect } from "react";
import { FolderOpen, ArrowRight, Settings, Trash2, AlertCircle, Download } from "lucide-react";
import type { Project, ProjectStatus } from "@/types";
import { useProjectStore } from "@/stores/projectStore";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
import { processManager, type RunPhase } from "@/lib/processManager";

// ─── Status helpers ────────────────────────────────────────────────────────────

function deriveStatus(project: Project, phase: RunPhase): ProjectStatus {
  if (!project.path || project.path.trim() === "") return "not-setup";
  if (phase === "running") return "online";
  if (phase === "error")   return "error";
  return "offline";
}

function StatusBadge({ status }: { status: ProjectStatus }) {
  if (status === "not-setup") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
        <AlertCircle className="w-3 h-3 shrink-0" />
        Setup required
      </span>
    );
  }

  if (status === "online") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
        </span>
        Online
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-red-600 dark:text-red-400">
        <span className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0" />
        Error
      </span>
    );
  }

  // offline
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
      Offline
    </span>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

interface ProjectCardProps {
  project: Project;
  onOpen?: () => void;
  onOpenSettings?: () => void;
}

export default function ProjectCard({ project, onOpen, onOpenSettings }: ProjectCardProps) {
  const removeProject = useProjectStore((s) => s.removeProject);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Subscribe to the global processManager so the card reflects the real-time
  // run state even when the project's tab is not currently open.
  const [runPhase, setRunPhase] = useState<RunPhase>(
    () => processManager.getPhase(project.id),
  );
  useEffect(() => {
    setRunPhase(processManager.getPhase(project.id));
    return processManager.subscribePhase(project.id, setRunPhase);
  }, [project.id]);

  const status = deriveStatus(project, runPhase);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  function handleSettingsClick(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    removeProject(project.id);
  }

  function handleOpenSettings(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen(false);
    onOpenSettings?.();
  }

  function handleCardClick(e: React.MouseEvent) {
    // Don't open if the menu or its descendants were clicked
    if (menuRef.current?.contains(e.target as Node)) return;
    onOpen?.();
  }

  return (
    <div
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      className="group relative flex flex-col p-4 bg-card border border-border rounded-lg hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5 transition-all duration-200 cursor-pointer"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-sm text-foreground truncate">{project.name}</h3>
        </div>

        {/* Settings button + dropdown */}
        <div ref={menuRef} className="relative shrink-0 ml-2">
          <button
            onClick={handleSettingsClick}
            title="Project settings"
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground hover:bg-secondary transition-all"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-30 w-36 bg-popover border border-border rounded-lg shadow-xl shadow-black/20 overflow-hidden py-1">
              <button
                onClick={handleOpenSettings}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-foreground/80 hover:text-foreground hover:bg-accent transition-colors"
              >
                <Settings className="w-3.5 h-3.5 text-muted-foreground" />
                Settings
              </button>
              <div className="mx-2 my-1 border-t border-border/50" />
              <button
                onClick={handleDelete}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{project.description}</p>
      )}

      {/* Path */}
      <div className="flex items-center gap-1.5 mb-3">
        <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="text-xs text-muted-foreground truncate">{project.path || "No path set"}</span>
      </div>

      {/* Framework badge */}
      {project.templateId && (() => {
        const fw = getFrameworkById(project.templateId);
        return fw ? (
          <div className="mb-3 flex items-center gap-1.5">
            <FrameworkIcon fw={fw} />
            <span className="text-xs font-medium" style={{ color: fw.color }}>
              {fw.name}
            </span>
          </div>
        ) : (
          <div className="mb-3">
            <span className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium bg-primary/10 text-primary border border-primary/20 rounded-sm tracking-wide uppercase">
              {project.templateId}
            </span>
          </div>
        );
      })()}

      {/* Footer */}
      <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
        {status === "not-setup" ? (
          <span className="inline-flex items-center gap-1.5 text-[10px] font-medium text-amber-500 dark:text-amber-400 group-hover:text-primary transition-colors">
            <Download className="w-3 h-3 shrink-0" />
            Install project
          </span>
        ) : (
          <StatusBadge status={status} />
        )}
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-150" />
      </div>
    </div>
  );
}
