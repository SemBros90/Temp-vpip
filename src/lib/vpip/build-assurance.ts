/**
 * VPIP-L1-BAF-001 — Build Assurance Framework (Layer 1, checks-first).
 * Pure module: registries, wizard, assumption engine, pre-compile gates, certificate.
 * Applies to AI-generated builds only. Imported repositories keep the runtime-first rule.
 */

export interface FrameworkProfile {
  id: string;
  label: string;
  /** detection: any listed dependency OR any listed file */
  detectDeps: string[];
  detectFiles: string[];
  mandatoryFiles: string[];
  /** alternatives: at least one of each group must exist */
  anyOfFiles?: string[][];
  /** folders that must contain at least one file */
  requiredDirs?: string[];
  installCommand: string;
  buildCommand: string;
  devCommand: string;
  priority: number;
}

/** Framework Registry — add new frameworks here; no framework rule is hardcoded elsewhere. */
export const FRAMEWORK_REGISTRY: FrameworkProfile[] = [
  { id: "nextjs", label: "Next.js", detectDeps: ["next"], detectFiles: ["next.config.js", "next.config.mjs", "next.config.ts"], mandatoryFiles: ["package.json"], anyOfFiles: [["next.config.js", "next.config.mjs", "next.config.ts"], ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "pages/_app.tsx", "src/pages/_app.tsx", "pages/_app.jsx"], ["app/page.tsx", "src/app/page.tsx", "app/page.jsx", "pages/index.tsx", "src/pages/index.tsx", "pages/index.jsx"]], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 90 },
  { id: "flutter", label: "Flutter", detectDeps: [], detectFiles: ["pubspec.yaml"], mandatoryFiles: ["pubspec.yaml", "lib/main.dart"], installCommand: "flutter pub get", buildCommand: "flutter build web", devCommand: "flutter run -d web-server", priority: 88 },
  { id: "react-native", label: "React Native", detectDeps: ["react-native"], detectFiles: ["app.json"], mandatoryFiles: ["package.json"], anyOfFiles: [["App.tsx", "App.js", "App.jsx", "src/App.tsx"]], requiredDirs: ["android", "ios"], installCommand: "npm install", buildCommand: "npx expo export", devCommand: "npx expo start", priority: 85 },
  { id: "electron", label: "Electron", detectDeps: ["electron"], detectFiles: [], mandatoryFiles: ["package.json"], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm start", priority: 80 },
  { id: "capacitor", label: "Capacitor", detectDeps: ["@capacitor/core"], detectFiles: ["capacitor.config.ts", "capacitor.config.json"], mandatoryFiles: ["package.json"], anyOfFiles: [["capacitor.config.ts", "capacitor.config.json"]], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 78 },
  { id: "angular", label: "Angular", detectDeps: ["@angular/core"], detectFiles: ["angular.json"], mandatoryFiles: ["package.json", "angular.json", "tsconfig.json", "src/main.ts"], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm start", priority: 75 },
  { id: "svelte", label: "Svelte / SvelteKit", detectDeps: ["svelte", "@sveltejs/kit"], detectFiles: ["svelte.config.js"], mandatoryFiles: ["package.json"], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 70 },
  { id: "vue", label: "Vue", detectDeps: ["vue"], detectFiles: [], mandatoryFiles: ["package.json", "index.html"], anyOfFiles: [["src/main.ts", "src/main.js"], ["src/App.vue"]], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 65 },
  { id: "react-vite", label: "React + Vite", detectDeps: ["vite"], detectFiles: ["vite.config.ts", "vite.config.js"], mandatoryFiles: ["package.json", "index.html"], anyOfFiles: [["src/main.tsx", "src/main.jsx"], ["src/App.tsx", "src/App.jsx"], ["vite.config.ts", "vite.config.js", "vite.config.mjs"], ["tsconfig.json", "jsconfig.json"]], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 60 },
  { id: "node-api", label: "Node API", detectDeps: ["express", "fastify", "koa", "hono"], detectFiles: [], mandatoryFiles: ["package.json"], installCommand: "npm install", buildCommand: "npm run build --if-present", devCommand: "npm run dev", priority: 50 },
  { id: "fastapi", label: "FastAPI", detectDeps: [], detectFiles: ["requirements.txt", "pyproject.toml"], mandatoryFiles: [], anyOfFiles: [["requirements.txt", "pyproject.toml"], ["main.py", "app/main.py"]], installCommand: "pip install -r requirements.txt", buildCommand: "python -m compileall .", devCommand: "uvicorn main:app", priority: 40 },
  { id: "django", label: "Django", detectDeps: [], detectFiles: ["manage.py"], mandatoryFiles: ["manage.py"], anyOfFiles: [["requirements.txt", "pyproject.toml"]], installCommand: "pip install -r requirements.txt", buildCommand: "python manage.py check", devCommand: "python manage.py runserver", priority: 45 },
  { id: "laravel", label: "Laravel", detectDeps: [], detectFiles: ["artisan"], mandatoryFiles: ["artisan", "composer.json"], installCommand: "composer install", buildCommand: "php artisan optimize", devCommand: "php artisan serve", priority: 45 },
  { id: "aspnet", label: "ASP.NET", detectDeps: [], detectFiles: [".csproj"], mandatoryFiles: [], anyOfFiles: [[".csproj"], ["Program.cs"]], installCommand: "dotnet restore", buildCommand: "dotnet build", devCommand: "dotnet run", priority: 45 },
  { id: "spring-boot", label: "Spring Boot", detectDeps: [], detectFiles: ["pom.xml", "build.gradle"], mandatoryFiles: [], anyOfFiles: [["pom.xml", "build.gradle", "build.gradle.kts"]], installCommand: "mvn -q dependency:resolve", buildCommand: "mvn -q package", devCommand: "mvn spring-boot:run", priority: 45 },
  { id: "static", label: "Static Website", detectDeps: [], detectFiles: ["index.html"], mandatoryFiles: ["index.html"], installCommand: "", buildCommand: "", devCommand: "npx serve .", priority: 1 },
];

export interface HostProfile {
  id: string;
  label: string;
  /** any one of each group must exist */
  requiredFiles: string[][];
}

/** Host Profile Registry — host-specific files are configured here only. */
export const HOST_REGISTRY: HostProfile[] = [
  { id: "netlify", label: "Netlify", requiredFiles: [["netlify.toml"]] },
  { id: "vercel", label: "Vercel", requiredFiles: [["vercel.json"]] },
  { id: "docker", label: "Docker", requiredFiles: [["Dockerfile"]] },
  { id: "iis", label: "IIS", requiredFiles: [["web.config", "public/web.config"]] },
  { id: "github-pages", label: "GitHub Pages", requiredFiles: [["index.html", "public/index.html"]] },
  { id: "cloudflare-pages", label: "Cloudflare Pages", requiredFiles: [] },
  { id: "custom", label: "Custom Server", requiredFiles: [] },
  { id: "aws", label: "AWS", requiredFiles: [] },
  { id: "azure", label: "Azure", requiredFiles: [] },
  { id: "static", label: "Static Hosting", requiredFiles: [["index.html", "public/index.html"]] },
  { id: "other", label: "Other", requiredFiles: [] },
];

export const NOT_DECIDED = "Not Decided Yet";

export const WIZARD_QUESTIONS = [
  { key: "hosting", label: "Hosting provider", options: ["Netlify", "Vercel", "GitHub Pages", "Cloudflare Pages", "AWS", "Azure", "Docker", "IIS", "Static Hosting", "Custom Server", NOT_DECIDED, "Other"] },
  { key: "repository", label: "Repository provider", options: ["GitHub", "GitLab", "Bitbucket", "Local Only", NOT_DECIDED] },
  { key: "database", label: "Database provider", options: ["Supabase", "PostgreSQL", "MySQL", "SQL Server", "MongoDB", NOT_DECIDED] },
  { key: "auth", label: "Authentication provider", options: ["Google", "Microsoft", "Email/Password", "OTP", "None", NOT_DECIDED] },
  { key: "email", label: "Email provider", options: ["SendGrid", "Mailgun", "Amazon SES", "Brevo", "Zoho", NOT_DECIDED] },
  { key: "storage", label: "Storage provider", options: ["Supabase Storage", "AWS S3", "Azure Blob", "Google Cloud Storage", "Local Storage", NOT_DECIDED] },
] as const;

export type WizardKey = (typeof WIZARD_QUESTIONS)[number]["key"];
export type BuildConfig = Partial<Record<WizardKey, string>>;

/** Assumption Engine defaults for "Not Decided Yet". */
const DEFAULTS: Record<WizardKey, { value: string; note: string }> = {
  hosting: { value: "Netlify", note: "Default Netlify profile selected." },
  repository: { value: "Local Only", note: "Project kept in VPIP only." },
  database: { value: "Supabase", note: "Default Supabase profile selected." },
  auth: { value: "Email/Password", note: "Email/Password template used." },
  email: { value: "Disabled", note: "Email services disabled." },
  storage: { value: "Supabase Storage", note: "Default Supabase Storage profile selected." },
};

export interface Assumption {
  code: string;
  key: WizardKey;
  statement: string;
  resolved: string;
  createdAt: string;
}

export function resolveConfig(config: BuildConfig): { effective: Record<WizardKey, string>; assumptions: Assumption[] } {
  const effective = {} as Record<WizardKey, string>;
  const assumptions: Assumption[] = [];
  const now = new Date().toISOString();
  for (const q of WIZARD_QUESTIONS) {
    const v = config[q.key];
    if (!v || v === NOT_DECIDED) {
      const d = DEFAULTS[q.key];
      effective[q.key] = d.value;
      assumptions.push({
        code: `A-${String(assumptions.length + 1).padStart(3, "0")}`,
        key: q.key,
        statement: `${q.label} not specified. ${d.note}`,
        resolved: d.value,
        createdAt: now,
      });
    } else effective[q.key] = v;
  }
  return { effective, assumptions };
}

// ---------------------------------------------------------------- checks

export type StageResult = "PASS" | "FAIL" | "PENDING";
export interface StageReport {
  id: string;
  label: string;
  result: StageResult;
  errors: string[];
  note?: string | undefined;
}

export interface AssuranceFile {
  path: string;
  content: string;
}

const norm = (p: string) => p.replace(/^\/+/, "").replace(/^\.\//, "");
const CODE_EXT = /\.(m?[jt]sx?|cjs)$/i;
const RESOLVE_EXT = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".json", ".css", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"];
const BUILTINS = new Set("assert buffer child_process cluster crypto dgram dns events fs http http2 https net os path perf_hooks process querystring readline stream string_decoder timers tls tty url util v8 vm worker_threads zlib".split(" "));

function hasFile(set: Set<string>, name: string) {
  if (name.startsWith(".")) return [...set].some((p) => p.endsWith(name));
  return set.has(name);
}

function pkgDeps(files: AssuranceFile[]): Set<string> | null {
  const f = files.find((x) => norm(x.path) === "package.json");
  if (!f) return null;
  try {
    const j = JSON.parse(f.content) as Record<string, Record<string, string> | undefined>;
    return new Set([...Object.keys(j["dependencies"] ?? {}), ...Object.keys(j["devDependencies"] ?? {}), ...Object.keys(j["peerDependencies"] ?? {})]);
  } catch {
    return new Set();
  }
}

export function detectFramework(files: AssuranceFile[]): FrameworkProfile | null {
  const set = new Set(files.map((f) => norm(f.path)));
  const deps = pkgDeps(files) ?? new Set<string>();
  const hits = FRAMEWORK_REGISTRY.filter(
    (fw) => fw.detectDeps.some((d) => deps.has(d)) || fw.detectFiles.some((n) => hasFile(set, n)),
  ).sort((a, b) => b.priority - a.priority);
  return hits[0] ?? null;
}

interface ImportRef { from: string; spec: string; names: string[] }

function parseImports(path: string, src: string): ImportRef[] {
  const out: ImportRef[] = [];
  const re = /(?:import|export)\s+(type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']|import\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
  for (const m of src.matchAll(re)) {
    const spec = m[3] ?? m[4] ?? m[5];
    if (!spec) continue;
    const names: string[] = [];
    if (m[3] && !m[1]) {
      const clause = m[2] ?? "";
      const braces = /\{([\s\S]*?)\}/.exec(clause);
      if (braces && !/^\s*export/.test(m[0]) ) {
        for (const part of braces[1]!.split(",")) {
          const t = part.trim().replace(/^type\s+/, "");
          if (!t || part.trim().startsWith("type ")) continue;
          names.push(t.split(/\s+as\s+/)[0]!.trim());
        }
      }
      const def = clause.replace(/\{[\s\S]*\}/, "").replace(/\*\s+as\s+\w+/, "").split(",")[0]!.trim();
      if (def && /^[A-Za-z_$][\w$]*$/.test(def) && !/^export/.test(m[0])) names.push("default");
    }
    out.push({ from: path, spec, names });
  }
  return out;
}

function exportsOf(src: string): { names: Set<string>; star: boolean } {
  const names = new Set<string>();
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|class|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]!);
  if (/export\s+default\b/.test(src)) names.add("default");
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g))
    for (const part of m[1]!.split(",")) {
      const t = part.trim().replace(/^type\s+/, "");
      if (t) names.add((t.split(/\s+as\s+/)[1] ?? t).trim());
    }
  return { names, star: /export\s+\*\s+from/.test(src) };
}

