import { Search, Plus, Settings, X } from "lucide-react";
import logo from "@/assets/logo.png";
import { getCurrentWindow } from "@tauri-apps/api/window";
import WindowControls from "@/components/WindowControls";
import { useProjectStore } from "@/stores/projectStore";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
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
        className="flex items-stretch h-full flex-1 min-w-0 overflow-x-auto"
        style={{ scrollbarWidth: "none" }}
      >
        {/* Dashboard */}
        <button
          onClick={() => onTabChange("dashboard")}
          className={`px-4 h-full text-sm font-medium border-b-2 transition-colors shrink-0 ${
            activeTab === "dashboard"
              ? "text-primary border-primary"
              : "text-muted-foreground border-transparent hover:text-foreground"
          }`}
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
              className={`flex items-center border-b-2 shrink-0 transition-colors ${
                isActive ? "border-primary" : "border-transparent"
              }`}
            >
              <button
                onClick={() => onTabChange(tabId)}
                title={project.name}
                className={`flex items-center gap-1.5 pl-3 pr-1 h-full text-sm font-medium transition-colors ${
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {fw && (
                  <span className="shrink-0 opacity-70">
                    <FrameworkIcon fw={fw} size={12} />
                  </span>
                )}
                <span
                  className="max-w-[120px] truncate"
                  style={{ display: "block" }}
                >
                  {project.name}
                </span>
              </button>
              <button
                onClick={() => onProjectTabClose(projectId)}
                title="Close tab"
                className="w-5 h-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.07] transition-colors mx-1.5"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          );
        })}

        {/* Settings tab — shown while settings is open */}
        {settingsOpen && (
          <div
            className={`flex items-center border-b-2 shrink-0 transition-colors ${
              activeTab === "settings" ? "border-primary" : "border-transparent"
            }`}
          >
            <button
              onClick={() => onTabChange("settings")}
              className={`pl-4 pr-1.5 h-full text-sm font-medium transition-colors ${
                activeTab === "settings"
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Settings
            </button>
            <button
              onClick={onCloseSettings}
              title="Close Settings"
              className="w-5 h-5 flex items-center justify-center rounded-sm text-muted-foreground/50 hover:text-foreground hover:bg-foreground/[0.07] transition-colors mr-2"
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
          className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors ${
            activeTab === "settings"
              ? "text-foreground bg-secondary"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary"
          }`}
        >
          <Settings className="w-4 h-4" />
        </button>

        {/* Search — dashboard only */}
        {onDashboard && (
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              placeholder="Search projects..."
              value={searchValue}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 pr-3 text-sm bg-secondary/60 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring w-44 transition-colors select-text cursor-text"
            />
          </div>
        )}

        {/* New Project — dashboard only */}
        {onDashboard && (
          <button
            onClick={onNewProject}
            aria-label="New project"
            title="New project"
            className="inline-flex items-center justify-center w-8 h-8 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 transition-all"
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
