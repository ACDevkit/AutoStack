import { useState, useEffect, useRef } from "react";
import { X, FolderOpen, Container, FolderPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { open } from "@tauri-apps/plugin-dialog";
import { useProjectStore } from "@/stores/projectStore";
import { useSettingsStore } from "@/stores/settingsStore";
import FrameworkSelect from "@/components/FrameworkSelect";
import { createDefaultRuntimeSettings } from "@/lib/projectRuntime";

interface CreateProjectModalProps {
  onClose: () => void;
  /** Pre-select a framework (e.g. from an EmptyState quick-start chip). */
  initialFramework?: string;
}

const CLOSE_ANIMATION_MS = 150;

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ToggleTrack({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "relative w-10 h-6 rounded-full transition-colors duration-200 shrink-0 pointer-events-none",
        checked ? "bg-primary" : "bg-secondary border border-border",
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200",
          checked && "translate-x-4",
        )}
      />
    </span>
  );
}

export default function CreateProjectModal({ onClose, initialFramework }: CreateProjectModalProps) {
  const addProject             = useProjectStore((s) => s.addProject);
  const defaultProjectLocation = useSettingsStore((s) => s.defaultProjectLocation);
  const [name, setName]               = useState("");
  const [description, setDescription] = useState("");
  const [framework, setFramework]     = useState(initialFramework ?? "");
  const [path, setPath]               = useState("");
  const [useDocker, setUseDocker]     = useState(false);
  const [isClosing, setIsClosing]     = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Animate out, then unmount via onClose.
  function requestClose() {
    if (closeTimerRef.current) return;
    setIsClosing(true);
    closeTimerRef.current = setTimeout(onClose, CLOSE_ANIMATION_MS);
  }

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      // Focus trap: keep Tab cycling within the modal panel.
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => el.offsetParent !== null || el === document.activeElement);
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      runtime: createDefaultRuntimeSettings(framework),
      createdAt: now,
      updatedAt: now,
    });
    requestClose();
  }

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) requestClose();
  }

  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm",
        isClosing
          ? "animate-out fade-out duration-150"
          : "animate-in fade-in duration-200",
      )}
      onClick={handleBackdropClick}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create new project"
        className={cn(
          "relative w-full max-w-md bg-card border border-border rounded-2xl p-6 mx-4",
          isClosing
            ? "animate-out fade-out zoom-out-95 duration-150"
            : "animate-in fade-in zoom-in-95 slide-in-from-bottom-2 duration-200",
        )}
        style={{
          boxShadow: "inset 0 1px 0 var(--border-highlight), var(--shadow-modal)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-primary-soft ring-1 ring-primary/20 flex items-center justify-center shrink-0">
              <FolderPlus className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground leading-tight">
                Create New Project
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Scaffold and manage a new project
              </p>
            </div>
          </div>
          <button
            onClick={requestClose}
            className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors shrink-0"
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

          <button
            type="button"
            role="switch"
            aria-checked={useDocker}
            onClick={() => setUseDocker((v) => !v)}
            className={cn(
              "w-full flex items-center justify-between gap-3 px-3 h-10",
              "bg-secondary/50 border border-border rounded-md text-left",
              "hover:bg-secondary/70 transition-colors cursor-pointer",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-ring",
            )}
          >
            <span className="flex items-center gap-2 min-w-0">
              <Container className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
              <span className="text-sm font-medium text-foreground">Run in Docker</span>
            </span>
            <ToggleTrack checked={useDocker} />
          </button>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={requestClose}
              className="h-8 px-4 text-sm font-medium text-muted-foreground hover:text-foreground bg-secondary hover:bg-accent border border-border rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !framework}
              className="h-8 px-4 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary-emphasis active:scale-95 disabled:opacity-40 disabled:pointer-events-none transition-all"
              style={{
                boxShadow:
                  "0 2px 10px -2px color-mix(in oklch, var(--primary) 35%, transparent)",
              }}
            >
              Create Project
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
