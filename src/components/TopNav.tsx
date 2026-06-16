import { useLayoutEffect, useRef, useState } from "react";
import { Search, Plus, Settings, X } from "lucide-react";
import logo from "@/assets/logo.png";
import { getCurrentWindow } from "@tauri-apps/api/window";
import WindowControls from "@/components/WindowControls";
import { useProjectStore } from "@/stores/projectStore";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
import { useRunPhase } from "@/lib/status";
import { cn } from "@/lib/utils";
import type { TabId } from "@/App";

interface TopNavProps {
  onNewProject: () => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  activeTab: TabId;
  settingsOpen: boolean;
  onTabChange: (tab: TabId) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  openProjectTabIds: string[];
  onProjectTabClose: (projectId: string) => void;
}

const INTERACTIVE =
  'button, input, a, select, textarea, [role="button"], [role="menuitem"]';

function handleDragStart(e: React.MouseEvent<HTMLElement>) {
  if (e.button !== 0) return;
  const target = e.target as HTMLElement;
  if (!target.closest(INTERACTIVE)) {
    getCurrentWindow().startDragging().catch(() => {});
  }
}

/** Live run-state dot for a project tab — green pulse while running, red on error. */
function TabStatusDot({ projectId }: { projectId: string }) {
  const phase = useRunPhase(projectId);
  if (phase === "running") {
    return (
      <span className="relative flex h-1.5 w-1.5 shrink-0">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
      </span>
    );
  }
  if (phase === "error") {
    return <span className="h-1.5 w-1.5 rounded-full bg-danger shrink-0" />;
  }
  return null;
}

export default function TopNav({
  onNewProject,
  searchValue,
  onSearchChange,
  activeTab,
  settingsOpen,
  onTabChange,
  onOpenSettings,
  onCloseSettings,
  openProjectTabIds,
  onProjectTabClose,
}: TopNavProps) {
  const projects  = useProjectStore((s) => s.projects);
  const onDashboard = activeTab === "dashboard";

  // ── Sliding active-tab indicator ─────────────────────────────────────────
  const navRef = useRef<HTMLElement>(null);
  const [indicator, setIndicator] = useState({ left: 0, width: 0, visible: false });

  useLayoutEffect(() => {
    function measure() {
      const nav = navRef.current;
      if (!nav) return;
      const el = nav.querySelector<HTMLElement>(
        `[data-tab-id="${CSS.escape(activeTab)}"]`,
      );
      if (!el) {
        setIndicator((prev) => ({ ...prev, visible: false }));
        return;
      }
      setIndicator({ left: el.offsetLeft, width: el.offsetWidth, visible: true });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeTab, openProjectTabIds, settingsOpen, projects]);

  return (
    <header
      onMouseDown={handleDragStart}
      className="flex items-center h-12 px-4 border-b border-border bg-sidebar shrink-0 gap-3 select-none cursor-default"
    >
      {/* Logo */}
      <div className="flex items-center shrink-0 pointer-events-none">
        <img
          src={logo}
          alt="AutoStack"
          className="h-7 w-auto object-contain"
          draggable={false}
        />
      </div>

      {/* Tabs — scrollable so many open projects don't break the layout */}
      <nav
        ref={navRef}
        className="relative flex items-stretch h-full flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Sliding active indicator */}
        <span
          aria-hidden
          className="tab-indicator absolute bottom-0 h-[2px] bg-primary rounded-full pointer-events-none transition-[left,width,opacity] duration-200"
          style={{
            left: indicator.left,
            width: indicator.width,
            opacity: indicator.visible ? 1 : 0,
            transitionTimingFunction: "var(--ease-out-expo)",
          }}
        />

        {/* Dashboard */}
        <button
          data-tab-id="dashboard"
          onClick={() => onTabChange("dashboard")}
          className={cn(
            "px-4 h-full text-sm font-medium transition-colors shrink-0 hover:bg-foreground/[0.03]",
            activeTab === "dashboard"
              ? "text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          Dashboard
        </button>

        {/* Open project tabs */}
        {openProjectTabIds.map((projectId) => {
          const project = projects.find((p) => p.id === projectId);
          if (!project) return null;

          const tabId   = `project-${projectId}`;
          const isActive = activeTab === tabId;
          const fw      = getFrameworkById(project.templateId);

          return (
            <div
              key={projectId}
              data-tab-id={tabId}
              className="flex items-center shrink-0 animate-in fade-in slide-in-from-bottom-1 duration-200 hover:bg-foreground/[0.03] transition-colors"
            >
              <button
                onClick={() => onTabChange(tabId)}
                title={project.name}
                className={cn(
                  "flex items-center gap-1.5 pl-3 pr-1 h-full text-sm font-medium transition-colors",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {fw && (
                  <span className="shrink-0 opacity-70">
                    <FrameworkIcon fw={fw} size={12} />
                  </span>
                )}
                <span className="max-w-[120px] truncate" style={{ display: "block" }}>
                  {project.name}
                </span>
                <TabStatusDot projectId={projectId} />
              </button>
              <button
                onClick={() => onProjectTabClose(projectId)}
                title="Close tab"
                className="w-5 h-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-danger hover:bg-danger-soft transition-colors mx-1.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Settings tab — shown while settings is open */}
        {settingsOpen && (
          <div
            data-tab-id="settings"
            className="flex items-center shrink-0 animate-in fade-in slide-in-from-bottom-1 duration-200 hover:bg-foreground/[0.03] transition-colors"
          >
            <button
              onClick={() => onTabChange("settings")}
              className={cn(
                "pl-4 pr-1.5 h-full text-sm font-medium transition-colors",
                activeTab === "settings"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Settings
            </button>
            <button
              onClick={onCloseSettings}
              title="Close Settings"
              className="w-5 h-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-danger hover:bg-danger-soft transition-colors mr-2"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        )}
      </nav>

      {/* Right section */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Settings icon */}
        <button
          onClick={onOpenSettings}
          title="Settings"
          className={cn(
            "w-8 h-8 flex items-center justify-center rounded-md transition-colors",
            activeTab === "settings"
              ? "text-foreground bg-secondary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary",
          )}
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Search — dashboard only */}
        {onDashboard && (
          <div className="relative group/search">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground group-focus-within/search:text-primary transition-colors duration-200 pointer-events-none" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 pr-3 text-sm bg-secondary/60 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring w-44 focus:w-56 transition-all duration-200 select-text cursor-text"
            />
          </div>
        )}

        {/* New Project — dashboard only */}
        {onDashboard && (
          <button
            onClick={onNewProject}
            aria-label="New project"
            title="New project"
            className="inline-flex items-center justify-center w-8 h-8 bg-primary text-primary-foreground rounded-md hover:bg-primary-emphasis active:scale-95 transition-all"
            style={{
              boxShadow:
                "0 2px 10px -2px color-mix(in oklch, var(--primary) 40%, transparent)",
            }}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Separator */}
        <div className="w-px h-5 bg-border/60 ml-1" />

        <WindowControls />
      </div>
    </header>
  );
}
