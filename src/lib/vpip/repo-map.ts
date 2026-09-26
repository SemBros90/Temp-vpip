/** Read-only repository classification and module grouping for Admin AI Repository Explorer. */
export type FileClass = "UI" | "Backend" | "Database" | "API" | "Configuration" | "Security" | "Documentation" | "Deployment" | "Testing" | "Assets" | "Unknown";

export function classifyFile(path: string): FileClass {
  const p = path.toLowerCase();
  const name = p.split("/").pop() ?? p;
  if (/(\.test|\.spec)\.[jt]sx?$|(^|\/)(__tests__|tests?|e2e|cypress|playwright)\//.test(p)) return "Testing";
  if (/(^|\/)(\.github\/workflows|deploy|docker)|dockerfile|wrangler\.|vercel\.json|netlify\.toml|fly\.toml|procfile/.test(p)) return "Deployment";
  if (/\.(sql)$|(^|\/)(migrations?|drizzle|prisma|supabase\/migrations)\/|schema\.(ts|prisma)$/.test(p)) return "Database";
  if (/(^|\/)(auth|security)|middleware|\.env|secrets?|rls|policy|cron-auth/.test(p)) return "Security";
  if (/(^|\/)(routes\/api|api|pages\/api)\/|\.functions\.tsx?$/.test(p)) return "API";
  if (/\.server\.tsx?$|(^|\/)(server|services?|controllers?|backend)\/|(^|\/)src\/(server|start)\.ts$/.test(p)) return "Backend";
  if (/\.(md|mdx|txt|rst)$|(^|\/)docs?\//.test(p)) return "Documentation";
  if (/\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|mp3|pdf)$|(^|\/)(public|assets|static)\//.test(p)) return "Assets";
  if (/\.(json|ya?ml|toml|ini|lock|lockb)$|config\.|^\.|\/\.|tsconfig|eslint|prettier/.test(name) || name.startsWith(".")) return "Configuration";
  if (/\.(tsx|jsx|vue|svelte|css|scss|html)$/.test(p)) return "UI";
  if (/\.(ts|js|mjs|cjs)$/.test(p)) return "Backend";
  return "Unknown";
}

export const CLASS_TONE: Record<FileClass, string> = {
  UI: "text-primary", Backend: "text-foreground", Database: "text-accent-foreground", API: "text-primary",
  Configuration: "text-muted-foreground", Security: "text-destructive", Documentation: "text-muted-foreground",
  Deployment: "text-foreground", Testing: "text-muted-foreground", Assets: "text-muted-foreground", Unknown: "text-muted-foreground",
};

/** Top-level map buckets → sub-module → file paths. */
export function moduleOf(path: string): [string, string] {
  const p = path.toLowerCase();
  const c = classifyFile(path);
  if (c === "Database") return ["Database", /function/.test(p) ? "Functions" : /trigger/.test(p) ? "Triggers" : /migration/.test(p) ? "Migrations" : "Tables & Schema"];
  if (c === "API") return ["Backend", "APIs"];
  if (c === "Backend" || c === "Security") return ["Backend", /controller/.test(p) ? "Controllers" : c === "Security" ? "Security" : /integrations\//.test(p) ? "Integrations" : "Services"];
  if (c === "UI") return ["Frontend", /routes\/|pages\//.test(p) ? "Pages" : /layout|shell|__root/.test(p) ? "Layouts" : /hooks?\//.test(p) ? "Hooks" : /\.(css|scss)$/.test(p) ? "Styles" : "Components"];
  if (c === "Configuration" || c === "Deployment") return ["Config", c === "Deployment" ? "Deployment" : "Configuration"];
  if (c === "Assets") return ["Assets", "Static files"];
  if (c === "Documentation") return ["Documentation", "Docs"];
  if (c === "Testing") return ["Testing", "Tests"];
  return ["Other", "Unclassified"];
}

export interface Ownership { lastContributor: string; lastSha: string; lastDate: string; commits: number; contributors: string[] }

/** Reads GitHub commit history for one path (read-only). */
export async function fileOwnership(token: string, repo: string, branch: string, path: string): Promise<Ownership> {
  let page = 1; const all: Array<{ sha: string; commit: { author?: { name?: string; date?: string } }; author?: { login?: string } | null }> = [];
  while (page <= 5) {
    const res = await fetch(`https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(path)}&per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json", ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}) },
    });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const rows = (await res.json()) as typeof all;
    all.push(...rows);
    if (rows.length < 100) break;
    page++;
  }
  const who = (c: (typeof all)[number]) => c.author?.login ?? c.commit.author?.name ?? "unknown";
  const first = all[0];
  return { lastContributor: first ? who(first) : "—", lastSha: first?.sha ?? "", lastDate: first?.commit.author?.date ?? "", commits: all.length, contributors: [...new Set(all.map(who))] };
}
