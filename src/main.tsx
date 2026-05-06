import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { loadSettings, loadProjects } from "@/lib/persistence";
import { useSettingsStore, applyTheme } from "@/stores/settingsStore";
import { useProjectStore } from "@/stores/projectStore";

function mount() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

async function init() {
  try {
    const [savedSettings, savedProjects] = await Promise.all([
      loadSettings(),
      loadProjects(),
    ]);

    useSettingsStore.getState().hydrate(savedSettings);
    useProjectStore.getState().hydrate(savedProjects);

    applyTheme(savedSettings.theme ?? "dark");
  } catch (err) {
    console.error("[init] Failed to load persisted state:", err);
    applyTheme("dark");
  }

  mount();
}

init();
