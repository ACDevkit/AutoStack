export type ProjectStatus = "online" | "offline" | "error" | "not-setup";

export interface Project {
  id: string;
  name: string;
  description?: string;
  path: string;
  templateId: string;
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
