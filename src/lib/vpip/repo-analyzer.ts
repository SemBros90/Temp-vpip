/**
 * Repository compatibility engine. Pure functions over the repository's files:
 * classification, dependency / import / alias / environment validation,
 * unsupported-runtime detection and a health score.
 */
import type {
  AliasEntry,
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

const NODE_BUILTINS = new Set(
  "assert buffer child_process cluster crypto dgram dns events fs http http2 https module net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib async_hooks inspector".split(
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
    fw.find((f) => !["Vite", "Monorepo", "Turborepo", "Nx Workspace", "Express"].includes(f)) ?? fw[0] ?? (rootPkg ? "Node.js" : "Static / unknown");
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
  for (const name of ["tsconfig.json", "tsconfig.app.json", "jsconfig.json"]) {
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
  const binaryMissing = (target: string) => BIN.test(target) && !dirs.has(dirname(target));
  const skipBinary = (target: string) => BIN.test(target) && !binaryMissing(target);

  for (const f of files) {
    if (!(CODE_RE.test(f.path) || STYLE_RE.test(f.path))) continue;
    if (/(^|\/)(node_modules|dist|build|\.next)\//.test(f.path) || /\.d\.ts$/.test(f.path)) continue;
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
      if (/^(node:|virtual:|~icons|https?:|data:|bun:|\$)/.test(spec)) continue;
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

export function healthScore(r: Pick<RepoReport, "dependencies" | "imports" | "environment" | "unsupported">, totalImports: number): RepoHealth {
  const pct = (bad: number, total: number) => (total <= 0 ? 100 : Math.max(0, Math.round(100 - (bad / total) * 100)));
  const badDeps = r.dependencies.filter((d) => d.status !== "OK").length;
  const dependencies = pct(badDeps, Math.max(r.dependencies.length, 1));
  const codeIssues = r.imports.filter((i) => i.kind !== "Missing asset").length;
  const assetIssues = r.imports.length - codeIssues;
  const imports = pct(codeIssues, Math.max(totalImports, 1));
  const assets = assetIssues === 0 ? 100 : Math.max(0, 100 - assetIssues * 10);
  const environment = pct(r.environment.filter((e) => !e.configured).length, r.environment.length);
  const blocking = r.unsupported.filter((u) => u.blocking).length;
  const warn = r.unsupported.length - blocking;
  const previewReadiness = blocking
    ? Math.max(0, 25 - blocking * 5)
    : Math.max(0, Math.round((imports + dependencies + environment) / 3) - warn * 8);
  const overall = Math.round(dependencies * 0.2 + imports * 0.25 + assets * 0.1 + environment * 0.15 + previewReadiness * 0.3);
  return { overall, dependencies, imports, assets, environment, previewReadiness };
}

/* ------------------------------------------------------------- analyse */

export type AnalysisResult = Omit<RepoReport, "id" | "createdAt" | "projectId">;

export function analyzeRepository(
  files: AnalyzerFile[],
  opts: { configuredEnv?: string[] | undefined; branch?: string | undefined; commitSha?: string | undefined; repositoryId?: string | undefined; buildSessionId?: string | undefined; previewDiagnostics?: PreviewDiagnostics | undefined } = {},
): AnalysisResult {
  const classification = classify(files);
  const aliases = readAliases(files, classification.appRoot);
  const declared = new Set<string>();
  for (const f of files.filter((x) => /(^|\/)package\.json$/.test(x.path))) {
    const j = readPkg(files, f.path);
    for (const k of Object.keys({ ...j?.dependencies, ...j?.devDependencies, ...j?.peerDependencies })) declared.add(k);
  }
  const { issues, usedPackages, total } = validateImports(files, aliases, declared);
  const dependencies = validateDependencies(files, usedPackages, classification.appRoot);
  const environment = scanEnv(files, new Set(opts.configuredEnv ?? []));
  const unsupported = detectUnsupported(files, classification, dependencies);
  const health = healthScore({ dependencies, imports: issues, environment, unsupported }, total);
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
    previewDiagnostics: opts.previewDiagnostics ?? { buildStatus: "Not run", repairs: [], runtimeErrors: [] },
    health,
  };
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
}

export function previewOptionsFrom(report: RepoReport | undefined, files: AnalyzerFile[], env: Record<string, string>): PreviewOptions {
  const packages: Record<string, string> = {};
  const pkg = readPkg(files, report?.classification.appRoot ? `${report.classification.appRoot}/package.json` : "package.json") ?? readPkg(files, "package.json");
  for (const [k, v] of Object.entries({ ...pkg?.dependencies })) packages[k] = v;
  for (const d of report?.dependencies ?? []) if (!packages[d.name] && !d.dev) packages[d.name] = d.installed ?? d.required;
  return { aliases: report?.aliases ?? readAliases(files), packages, env };
}
