import { create } from "zustand";
import type { Project } from "@/types";
import { saveProjects } from "@/lib/persistence";

interface ProjectState {
  projects: Project[];
  activeProjectId: string | null;
  setProjects: (projects: Project[]) => void;
  addProject: (project: Project) => void;
  removeProject: (id: string) => void;
  updateProject: (id: string, patch: Partial<Omit<Project, "id" | "createdAt">>) => void;
  setActiveProject: (id: string | null) => void;
  hydrate: (projects: Project[]) => void;
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  activeProjectId: null,

  setProjects: (projects) => {
    set({ projects });
    saveProjects(projects);
  },

  addProject: (project) => {
    const projects = [...get().projects, project];
    set({ projects });
    saveProjects(projects);
  },

  removeProject: (id) => {
    const projects = get().projects.filter((p) => p.id !== id);
    set({ projects });
    saveProjects(projects);
  },

  updateProject: (id, patch) => {
    const projects = get().projects.map((p) =>
      p.id === id ? { ...p, ...patch, updatedAt: new Date().toISOString() } : p,
    );
    set({ projects });
    saveProjects(projects);
  },

  setActiveProject: (id) => set({ activeProjectId: id }),

  hydrate: (projects) => set({ projects }),
}));
