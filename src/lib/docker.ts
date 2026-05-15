import { invoke } from "@tauri-apps/api/core";
import type { DockerRuntimeConfig } from "@/types";

interface PrepareDockerParams {
  projectPath: string;
  frameworkId: string;
  projectName: string;
  preferredHostPort?: number;
}

export async function prepareDockerRuntime(
  params: PrepareDockerParams,
): Promise<DockerRuntimeConfig> {
  const result = await invoke<DockerRuntimeConfig>("prepare_docker_runtime", {
    projectPath: params.projectPath,
    frameworkId: params.frameworkId,
    projectName: params.projectName,
    preferredHostPort: params.preferredHostPort ?? null,
  });
  return result;
}
