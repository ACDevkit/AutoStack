import type { Template } from "@/types";

export const templates: Template[] = [];

export function getTemplateById(id: string): Template | undefined {
  return templates.find((t) => t.id === id);
}
