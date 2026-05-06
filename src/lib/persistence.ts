import { load, type Store } from "@tauri-apps/plugin-store";
import type { Project } from "@/types";
import type { AppLanguage, AppTheme } from "@/stores/settingsStore";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersistedSettings {
  language: AppLanguage;
  autoLaunch: boolean;
  defaultProjectLocation: string;
  theme: AppTheme;
}

// ─── Store singletons ─────────────────────────────────────────────────────────

let _settingsStore: Store | null = null;
let _projectsStore: Store | null = null;

async function getSettingsStore(): Promise<Store> {
  if (!_settingsStore) {
    _settingsStore = await load("settings.json");
  }
  return _settingsStore;
}

async function getProjectsStore(): Promise<Store> {
  if (!_projectsStore) {
    _projectsStore = await load("projects.json");
  }
  return _projectsStore;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

export async function loadSettings(): Promise<Partial<PersistedSettings>> {
  try {
    const store = await getSettingsStore();
    const language = await store.get<AppLanguage>("language");
    const autoLaunch = await store.get<boolean>("autoLaunch");
    const defaultProjectLocation = await store.get<string>("defaultProjectLocation");
    const theme = await store.get<AppTheme>("theme");

    return {
      ...(language !== null && language !== undefined && { language }),
      ...(autoLaunch !== null && autoLaunch !== undefined && { autoLaunch }),
      ...(defaultProjectLocation !== null && defaultProjectLocation !== undefined && { defaultProjectLocation }),
      ...(theme !== null && theme !== undefined && { theme }),
    };
  } catch (err) {
    console.warn("[persistence] Failed to load settings, using defaults:", err);
    return {};
  }
}

export async function saveSettings(settings: PersistedSettings): Promise<void> {
  try {
    const store = await getSettingsStore();
    await store.set("language", settings.language);
    await store.set("autoLaunch", settings.autoLaunch);
    await store.set("defaultProjectLocation", settings.defaultProjectLocation);
    await store.set("theme", settings.theme);
    await store.save();
  } catch (err) {
    console.error("[persistence] Failed to save settings:", err);
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export async function loadProjects(): Promise<Project[]> {
  try {
    const store = await getProjectsStore();
    const projects = await store.get<Project[]>("projects");
    return projects ?? [];
  } catch (err) {
    console.warn("[persistence] Failed to load projects, starting fresh:", err);
    return [];
  }
}

export async function saveProjects(projects: Project[]): Promise<void> {
  try {
    const store = await getProjectsStore();
    await store.set("projects", projects);
    await store.save();
  } catch (err) {
    console.error("[persistence] Failed to save projects:", err);
  }
}
