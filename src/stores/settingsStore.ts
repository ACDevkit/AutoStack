import { create } from "zustand";
import { saveSettings, type PersistedSettings } from "@/lib/persistence";

export type AppLanguage = "en" | "es" | "fr" | "de" | "pt" | "ja" | "zh" | "ko" | "it";
export type AppTheme = "dark" | "light" | "system";

interface SettingsState extends PersistedSettings {
  setLanguage: (lang: AppLanguage) => void;
  setAutoLaunch: (val: boolean) => void;
  setDefaultProjectLocation: (path: string) => void;
  setTheme: (theme: AppTheme) => void;
  hydrate: (data: Partial<PersistedSettings>) => void;
}

const DEFAULTS: PersistedSettings = {
  language: "en",
  autoLaunch: false,
  defaultProjectLocation: "",
  theme: "dark",
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULTS,

  setLanguage: (language) => {
    set({ language });
    saveSettings({ ...get(), language });
  },

  setAutoLaunch: (autoLaunch) => {
    set({ autoLaunch });
    saveSettings({ ...get(), autoLaunch });
  },

  setDefaultProjectLocation: (defaultProjectLocation) => {
    set({ defaultProjectLocation });
    saveSettings({ ...get(), defaultProjectLocation });
  },

  setTheme: (theme) => {
    set({ theme });
    applyTheme(theme);
    saveSettings({ ...get(), theme });
  },

  hydrate: (data) => set((s) => ({ ...s, ...data })),
}));

// ─── Theme application ─────────────────────────────────────────────────────────

const systemThemeMQ = window.matchMedia("(prefers-color-scheme: dark)");

export function applyTheme(theme: AppTheme): void {
  const root = document.documentElement;
  if (theme === "system") {
    root.classList.toggle("dark", systemThemeMQ.matches);
  } else {
    root.classList.toggle("dark", theme === "dark");
  }
}

// Keep "system" theme in sync if the OS preference changes at runtime
systemThemeMQ.addEventListener("change", () => {
  const theme = useSettingsStore.getState().theme;
  if (theme === "system") applyTheme("system");
});
