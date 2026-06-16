import { useState, useEffect, useRef } from "react";
import { Search, Plus, Layers2, LayoutGrid, Rows3 } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import { useRunPhases, deriveProjectStatus } from "@/lib/status";
import TopNav from "@/components/TopNav";
import ProjectCard from "@/components/ProjectCard";
import CreateProjectModal from "@/components/CreateProjectModal";
import SettingsPage from "@/components/SettingsPage";
import ProjectPage from "@/components/ProjectPage";
import EmptyState from "@/components/EmptyState";
import { cn } from "@/lib/utils";

export type TabId = string;
export type ProjectTabView = "console" | "settings";
type StatusFilter = "all" | "online" | "offline" | "not-setup";

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "online", label: "Online" },
  { value: "offline", label: "Offline" },
  { value: "not-setup", label: "Setup" },
];

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const projects = useProjectStore((s) => s.projects);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [createInitialFramework, setCreateInitialFramework] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openProjectTabIds, setOpenProjectTabIds] = useState<string[]>([]);
  const [projectTabViews, setProjectTabViews] = useState<Record<string, ProjectTabView>>({});

  // Dashboard view preferences
  const [dashboardView, setDashboardView] = useState<"grid" | "list">("grid");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dashScrolled, setDashScrolled] = useState(false);

  function openCreateModal(framework?: string) {
    setCreateInitialFramework(framework);
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setIsCreateModalOpen(false);
    setCreateInitialFramework(undefined);
  }

  // Keep activeTab ref in sync for use inside effects without re-triggering them
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  // Auto-close tabs when their project is removed
  useEffect(() => {
    const ids = new Set(projects.map((p) => p.id));
    setOpenProjectTabIds((prev) => {
      const next = prev.filter((id) => ids.has(id));
      return next.length !== prev.length ? next : prev;
    });
    setProjectTabViews((prev) => {
      const nextEntries = Object.entries(prev).filter(([id]) => ids.has(id));
      if (nextEntries.length === Object.keys(prev).length) return prev;
      return Object.fromEntries(nextEntries);
    });
    if (
      activeTabRef.current.startsWith("project-") &&
      !ids.has(activeTabRef.current.slice("project-".length))
    ) {
      setActiveTab("dashboard");
    }
  // Projects list identity change is the only trigger we need
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects]);

  // ── Tab helpers ──────────────────────────────────────────────────────────────

  function openProjectTab(projectId: string, initialView: ProjectTabView = "console") {
    setOpenProjectTabIds((prev) =>
      prev.includes(projectId) ? prev : [...prev, projectId],
    );
    setProjectTabViews((prev) => ({ ...prev, [projectId]: initialView }));
    setActiveTab(`project-${projectId}`);
  }

  function closeProjectTab(projectId: string) {
    setOpenProjectTabIds((prev) => prev.filter((id) => id !== projectId));
    setProjectTabViews((prev) => {
      if (!(projectId in prev)) return prev;
      const next = { ...prev };
      delete next[projectId];
      return next;
    });
    setActiveTab((prev) =>
      prev === `project-${projectId}` ? "dashboard" : prev,
    );
  }

  function openProjectSettingsTab(projectId: string) {
    openProjectTab(projectId, "settings");
  }

  function setProjectTabView(projectId: string, view: ProjectTabView) {
    setProjectTabViews((prev) => ({ ...prev, [projectId]: view }));
  }

  function openSettings() {
    setSettingsOpen(true);
    setActiveTab("settings");
  }

  function closeSettings() {
    setSettingsOpen(false);
    setActiveTab((prev) => (prev === "settings" ? "dashboard" : prev));
  }

  function handleTabChange(tab: TabId) {
    if (tab === "settings" && !settingsOpen) setSettingsOpen(true);
    setActiveTab(tab);
  }

  // ── Derived state ────────────────────────────────────────────────────────────

  const isDashboard = activeTab === "dashboard";
  const isSettings  = activeTab === "settings";

  // Live run phases for the dashboard stat chips + status filter
  const runPhases   = useRunPhases(projects.map((p) => p.id));
  const onlineCount = projects.filter((p) => runPhases[p.id] === "running").length;
  const setupCount  = projects.filter((p) => !p.path || p.path.trim() === "").length;

  function matchesStatusFilter(p: (typeof projects)[number]): boolean {
    if (statusFilter === "all") return true;
    const status = deriveProjectStatus(p, runPhases[p.id] ?? "stopped");
    if (statusFilter === "online")    return status === "online";
    if (statusFilter === "not-setup") return status === "not-setup";
    // "offline" groups installed-but-not-running, including crashed (error)
    return status === "offline" || status === "error";
  }

  const filteredProjects = projects.filter((p) => {
    const q = search.toLowerCase();
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      p.path.toLowerCase().includes(q);
    return matchesSearch && matchesStatusFilter(p);
  });

  const hasProjects = projects.length > 0;
  const hasResults  = filteredProjects.length > 0;
  const isFiltering = search.trim() !== "" || statusFilter !== "all";

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <TopNav
        onNewProject={() => openCreateModal()}
        searchValue={search}
        onSearchChange={setSearch}
        activeTab={activeTab}
        settingsOpen={settingsOpen}
        onTabChange={handleTabChange}
        onOpenSettings={openSettings}
        onCloseSettings={closeSettings}
        openProjectTabIds={openProjectTabIds}
        onProjectTabClose={closeProjectTab}
      />

      <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* ── Settings page (kept mounted while open) ──────────────────── */}
        {settingsOpen && (
          <div className={isSettings ? "flex flex-col flex-1 min-h-0 animate-tab-fade" : "hidden"}>
            <SettingsPage />
          </div>
        )}

        {/* ── Project pages (kept mounted to preserve terminal state) ───── */}
        {openProjectTabIds.map((projectId) => {
          const project = projects.find((p) => p.id === projectId);
          if (!project) return null;
          const active = activeTab === `project-${projectId}`;
          const viewMode = projectTabViews[projectId] ?? "console";
          return (
            <div
              key={projectId}
              className={active ? "flex flex-col flex-1 min-h-0 animate-tab-fade" : "hidden"}
            >
              <ProjectPage
                project={project}
                isActive={active}
                viewMode={viewMode}
                onViewModeChange={(view) => setProjectTabView(projectId, view)}
              />
            </div>
          );
        })}

        {/* ── Dashboard ────────────────────────────────────────────────── */}
        <div
          className={isDashboard ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}
          onScroll={(e) => {
            const scrolled = e.currentTarget.scrollTop > 4;
            setDashScrolled((prev) => (prev === scrolled ? prev : scrolled));
          }}
        >
          {!hasProjects && !isFiltering ? (
            /* First-run empty state */
            <div className="h-full animate-card-enter">
              <EmptyState onCreateProject={openCreateModal} />
            </div>
          ) : (
            <div className="max-w-[1600px] mx-auto animate-tab-fade">
              {/* Sticky page header */}
              <div
                className={cn(
                  "sticky top-0 z-20 px-8 pt-8 pb-4 border-b transition-[background-color,border-color] duration-200",
                  dashScrolled
                    ? "bg-background/80 backdrop-blur-md border-border"
                    : "border-transparent",
                )}
              >
                <div className="flex items-end justify-between gap-4 flex-wrap">
                  {/* Title block */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-primary-soft ring-1 ring-primary/20 flex items-center justify-center shrink-0">
                      <Layers2 className="w-4.5 h-4.5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <h1 className="text-xl font-semibold text-foreground/90 tracking-tight leading-tight">
                        Projects
                      </h1>
                      <p className="text-xs text-muted-foreground mt-0.5 tabular-nums">
                        {projects.length} project{projects.length !== 1 ? "s" : ""}
                        {isFiltering && ` · ${filteredProjects.length} shown`}
                      </p>
                    </div>
                  </div>

                  {/* Controls: stats + status filter + view toggle */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors duration-200",
                        onlineCount > 0
                          ? "bg-success-soft text-success"
                          : "bg-secondary/60 text-muted-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          onlineCount > 0 ? "bg-success animate-pulse" : "bg-muted-foreground/40",
                        )}
                      />
                      {onlineCount} online
                    </span>
                    {setupCount > 0 && (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-[11px] font-medium text-warning tabular-nums">
                        <span className="h-1.5 w-1.5 rounded-full bg-warning shrink-0" />
                        {setupCount} need{setupCount === 1 ? "s" : ""} setup
                      </span>
                    )}

                    <div className="w-px h-5 bg-border/60 mx-0.5" />

                    {/* Status filter segmented control */}
                    <div className="flex rounded-md border border-border overflow-hidden bg-secondary/40">
                      {STATUS_FILTERS.map((f, i) => {
                        const active = statusFilter === f.value;
                        return (
                          <button
                            key={f.value}
                            type="button"
                            onClick={() => setStatusFilter(f.value)}
                            aria-pressed={active}
                            className={cn(
                              "px-2.5 h-7 text-[11px] font-medium transition-colors duration-150",
                              i > 0 && "border-l border-border",
                              active
                                ? "bg-primary text-primary-foreground"
                                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                            )}
                          >
                            {f.label}
                          </button>
                        );
                      })}
                    </div>

                    {/* View toggle */}
                    <div className="flex rounded-md border border-border overflow-hidden bg-secondary/40">
                      <button
                        type="button"
                        onClick={() => setDashboardView("grid")}
                        aria-label="Grid view"
                        title="Grid view"
                        aria-pressed={dashboardView === "grid"}
                        className={cn(
                          "flex items-center justify-center w-7 h-7 transition-colors duration-150",
                          dashboardView === "grid"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                        )}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDashboardView("list")}
                        aria-label="List view"
                        title="List view"
                        aria-pressed={dashboardView === "list"}
                        className={cn(
                          "flex items-center justify-center w-7 h-7 border-l border-border transition-colors duration-150",
                          dashboardView === "list"
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                        )}
                      >
                        <Rows3 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="px-8 pb-8 pt-4">
                {hasResults || !isFiltering ? (
                  <div
                    className={cn(
                      dashboardView === "grid"
                        ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5"
                        : "flex flex-col gap-2.5",
                    )}
                  >
                    {filteredProjects.map((project, i) => (
                      <ProjectCard
                        key={project.id}
                        project={project}
                        index={i}
                        layout={dashboardView}
                        onOpen={() => openProjectTab(project.id)}
                        onOpenSettings={() => openProjectSettingsTab(project.id)}
                      />
                    ))}

                    {/* New project affordance — hidden while filtering */}
                    {!isFiltering && dashboardView === "grid" && (
                      <button
                        onClick={() => openCreateModal()}
                        aria-label="New project"
                        title="New project"
                        className="group flex flex-col items-center justify-center gap-2.5 p-4 min-h-[152px] bg-transparent border border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] rounded-xl transition-all duration-200 animate-card-enter"
                        style={{
                          animationDelay: `${Math.min(filteredProjects.length * 35, 385)}ms`,
                        }}
                      >
                        <div className="relative w-10 h-10 rounded-xl border border-dashed border-muted-foreground/30 group-hover:border-primary/50 group-hover:bg-primary-soft group-hover:scale-105 flex items-center justify-center transition-all duration-200">
                          <div className="absolute inset-0 rounded-xl bg-primary/20 blur-lg opacity-0 group-hover:opacity-60 transition-opacity duration-300 pointer-events-none" />
                          <Plus className="relative w-4.5 h-4.5 text-muted-foreground/50 group-hover:text-primary transition-colors duration-200" />
                        </div>
                        <span className="text-xs font-medium text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          New Project
                        </span>
                      </button>
                    )}

                    {!isFiltering && dashboardView === "list" && (
                      <button
                        onClick={() => openCreateModal()}
                        aria-label="New project"
                        title="New project"
                        className="group flex items-center justify-center gap-2 py-3 bg-transparent border border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] rounded-xl transition-all duration-200 animate-card-enter text-xs font-medium text-muted-foreground hover:text-primary"
                        style={{
                          animationDelay: `${Math.min(filteredProjects.length * 30, 300)}ms`,
                        }}
                      >
                        <Plus className="w-4 h-4" />
                        New Project
                      </button>
                    )}
                  </div>
                ) : (
                  /* No results for the active search / filter */
                  <div className="flex flex-col items-center justify-center py-16 text-center animate-card-enter">
                    <div className="w-12 h-12 rounded-full bg-secondary/60 flex items-center justify-center mb-4">
                      <Search className="w-5 h-5 text-muted-foreground/40" />
                    </div>
                    <p className="text-sm font-medium text-foreground mb-1">
                      {search ? (
                        <>No results for "<span className="text-primary">{search}</span>"</>
                      ) : (
                        "No matching projects"
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Try a different name, path, or filter
                    </p>
                    <button
                      onClick={() => {
                        setSearch("");
                        setStatusFilter("all");
                      }}
                      className="h-7 px-3 text-xs font-medium rounded-md bg-secondary border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {isCreateModalOpen && (
        <CreateProjectModal
          onClose={closeCreateModal}
          initialFramework={createInitialFramework}
        />
      )}
    </div>
  );
}
