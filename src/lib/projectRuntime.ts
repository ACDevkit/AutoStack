import type { PackageManager, ProjectRuntimeSettings, RuntimeVersion } from "@/types";

const NODE_RUNTIME_DEFAULT: RuntimeVersion = "node-20-lts";
const NODE_PM_DEFAULT: PackageManager = "npm";
const RUNTIME_OPTIONS: RuntimeVersion[] = ["node-20-lts", "node-22-current", "bun-latest"];
const PACKAGE_MANAGER_OPTIONS: PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

function isNodeEcosystemFramework(frameworkId: string): boolean {
  return [
    "react",
    "vite",
    "vue",
    "svelte",
    "solid",
    "nextjs",
    "nuxt",
    "astro",
    "sveltekit",
    "remix",
    "nodejs",
  ].includes(frameworkId);
}

function commandForPackageManager(pm: PackageManager, script: "start" | "dev"): string {
  if (pm === "bun") return `bun run ${script}`;
  if (pm === "yarn") return `yarn ${script}`;
  return `${pm} run ${script}`;
}

export function deriveDefaultStartupCommand(
  frameworkId: string,
  packageManager: PackageManager,
): string {
  switch (frameworkId) {
    case "react":
    case "angular":
      return commandForPackageManager(packageManager, "start");
    case "vite":
    case "vue":
    case "svelte":
    case "solid":
    case "nextjs":
    case "nuxt":
    case "astro":
    case "sveltekit":
    case "remix":
      return commandForPackageManager(packageManager, "dev");
    case "nodejs":
      return "node index.js";
    case "fastapi":
      return "uvicorn main:app --reload";
    case "django":
      return "python manage.py runserver";
    case "go":
      return "go run .";
    case "rust":
      return "cargo run";
    case "laravel":
      return "php artisan serve";
    case "dotnet":
      return "dotnet run";
    default:
      return commandForPackageManager(packageManager, "start");
  }
}

export function createDefaultRuntimeSettings(frameworkId: string): ProjectRuntimeSettings {
  const packageManager = isNodeEcosystemFramework(frameworkId) ? NODE_PM_DEFAULT : "npm";
  return {
    runtimeVersion: NODE_RUNTIME_DEFAULT,
    packageManager,
    startupCommand: deriveDefaultStartupCommand(frameworkId, packageManager),
    autoInstallDeps: true,
    enableStrictPorts: false,
  };
}

export function normalizeRuntimeSettings(
  settings: Partial<ProjectRuntimeSettings> | null | undefined,
  frameworkId: string,
): ProjectRuntimeSettings {
  const defaults = createDefaultRuntimeSettings(frameworkId);
  const merged: ProjectRuntimeSettings = {
    ...defaults,
    ...(settings ?? {}),
  };
  if (!RUNTIME_OPTIONS.includes(merged.runtimeVersion)) {
    merged.runtimeVersion = defaults.runtimeVersion;
  }
  if (!PACKAGE_MANAGER_OPTIONS.includes(merged.packageManager)) {
    merged.packageManager = defaults.packageManager;
  }
  if (!merged.startupCommand || !merged.startupCommand.trim()) {
    merged.startupCommand = deriveDefaultStartupCommand(frameworkId, merged.packageManager);
  } else {
    merged.startupCommand = merged.startupCommand.trim();
  }
  return merged;
}

