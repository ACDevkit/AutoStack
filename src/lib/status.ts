import { useEffect, useState } from "react";
import type { Project, ProjectStatus } from "@/types";
import { processManager, type RunPhase } from "@/lib/processManager";

/** Derive the displayable status of a project from its run phase. */
export function deriveProjectStatus(project: Project, phase: RunPhase): ProjectStatus {
  if (!project.path || project.path.trim() === "") return "not-setup";
  if (phase === "running") return "online";
  if (phase === "error") return "error";
  return "offline";
}

/** Subscribe to a single project's live run phase from the global processManager. */
export function useRunPhase(projectId: string): RunPhase {
  const [phase, setPhase] = useState<RunPhase>(() => processManager.getPhase(projectId));
  useEffect(() => {
    setPhase(processManager.getPhase(projectId));
    return processManager.subscribePhase(projectId, setPhase);
  }, [projectId]);
  return phase;
}

/** Subscribe to live run phases for a list of projects (dashboard stats, tab dots). */
export function useRunPhases(projectIds: string[]): Record<string, RunPhase> {
  const [phases, setPhases] = useState<Record<string, RunPhase>>({});
  const key = projectIds.join("|");
  useEffect(() => {
    setPhases(Object.fromEntries(projectIds.map((id) => [id, processManager.getPhase(id)])));
    const unsubs = projectIds.map((id) =>
      processManager.subscribePhase(id, (phase) =>
        setPhases((prev) => (prev[id] === phase ? prev : { ...prev, [id]: phase })),
      ),
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return phases;
}