function resolveLocal(fromPath: string, spec: string, set: Set<string>): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = "src/" + spec.slice(2);
  else if (spec.startsWith("~/")) base = "src/" + spec.slice(2);
  else {
    const parts = norm(fromPath).split("/");
    parts.pop();
    for (const seg of spec.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    base = parts.join("/");
  }
  for (const ext of RESOLVE_EXT) if (set.has(base + ext)) return base + ext;
  return null;
}

const isLocal = (s: string) => s.startsWith(".") || s.startsWith("/") || s.startsWith("@/") || s.startsWith("~/");
const pkgName = (s: string) => (s.startsWith("@") ? s.split("/").slice(0, 2).join("/") : s.split("/")[0]!);

export interface AssuranceRequirement { code: string; title: string; status: string; files: string[] }

export interface AssuranceInput {
  files: AssuranceFile[];
  plannedFiles: string[];
  hostingId: string;
  requirements?: AssuranceRequirement[] | undefined;
  runtime?: { installed: boolean; running: boolean; previewReady: boolean; fatalErrors: number } | undefined;
}

export interface CompletenessResult {
  planned: string[];
  created: string[];
  missing: string[];
  extra: string[];
  complete: boolean;
}

/** Phase 0 — Generation Completeness Gate: planned vs created registries. */
export function checkCompleteness(files: AssuranceFile[], plannedFiles: string[]): CompletenessResult {
  const created = [...new Set(files.filter((f) => f.content.trim().length > 0).map((f) => norm(f.path)))].sort();
  const createdSet = new Set(created);
  const planned = [...new Set(plannedFiles.map(norm))].sort();
  const plannedSet = new Set(planned);
  const missing = planned.filter((p) => !createdSet.has(p));
  const extra = created.filter((p) => !plannedSet.has(p));
  return { planned, created, missing, extra, complete: missing.length === 0 };
}

