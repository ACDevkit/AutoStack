import { useEffect, useState, useRef } from "react";
import {
  FolderOpen, ChevronDown, RefreshCw, CheckCircle2, AlertCircle, ArrowDownToLine,
  Globe, Rocket, Palette, Sun, Moon, Monitor, GitBranch, type LucideIcon,
} from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { getVersion } from "@tauri-apps/api/app";
import { useSettingsStore, type AppLanguage, type AppTheme } from "@/stores/settingsStore";
import Toggle from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

// ─── Sub-components ───────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-2 px-1">
        {title}
      </p>
      <div className="surface-card rounded-xl divide-y divide-border/60">
        {children}
      </div>
    </div>
  );
}

function SettingRow({
  icon: Icon,
  label,
  description,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-10 px-5 py-4">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-8 h-8 rounded-lg bg-secondary/60 ring-1 ring-border flex items-center justify-center shrink-0">
            <Icon className="w-4 h-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground leading-snug">{label}</p>
          {description && (
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
          )}
        </div>
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Language data ─────────────────────────────────────────────────────────────

const LANGUAGES: { code: AppLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "zh", label: "中文 (简体)" },
  { code: "ko", label: "한국어" },
];

const THEMES: { value: AppTheme; label: string; icon: LucideIcon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
  { value: "system", label: "System", icon: Monitor },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

// ─── Update check state ────────────────────────────────────────────────────────

type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up-to-date" }
  | { kind: "available"; version: string }
  | { kind: "error"; message: string };

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    language, setLanguage,
    autoLaunch, setAutoLaunch,
    defaultProjectLocation, setDefaultProjectLocation,
    theme, setTheme,
  } = useSettingsStore();

  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({ kind: "idle" });
  const [currentVersion, setCurrentVersion] = useState<string>("...");
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let isMounted = true;
    getVersion()
      .then((v) => {
        if (isMounted) setCurrentVersion(v);
      })
      .catch(() => {
        if (isMounted) setCurrentVersion("unknown");
      });
    return () => {
      isMounted = false;
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    };
  }, []);

  async function browseForFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      setDefaultProjectLocation(selected);
    }
  }

  function handleCheckForUpdate() {
    if (updateStatus.kind === "checking") return;

    // Clear any pending auto-reset.
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);

    setUpdateStatus({ kind: "checking" });

    // Placeholder: simulate a network check.
    // Replace this timeout with a real invoke() call when the backend is ready.
    resetTimerRef.current = setTimeout(() => {
      setUpdateStatus({ kind: "up-to-date" });

      // Auto-reset back to idle after 6 s so the row doesn't stay green forever.
      resetTimerRef.current = setTimeout(() => {
        setUpdateStatus({ kind: "idle" });
      }, 6_000);
    }, 1_800);
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
        </div>

        {/* General */}
        <Section title="General">
          {/* Language */}
          <SettingRow
            icon={Globe}
            label="Language"
            description="Select the display language for the application."
          >
            <div className="relative">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as AppLanguage)}
                className="h-8 pl-3 pr-8 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer"
              >
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </SettingRow>

          {/* Auto Launch */}
          <SettingRow
            icon={Rocket}
            label="Auto Launch on PC Startup"
            description="Automatically open AutoStack when you log in to Windows."
          >
            <Toggle checked={autoLaunch} onChange={setAutoLaunch} />
          </SettingRow>

          {/* Default Project Location */}
          <SettingRow
            icon={FolderOpen}
            label="Default Project Location"
            description="The folder where new projects will be created by default."
          >
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="e.g. C:\Projects"
                value={defaultProjectLocation}
                onChange={(e) => setDefaultProjectLocation(e.target.value)}
                className="w-48 h-8 px-3 text-sm bg-secondary border border-border rounded-md text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring transition-colors"
              />
              <button
                type="button"
                onClick={browseForFolder}
                className="h-8 px-2.5 text-sm bg-secondary border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 shrink-0"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Browse
              </button>
            </div>
          </SettingRow>
        </Section>

        {/* Appearance */}
        <Section title="Appearance">
          <SettingRow
            icon={Palette}
            label="Theme"
            description="Choose how AutoStack looks on your screen."
          >
            <div className="flex rounded-md border border-border overflow-hidden bg-secondary/40">
              {THEMES.map((t, i) => {
                const Icon = t.icon;
                const active = theme === t.value;
                return (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTheme(t.value)}
                    className={cn(
                      "inline-flex items-center gap-1.5 px-3.5 h-8 text-xs font-medium transition-colors duration-200",
                      i > 0 && "border-l border-border",
                      active
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-secondary",
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </SettingRow>
        </Section>

        {/* Updates */}
        <Section title="Updates">
          <SettingRow
            icon={RefreshCw}
            label="Updates"
            description="Check for new releases and keep AutoStack on the latest version."
          >
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center h-7 px-2.5 text-[11px] font-medium rounded-md border border-border bg-secondary text-muted-foreground">
                Current v{currentVersion}
              </span>

              {/* idle */}
              {updateStatus.kind === "idle" && (
                <button
                  type="button"
                  onClick={handleCheckForUpdate}
                  className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-secondary border border-border rounded-md text-foreground hover:bg-accent hover:border-ring/40 active:scale-95 transition-all duration-150"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Check for Updates
                </button>
              )}

              {/* checking */}
              {updateStatus.kind === "checking" && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Checking for updates...
                </span>
              )}

              {/* up to date */}
              {updateStatus.kind === "up-to-date" && (
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success animate-in fade-in zoom-in-95 duration-200">
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  Already up to date
                </span>
              )}

              {/* update available */}
              {updateStatus.kind === "available" && (
                <>
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                    v{updateStatus.version} available
                  </span>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 active:scale-95 transition-all duration-150"
                  >
                    <ArrowDownToLine className="w-3.5 h-3.5" />
                    Download &amp; Install
                  </button>
                </>
              )}

              {/* error */}
              {updateStatus.kind === "error" && (
                <>
                  <span className="inline-flex items-center gap-1.5 text-xs text-warning animate-in fade-in zoom-in-95 duration-200">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {updateStatus.message}
                  </span>
                  <button
                    type="button"
                    onClick={handleCheckForUpdate}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium bg-secondary border border-border rounded-md text-muted-foreground hover:text-foreground hover:bg-accent active:scale-95 transition-all duration-150"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry
                  </button>
                </>
              )}
            </div>
          </SettingRow>

          {/* Release channel — placeholder for future use */}
          <SettingRow
            icon={GitBranch}
            label="Release Channel"
            description="Stable receives tested releases. Beta gets early access to new features."
          >
            <div className="relative">
              <select
                defaultValue="stable"
                className="h-8 pl-3 pr-8 text-sm bg-secondary border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-ring appearance-none cursor-pointer"
              >
                <option value="stable">Stable</option>
                <option value="beta">Beta</option>
              </select>
              <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
            </div>
          </SettingRow>
        </Section>

      </div>
    </div>
  );
}
