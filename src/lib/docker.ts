import { invoke } from "@tauri-apps/api/core";
import type { DockerRuntimeConfig, ProjectRuntimeSettings } from "@/types";

interface PrepareDockerParams {
  projectPath: string;
  frameworkId: string;
  projectName: string;
  runtimeSettings: ProjectRuntimeSettings;
  preferredHostPort?: number;
}

export async function prepareDockerRuntime(
  params: PrepareDockerParams,
): Promise<DockerRuntimeConfig> {
  const result = await invoke<DockerRuntimeConfig>("prepare_docker_runtime", {
    projectPath: params.projectPath,
    frameworkId: params.frameworkId,
    projectName: params.projectName,
    runtimeSettings: params.runtimeSettings,
    preferredHostPort: params.preferredHostPort ?? null,
  });
  return result;
}
