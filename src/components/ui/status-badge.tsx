import { AlertCircle } from "lucide-react";
import type { ProjectStatus } from "@/types";
import { cn } from "@/lib/utils";

interface StatusBadgeProps {
  status: ProjectStatus;
  size?: "sm" | "md";
  /** Optional label override (e.g. error message). */
  message?: string;
  className?: string;
}

/** Semantic status pill shared by ProjectCard / ProjectPage / tabs. */
export default function StatusBadge({
  status,
  size = "sm",
  message,
  className,
}: StatusBadgeProps) {
  const sm = size === "sm";
  const base = cn(
    "inline-flex items-center font-medium rounded-full transition-colors duration-200",
    sm ? "gap-1.5 text-[10px] px-2 py-0.5" : "gap-1.5 text-xs px-2.5 py-1",
    className,
  );
  const dot = sm ? "h-1.5 w-1.5" : "h-2 w-2";

  if (status === "not-setup") {
    return (
      <span className={cn(base, "bg-warning-soft text-warning")}>
        <AlertCircle className={cn(sm ? "w-3 h-3" : "w-3.5 h-3.5", "shrink-0")} />
        {message ?? "Setup required"}
      </span>
    );
  }

  if (status === "online") {
    return (
      <span className={cn(base, "bg-success-soft text-success")}>
        <span className={cn("relative flex shrink-0", dot)}>
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-60" />
          <span className={cn("relative inline-flex rounded-full bg-success", dot)} />
        </span>
        {message ?? "Online"}
      </span>
    );
  }

  if (status === "error") {
    return (
      <span className={cn(base, "bg-danger-soft text-danger")}>
        <span className={cn("rounded-full bg-danger shrink-0", dot)} />
        {message ?? "Error"}
      </span>
    );
  }

  return (
    <span className={cn(base, "bg-secondary/60 text-muted-foreground")}>
      <span className={cn("rounded-full bg-muted-foreground/40 shrink-0", dot)} />
      {message ?? "Offline"}
    </span>
  );
}
