import { Layers2, Plus } from "lucide-react";

interface EmptyStateProps {
  onCreateProject: () => void;
}

export default function EmptyState({ onCreateProject }: EmptyStateProps) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full text-center px-6 select-none overflow-hidden">
      {/* Subtle dot-grid background */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.035]"
        style={{
          backgroundImage: "radial-gradient(circle, white 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />

      {/* Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 rounded-full bg-primary/5 blur-3xl pointer-events-none" />

      {/* Icon */}
      <div className="relative w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center mb-5">
        <Layers2 className="w-8 h-8 text-primary" />
      </div>

      <h2 className="relative text-xl font-semibold text-foreground mb-2">No Projects Yet</h2>
      <p className="relative text-sm text-muted-foreground max-w-[280px] mb-8 leading-relaxed">
        Create your first project to start automating your stack setup and managing deployments.
      </p>

      <button
        onClick={onCreateProject}
        className="relative flex items-center gap-2 h-9 px-5 text-sm font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 active:scale-95 transition-all"
      >
        <Plus className="w-4 h-4" />
        Create New Project
      </button>
    </div>
  );
}
