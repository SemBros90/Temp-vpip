/**
 * Repository compatibility engine. Pure functions over the repository's files:
 * classification, dependency / import / alias / environment validation,
 * unsupported-runtime detection and a health score.
 */
import type {
  AliasEntry,
  BuildStages,
  CodeSide,
  GraphEdge,
  RepoInsights,
  ServerOnlyFile,
  StageResult,
  StageStatus,
  DepReportRow,
  EnvReportRow,
  ImportIssue,
  PreviewDiagnostics,
  RepoClassification,
  RepoHealth,
  RepoReport,
  UnsupportedReason,
} from "./types";

export interface AnalyzerFile {
  path: string;
  content: string;
}

type Pkg = {
  name?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
  packageManager?: string;
  scripts?: Record<string, string>;
};

/** All Node built-ins — valid with or without the `node:` prefix, never a missing dependency. */
const NODE_BUILTINS = new Set(
  "assert buffer child_process cluster console constants crypto dgram diagnostics_channel dns domain events fs http http2 https module net os path perf_hooks process punycode querystring readline repl stream string_decoder sys timers tls trace_events tty url util v8 vm wasi worker_threads zlib async_hooks inspector test sqlite sea".split(
    " ",
  ),
);
const CODE_RE = /\.(m?[jt]sx?|cjs|vue|svelte|astro)$/i;
const STYLE_RE = /\.(css|scss|sass|less)$/i;
const ASSET_RE = /\.(png|jpe?g|gif|webp|svg|ico|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|json|txt|md)$/i;
const RESOLVE_EXT = ["", ".tsx", ".ts", ".jsx", ".js", ".mjs", ".cjs", ".vue", ".svelte", ".json", ".css", ".scss"];
const INDEX = ["/index.tsx", "/index.ts", "/index.jsx", "/index.js", "/index.vue"];

/** JSON with comments and trailing commas (tsconfig). */
export function parseJsonc(text: string): unknown {
  const noComments = text.replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, str) => str ?? "");
  return JSON.parse(noComments.replace(/,(\s*[}\]])/g, "$1"));
}

function readPkg(files: AnalyzerFile[], path: string): Pkg | null {
  const f = files.find((x) => x.path === path);
  if (!f) return null;
  try {
    return JSON.parse(f.content) as Pkg;
  } catch {
    return null;
  }
}

