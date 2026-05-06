import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import {
  SiReact, SiVuedotjs, SiAngular, SiSvelte, SiSolid,
  SiNextdotjs, SiNuxt, SiAstro, SiRemix,
  SiNodedotjs, SiFastapi, SiDjango, SiGo, SiRust, SiLaravel, SiDotnet,
} from "react-icons/si";
import type { IconType } from "react-icons";
import { cn } from "@/lib/utils";
import { FRAMEWORKS, CATEGORIES, getFrameworkById, type Framework } from "@/lib/frameworks";

const FRAMEWORK_ICONS: Record<string, IconType> = {
  react:     SiReact,
  vue:       SiVuedotjs,
  angular:   SiAngular,
  svelte:    SiSvelte,
  solid:     SiSolid,
  nextjs:    SiNextdotjs,
  nuxt:      SiNuxt,
  astro:     SiAstro,
  sveltekit: SiSvelte,
  remix:     SiRemix,
  nodejs:    SiNodedotjs,
  fastapi:   SiFastapi,
  django:    SiDjango,
  go:        SiGo,
  rust:      SiRust,
  laravel:   SiLaravel,
  dotnet:    SiDotnet,
};

interface FrameworkIconProps {
  fw: Framework;
  size?: number;
}

export function FrameworkIcon({ fw, size = 14 }: FrameworkIconProps) {
  const Icon = FRAMEWORK_ICONS[fw.id];
  return (
    <span
      className="flex items-center justify-center shrink-0"
      style={{ color: fw.color, width: size + 4, height: size + 4 }}
    >
      {Icon
        ? <Icon size={size} />
        : <span className="font-bold leading-none" style={{ fontSize: size * 0.7 }}>{fw.abbr}</span>
      }
    </span>
  );
}

interface FrameworkSelectProps {
  value: string;
  onChange: (id: string) => void;
}

export default function FrameworkSelect({ value, onChange }: FrameworkSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selected = getFrameworkById(value) ?? null;

  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "w-full h-9 px-3 flex items-center justify-between gap-2 text-sm bg-secondary/50 border rounded-md transition-colors text-left",
          open
            ? "border-ring ring-1 ring-ring"
            : "border-border hover:border-border/80 hover:bg-secondary/70",
        )}
      >
        {selected ? (
          <span className="flex items-center gap-2 min-w-0">
            <FrameworkIcon fw={selected} />
            <span className="text-foreground truncate">{selected.name}</span>
            <span className="text-[10px] text-muted-foreground/50 shrink-0">{selected.category}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Select a framework or library...</span>
        )}
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-transform duration-150 shrink-0",
            open && "rotate-180",
          )}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-[60] left-0 right-0 mt-1.5 rounded-lg shadow-2xl shadow-black/70 overflow-hidden border border-border bg-[oklch(0.13_0_0)]">
          <div className="max-h-[240px] overflow-y-auto">
            {CATEGORIES.map((cat, catIdx) => {
              const items = FRAMEWORKS.filter((f) => f.category === cat);
              return (
                <div key={cat}>
                  {/* Category label */}
                  <div className={cn(
                    "px-3 py-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/40 bg-[oklch(0.13_0_0)] sticky top-0",
                    catIdx > 0 && "border-t border-border/40"
                  )}>
                    {cat}
                  </div>

                  {/* Framework rows */}
                  <div className="pb-1">
                    {items.map((fw) => (
                      <button
                        key={fw.id}
                        type="button"
                        onClick={() => { onChange(fw.id); setOpen(false); }}
                        className={cn(
                          "w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors",
                          fw.id === value
                            ? "bg-primary/10 text-foreground"
                            : "text-foreground/75 hover:bg-white/[0.04] hover:text-foreground",
                        )}
                      >
                        <FrameworkIcon fw={fw} size={15} />
                        <span className="flex-1 text-left">{fw.name}</span>
                        {fw.id === value && (
                          <Check className="w-3 h-3 text-primary shrink-0" />
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
