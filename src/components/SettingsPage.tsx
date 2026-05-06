import { FolderOpen, ChevronDown } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useSettingsStore, type AppLanguage, type AppTheme } from "@/stores/settingsStore";

// ─── Sub-components ───────────────────────────────────────────────────────────

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        checked ? "bg-primary" : "bg-secondary border border-border"
      }`}
    >
      <span
        className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-8">
      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50 mb-2 px-1">
        {title}
      </p>
      <div className="bg-card border border-border rounded-lg divide-y divide-border/60">
        {children}
      </div>
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-10 px-5 py-4">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground leading-snug">{label}</p>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>
        )}
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

const THEMES: { value: AppTheme; label: string }[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System" },
];

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const {
    language, setLanguage,
    autoLaunch, setAutoLaunch,
    defaultProjectLocation, setDefaultProjectLocation,
    theme, setTheme,
  } = useSettingsStore();

  async function browseForFolder() {
    const selected = await open({ directory: true, multiple: false });
    if (typeof selected === "string" && selected) {
      setDefaultProjectLocation(selected);
    }
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-8 py-8">

        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your AutoStack preferences
          </p>
        </div>

        {/* General */}
        <Section title="General">
          {/* Language */}
          <SettingRow
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
            label="Auto Launch on PC Startup"
            description="Automatically open AutoStack when you log in to Windows."
          >
            <Toggle checked={autoLaunch} onChange={setAutoLaunch} />
          </SettingRow>

          {/* Default Project Location */}
          <SettingRow
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
            label="Theme"
            description="Choose how AutoStack looks on your screen."
          >
            <div className="flex rounded-md border border-border overflow-hidden">
              {THEMES.map((t, i) => (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setTheme(t.value)}
                  className={`px-4 h-8 text-xs font-medium transition-colors ${
                    i > 0 ? "border-l border-border" : ""
                  } ${
                    theme === t.value
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </SettingRow>
        </Section>

      </div>
    </div>
  );
}
