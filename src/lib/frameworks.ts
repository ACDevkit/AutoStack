export interface Framework {
  id: string;
  name: string;
  category: "Frontend" | "Full-Stack" | "Backend";
  color: string;
  abbr: string;
}

export const FRAMEWORKS: Framework[] = [
  // Frontend
  { id: "react",     name: "React",        category: "Frontend",   color: "#61DAFB", abbr: "Re" },
  { id: "vue",       name: "Vue",          category: "Frontend",   color: "#42B883", abbr: "Vu" },
  { id: "angular",   name: "Angular",      category: "Frontend",   color: "#DD0031", abbr: "Ng" },
  { id: "svelte",    name: "Svelte",       category: "Frontend",   color: "#FF3E00", abbr: "Sv" },
  { id: "solid",     name: "Solid",        category: "Frontend",   color: "#4B8EF0", abbr: "So" },
  // Full-Stack
  { id: "nextjs",    name: "Next.js",      category: "Full-Stack", color: "#E5E7EB", abbr: "Nx" },
  { id: "nuxt",      name: "Nuxt",         category: "Full-Stack", color: "#00DC82", abbr: "Nu" },
  { id: "astro",     name: "Astro",        category: "Full-Stack", color: "#FF5D01", abbr: "As" },
  { id: "sveltekit", name: "SvelteKit",    category: "Full-Stack", color: "#FF9040", abbr: "SK" },
  { id: "remix",     name: "Remix",        category: "Full-Stack", color: "#A78BFA", abbr: "Rm" },
  // Backend
  { id: "nodejs",    name: "Node.js",      category: "Backend",    color: "#68A063", abbr: "No" },
  { id: "fastapi",   name: "FastAPI",      category: "Backend",    color: "#009688", abbr: "FA" },
  { id: "django",    name: "Django",       category: "Backend",    color: "#44B78B", abbr: "Dj" },
  { id: "go",        name: "Go / Gin",     category: "Backend",    color: "#00ADD8", abbr: "Go" },
  { id: "rust",      name: "Rust / Axum",  category: "Backend",    color: "#CE422B", abbr: "Rs" },
  { id: "laravel",   name: "Laravel",      category: "Backend",    color: "#FF2D20", abbr: "La" },
  { id: "dotnet",    name: ".NET",         category: "Backend",    color: "#512BD4", abbr: "Dn" },
];

export const CATEGORIES = ["Frontend", "Full-Stack", "Backend"] as const;

export function getFrameworkById(id: string): Framework | undefined {
  return FRAMEWORKS.find((f) => f.id === id);
}
