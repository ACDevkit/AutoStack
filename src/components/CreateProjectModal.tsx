import { useState } from "react";
import { X, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import FrameworkSelect from "@/components/FrameworkSelect";

interface CreateProjectModalProps {
  onClose: () => void;
}

export default function CreateProjectModal({ onClose }: CreateProjectModalProps) {
  const addProject             = useProjectStore((s) => s.addProject);
  const defaultProjectLocation = useSettingsStore((s) => s.defaultProjectLocation);
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [framework, setFramework]     = useState("");
  const [path, setPath]               = useState("");
  const [useDocker, setUseDocker]     = useState(true);

  async function browsePath() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) setPath(selected);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !framework) return;
    const now = new Date().toISOString();
    addProject({
      id: crypto.randomUUID(),
      name: name.trim(),
      description: description.trim() || undefined,
      path: path.trim(),
      templateId: framework,
      useDocker,
      createdAt: now,
      updatedAt: now,
    });
    onClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="relative w-full max-w-md bg-card border border-border rounded-xl shadow-2xl shadow-black/50 p-6 mx-4">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-foreground">Create New Project</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Project Name <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              placeholder="e.g. My Web App"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full h-9 px-3 text-sm bg-secondary/50 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Description{" "}
              <span className="font-normal text-muted-foreground/50">(optional)</span>
            </label>
            <input
              type="text"
              placeholder="Brief description of the project"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full h-9 px-3 text-sm bg-secondary/50 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
            />
          </div>

          {/* Framework / Library */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Framework / Library <span className="text-destructive">*</span>
            </label>
            <FrameworkSelect value={framework} onChange={setFramework} />
          </div>

          {/* Path */}
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1.5">
              Project Path{" "}
              <span className="font-normal text-muted-foreground/50">
                (leave blank to install automatically)
              </span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={
                  defaultProjectLocation
                    ? `Default: ${defaultProjectLocation}`
                    : "Leave blank to install automatically"
                }
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="flex-1 h-9 px-3 text-sm bg-secondary/50 border border-border rounded-md text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
              />
              <button
                type="button"
                onClick={browsePath}
                className="h-9 px-3 text-sm bg-secondary border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </button>
            </div>
          </div>

          <label className="inline-flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={useDocker}
              onChange={(e) => setUseDocker(e.target.checked)}
              className="h-4 w-4 rounded border-border bg-secondary accent-primary"
            />
            Run this project in Docker containers with local port forwarding
          </label>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="h-8 px-4 text-sm font-medium text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !framework}
              className="h-8 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