export type MissingSource = "framework" | "planned" | "import" | "route";
export interface ExpectedFile { path: string; sources: MissingSource[]; referencedBy: string[] }
export interface MissingFilesResult { expected: ExpectedFile[]; missing: ExpectedFile[] }

/**
 * Missing File Elimination — Expected Files = Framework Registry ∪ Planned Files ∪ Import Targets ∪ Route Targets.
 * Route targets are routed components whose import points to a file that does not exist.
 */
export function computeMissingFiles(files: AssuranceFile[], plannedFiles: string[]): MissingFilesResult {
  const present = files.filter((f) => f.content.trim().length > 0);
  const set = new Set(present.map((f) => norm(f.path)));
  const map = new Map<string, ExpectedFile>();
  const add = (path: string, src: MissingSource, by?: string) => {
    const p = norm(path);
    const e = map.get(p) ?? { path: p, sources: [], referencedBy: [] };
    if (!e.sources.includes(src)) e.sources.push(src);
    if (by && !e.referencedBy.includes(by)) e.referencedBy.push(by);
    map.set(p, e);
  };
  const fa = auditFrameworkFiles(files, plannedFiles);
  for (const r of fa.rows) {
    if (r.required.endsWith("/")) continue;
    if (r.exists) add(r.found ?? r.required, "framework");
    else if (!r.required.startsWith(".")) add(r.required, "framework");
  }
  for (const p of plannedFiles) add(p, "planned");
  for (const f of present) {
    const p = norm(f.path);
    if (!CODE_EXT.test(p) || p.startsWith("node_modules/")) continue;
    const routed = new Set([
      ...[...f.content.matchAll(/element=\{\s*<([A-Z][\w$]*)/g)].map((m) => m[1]!),
      ...[...f.content.matchAll(/component[=:]\s*\{?\s*([A-Z][\w$]*)/g)].map((m) => m[1]!),
    ]);
    for (const ref of parseImports(p, f.content)) {
      if (!isLocal(ref.spec) || ref.spec.startsWith("/")) continue;
      const hit = resolveLocal(p, ref.spec, set);
      let target = hit;
      if (!target) {
        const base = ref.spec.startsWith("@/") || ref.spec.startsWith("~/") ? "src/" + ref.spec.slice(2)
          : (() => { const parts = p.split("/"); parts.pop(); for (const s of ref.spec.split("/")) { if (s === "." || !s) continue; if (s === "..") parts.pop(); else parts.push(s); } return parts.join("/"); })();
        const hasExt = /\.[a-z0-9]+$/i.test(base.split("/").pop() ?? "");
        target = hasExt ? base : base + (/\.(t|j)sx$/.test(p) ? (p.endsWith("x") && /\.tsx$/.test(p) ? ".tsx" : ".jsx") : /\.js$|\.mjs$/.test(p) ? ".js" : ".ts");
      }
      const isRoute = ref.names.includes("default") && [...routed].some((n) => new RegExp(`import\\s+${n}\\b[^;]*["']${ref.spec.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`).test(f.content));
      add(target, isRoute ? "route" : "import", p);
    }
  }
  const expected = [...map.values()].sort((a, b) => a.path.localeCompare(b.path));
  return { expected, missing: expected.filter((e) => !set.has(e.path)) };
}

export type IntegrityStatus = "VALID" | "INVALID" | "MISSING";
export interface FrameworkFileRow { required: string; expected: string; exists: boolean; found?: string | undefined; valid?: boolean | undefined; status?: IntegrityStatus | undefined; problems?: string[] | undefined }
export interface FrameworkFileAudit { framework: string | null; source: "files" | "plan" | "source-inference" | "none"; rows: FrameworkFileRow[]; complete: boolean }

function parseJsonc(src: string): unknown {
  const stripped = src
    .replace(/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (m, s: string | undefined) => s ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(stripped);
}
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Required File Integrity rules — minimum structure per file type. Unknown file types pass if non-empty. */
export function checkFileIntegrity(path: string, content: string): string[] {
  const p = norm(path);
  const base = p.split("/").pop() ?? p;
  const errs: string[] = [];
  if (!content.trim()) return ["File is empty"];
  if (base === "package.json") {
    let j: unknown;
    try { j = JSON.parse(content); } catch (e) { return [`Invalid JSON: ${(e as Error).message}`]; }
    if (!isObj(j)) return ["Not a JSON object"];
    if (typeof j["name"] !== "string" || !j["name"]) errs.push("Missing \"name\"");
    if (!isObj(j["scripts"]) || !Object.keys(j["scripts"]).length) errs.push("Missing \"scripts\"");
    if (!isObj(j["dependencies"]) || !Object.keys(j["dependencies"]).length) errs.push("Missing \"dependencies\"");
  } else if (/^(ts|js)config(\.[\w-]+)?\.json$/.test(base)) {
    let j: unknown;
    try { j = parseJsonc(content); } catch (e) { return [`Invalid JSON: ${(e as Error).message}`]; }
    if (!isObj(j)) return ["Not a JSON object"];
    if (!isObj(j["compilerOptions"]) && !Array.isArray(j["references"]) && !j["extends"] && !Array.isArray(j["include"]) && !Array.isArray(j["files"]))
      errs.push("No compilerOptions, extends, references, include or files");
  } else if (base === "index.html") {
    if (!/<html[\s>]/i.test(content) && !/<body[\s>]/i.test(content)) errs.push("No <html> or <body> element");
    if (!/<[a-z]+[^>]*\bid\s*=\s*["'](root|app)["']/i.test(content)) errs.push("No root mount element (id=\"root\" or id=\"app\")");
  } else if (/^vite\.config\.(m?[jt]s)$/.test(base)) {
    if (!/export\s+default/.test(content) && !/module\.exports/.test(content)) errs.push("No default export of a Vite configuration");
    if (!/defineConfig|plugins\s*:|\{[\s\S]*\}/.test(content)) errs.push("No configuration object");
  } else if (/^src\/main\.(t|j)sx$/.test(p)) {
    if (!/createRoot\s*\([\s\S]*?\)\s*\.render\s*\(|hydrateRoot\s*\(|ReactDOM\.render\s*\(/.test(content)) errs.push("No React entry render (createRoot(...).render / hydrateRoot / ReactDOM.render)");
  } else if (/(^|\/)App\.(t|j)sx$/.test(p)) {
    if (!/export\s+default\b/.test(content) && !/export\s+(function|const|class)\s+App\b/.test(content) && !/export\s*\{[^}]*\bApp\b/.test(content)) errs.push("No component export (export default / export App)");
  } else if (/^next\.config\./.test(base)) {
    if (!/export\s+default|module\.exports/.test(content)) errs.push("No exported Next.js configuration");
  }
  return errs;
}

/**
 * Framework Required File Audit — independent of Planned Files and Import Validation.
 * Scans the whole project root. If the framework cannot be detected from the files themselves
 * (e.g. package.json / vite.config are the missing files), it is inferred from the build plan,
 * then from source extensions, so missing root files cannot hide the framework.
 * Each existing file is also integrity-checked; invalid counts as a failure exactly like missing.
 */
export function auditFrameworkFiles(files: AssuranceFile[], plannedFiles: string[] = []): FrameworkFileAudit {
  const present = files.filter((f) => f.content.trim().length > 0);
  const set = new Set(present.map((f) => norm(f.path)));
  const byPath = new Map(present.map((f) => [norm(f.path), f.content]));
  let fw = detectFramework(present);
  let source: FrameworkFileAudit["source"] = fw ? "files" : "none";
  if (!fw && plannedFiles.length) { fw = detectFramework(plannedFiles.map((p) => ({ path: p, content: "" }))); if (fw) source = "plan"; }
  if (!fw || fw.id === "static") {
    const all = [...set, ...plannedFiles.map(norm)];
    if (all.some((p) => /^src\/.*\.(t|j)sx$/.test(p))) { fw = FRAMEWORK_REGISTRY.find((f) => f.id === "react-vite")!; source = "source-inference"; }
  }
  if (!fw) return { framework: null, source: "none", rows: [], complete: false };
  const resolvePath = (name: string) => (name.startsWith(".") ? [...set].find((p) => p.endsWith(name)) : set.has(name) ? name : undefined);
  const finish = (row: Omit<FrameworkFileRow, "valid" | "status" | "problems">, path: string | undefined): FrameworkFileRow => {
    if (!row.exists || !path) return { ...row, valid: false, status: "MISSING", problems: [] };
    const problems = checkFileIntegrity(path, byPath.get(path) ?? "");
    return { ...row, valid: problems.length === 0, status: problems.length ? "INVALID" : "VALID", problems };
  };
  const rows: FrameworkFileRow[] = [];
  for (const m of fw.mandatoryFiles) { const hit = resolvePath(m); rows.push(finish({ required: m, expected: `/${m} (project root)`, exists: !!hit }, hit)); }
  for (const g of fw.anyOfFiles ?? []) {
    const found = g.find((x) => hasFile(set, x));
    rows.push(finish({ required: g[0]!, expected: g.map((x) => "/" + x).join(" | "), exists: !!found, found }, found ? resolvePath(found) : undefined));
  }
  for (const d of fw.requiredDirs ?? []) {
    const ok = [...set].some((p) => p.startsWith(d + "/"));
    rows.push({ required: d + "/", expected: `/${d}/ (non-empty)`, exists: ok, valid: ok, status: ok ? "VALID" : "MISSING", problems: [] });
  }
  return { framework: fw.id, source, rows, complete: rows.every((r) => r.status === "VALID") };
}

export interface AssuranceReport {
  at: string;
  framework: string | null;
  stages: StageReport[];
  completeness?: CompletenessResult | undefined;
  frameworkFiles?: FrameworkFileAudit | undefined;
  compileAllowed: boolean;
  score: number;
  verified: boolean;
}

function routeTargetErrors(path: string, src: string): string[] {
  const out: string[] = [];
  const declared = new Set<string>();
  for (const m of src.matchAll(/import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["'][^"']+["']/g)) {
    for (const id of m[1]!.replace(/[{}]/g, ",").split(",")) {
      const t = id.trim().split(/\s+as\s+/).pop()!.replace(/^\*\s+as\s+/, "").trim();
      if (t) declared.add(t);
    }
  }
  for (const m of src.matchAll(/(?:function|const|let|var|class)\s+([A-Z][\w$]*)/g)) declared.add(m[1]!);
  const refs = [
    ...[...src.matchAll(/element=\{\s*<([A-Z][\w$]*)/g)].map((m) => m[1]!),
    ...[...src.matchAll(/component[=:]\s*\{?\s*([A-Z][\w$]*)\s*\}?/g)].map((m) => m[1]!),
  ];
  for (const r of new Set(refs)) if (!declared.has(r)) out.push(`${path}: route target <${r}> is not defined or imported`);
  return out;
}

export function runAssurance(input: AssuranceInput): AssuranceReport {
  const files = input.files.filter((f) => !f.content.startsWith("data:") || !CODE_EXT.test(f.path));
  const set = new Set(files.map((f) => norm(f.path)));
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));
  const stages: StageReport[] = [];
  const push = (id: string, label: string, errors: string[], note?: string) =>
    stages.push({ id, label, result: errors.length ? "FAIL" : "PASS", errors, ...(note ? { note } : {}) });
  const blocked = (id: string, label: string, why: string) => stages.push({ id, label, result: "PENDING", errors: [], note: why });

  const LATER = [["framework", "Framework Validation"], ["structure", "File Validation"], ["routes", "Route Validation"], ["imports", "Import Validation"], ["exports", "Export Validation"], ["packages", "Dependency Validation"], ["features", "Feature Completeness"], ["host", "Host Profile Validation"], ["compile", "Compile Validation"], ["runtime", "Runtime Validation"], ["preview", "Preview Validation"]] as const;

  // Pre-gate — Framework Required File Audit (independent of plan and imports; fails immediately)
  const frameworkFiles = auditFrameworkFiles(files, input.plannedFiles);
  push("framework-files", "Framework Required File Audit",
    frameworkFiles.framework ? frameworkFiles.rows.filter((r) => r.status !== "VALID").map((r) => r.status === "INVALID" ? `Framework critical file invalid: ${r.found ?? r.required} — ${(r.problems ?? []).join("; ")}` : `Framework critical file missing: ${r.expected}`) : ["Framework could not be determined from files, plan or sources."],
    frameworkFiles.framework ? `${frameworkFiles.framework} (detected from ${frameworkFiles.source})` : undefined);

  // Phase 0 — Generation Completeness Gate
  const completeness = checkCompleteness(files, input.plannedFiles);
  push("completeness", "Generation Completeness", completeness.missing.map((m) => `Planned but not generated: ${m}`),
    input.plannedFiles.length ? `${completeness.created.length} created / ${completeness.planned.length} planned` : "No build plan — nothing planned to compare");
  // Phase 0b — Missing File Elimination (framework + planned + import targets + route targets)
  const missingFiles = computeMissingFiles(files, input.plannedFiles);
  push("missing-files", "Missing File Count", missingFiles.missing.map((m) => `Missing: ${m.path} (${m.sources.join(", ")})`),
    `${missingFiles.missing.length} missing of ${missingFiles.expected.length} expected`);
  if (!frameworkFiles.complete || !completeness.complete || missingFiles.missing.length) {
    const why = !frameworkFiles.complete ? "Blocked — framework-critical file missing or invalid" : missingFiles.missing.length ? "Blocked — Missing File Count must be 0" : "Blocked by Generation Completeness Gate";
    for (const [id, label] of LATER) blocked(id, label, why);
    return { at: new Date().toISOString(), framework: frameworkFiles.framework, stages, completeness, frameworkFiles, missingFiles, compileAllowed: false, score: 0, verified: false };
  }

  // Phase 1 — framework
  const fw = detectFramework(files);
  push("framework", "Framework Validation", fw ? [] : ["No registered framework matched the project files."], fw?.label);

  // Phase 2 — framework required files (already enforced by the audit above)
  const structErr: string[] = [];
  push("structure", "File Validation", structErr);

  // routes
  const routeErr: string[] = [];
  for (const f of files) {
    const p = norm(f.path);
    if (/\.(t|j)sx$/.test(p) && !p.startsWith("node_modules/")) routeErr.push(...routeTargetErrors(p, f.content));
  }
  push("routes", "Route Validation", routeErr);

  // imports / exports / packages
  const importErr: string[] = [];
  const exportErr: string[] = [];
  const pkgMissing = new Set<string>();
  const deps = pkgDeps(files);
  for (const f of files) {
    const p = norm(f.path);
    if (!CODE_EXT.test(p) || p.startsWith("node_modules/")) continue;
    for (const ref of parseImports(p, f.content)) {
      if (isLocal(ref.spec)) {
        const target = resolveLocal(p, ref.spec, set);
        if (!target) { importErr.push(`${p} → "${ref.spec}" (no file)`); continue; }
        if (!CODE_EXT.test(target) || !ref.names.length) continue;
        const ex = exportsOf(byPath.get(target) ?? "");
        if (ex.star) continue;
        for (const n of ref.names) if (!ex.names.has(n)) exportErr.push(`${p} imports ${n === "default" ? "default export" : `{ ${n} }`} from ${target} — not exported`);
      } else {
        const name = pkgName(ref.spec.replace(/^node:/, ""));
        if (ref.spec.startsWith("node:") || BUILTINS.has(name) || /^(virtual|https?):/.test(ref.spec)) continue;
        if (deps && !deps.has(name)) pkgMissing.add(name);
      }
    }
  }
  push("imports", "Import Validation", importErr);
  push("exports", "Export Validation", exportErr);
  const pkgErr = deps === null && fw && fw.mandatoryFiles.includes("package.json") ? ["package.json missing"] : [...pkgMissing].sort().map((n) => `Package not in manifest: ${n}`);
  push("packages", "Dependency Validation", pkgErr);

  // feature completeness — every user requirement must be satisfied by existing files
  const featErr: string[] = [];
  for (const r of input.requirements ?? []) {
    if (r.status === "Failed" || r.status === "Blocked") featErr.push(`${r.code} ${r.title} — status ${r.status}`);
    else if (!r.files.map(norm).some((x) => set.has(x))) featErr.push(`${r.code} ${r.title} — no generated file implements it`);
  }
  push("features", "Feature Completeness", featErr, input.requirements?.length ? `${input.requirements.length} requirements` : "No registered requirements");

  // host
  const host = HOST_REGISTRY.find((h) => h.label === input.hostingId || h.id === input.hostingId);
  const hostErr = (host?.requiredFiles ?? []).filter((g) => !g.some((x) => hasFile(set, x))).map((g) => `Missing host file for ${host!.label}: ${g.join(" | ")}`);
  push("host", "Host Profile Validation", hostErr, host?.label ?? input.hostingId);

  const compileAllowed = stages.every((s) => s.result === "PASS");

  // runtime-backed stages
  const rt = input.runtime;
  const pend = (id: string, label: string, ok: boolean | undefined, why: string, noteIfUnknown: string) =>
    stages.push({ id, label, result: !compileAllowed || ok === undefined ? "PENDING" : ok ? "PASS" : "FAIL", errors: ok === false ? [why] : [], note: !compileAllowed ? "Blocked until pre-compile gates pass" : ok === undefined ? noteIfUnknown : undefined });
  pend("compile", "Compile Validation", rt ? rt.installed && rt.running : undefined, "Install or compile did not complete", "Launch Runtime to collect evidence");
  pend("runtime", "Runtime Validation", rt ? rt.running && rt.fatalErrors === 0 : undefined, "Dev server did not start cleanly", "Launch Runtime to collect evidence");
  pend("preview", "Preview Validation", rt?.previewReady, "Preview not reachable", "Launch Runtime to collect evidence");

  const pass = stages.filter((s) => s.result === "PASS").length;
  const score = Math.round((pass / stages.length) * 100);
  return { at: new Date().toISOString(), framework: fw?.id ?? null, stages, completeness, compileAllowed, score, verified: stages.every((s) => s.result === "PASS") };
}

export type RepairMode = "auto" | "approval";
export interface AuditEntry {
  at: string;
  stage: string;
  result: StageResult;
  errors: number;
  repairs: string;
}
