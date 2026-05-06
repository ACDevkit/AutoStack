import { useState, useEffect, useRef } from "react";
import { Search, Plus } from "lucide-react";
import { useProjectStore } from "@/stores/projectStore";
import TopNav from "@/components/TopNav";
import ProjectCard from "@/components/ProjectCard";
import CreateProjectModal from "@/components/CreateProjectModal";
import SettingsPage from "@/components/SettingsPage";
import ProjectPage from "@/components/ProjectPage";

export type TabId = string;

// ─── Ghost card skeleton ───────────────────────────────────────────────────────

function GhostCard() {
  return (
    <div className="flex flex-col p-4 bg-card/40 border border-dashed border-border/50 rounded-lg h-[152px] animate-pulse">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 rounded-lg bg-secondary/60" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-2.5 bg-secondary/60 rounded w-2/3" />
          <div className="h-2 bg-secondary/40 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2 mt-auto">
        <div className="h-2 bg-secondary/40 rounded w-3/4" />
        <div className="h-2 bg-secondary/30 rounded w-1/2" />
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const projects = useProjectStore((s) => s.projects);

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("dashboard");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openProjectTabIds, setOpenProjectTabIds] = useState<string[]>([]);

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

  function openProjectTab(projectId: string) {
    setOpenProjectTabIds((prev) =>
      prev.includes(projectId) ? prev : [...prev, projectId],
    );
    setActiveTab(`project-${projectId}`);
  }

  function closeProjectTab(projectId: string) {
    setOpenProjectTabIds((prev) => prev.filter((id) => id !== projectId));
    setActiveTab((prev) =>
      prev === `project-${projectId}` ? "dashboard" : prev,
    );
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

  const filteredProjects = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.description ?? "").toLowerCase().includes(search.toLowerCase()) ||
      p.path.toLowerCase().includes(search.toLowerCase()),
  );

  const hasProjects = projects.length > 0;
  const hasResults  = filteredProjects.length > 0;
  const isDashboard = activeTab === "dashboard";
  const isSettings  = activeTab === "settings";

  return (
    <div className="flex flex-col h-screen bg-background text-foreground overflow-hidden">
      <TopNav
        onNewProject={() => setIsCreateModalOpen(true)}
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
          <div className={isSettings ? "flex flex-col flex-1 min-h-0" : "hidden"}>
            <SettingsPage />
          </div>
        )}

        {/* ── Project pages (kept mounted to preserve terminal state) ───── */}
        {openProjectTabIds.map((projectId) => {
          const project = projects.find((p) => p.id === projectId);
          if (!project) return null;
          const active = activeTab === `project-${projectId}`;
          return (
            <div
              key={projectId}
              className={active ? "flex flex-col flex-1 min-h-0" : "hidden"}
            >
              <ProjectPage project={project} isActive={active} />
            </div>
          );
        })}

        {/* ── Dashboard ────────────────────────────────────────────────── */}
        <div className={isDashboard ? "flex-1 min-h-0 overflow-y-auto" : "hidden"}>
          <div className="px-8 py-8">
            {/* Page header */}
            <div className="flex items-end justify-between mb-6">
              <h1 className="text-xl font-semibold text-foreground">Projects</h1>
              {search && (
                <span className="text-xs text-muted-foreground">
                  {filteredProjects.length} result
                  {filteredProjects.length !== 1 ? "s" : ""}
                </span>
              )}
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredProjects.map((project) => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  onOpen={() => openProjectTab(project.id)}
                />
              ))}

              {/* No search results */}
              {hasProjects && !hasResults && (
                <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
                  <Search className="w-8 h-8 text-muted-foreground/25 mb-3" />
                  <p className="text-sm font-medium text-foreground mb-1">
                    No results for "{search}"
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Try a different name or path
                  </p>
                </div>
              )}

              {/* New project card */}
              {!search && (
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  className="group flex flex-col items-center justify-center gap-2 p-4 h-[152px] bg-transparent border border-dashed border-border hover:border-primary/40 hover:bg-primary/[0.03] rounded-lg transition-all duration-200"
                >
                  <div className="w-8 h-8 rounded-md border border-dashed border-muted-foreground/30 group-hover:border-primary/50 flex items-center justify-center transition-colors">
                    <Plus className="w-4 h-4 text-muted-foreground/50 group-hover:text-primary transition-colors" />
                  </div>
                  <span className="text-xs font-medium text-muted-foreground/60 group-hover:text-muted-foreground transition-colors">
                    New Project
                  </span>
                </button>
              )}

              {/* Ghost cards when no projects yet */}
              {!hasProjects && !search && <GhostCard />}
              {!hasProjects && !search && <GhostCard />}
            </div>
          </div>
        </div>
      </main>

      {isCreateModalOpen && (
        <CreateProjectModal onClose={() => setIsCreateModalOpen(false)} />
      )}
    </div>
  );
}