function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function joinPath(base: string, rel: string) {
  const parts = base ? base.split("/") : [];
  for (const part of rel.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}
function pkgName(spec: string) {
  if (spec.startsWith("@")) return spec.split("/").slice(0, 2).join("/");
  return spec.split("/")[0] ?? spec;
}

/* --------------------------------------------------------- classification */

export function classify(files: AnalyzerFile[]): RepoClassification {
  const has = (re: RegExp) => files.some((f) => re.test(f.path));
  const rootPkg = readPkg(files, "package.json");
  const allPkgs = files.filter((f) => /(^|\/)package\.json$/.test(f.path) && !f.path.includes("node_modules"));
  const deps: Record<string, string> = {};
  for (const p of allPkgs) {
    const j = readPkg(files, p.path);
    Object.assign(deps, j?.dependencies, j?.devDependencies);
  }
  const d = (n: string) => Boolean(deps[n]);
  const fw: string[] = [];
  if (d("next") || has(/(^|\/)next\.config\./)) fw.push("Next.js");
  if (d("nuxt") || has(/(^|\/)nuxt\.config\./)) fw.push("Nuxt");
  if (d("@remix-run/react") || d("@remix-run/dev")) fw.push("Remix");
  if (d("@angular/core") || has(/(^|\/)angular\.json$/)) fw.push("Angular");
  if (d("astro") || has(/(^|\/)astro\.config\./)) fw.push("Astro");
  if (d("svelte") || d("@sveltejs/kit") || has(/(^|\/)svelte\.config\./)) fw.push("Svelte");
  if ((d("vue") || has(/\.vue$/)) && !fw.includes("Nuxt")) fw.push("Vue");
  if (d("react")) fw.push("React");
  if (d("vite") || has(/(^|\/)vite\.config\./)) fw.push("Vite");
  if (d("electron")) fw.push("Electron");
  if (d("@tauri-apps/api") || has(/(^|\/)src-tauri\//)) fw.push("Tauri");
  if (d("@nestjs/core")) fw.push("NestJS");
  if (d("express")) fw.push("Express");
  if (d("fastify") || d("koa") || d("hono")) fw.push(d("fastify") ? "Fastify" : d("koa") ? "Koa" : "Hono");
  if (!fw.includes("Remix") && has(/(^|\/)remix\.config\./)) fw.push("Remix");
  const FRONT = ["Next.js", "Nuxt", "Remix", "Angular", "Astro", "Svelte", "Vue", "React"];
  const BACK = ["Express", "NestJS", "Fastify", "Koa", "Hono"];
  const hasServerDir = has(/^(server|backend|api)\/.+\.[cm]?[jt]s$/);
  if (fw.some((f) => FRONT.includes(f)) && (fw.some((f) => BACK.includes(f)) || hasServerDir)) fw.push("Full-stack");
  if (!fw.some((f) => FRONT.includes(f) || BACK.includes(f)) && rootPkg && has(/\.[cm]?[jt]s$/)) fw.push("Node");

  const isTurbo = has(/^turbo\.json$/);
  const isNx = has(/^nx\.json$/);
  const isMono = Boolean(rootPkg?.workspaces) || has(/^pnpm-workspace\.yaml$/) || has(/^lerna\.json$/) || isTurbo || isNx;
  if (isMono) fw.push("Monorepo");
  if (isTurbo) fw.push("Turborepo");
  if (isNx) fw.push("Nx Workspace");

  const ts = files.filter((f) => /\.tsx?$/.test(f.path)).length;
  const js = files.filter((f) => /\.jsx?$/.test(f.path)).length;
  const py = files.filter((f) => /\.py$/.test(f.path)).length;
  const language = ts >= js && ts > 0 ? "TypeScript" : js > 0 ? "JavaScript" : py > 0 ? "Python" : has(/\.html$/) ? "HTML" : "Unknown";

  const pm = rootPkg?.packageManager?.split("@")[0];
  const packageManager =
    pm ??
    (has(/^bun\.lockb?$/) ? "bun" : has(/^pnpm-lock\.yaml$/) ? "pnpm" : has(/^yarn\.lock$/) ? "yarn" : has(/^package-lock\.json$/) ? "npm" : rootPkg ? "npm (no lockfile)" : "none");

  const buildSystem = isTurbo
    ? "Turborepo"
    : isNx
      ? "Nx"
      : fw.includes("Next.js")
        ? "Next.js"
        : fw.includes("Vite")
          ? "Vite"
          : fw.includes("Angular")
            ? "Angular CLI"
            : d("webpack") || has(/webpack\.config\./)
              ? "Webpack"
              : d("react-scripts")
                ? "Create React App"
                : d("parcel")
                  ? "Parcel"
                  : rootPkg
                    ? "npm scripts"
                    : "None";

  // In monorepos, pick the most previewable app folder.
  let appRoot = "";
  if (isMono) {
    const apps = allPkgs
      .map((p) => dirname(p.path))
      .filter((dir) => dir && (files.some((f) => f.path === `${dir}/index.html`) || files.some((f) => f.path.startsWith(`${dir}/src/main.`))));
    appRoot = apps.find((a) => /apps?\/(web|client|frontend|site|app)/.test(a)) ?? apps[0] ?? "";
  }

  const primary =
    fw.find((f) => !["Vite", "Monorepo", "Turborepo", "Nx Workspace", "Express", "Full-stack"].includes(f)) ?? fw[0] ?? (rootPkg ? "Node.js" : "Static / unknown");
  return {
    frameworks: fw,
    primary,
    language,
    packageManager,
    buildSystem,
    workspaceType: isNx ? "Nx Workspace" : isTurbo ? "Turborepo" : isMono ? "Monorepo" : "Single package",
    appRoot,
  };
}

/* ------------------------------------------------------------ lockfiles */

export function parseLockfiles(files: AnalyzerFile[]): { versions: Record<string, string>; source: string } {
  const versions: Record<string, string> = {};
  const lock = files.find((f) => f.path === "package-lock.json");
  if (lock) {
    try {
      const j = JSON.parse(lock.content) as {
        packages?: Record<string, { version?: string }>;
        dependencies?: Record<string, { version?: string }>;
      };
      for (const [k, v] of Object.entries(j.packages ?? {})) {
        const m = /(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(k);
        if (m?.[1] && v.version && !k.slice(0, -m[1].length - 13).includes("node_modules")) versions[m[1]] = v.version;
      }
      for (const [k, v] of Object.entries(j.dependencies ?? {})) if (v.version && !versions[k]) versions[k] = v.version;
      return { versions, source: "package-lock.json" };
    } catch {
      /* invalid */
    }
  }
  const pnpm = files.find((f) => f.path === "pnpm-lock.yaml");
  if (pnpm) {
    const importerRe = /^\s{6}'?((?:@[^/\s']+\/)?[^:\s']+)'?:\n\s{8}specifier:.*\n\s{8}version:\s*'?([^\s'(]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = importerRe.exec(pnpm.content))) if (m[1] && m[2]) versions[m[1]] ??= m[2];
    const pkRe = /^\s{2}'?\/?((?:@[^/\s']+\/)?[^@\s']+)@([^:('\s]+)/gm;
    while ((m = pkRe.exec(pnpm.content))) if (m[1] && m[2]) versions[m[1]] ??= m[2];
    return { versions, source: "pnpm-lock.yaml" };
  }
  const yarn = files.find((f) => f.path === "yarn.lock");
  if (yarn) {
    const re = /^"?((?:@[^@\s"]+\/)?[^@\s"]+)@[^\n]*:\n\s+version:?\s+"?([^"\s]+)/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(yarn.content))) if (m[1] && m[2]) versions[m[1]] ??= m[2];
    return { versions, source: "yarn.lock" };
  }
  if (files.some((f) => f.path === "bun.lock")) {
    const bl = files.find((f) => f.path === "bun.lock");
    const re = /"((?:@[^"/]+\/)?[^"@]+)":\s*\["[^"@]+@([^"]+)"/g;
    let m: RegExpExecArray | null;
    while (bl && (m = re.exec(bl.content))) if (m[1] && m[2]) versions[m[1]] ??= m[2];
    return { versions, source: "bun.lock" };
  }
  return { versions, source: "" };
}

function satisfiesLoose(range: string, version: string): boolean {
  const r = range.replace(/^[\^~>=<v\s]+/, "");
  if (!/^\d/.test(r)) return true; // tags, urls, workspace:* etc.
  const [rm] = r.split(".");
  const [vm] = version.split(".");
  if (range.startsWith("^") || range.startsWith("~") || /^\d/.test(range)) return rm === vm;
  return true;
}

/* -------------------------------------------------------------- aliases */

export function readAliases(files: AnalyzerFile[], appRoot = ""): AliasEntry[] {
  const out: AliasEntry[] = [];
  const pre = appRoot ? `${appRoot}/` : "";
  for (const name of ["tsconfig.json", "tsconfig.app.json", "tsconfig.base.json", "jsconfig.json"]) {
    for (const f of files.filter((x) => x.path === name || x.path === `${pre}${name}`)) {
      try {
        const j = parseJsonc(f.content) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
        const base = joinPath(dirname(f.path), j.compilerOptions?.baseUrl ?? ".");
        for (const [k, v] of Object.entries(j.compilerOptions?.paths ?? {})) {
          const target = v[0];
          if (!target) continue;
          out.push({ alias: k.replace(/\/\*$/, ""), target: joinPath(base, target.replace(/\/\*$/, "")), source: f.path });
        }
      } catch {
        /* unparsable */
      }
    }
  }
  for (const f of files.filter((x) => /(^|\/)(vite|next|webpack)\.config\.[cm]?[jt]s$/.test(x.path))) {
    const re = /['"]?([@~$\w/-]+)['"]?\s*:\s*(?:path\.)?(?:resolve|join)?\(?\s*(?:__dirname|process\.cwd\(\)|fileURLToPath\(new URL\()?\s*,?\s*['"]\.?\/?([\w./-]+)['"]/g;
    const block = /alias\s*:\s*[{[]([\s\S]*?)[}\]]/m.exec(f.content)?.[1] ?? "";
    let m: RegExpExecArray | null;
    while ((m = re.exec(block))) {
      if (m[1] && m[2]) out.push({ alias: m[1].replace(/\/$/, ""), target: joinPath(dirname(f.path), m[2].replace(/\/$/, "")), source: f.path });
    }
  }
  // Conventional defaults when nothing is declared but the folder exists.
  const srcRoot = `${pre}src`;
  if (!out.some((a) => a.alias === "@") && files.some((f) => f.path.startsWith(`${srcRoot}/`)))
    out.push({ alias: "@", target: srcRoot, source: "convention" });
  if (!out.some((a) => a.alias === "~") && files.some((f) => f.path.startsWith(`${srcRoot}/`)))
    out.push({ alias: "~", target: srcRoot, source: "convention" });
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.alias) ? false : (seen.add(a.alias), true)));
}

