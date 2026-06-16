import { getFrameworkById } from "@/lib/frameworks";
import { FrameworkIcon } from "@/components/FrameworkSelect";
import { cn } from "@/lib/utils";

interface FrameworkAvatarProps {
  templateId: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const SIZES = {
  sm: { tile: "w-8 h-8 rounded-lg", icon: 16 },
  md: { tile: "w-10 h-10 rounded-xl", icon: 20 },
  lg: { tile: "w-12 h-12 rounded-xl", icon: 24 },
} as const;

/** Brand-tinted icon tile that makes a project's framework instantly scannable. */
export default function FrameworkAvatar({
  templateId,
  size = "md",
  className,
}: FrameworkAvatarProps) {
  const fw = getFrameworkById(templateId);
  const s = SIZES[size];

  if (!fw) {
    return (
      <div
        className={cn(
          s.tile,
          "flex items-center justify-center shrink-0 bg-secondary/60 ring-1 ring-border",
          className,
        )}
      >
        <span className="text-xs font-bold text-muted-foreground">?</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        s.tile,
        "flex items-center justify-center shrink-0 transition-transform duration-200",
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklch, ${fw.color} 12%, transparent)`,
        boxShadow: `0 0 0 1px color-mix(in oklch, ${fw.color} 25%, transparent)`,
      }}
    >
      <FrameworkIcon fw={fw} size={s.icon} />
    </div>
  );
}
