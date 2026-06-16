import { useState, useRef, useEffect } from "react";
import { FolderOpen, ArrowRight, Settings, Trash2, Download } from "lucide-react";
import type { Project } from "@/types";
import { useProjectStore } from "@/stores/projectStore";
import { getFrameworkById } from "@/lib/frameworks";
import { deriveProjectStatus, useRunPhase } from "@/lib/status";
import StatusBadge from "@/components/ui/status-badge";
import FrameworkAvatar from "@/components/ui/framework-avatar";
import { cn } from "@/lib/utils";

interface ProjectCardProps {
  project: Project;
  onOpen?: () => void;
  onOpenSettings?: () => void;
  /** Position in the grid — drives the staggered entrance animation. */
  index?: number;
  /** Visual density: full grid card or a compact horizontal row. */
  layout?: "grid" | "list";
}

export default function ProjectCard({
  project,
  onOpen,
  onOpenSettings,
  index = 0,
  layout = "grid",
}: ProjectCardProps) {
  const removeProject = useProjectStore((s) => s.removeProject);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Live run state from the global processManager, even when the tab is closed.
  const runPhase = useRunPhase(project.id);
  const status = deriveProjectStatus(project, runPhase);
  const fw = getFrameworkById(project.templateId);

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  // Reset the two-step delete confirmation whenever the menu closes.
  useEffect(() => {
    if (!menuOpen) setConfirmDelete(false);
  }, [menuOpen]);

  function handleMenuClick(e: React.MouseEvent) {
    e.stopPropagation();
    setMenuOpen((v) => !v);
  }

  function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
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

  const cardClassName = cn(
    "group relative cursor-pointer",
    "surface-card surface-card-interactive animate-card-enter glow-primary",
    layout === "list"
      ? "flex items-center gap-3 px-3 py-2.5 rounded-xl"
      : "flex flex-col p-4 rounded-xl",
  );

  const cardStyle = {
    animationDelay: `${Math.min(index * (layout === "list" ? 30 : 35), layout === "list" ? 300 : 350)}ms`,
  };

  const menu = (
    <div ref={menuRef} className="relative shrink-0">
      <button
        onClick={handleMenuClick}
        title="Project settings"
        className={cn(
          "w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-all",
          layout === "grid" && "opacity-0 group-hover:opacity-100",
        )}
      >
        <Settings className="w-3.5 h-3.5" />
      </button>

      {menuOpen && (
        <div
          className="absolute right-0 top-full mt-1 z-30 w-40 bg-popover border border-border rounded-lg overflow-hidden py-1 origin-top-right animate-in fade-in zoom-in-95 duration-150"
          style={{ boxShadow: "var(--shadow-popover)" }}
        >
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
            className={cn(
              "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
              confirmDelete
                ? "text-danger bg-danger-soft font-medium"
                : "text-destructive hover:bg-danger-soft",
            )}
          >
            <Trash2 className="w-3.5 h-3.5" />
            {confirmDelete ? "Confirm delete?" : "Delete"}
          </button>
        </div>
      )}
    </div>
  );

  const footerStatus =
    status === "not-setup" ? (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning group-hover:bg-primary-soft group-hover:text-primary transition-colors duration-200">
        <Download className="w-3 h-3 shrink-0" />
        Install project
      </span>
    ) : (
      <StatusBadge status={status} />
    );

  // ── List layout — compact horizontal row ─────────────────────────────────────
  if (layout === "list") {
    return (
      <div
        onClick={handleCardClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
        className={cardClassName}
        style={cardStyle}
      >
        <FrameworkAvatar
          templateId={project.templateId}
          size="sm"
          className="group-hover:scale-[1.05]"
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <h3 className="font-semibold text-sm text-foreground truncate leading-tight">
              {project.name}
            </h3>
            {fw && (
              <span
                className="text-[11px] font-medium truncate shrink-0 hidden sm:inline"
                style={{ color: fw.color }}
              >
                {fw.name}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
            <FolderOpen className="w-3 h-3 text-muted-foreground/70 shrink-0" />
            <span className="font-mono text-[11px] text-muted-foreground truncate">
              {project.path || "No path set"}
            </span>
          </div>
        </div>

        <div className="shrink-0">{footerStatus}</div>
        {menu}
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-150 shrink-0" />
      </div>
    );
  }

  // ── Grid layout (default) ─────────────────────────────────────────────────────
  return (
    <div
      onClick={handleCardClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && onOpen?.()}
      className={cardClassName}
      style={cardStyle}
    >
      {/* Header row: framework avatar + identity + menu */}
      <div className="flex items-start gap-3 mb-3">
        <FrameworkAvatar
          templateId={project.templateId}
          className="group-hover:scale-[1.05]"
        />

        <div className="flex-1 min-w-0 pt-0.5">
          <h3 className="font-semibold text-sm text-foreground truncate leading-tight">
            {project.name}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 min-w-0">
            {fw ? (
              <>
                <span
                  className="text-[11px] font-medium truncate"
                  style={{ color: fw.color }}
                >
                  {fw.name}
                </span>
                <span className="text-muted-foreground/30 text-[10px] select-none">
                  ·
                </span>
                <span className="text-[11px] text-muted-foreground/60 truncate">
                  {fw.category}
                </span>
              </>
            ) : (
              <span className="text-[11px] text-muted-foreground/60 truncate">
                {project.templateId || "No framework"}
              </span>
            )}
          </div>
        </div>

        {menu}
      </div>

      {/* Description */}
      {project.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
          {project.description}
        </p>
      )}

      {/* Path */}
      <div className="flex items-center gap-1.5 mb-3 min-w-0">
        <FolderOpen className="w-3 h-3 text-muted-foreground shrink-0" />
        <span className="font-mono text-[11px] text-muted-foreground truncate">
          {project.path || "No path set"}
        </span>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-3 border-t border-border flex items-center justify-between">
        {footerStatus}
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all duration-150" />
      </div>
    </div>
  );
}
