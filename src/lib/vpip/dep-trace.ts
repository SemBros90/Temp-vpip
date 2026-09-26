/**
 * Admin AI dependency tracing (read-only). Builds an import graph from indexed
 * repository files and answers "if I change this file, what breaks?".
 */
const EXTS = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", "/index.ts", "/index.tsx", "/index.js"];
const IMPORT_RE = /(?:import|export)\s[^'"]*?from\s*["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)|^\s*import\s*["']([^"']+)["']/gm;

function norm(parts: string[]) {
  const out: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

export function resolveImport(from: string, spec: string, files: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
  else if (spec.startsWith(".")) base = norm([...from.split("/").slice(0, -1), ...spec.split("/")]);
  else return null;
  for (const e of EXTS) if (files.has(base + e)) return base + e;
  return null;
}

export interface DepGraph {
  imports: Map<string, string[]>;
  importedBy: Map<string, string[]>;
  packages: Map<string, string[]>;
}

export function buildGraph(index: Map<string, string>): DepGraph {
  const files = new Set(index.keys());
  const imports = new Map<string, string[]>();
  const importedBy = new Map<string, string[]>();
  const packages = new Map<string, string[]>();
  for (const [path, content] of index) {
    if (!/\.(tsx?|jsx?|mjs)$/.test(path)) continue;
    const deps = new Set<string>();
    const pkgs = new Set<string>();
    for (const m of content.matchAll(IMPORT_RE)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (!spec) continue;
      const r = resolveImport(path, spec, files);
      if (r) deps.add(r);
      else if (!spec.startsWith(".") && !spec.startsWith("@/")) pkgs.add(spec);
    }
    imports.set(path, [...deps]);
    packages.set(path, [...pkgs]);
    for (const d of deps) importedBy.set(d, [...(importedBy.get(d) ?? []), path]);
  }
  return { imports, importedBy, packages };
}

export type Risk = "Low" | "Medium" | "High" | "Critical";

export interface Impact {
  target: string;
  direct: string[];
  transitive: Array<{ path: string; depth: number }>;
  routes: string[];
  apis: string[];
  components: string[];
  dbObjects: string[];
  imports: string[];
  packages: string[];
  exports: string[];
  risk: Risk;
  reason: string;
}

const isRoute = (p: string) => p.startsWith("src/routes/") && !p.includes("/api/") && !p.endsWith(".gen.ts");
const isApi = (p: string) => p.startsWith("src/routes/api/") || /\.functions\.tsx?$|\.server\.tsx?$/.test(p);
const isComponent = (p: string) => p.startsWith("src/components/");

export function traceImpact(g: DepGraph, index: Map<string, string>, target: string): Impact {
  const seen = new Map<string, number>();
  const queue: Array<[string, number]> = (g.importedBy.get(target) ?? []).map((p) => [p, 1]);
  while (queue.length) {
    const [p, d] = queue.shift()!;
    if (seen.has(p) || p === target) continue;
    seen.set(p, d);
    for (const q of g.importedBy.get(p) ?? []) queue.push([q, d + 1]);
  }
  const all = [...seen.keys()];
  const withSelf = [target, ...all];
  const content = index.get(target) ?? "";
  const exports = [...content.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+(\w+)/gm)].map((m) => m[1]!);
  const dbObjects = [...new Set(withSelf.flatMap((p) => [...(index.get(p) ?? "").matchAll(/\.from\(\s*["'`](\w+)["'`]\s*\)|\.rpc\(\s*["'`](\w+)["'`]/g)].map((m) => (m[1] ?? m[2])!)))].filter(Boolean);
  const routes = withSelf.filter(isRoute);
  const apis = withSelf.filter(isApi);
  const components = all.filter(isComponent);
  const n = all.length;
  const core = target === "src/routes/__root.tsx" || /^(src\/(router|start|server)\.tsx?|vite\.config|package\.json|src\/styles\.css)/.test(target) || target.startsWith("src/integrations/");
  const risk: Risk = core || n >= 40 ? "Critical" : n >= 15 || routes.length >= 5 ? "High" : n >= 3 || apis.length ? "Medium" : "Low";
  const reason = core
    ? "Core app entry / integration file — every page depends on it."
    : `${n} dependent file(s), ${routes.length} page(s), ${apis.length} server/API file(s), ${dbObjects.length} database object(s).`;
  return {
    target,
    direct: g.importedBy.get(target) ?? [],
    transitive: all.map((path) => ({ path, depth: seen.get(path)! })).sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path)),
    routes, apis, components, dbObjects,
    imports: g.imports.get(target) ?? [],
    packages: g.packages.get(target) ?? [],
    exports, risk, reason,
  };
}

export function impactMarkdown(i: Impact) {
  const list = (a: string[]) => (a.length ? a.map((x) => `- ${x}`).join("\n") : "- none");
  return `# Impact Analysis: ${i.target}
**Risk:** ${i.risk} — ${i.reason}

## Exports
${list(i.exports)}
## Imports (internal)
${list(i.imports)}
## Packages
${list(i.packages)}
## Directly imported by (${i.direct.length})
${list(i.direct)}
## All affected files (${i.transitive.length})
${i.transitive.map((t) => `- [depth ${t.depth}] ${t.path}`).join("\n") || "- none"}
## Affected pages/routes
${list(i.routes)}
## Affected server/API files
${list(i.apis)}
## Affected components
${list(i.components)}
## Database objects touched
${list(i.dbObjects)}`;
}
