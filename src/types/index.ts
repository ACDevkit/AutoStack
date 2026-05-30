export type ProjectStatus = "online" | "offline" | "error" | "not-setup";

export type RuntimeVersion = "node-20-lts" | "node-22-current" | "bun-latest";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export interface ProjectRuntimeSettings {
  runtimeVersion: RuntimeVersion;
  packageManager: PackageManager;
  startupCommand: string;
  autoInstallDeps: boolean;
  enableStrictPorts: boolean;
}

export interface DockerRuntimeConfig {
  enabled: boolean;
  hostPort: number;
  containerPort: number;
  serviceName: string;
  composeFile: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  path: string;
  templateId: string;
  useDocker?: boolean;
  runtime?: ProjectRuntimeSettings;
  docker?: DockerRuntimeConfig;
  createdAt: string;
  updatedAt: string;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  tags: string[];
  commands: TemplateCommand[];
}

export interface TemplateCommand {
  label: string;
  command: string;
  cwd?: string;
}
