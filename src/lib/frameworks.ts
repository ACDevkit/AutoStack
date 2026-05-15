export interface Framework {
  id: string;
  name: string;
  category: "Frontend" | "Full-Stack" | "Backend";
  color: string;
  abbr: string;
}

export const FRAMEWORKS: Framework[] = [
  // Frontend (React ecosystem)
  { id: "react",     name: "React",        category: "Frontend",   color: "#61DAFB", abbr: "Re" },
  { id: "vite",      name: "Vite",         category: "Frontend",   color: "#A78BFA", abbr: "Vi" },
  // Full-Stack
  { id: "nextjs",    name: "Next.js",      category: "Full-Stack", color: "#E5E7EB", abbr: "Nx" },
  { id: "astro",     name: "Astro",        category: "Full-Stack", color: "#FF5D01", abbr: "As" },
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