/* -------------------------------------------------------------- imports */

function extractSpecs(content: string, path: string): string[] {
  const out: string[] = [];
  if (STYLE_RE.test(path)) {
    const re = /@import\s+(?:url\()?['"]([^'"]+)['"]|url\(\s*['"]?([^'")]+)['"]?\s*\)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content))) {
      const s = m[1] ?? m[2];
      if (s && !/^(data:|https?:|#|\/\/)/.test(s)) out.push(s);
    }
    return out;
  }
  const res = [
    /(?:^|[^.\w])import\s+(?:[\w*{}\s,$]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /export\s+[\w*{}\s,$]+\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  const clean = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const re of res) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean))) if (m[1]) out.push(m[1]);
  }
  return out;
}

export function validateImports(
  files: AnalyzerFile[],
  aliases: AliasEntry[],
  declared: Set<string>,
): { issues: ImportIssue[]; usedPackages: Map<string, string[]>; total: number } {
  const paths = new Set(files.map((f) => f.path));
  const issues: ImportIssue[] = [];
  const usedPackages = new Map<string, string[]>();
  let total = 0;
  const exists = (p: string) => {
    const base = p.split("?")[0]!.replace(/\/$/, "");
    return RESOLVE_EXT.some((e) => paths.has(base + e)) || INDEX.some((e) => paths.has(base + e));
  };
  const isPublicAsset = (spec: string) => paths.has(`public${spec}`) || [...paths].some((p) => p.endsWith(`/public${spec}`));
  const sorted = [...aliases].sort((a, b) => b.alias.length - a.alias.length);
  // Images/fonts are not downloaded on import, so a binary reference can only be
  // judged missing when its folder is absent from the repository too.
  const BIN = /\.(png|jpe?g|gif|webp|ico|avif|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|wav)$/i;
  const dirs = new Set<string>();
  for (const p of paths) for (let d = dirname(p); d; d = dirname(d)) dirs.add(d);
  const hasBinaries = [...paths].some((p) => BIN.test(p));
  const binaryMissing = (target: string) => BIN.test(target) && hasBinaries && !dirs.has(dirname(target));
  const skipBinary = (target: string) => BIN.test(target) && !binaryMissing(target);

  for (const f of files) {
    if (!(CODE_RE.test(f.path) || STYLE_RE.test(f.path))) continue;
    if (/(^|\/)(node_modules|dist|build|\.next)\//.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
    // Deno edge functions resolve their own URL / npm: imports.
    if (/^supabase\/functions\//.test(f.path)) continue;
    for (const spec of extractSpecs(f.content, f.path)) {
      total++;
      const asset = ASSET_RE.test(spec.split("?")[0]!);
      if (spec.startsWith(".")) {
        const target = joinPath(dirname(f.path), spec);
        if (!exists(target) && !skipBinary(target))
          issues.push({ kind: asset ? "Missing asset" : "Broken relative path", spec, referencedBy: f.path, expectedPath: target });
        continue;
      }
      if (spec.startsWith("/")) {
        if (!isPublicAsset(spec) && !exists(spec.slice(1)) && !skipBinary(`public${spec}`))
          issues.push({ kind: asset ? "Missing asset" : "Missing file", spec, referencedBy: f.path, expectedPath: `public${spec}` });
        continue;
      }
      const al = sorted.find((a) => spec === a.alias || spec.startsWith(`${a.alias}/`));
      if (al && (al.alias.startsWith("@") ? spec.startsWith(`${al.alias}/`) || spec === al.alias : true) && !declared.has(pkgName(spec))) {
        const target = joinPath(al.target, spec.slice(al.alias.length).replace(/^\//, ""));
        if (!exists(target) && !skipBinary(target))
          issues.push({ kind: asset ? "Missing asset" : "Broken alias", spec, referencedBy: f.path, expectedPath: target });
        continue;
      }
      if (/^(node:|npm:|jsr:|virtual:|~icons|https?:|data:|bun:|\$)/.test(spec)) continue;
      const name = pkgName(spec);
      if (NODE_BUILTINS.has(name)) continue;
      const list = usedPackages.get(name) ?? [];
      if (!list.includes(f.path)) list.push(f.path);
      usedPackages.set(name, list);
    }
  }
  return { issues, usedPackages, total };
}

/* --------------------------------------------------------- dependencies */

const IMPLICIT = new Set(["react/jsx-runtime", "react-dom", "react"]);

export function validateDependencies(
  files: AnalyzerFile[],
  usedPackages: Map<string, string[]>,
  appRoot = "",
): DepReportRow[] {
  const rows: DepReportRow[] = [];
  const pkgs = files.filter((f) => /(^|\/)package\.json$/.test(f.path)).map((f) => readPkg(files, f.path));
  const deps: Record<string, string> = {};
  const dev: Record<string, string> = {};
  const localNames = new Set<string>();
  for (const p of pkgs) {
    if (p?.name) localNames.add(p.name);
    Object.assign(deps, p?.dependencies, p?.peerDependencies);
    Object.assign(dev, p?.devDependencies);
  }
  const { versions, source } = parseLockfiles(files);
  const nameRe = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/;
  const add = (name: string, range: string, isDev: boolean) => {
    const installed = versions[name];
    let status: DepReportRow["status"] = "OK";
    if (!nameRe.test(name)) status = "Invalid";
    else if (source && !installed && !/^(workspace:|file:|link:)/.test(range)) status = "Not locked";
    else if (installed && !satisfiesLoose(range, installed)) status = "Version conflict";
    rows.push({ name, required: range, installed, dev: isDev, status, usedBy: usedPackages.get(name) });
  };
  for (const [n, r] of Object.entries(deps)) add(n, r, false);
  for (const [n, r] of Object.entries(dev)) if (!deps[n]) add(n, r, true);
  for (const [name, usedBy] of usedPackages) {
    if (deps[name] || dev[name] || localNames.has(name) || IMPLICIT.has(name)) continue;
    // Type-only packages imported as "@types/…" are not runtime deps.
    if (name.startsWith("@types/")) continue;
    rows.push({ name, required: "latest", installed: versions[name], dev: false, status: "Missing", usedBy });
  }
  void appRoot;
  return rows.sort((a, b) => (a.status === "OK" ? 1 : 0) - (b.status === "OK" ? 1 : 0) || a.name.localeCompare(b.name));
}

/* ---------------------------------------------------------- environment */

export function scanEnv(files: AnalyzerFile[], configured: Set<string>): EnvReportRow[] {
  const map = new Map<string, Set<string>>();
  const put = (k: string, src: string) => {
    if (["NODE_ENV", "MODE", "DEV", "PROD", "SSR", "BASE_URL"].includes(k)) return;
    const s = map.get(k) ?? new Set<string>();
    s.add(src);
    map.set(k, s);
  };
  for (const f of files) {
    if (CODE_RE.test(f.path) && !/(^|\/)node_modules\//.test(f.path)) {
      const re = /(?:import\.meta\.env|process\.env)(?:\.([A-Z_][A-Z0-9_]*)|\[\s*['"]([A-Z_][A-Z0-9_]*)['"]\s*\])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content))) {
        const k = m[1] ?? m[2];
        if (k) put(k, f.path);
      }
    }
    if (/(^|\/)\.env(\.example|\.sample|\.template|\.local\.example)?$/.test(f.path)) {
      for (const line of f.content.split("\n")) {
        const m = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)\s*=/.exec(line);
        if (m?.[1]) put(m[1], f.path);
      }
    }
  }
  const presentInRepoEnv = new Set<string>();
  for (const f of files.filter((x) => /(^|\/)\.env(\.local|\.development)?$/.test(x.path))) {
    for (const line of f.content.split("\n")) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)$/.exec(line);
      if (m?.[1] && m[2]?.trim()) presentInRepoEnv.add(m[1]);
    }
  }
  return [...map.entries()]
    .map(([key, s]) => ({ key, sources: [...s], configured: configured.has(key) || presentInRepoEnv.has(key) }))
    .sort((a, b) => Number(a.configured) - Number(b.configured) || a.key.localeCompare(b.key));
}

/* --------------------------------------------------------- unsupported */

export function detectUnsupported(files: AnalyzerFile[], c: RepoClassification, deps: DepReportRow[]): UnsupportedReason[] {
  const out: UnsupportedReason[] = [];
  const has = (re: RegExp) => files.find((f) => re.test(f.path));
  const dep = (n: string | RegExp) => deps.find((d) => (typeof n === "string" ? d.name === n : n.test(d.name)));
  const add = (reason: string, evidence: string, blocking = false) => out.push({ reason, evidence, blocking });

  const docker = has(/(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/);
  if (docker) add("Docker required", `${docker.path} found — services defined there cannot run in the browser preview.`);
  const pg = dep(/^(pg|postgres|@prisma\/client|prisma|drizzle-orm|typeorm|sequelize|knex|mysql2?|mongoose|mongodb)$/);
  if (pg) add("Database required", `Package "${pg.name}" needs a running database (PostgreSQL/MySQL/MongoDB). Data screens will fail in preview.`);
  const py = has(/(^|\/)(requirements\.txt|pyproject\.toml|Pipfile|manage\.py)$/);
  if (py) add("Python service required", `${py.path} found — Python code cannot run in the browser preview.`, !files.some((f) => f.path.endsWith("package.json")));
  if (c.frameworks.includes("Electron")) add("Electron runtime required", "The app uses electron APIs (main process, native windows); only renderer UI can be previewed.");
  if (c.frameworks.includes("Tauri")) add("Tauri runtime required", "src-tauri / @tauri-apps/api — native Rust backend calls will fail in preview.");
  if (c.frameworks.includes("NestJS") || (c.frameworks.includes("Express") && !c.frameworks.some((f) => ["React", "Vue", "Svelte"].includes(f))))
    add("Node server required", "This is a server application (Express/NestJS); there is no browser UI to preview.", true);
  if (c.frameworks.includes("Next.js")) {
    const server = has(/(^|\/)(app\/api\/|pages\/api\/)|(^|\/)middleware\.[jt]s$/) ?? files.find((f) => /['"]use server['"]|getServerSideProps/.test(f.content));
    add(
      "Next.js server features",
      server ? `${server.path} uses server-side code (API routes / server actions / SSR). Only client components are previewed.` : "Next.js routing is emulated; server rendering does not run in preview.",
    );
  }
  for (const fw of ["Nuxt", "Remix", "Angular", "Astro"])
    if (c.frameworks.includes(fw)) add(`${fw} build required`, `${fw} needs its own compiler/server; the in-browser preview cannot build it. Code, diagnostics and AI help still work.`, true);
  if (c.frameworks.includes("Svelte") || c.frameworks.includes("Vue"))
    add(`${c.frameworks.includes("Vue") ? "Vue" : "Svelte"} compiler required`, "Single-file components (.vue/.svelte) need a compiler that the preview does not include.", true);
  if (c.workspaceType !== "Single package")
    add(
      c.appRoot ? "Monorepo — previewing one app" : "Monorepo not supported",
      c.appRoot ? `Previewing app "${c.appRoot}". Other packages are resolved by path only.` : "No previewable app folder (with index.html or src/main.*) was found in the workspace.",
      !c.appRoot,
    );
  const apiEnv = files.find((f) => CODE_RE.test(f.path) && /fetch\(\s*[`'"]https?:\/\/(?!localhost)/.test(f.content));
  if (apiEnv) add("External API required", `${apiEnv.path} calls an external API — it will only work if that API allows browser requests.`);
  return out;
}

/* --------------------------------------------------------------- health */

/* ------------------------------------------------ graph / split / server */

const SERVER_PATH = /(^|\/)(server|backend|api|functions|netlify\/functions|supabase\/functions|prisma|scripts)\/|(^|\/)pages\/api\/|(^|\/)app\/(.+\/)?route\.[cm]?[jt]s$|\.server\.[cm]?[jt]sx?$|(^|\/)(middleware|server|index\.server)\.[cm]?[jt]s$|(^|\/)(vite|next|remix|webpack|tailwind|postcss|eslint|astro|nuxt|svelte|drizzle|jest|vitest|playwright)\.config\.[cm]?[jt]s$/;
const SHARED_PATH = /(^|\/)(shared|common|types|lib\/shared)\/|\.d\.ts$|(^|\/)types?\.[jt]s$/;
const BUILTIN_ALT = [...NODE_BUILTINS].join("|");
const SERVER_API_RES: Array<[string, RegExp]> = [
  ["node: import", /from\s+['"]node:[\w/]+['"]|require\(\s*['"]node:/],
  ["Node built-in", new RegExp(`(?:from\\s+|require\\(\\s*)['"](?:${BUILTIN_ALT})(?:/[\\w/]*)?['"]`)],
  ["res.setHeader", /\bres\.(setHeader|writeHead|status|send|json|end)\s*\(/],
  ["req object", /\breq\.(body|query|params|headers|method|url|cookies)\b/],
  ["process API", /\bprocess\.(cwd|exit|argv|on|platform|pid|memoryUsage|stdout|stderr)\b/],
  ["__dirname", /\b__dirname\b|\b__filename\b/],
  ["server framework", /(?:from\s+|require\(\s*)['"](express|fastify|koa|hono\/node-server|@nestjs\/[\w-]+|http-proxy|ws)['"]/],
  ["use server", /^\s*['"]use server['"]/m],
  ["database driver", /(?:from\s+|require\(\s*)['"](pg|mysql2?|mongodb|mongoose|@prisma\/client|better-sqlite3|sqlite3|redis|ioredis)['"]/],
];

export function detectServerApis(files: AnalyzerFile[]): ServerOnlyFile[] {
  const out: ServerOnlyFile[] = [];
  for (const f of files) {
    if (!CODE_RE.test(f.path) || /(^|\/)node_modules\//.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
    const src = f.content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const apis: string[] = [];
    for (const [label, re] of SERVER_API_RES) {
      const m = re.exec(src);
      if (m) apis.push(label === "Node built-in" ? `Node built-in (${/['"]([^'"]+)['"]/.exec(m[0])?.[1] ?? "?"})` : label);
    }
    if (apis.length) out.push({ path: f.path, apis });
  }
  return out;
}

function resolveTo(paths: Set<string>, aliases: AliasEntry[], from: string, spec: string): string | undefined {
  let base: string | undefined;
  if (spec.startsWith(".")) base = joinPath(dirname(from), spec);
  else {
    const al = [...aliases].sort((a, b) => b.alias.length - a.alias.length).find((a) => spec === a.alias || spec.startsWith(`${a.alias}/`));
    if (al) base = joinPath(al.target, spec.slice(al.alias.length).replace(/^\//, ""));
    else if (spec.startsWith("/")) base = spec.slice(1);
  }
  if (base === undefined) return undefined;
  const b = base.split("?")[0]!;
  for (const e of RESOLVE_EXT) if (paths.has(b + e)) return b + e;
  for (const e of INDEX) if (paths.has(b + e)) return b + e;
  return undefined;
}

export function pickEntry(files: AnalyzerFile[], appRoot = ""): string | undefined {
  const pre = appRoot ? `${appRoot}/` : "";
  const html = files.find((f) => f.path === `${pre}index.html`);
  const src = html ? /<script[^>]*type=["']module["'][^>]*src=["']\/?([^"']+)["']/i.exec(html.content)?.[1] : undefined;
  const cands = [src && `${pre}${src}`, ...["src/main.tsx", "src/main.ts", "src/main.jsx", "src/main.js", "src/index.tsx", "src/index.jsx", "src/index.js", "app/root.tsx", "src/routes/__root.tsx", "app/layout.tsx", "src/app/layout.tsx", "pages/_app.tsx", "pages/index.tsx", "src/App.tsx"].map((p) => pre + p)];
  const set = new Set(files.map((f) => f.path));
  return cands.find((c): c is string => Boolean(c && set.has(c)));
}

export function buildDependencyGraph(files: AnalyzerFile[], aliases: AliasEntry[], entry?: string) {
  const paths = new Set(files.map((f) => f.path));
  const edges: GraphEdge[] = [];
  const packagesByFile: Record<string, string[]> = {};
  const adj = new Map<string, string[]>();
  for (const f of files) {
    if (!(CODE_RE.test(f.path) || STYLE_RE.test(f.path)) || /(^|\/)node_modules\//.test(f.path)) continue;
    const outs: string[] = [];
    for (const spec of extractSpecs(f.content, f.path)) {
      const to = resolveTo(paths, aliases, f.path, spec);
      if (to) {
        if (!outs.includes(to)) outs.push(to);
        continue;
      }
      if (/^[./]/.test(spec) || /^(node:|https?:|data:|virtual:)/.test(spec)) continue;
      const al = aliases.some((a) => spec === a.alias || spec.startsWith(`${a.alias}/`));
      if (al) continue;
      const name = pkgName(spec);
      (packagesByFile[f.path] ??= []).includes(name) || packagesByFile[f.path]!.push(name);
    }
    adj.set(f.path, outs);
    for (const to of outs) edges.push({ from: f.path, to });
  }
  const reach = new Set<string>();
  const stack = entry ? [entry] : [];
  while (stack.length) {
    const n = stack.pop()!;
    if (reach.has(n)) continue;
    reach.add(n);
    for (const m of adj.get(n) ?? []) stack.push(m);
  }
  const unreachable = entry
    ? [...adj.keys()].filter((p) => !reach.has(p) && /\.[jt]sx?$/.test(p) && !SERVER_PATH.test(p) && !/\.(test|spec|stories)\./.test(p) && !/\.d\.ts$/.test(p))
    : [];
  return { edges, packagesByFile, unreachable, reach, adj };
}

export function splitCode(files: AnalyzerFile[], serverOnly: ServerOnlyFile[], adj: Map<string, string[]>, reach: Set<string>): Record<string, CodeSide> {
  const server = new Set(serverOnly.filter((s) => !s.apis.every((a) => a === "process API")).map((s) => s.path));
  const side: Record<string, CodeSide> = {};
  for (const f of files) {
    if (!CODE_RE.test(f.path) || /(^|\/)node_modules\//.test(f.path)) continue;
    if (SERVER_PATH.test(f.path) || (server.has(f.path) && !reach.has(f.path))) side[f.path] = "Backend";
    else if (SHARED_PATH.test(f.path)) side[f.path] = "Shared";
    else side[f.path] = "Frontend";
  }
  // A module imported by both a backend and a frontend file is shared.
  const importers = new Map<string, Set<CodeSide>>();
  for (const [from, outs] of adj) for (const to of outs) {
    const s = importers.get(to) ?? new Set<CodeSide>();
    if (side[from]) s.add(side[from]!);
    importers.set(to, s);
  }
  for (const [p, s] of importers) if (side[p] && s.has("Backend") && s.has("Frontend") && !server.has(p)) side[p] = "Shared";
  return side;
}

export function parseTailwindConfig(files: AnalyzerFile[]): { content: string[]; plugins: string[] } | undefined {
  const f = files.find((x) => /(^|\/)tailwind\.config\.[cm]?[jt]s$/.test(x.path));
  if (!f) return undefined;
  const content = [...(/content\s*:\s*\[([\s\S]*?)\]/.exec(f.content)?.[1] ?? "").matchAll(/['"`]([^'"`]+)['"`]/g)].map((m) => m[1]!);
  const plugins = [...f.content.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)|import\s+\w+\s+from\s+['"]([^'"]+)['"]/g)]
    .map((m) => m[1] ?? m[2] ?? "")
    .filter((s) => s && !s.startsWith(".") && s !== "tailwindcss");
  return { content, plugins: [...new Set(plugins.map(pkgName))] };
}

export function parseRemixConfig(files: AnalyzerFile[]): { appDirectory?: string | undefined } | undefined {
  const f = files.find((x) => /(^|\/)remix\.config\.[cm]?[jt]s$/.test(x.path));
  if (!f) return undefined;
  return { appDirectory: /appDirectory\s*:\s*['"]([^'"]+)['"]/.exec(f.content)?.[1] ?? "app" };
}

/* --------------------------------------------------------------- stages */

const NOT_RUN: StageResult = { status: "Not run", detail: "Not run yet — open the preview to record this stage." };

export function staticStages(
  deps: DepReportRow[],
  imports: ImportIssue[],
  totalImports: number,
  compileErrors: string[] | undefined,
  prev?: BuildStages,
): BuildStages {
  // Calibrated (Phase 4A.1): only an invalid package name fails statically.
  // Undeclared packages, version/lockfile advisories and unresolved imports are
  // static guesses — warnings until a real install or runtime start proves otherwise.
  const invalid = deps.filter((d) => d.status === "Invalid");
  const missing = deps.filter((d) => d.status === "Missing");
  const warnDeps = deps.filter((d) => d.status === "Version conflict" || d.status === "Not locked");
  const codeIssues = imports.filter((i) => i.kind !== "Missing asset");
  const now = new Date().toISOString();
  return {
    dependencies: invalid.length
      ? { status: "Fail", detail: `${invalid.length} invalid package name(s): ${invalid.slice(0, 6).map((d) => d.name).join(", ")}`, at: now }
      : missing.length
        ? { status: "Warn", detail: `${missing.length} undeclared (static check only): ${missing.slice(0, 6).map((d) => d.name).join(", ")}`, at: now }
        : warnDeps.length
          ? { status: "Warn", detail: `${warnDeps.length} lockfile/version advisories (static check only)`, at: now }
          : { status: "Pass", detail: `${deps.length} dependencies resolve`, at: now },
    imports: codeIssues.length
      ? { status: "Warn", detail: `${codeIssues.length} of ${totalImports} imports unresolved (static check only)`, at: now }
      : { status: "Pass", detail: `${totalImports} imports resolve`, at: now },
    compile: compileErrors
      ? compileErrors.length
        ? { status: "Fail", detail: `${compileErrors.length} file(s) failed to compile: ${compileErrors[0]}`, at: now }
        : { status: "Pass", detail: "All frontend files compile", at: now }
      : prev?.compile ?? NOT_RUN,
    runtime: prev?.runtime ?? NOT_RUN,
    preview: prev?.preview ?? NOT_RUN,
  };
}

/* --------------------------------------------------------------- health */

const STAGE_PCT: Record<StageStatus, number | null> = { Pass: 100, Warn: 60, Fail: 0, "Not run": null };

/** Health is based on resolution + compile/runtime/preview outcomes — never on file count. */
export function healthScore(
  r: Pick<RepoReport, "dependencies" | "imports" | "environment" | "unsupported"> & { stages?: BuildStages | undefined },
  totalImports: number,
): RepoHealth {
  const pct = (bad: number, total: number) => (total <= 0 ? 100 : Math.max(0, Math.round(100 - (bad / total) * 100)));
  const badDeps = r.dependencies.filter((d) => d.status === "Missing" || d.status === "Invalid").length;
  const softDeps = r.dependencies.filter((d) => d.status === "Version conflict").length;
  const dependencies = Math.max(0, pct(badDeps, Math.max(r.dependencies.length, 1)) - softDeps * 2);
  const codeIssues = r.imports.filter((i) => i.kind !== "Missing asset").length;
  const assetIssues = r.imports.length - codeIssues;
  const imports = pct(codeIssues, Math.max(totalImports, 1));
  const assets = assetIssues === 0 ? 100 : Math.max(0, 100 - assetIssues * 10);
  const environment = pct(r.environment.filter((e) => !e.configured).length, r.environment.length);
  const blocking = r.unsupported.filter((u) => u.blocking).length;
  const compile = r.stages ? STAGE_PCT[r.stages.compile.status] : null;
  const runtime = r.stages ? STAGE_PCT[r.stages.runtime.status] : null;
  const preview = r.stages ? STAGE_PCT[r.stages.preview.status] : null;
  const estimate = blocking ? Math.max(0, 25 - blocking * 5) : Math.round((imports + dependencies + (compile ?? 100)) / 3);
  const previewReadiness = preview ?? estimate;
  const parts: Array<[number | null, number]> = [
    [dependencies, 25],
    [imports, 25],
    [compile, 20],
    [runtime, 15],
    [preview ?? estimate, 15],
  ];
  const used = parts.filter(([v]) => v !== null) as Array<[number, number]>;
  const w = used.reduce((a, [, x]) => a + x, 0);
  const overall = Math.round(used.reduce((a, [v, x]) => a + v * x, 0) / Math.max(w, 1));
  return {
    overall,
    dependencies,
    imports,
    assets,
    environment,
    previewReadiness,
    compile: compile ?? undefined,
    runtime: runtime ?? undefined,
    preview: preview ?? undefined,
  };
}

/* ------------------------------------------------------------- analyse */

export type AnalysisResult = Omit<RepoReport, "id" | "createdAt" | "projectId">;

export function analyzeRepository(
  files: AnalyzerFile[],
  opts: {
    configuredEnv?: string[] | undefined;
    branch?: string | undefined;
    commitSha?: string | undefined;
    repositoryId?: string | undefined;
    buildSessionId?: string | undefined;
    previewDiagnostics?: PreviewDiagnostics | undefined;
    compileErrors?: string[] | undefined;
    previousStages?: BuildStages | undefined;
  } = {},
): AnalysisResult {
  const classification = classify(files);
  const aliases = readAliases(files, classification.appRoot);
  const declared = new Set<string>();
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x.path))) {
    const j = readPkg(files, f.path);
    for (const k of Object.keys({ ...j?.dependencies, ...j?.devDependencies, ...j?.peerDependencies })) declared.add(k);
  }
  const { issues, usedPackages, total } = validateImports(files, aliases, declared);
  const tailwind = parseTailwindConfig(files);
  for (const p of tailwind?.plugins ?? []) {
    const l = usedPackages.get(p) ?? [];
    usedPackages.set(p, l.concat("tailwind.config"));
  }
  const dependencies = validateDependencies(files, usedPackages, classification.appRoot);
  const environment = scanEnv(files, new Set(opts.configuredEnv ?? []));
  const serverOnly = detectServerApis(files);
  const entry = pickEntry(files, classification.appRoot);
  const graph = buildDependencyGraph(files, aliases, entry);
  const codeSplit = splitCode(files, serverOnly, graph.adj, graph.reach);
  const unsupported = detectUnsupported(files, classification, dependencies);
  const reachedBackend = [...graph.reach].filter((p) => codeSplit[p] === "Backend");
  if (reachedBackend.length)
    unsupported.push({
      reason: "Backend code imported by the frontend",
      evidence: `${reachedBackend.slice(0, 4).join(", ")} ${reachedBackend.length > 4 ? `and ${reachedBackend.length - 4} more ` : ""}will be replaced with stubs in the preview.`,
      blocking: false,
    });
  const stages = staticStages(dependencies, issues, total, opts.compileErrors, opts.previousStages);
  const health = healthScore({ dependencies, imports: issues, environment, unsupported, stages }, total);
  const isBin = (p: string) => /\.(png|jpe?g|gif|webp|ico|avif|bmp|woff2?|ttf|otf|eot|svg)$/i.test(p);
  const skippedTooLarge = files.filter((f) => f.content.startsWith("vpip-skipped:")).map((f) => f.path);
  const insights: RepoInsights = {
    totalFiles: files.length,
    entry,
    codeSplit,
    serverOnly,
    edges: graph.edges.slice(0, 4000),
    packagesByFile: graph.packagesByFile,
    unreachable: graph.unreachable.slice(0, 300),
    assets: {
      present: files.filter((f) => isBin(f.path) && !f.content.startsWith("vpip-skipped:")).length,
      missing: issues.filter((i) => i.kind === "Missing asset").length,
      skippedTooLarge,
    },
    tailwind,
    remix: parseRemixConfig(files),
  };
  return {
    repositoryId: opts.repositoryId,
    buildSessionId: opts.buildSessionId,
    branch: opts.branch ?? "",
    commitSha: opts.commitSha,
    classification,
    dependencies,
    imports: issues,
    aliases,
    environment,
    unsupported,
    previewDiagnostics: { ...(opts.previewDiagnostics ?? { buildStatus: "Not run", repairs: [], runtimeErrors: [] }), insights },
    health,
    stages,
  };
}

/** Records a live preview result (runtime + preview stages) and re-scores health. */
export function applyPreviewResult(
  report: RepoReport,
  result: { rendered: boolean; runtimeErrors: string[]; compileErrors?: string[] | undefined },
): Pick<RepoReport, "stages" | "health" | "previewDiagnostics"> {
  const now = new Date().toISOString();
  const base = report.stages ?? staticStages(report.dependencies, report.imports, 0, undefined);
  const stages: BuildStages = {
    ...base,
    compile: result.compileErrors
      ? result.compileErrors.length
        ? { status: "Fail", detail: `${result.compileErrors.length} file(s) failed to compile: ${result.compileErrors[0]}`, at: now }
        : { status: "Pass", detail: "All frontend files compile", at: now }
      : base.compile,
    runtime: result.runtimeErrors.length
      ? { status: result.rendered ? "Warn" : "Fail", detail: `${result.runtimeErrors.length} runtime error(s): ${result.runtimeErrors[0]?.slice(0, 200)}`, at: now }
      : { status: "Pass", detail: "No runtime errors", at: now },
    preview: result.rendered ? { status: "Pass", detail: "The preview rendered content", at: now } : { status: "Fail", detail: "The preview stayed empty or showed an error", at: now },
  };
  const totalImports = Math.max(report.imports.length * 20, 1);
  const health = healthScore({ ...report, stages }, totalImports);
  // Keep the resolution scores computed with the real import total.
  health.imports = report.health.imports;
  health.dependencies = report.health.dependencies;
  const used: Array<[number, number]> = [
    [health.dependencies, 25],
    [health.imports, 25],
    [health.compile ?? 100, 20],
    [health.runtime ?? 100, 15],
    [health.preview ?? health.previewReadiness, 15],
  ];
  health.overall = Math.round(used.reduce((a, [v, w]) => a + v * w, 0) / 100);
  return {
    stages,
    health,
    previewDiagnostics: { ...report.previewDiagnostics, runtimeErrors: result.runtimeErrors.slice(-20), lastRunAt: now, buildStatus: result.rendered ? "Preview rendered" : "Preview failed — see stages" },
  };
}

/** Preview-verdict + must-fix list for the Import Diagnostics page. */
export function importVerdict(r: RepoReport): { verdict: "Preview can run" | "Preview can run with stubs" | "Preview cannot run"; mustFix: Array<{ file: string; problem: string; fix: string }> } {
  const mustFix: Array<{ file: string; problem: string; fix: string }> = [];
  const pm = r.classification.packageManager.startsWith("pnpm") ? "pnpm add" : r.classification.packageManager.startsWith("yarn") ? "yarn add" : r.classification.packageManager.startsWith("bun") ? "bun add" : "npm i";
  for (const d of r.dependencies.filter((x) => x.status === "Missing"))
    mustFix.push({ file: d.usedBy?.[0] ?? "package.json", problem: `Package "${d.name}" is imported but not declared`, fix: `Run \`${pm} ${d.name}\` (or Auto Repair)` });
  for (const d of r.dependencies.filter((x) => x.status === "Invalid")) mustFix.push({ file: "package.json", problem: `Invalid package name "${d.name}"`, fix: "Correct or remove it in package.json" });
  for (const i of r.imports)
    mustFix.push({ file: i.referencedBy, problem: `${i.kind}: "${i.spec}"`, fix: i.kind === "Missing asset" ? `Add the file at ${i.expectedPath}` : i.kind === "Broken alias" ? `Create ${i.expectedPath} or fix the alias in tsconfig paths` : `Create ${i.expectedPath} or fix the import path` });
  for (const e of r.environment.filter((x) => !x.configured)) mustFix.push({ file: e.sources[0] ?? "", problem: `Environment variable ${e.key} is not set`, fix: `Set ${e.key} in the Environment section` });
  const s = r.stages;
  if (s?.compile.status === "Fail") mustFix.push({ file: s.compile.detail.split(":")[1]?.trim() ?? "", problem: "Compile failed", fix: s.compile.detail });
  if (s?.runtime.status === "Fail") mustFix.push({ file: "", problem: "Runtime error", fix: s.runtime.detail });
  const blocking = r.unsupported.filter((u) => u.blocking);
  for (const u of blocking) mustFix.push({ file: "", problem: u.reason, fix: u.evidence });
  const stubs = (r.previewDiagnostics.insights?.serverOnly.length ?? 0) > 0 || r.unsupported.length > 0;
  const verdict = blocking.length || s?.preview.status === "Fail" ? "Preview cannot run" : stubs ? "Preview can run with stubs" : "Preview can run";
  return { verdict, mustFix };
}


/** Plain-text summary the AI reads (names only — never env values). */
export function repoDiagnosticsSummary(r: RepoReport | undefined, maxItems = 40): string {
  if (!r) return "";
  const c = r.classification;
  const lines: string[] = [
    `## Repository diagnostics (${r.branch || "default branch"}${r.commitSha ? ` @ ${r.commitSha.slice(0, 7)}` : ""})`,
    `Framework: ${c.frameworks.join(" + ") || c.primary} · Language: ${c.language} · Package manager: ${c.packageManager} · Build: ${c.buildSystem} · Workspace: ${c.workspaceType}${c.appRoot ? ` (app ${c.appRoot})` : ""}`,
    `Health ${r.health.overall}% — deps ${r.health.dependencies}%, imports ${r.health.imports}%, assets ${r.health.assets}%, env ${r.health.environment}%, preview ${r.health.previewReadiness}%`,
  ];
  const badDeps = r.dependencies.filter((d) => d.status !== "OK");
  if (badDeps.length) {
    lines.push("", "### Dependency problems");
    for (const d of badDeps.slice(0, maxItems))
      lines.push(`- ${d.name} (${d.status}) required ${d.required}${d.installed ? `, locked ${d.installed}` : ""}${d.usedBy?.length ? ` — used by ${d.usedBy.slice(0, 3).join(", ")}` : ""}`);
  }
  if (r.imports.length) {
    lines.push("", "### Unresolved imports / assets");
    for (const i of r.imports.slice(0, maxItems)) lines.push(`- ${i.kind}: "${i.spec}" in ${i.referencedBy} → expected ${i.expectedPath}`);
    if (r.imports.length > maxItems) lines.push(`- …and ${r.imports.length - maxItems} more`);
  }
  const missingEnv = r.environment.filter((e) => !e.configured);
  if (missingEnv.length) lines.push("", "### Missing environment variables", ...missingEnv.map((e) => `- ${e.key} (used in ${e.sources.slice(0, 2).join(", ")})`));
  if (r.unsupported.length) lines.push("", "### Runtime limits", ...r.unsupported.map((u) => `- ${u.reason}${u.blocking ? " (blocks preview)" : ""}: ${u.evidence}`));
  if (r.stages)
    lines.push("", "### Build stages", ...(["dependencies", "imports", "compile", "runtime", "preview"] as const).map((k) => `- ${k}: ${r.stages![k].status} — ${r.stages![k].detail}`));
  const so = r.previewDiagnostics.insights?.serverOnly ?? [];
  if (so.length) lines.push("", "### Server-only files (stubbed in preview)", ...so.slice(0, 20).map((x) => `- ${x.path}: ${x.apis.join(", ")}`));
  if (r.previewDiagnostics.runtimeErrors.length)
    lines.push("", "### Last preview errors", ...r.previewDiagnostics.runtimeErrors.slice(0, 10).map((e) => `- ${e}`));
  return lines.join("\n");
}

/** Adds missing packages to package.json (preview loads them from esm.sh). */
export function addMissingDependencies(pkgJson: string | undefined, rows: DepReportRow[]): { content: string; added: string[] } {
  let j: Pkg = {};
  try {
    j = pkgJson ? (JSON.parse(pkgJson) as Pkg) : {};
  } catch {
    j = {};
  }
  const added: string[] = [];
  j.dependencies = { ...(j.dependencies ?? {}) };
  for (const d of rows.filter((x) => x.status === "Missing")) {
    j.dependencies[d.name] = d.installed ? `^${d.installed}` : "latest";
    added.push(d.name);
  }
  return { content: `${JSON.stringify(j, null, 2)}\n`, added };
}

/** Everything the preview needs to resolve the repository. */
export interface PreviewOptions {
  aliases?: Array<{ alias: string; target: string }>;
  packages?: Record<string, string>;
  env?: Record<string, string>;
  /** Backend files that must never run in the preview (replaced with stubs). */
  excludePaths?: string[];
}

export function previewOptionsFrom(report: RepoReport | undefined, files: AnalyzerFile[], env: Record<string, string>): PreviewOptions {
  const packages: Record<string, string> = {};
  const pkg = readPkg(files, report?.classification.appRoot ? `${report.classification.appRoot}/package.json` : "package.json") ?? readPkg(files, "package.json");
  for (const [k, v] of Object.entries({ ...pkg?.dependencies })) packages[k] = v;
  for (const d of report?.dependencies ?? []) if (!packages[d.name] && !d.dev) packages[d.name] = d.installed ?? d.required;
  const split = report?.previewDiagnostics.insights?.codeSplit ?? {};
  const excludePaths = Object.entries(split).filter(([, side]) => side === "Backend").map(([p]) => p);
  return { aliases: report?.aliases ?? readAliases(files), packages, env, excludePaths };
}
