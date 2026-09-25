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
  installCommand: string;
  buildCommand: string;
  devCommand: string;
  priority: number;
}

/** Framework Registry — add new frameworks here; no framework rule is hardcoded elsewhere. */
export const FRAMEWORK_REGISTRY: FrameworkProfile[] = [
  { id: "nextjs", label: "Next.js", detectDeps: ["next"], detectFiles: ["next.config.js", "next.config.mjs", "next.config.ts"], mandatoryFiles: ["package.json"], anyOfFiles: [["app/layout.tsx", "src/app/layout.tsx", "pages/_app.tsx", "src/pages/_app.tsx", "app/layout.jsx", "pages/index.tsx", "pages/index.jsx"]], installCommand: "npm install", buildCommand: "npm run build", devCommand: "npm run dev", priority: 90 },
  { id: "react-native", label: "React Native", detectDeps: ["react-native"], detectFiles: ["app.json"], mandatoryFiles: ["package.json", "app.json"], installCommand: "npm install", buildCommand: "npx expo export", devCommand: "npx expo start", priority: 85 },
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
  { id: "aws", label: "AWS", requiredFiles: [] },
  { id: "azure", label: "Azure", requiredFiles: [] },
  { id: "static", label: "Static Hosting", requiredFiles: [["index.html", "public/index.html"]] },
  { id: "other", label: "Other", requiredFiles: [] },
];

export const NOT_DECIDED = "Not Decided Yet";

export const WIZARD_QUESTIONS = [
  { key: "hosting", label: "Hosting provider", options: ["Netlify", "Vercel", "AWS", "Azure", "Docker", "IIS", "Static Hosting", NOT_DECIDED, "Other"] },
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
  note?: string;
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

export interface AssuranceInput {
  files: AssuranceFile[];
  plannedFiles: string[];
  hostingId: string;
  runtime?: { installed: boolean; running: boolean; previewReady: boolean; fatalErrors: number } | undefined;
}

export interface AssuranceReport {
  at: string;
  framework: string | null;
  stages: StageReport[];
  compileAllowed: boolean;
  score: number;
  verified: boolean;
}

export function runAssurance(input: AssuranceInput): AssuranceReport {
  const files = input.files.filter((f) => !f.content.startsWith("data:") || !CODE_EXT.test(f.path));
  const set = new Set(files.map((f) => norm(f.path)));
  const byPath = new Map(files.map((f) => [norm(f.path), f.content]));
  const stages: StageReport[] = [];
  const push = (id: string, label: string, errors: string[], note?: string) =>
    stages.push({ id, label, result: errors.length ? "FAIL" : "PASS", errors, ...(note ? { note } : {}) });

  // 1 framework
  const fw = detectFramework(files);
  push("framework", "Framework Detection", fw ? [] : ["No registered framework matched the project files."], fw?.label);

  // 9 structure
  const structErr: string[] = [];
  if (fw) {
    for (const m of fw.mandatoryFiles) if (!hasFile(set, m)) structErr.push(`Missing mandatory file: ${m}`);
    for (const group of fw.anyOfFiles ?? []) if (!group.some((g) => hasFile(set, g))) structErr.push(`Missing one of: ${group.join(" | ")}`);
  }
  push("structure", "Repository Structure", structErr);

  // 4 closure
  const closure = input.plannedFiles.map(norm).filter((p) => !set.has(p)).map((p) => `Planned but not generated: ${p}`);
  push("closure", "Build Closure Audit", closure, input.plannedFiles.length ? `${input.plannedFiles.length} planned` : "No build plan — nothing to compare");

  // 5/6/7 graph
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
  push("packages", "Package Validation", pkgErr);

  // 8 host
  const host = HOST_REGISTRY.find((h) => h.label === input.hostingId || h.id === input.hostingId);
  const hostErr = (host?.requiredFiles ?? []).filter((g) => !g.some((x) => hasFile(set, x))).map((g) => `Missing host file for ${host!.label}: ${g.join(" | ")}`);
  push("host", "Host Profile Validation", hostErr, host?.label ?? input.hostingId);

  const compileAllowed = stages.every((s) => s.result === "PASS");

  // 10–15 runtime-backed stages (evidence from the real runtime; checks-first delivery)
  const rt = input.runtime;
  const pend = (id: string, label: string, ok: boolean | undefined, why: string) =>
    stages.push({ id, label, result: !compileAllowed || ok === undefined ? "PENDING" : ok ? "PASS" : "FAIL", errors: ok === false ? [why] : [], note: !compileAllowed ? "Blocked until pre-compile gates pass" : ok === undefined ? "Launch Runtime to collect evidence" : undefined });
  pend("install", "Dependency Install", rt?.installed, "Install did not complete");
  pend("compile", "Compile", undefined, "");
  stages[stages.length - 1]!.note = compileAllowed ? "Build-command check arrives in the next delivery" : "Blocked until pre-compile gates pass";
  pend("runtime", "Runtime", rt?.running, "Dev server did not start");
  pend("preview", "Preview", rt?.previewReady, "Preview not reachable");
  pend("routes", "Route Validation", undefined, "");
  stages[stages.length - 1]!.note = "Arrives in the next delivery";
  pend("fatal", "Fatal Runtime Errors", rt ? rt.fatalErrors === 0 : undefined, `${rt?.fatalErrors ?? 0} fatal errors`);

  const pass = stages.filter((s) => s.result === "PASS").length;
  const score = Math.round((pass / stages.length) * 100);
  return { at: new Date().toISOString(), framework: fw?.id ?? null, stages, compileAllowed, score, verified: score === 100 };
}

export type RepairMode = "auto" | "approval";
export interface AuditEntry {
  at: string;
  stage: string;
  result: StageResult;
  errors: number;
  repairs: string;
}
