import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/** Shared switch used across settings surfaces. Springy knob, accessible. */
export default function Toggle({ checked, onChange, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative w-10 h-6 rounded-full shrink-0 transition-colors duration-200",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "disabled:opacity-40 disabled:pointer-events-none",
        checked ? "bg-primary" : "bg-secondary border border-border",
        className,
      )}
    >
      <span
        className={cn(
          "absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm",
          "transition-transform duration-200 [transition-timing-function:var(--ease-spring)]",
          checked && "translate-x-4",
        )}
      />
    </button>
  );
}
