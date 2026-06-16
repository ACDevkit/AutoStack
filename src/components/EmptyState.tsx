import { Layers2, Plus } from "lucide-react";
import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";

interface EmptyStateProps {
  /** Opens the create modal, optionally pre-selecting a framework. */
  onCreateProject: (frameworkId?: string) => void;
}

// A few popular starting points surfaced as quick-start chips.
const QUICK_START_IDS = ["react", "nextjs", "vite", "fastapi"] as const;

export default function EmptyState({ onCreateProject }: EmptyStateProps) {
  const quickStarts = QUICK_START_IDS
    .map((id) => getFrameworkById(id))
    .filter((fw): fw is NonNullable<typeof fw> => Boolean(fw));

  return (
    <div className="relative flex flex-col items-center justify-center h-full text-center px-6 select-none overflow-hidden">
      {/* Subtle dot-grid background (theme-aware) */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.05]"
        style={{
          backgroundImage:
            "radial-gradient(circle, var(--foreground) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Softly pulsing glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-72 h-72 rounded-full bg-primary/[0.06] blur-3xl pointer-events-none animate-glow-pulse" />

      {/* Floating brand-gradient icon tile */}
      <div className="relative animate-float-gentle mb-5">
        <div
          className="w-16 h-16 rounded-2xl bg-gradient-brand flex items-center justify-center"
          style={{
            boxShadow:
              "0 8px 32px -8px color-mix(in oklch, var(--primary) 50%, transparent)",
          }}
        >
          <Layers2 className="w-8 h-8 text-white" />
        </div>
      </div>

      <h2 className="relative text-xl font-semibold tracking-tight text-foreground mb-2">
        No Projects Yet
      </h2>
      <p className="relative text-sm text-muted-foreground max-w-[300px] mb-8 leading-relaxed">
        Create your first project to start automating your stack setup and
        managing deployments.
      </p>

      <button
        onClick={() => onCreateProject()}
        className="relative flex items-center gap-2 h-9 px-5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary-emphasis active:scale-95 transition-all duration-150"
        style={{
          boxShadow:
            "0 4px 16px -4px color-mix(in oklch, var(--primary) 40%, transparent)",
        }}
      >
        <Plus className="w-4 h-4" />
        Create New Project
      </button>

      {/* Quick-start chips */}
      {quickStarts.length > 0 && (
        <div className="relative mt-8 flex flex-col items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground/50">
            Quick start
          </span>
          <div className="flex flex-wrap items-center justify-center gap-2 max-w-[360px]">
            {quickStarts.map((fw) => (
              <button
                key={fw.id}
                onClick={() => onCreateProject(fw.id)}
                title={`New ${fw.name} project`}
                className="group inline-flex items-center gap-2 h-8 pl-2 pr-3 rounded-full bg-secondary/50 border border-border text-xs font-medium text-foreground/80 hover:text-foreground hover:bg-secondary hover:border-border-strong active:scale-95 transition-all duration-150"
              >
                <span
                  className="flex items-center justify-center w-5 h-5 rounded-md shrink-0 transition-transform duration-150 group-hover:scale-110"
                  style={{
                    backgroundColor: `color-mix(in oklch, ${fw.color} 12%, transparent)`,
                  }}
                >
                  <FrameworkIcon fw={fw} size={12} />
                </span>
                {fw.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
