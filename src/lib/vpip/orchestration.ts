import { transform } from "sucrase";
import { completeChat, extractJson } from "./ai";
import { FOLDER_KEEP, fileName, normalizePath } from "./coder-fs";
import type {
  BuildHealth,
  BuildPlan,
  BuildRequirement,
  CoderFile,
  ProviderConfig,
  ProviderId,
  ValidationIssue,
  ValidationReport,
} from "./types";

/**
 * Module 16 — Build Orchestration.
 * VPIP acts as a build manager: requirements first, plan second, validated
 * dependencies and a bootable application before any feature generation.
 */

/* ------------------------------------------- 1. requirement extraction */

const NOISE = /^(?:and|or|the|then|also|etc|note|notes|rules?|goal|goals)$/i;

function cleanLine(raw: string) {
  return raw
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/[*_`]/g, "")
    .trim();
}

/** Heuristic extraction so the register works without an AI engine key. */
export function extractRequirements(markdown: string): { title: string; detail: string }[] {
  const out: { title: string; detail: string }[] = [];
  const seen = new Set<string>();
  for (const raw of markdown.split("\n")) {
    if (!/^\s*(?:[-*+]|\d+[.)]|#{2,6})\s+/.test(raw)) continue;
    const text = cleanLine(raw);
    if (text.length < 6 || NOISE.test(text)) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: text.length > 90 ? `${text.slice(0, 88)}…` : text, detail: text });
    if (out.length >= 120) break;
  }
  return out;
}

export function requirementCode(index: number) {
  return `REQ-${String(index + 1).padStart(3, "0")}`;
}

export function buildRequirements(
  buildSessionId: string,
  items: { title: string; detail: string }[],
  at: string,
): BuildRequirement[] {
  return items.map((item, i) => ({
    id: `${buildSessionId}-req-${i + 1}`,
    code: requirementCode(i),
    title: item.title,
    detail: item.detail,
    status: "Not Started",
    files: [],
    buildSessionId,
    createdAt: at,
    updatedAt: at,
  }));
}

const REQ_SYSTEM = `You extract build requirements from a software prompt.
Return ONLY one fenced JSON array: [{"title":"short requirement","detail":"one sentence"}].
Every requirement must be independently verifiable. No preamble, no commentary.`;

export async function extractRequirementsWithAi(
  provider: ProviderId,
  cfg: ProviderConfig,
  promptText: string,
): Promise<{ title: string; detail: string }[]> {
  const raw = await completeChat(provider, cfg, [
    { role: "system", content: REQ_SYSTEM },
    { role: "user", content: promptText.slice(0, 24000) },
  ]);
  const parsed = extractJson<{ title?: unknown; detail?: unknown }[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((x) => ({
      title: typeof x?.title === "string" ? x.title.trim() : "",
      detail: typeof x?.detail === "string" ? x.detail.trim() : "",
    }))
    .filter((x) => x.title.length > 2)
    .slice(0, 120);
}

/* ------------------------------------------------- 2. build planning */

export function buildPlanPrompt(promptText: string, requirements: BuildRequirement[]) {
  return `Produce the BUILD PLAN for this work. No code yet.

REQUIREMENTS
${requirements.map((r) => `${r.code} — ${r.title}`).join("\n") || "(none extracted)"}

PROMPT
${promptText.slice(0, 20000)}

Reply with exactly one fenced JSON block:
\`\`\`json
{
  "files": [{ "path": "src/App.tsx", "purpose": "why", "requirements": ["REQ-001"] }],
  "dependencies": ["react"],
  "buildOrder": ["index.html", "src/main.tsx", "src/App.tsx"],
  "moduleMap": [{ "path": "src/App.tsx", "imports": ["src/domain/parser.ts"] }]
}
\`\`\`
The plan MUST include index.html, src/main.tsx and src/App.tsx.
Only react and react-dom may appear in dependencies.`;
}

const JSON_BLOCK = /```(?:json)?\s*\n([\s\S]*?)```/g;

function strings(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export function parseBuildPlan(markdown: string, at: string): BuildPlan | null {
  let parsed: Record<string, unknown> | null = null;
  JSON_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_BLOCK.exec(markdown))) {
    try {
      const value = JSON.parse((m[1] ?? "").trim()) as Record<string, unknown>;
      if (value && typeof value === "object" && !Array.isArray(value)) parsed = value;
    } catch {
      /* keep looking */
    }
  }
  if (!parsed) return null;
  const files = Array.isArray(parsed["files"])
    ? (parsed["files"] as Record<string, unknown>[])
        .map((f) => ({
          path: normalizePath(typeof f?.["path"] === "string" ? (f["path"] as string) : ""),
          purpose: typeof f?.["purpose"] === "string" ? (f["purpose"] as string) : "",
          requirements: strings(f?.["requirements"]),
        }))
        .filter((f) => f.path.length > 0)
    : [];
  const moduleMap = Array.isArray(parsed["moduleMap"])
    ? (parsed["moduleMap"] as Record<string, unknown>[])
        .map((f) => ({
          path: normalizePath(typeof f?.["path"] === "string" ? (f["path"] as string) : ""),
          imports: strings(f?.["imports"]).map(normalizePath),
        }))
        .filter((f) => f.path.length > 0)
    : [];
  return {
    files,
    dependencies: strings(parsed["dependencies"]),
    buildOrder: strings(parsed["buildOrder"]).map(normalizePath),
    moduleMap,
    markdown: markdown.replace(JSON_BLOCK, "").trim(),
    createdAt: at,
  };
}

/* ------------------------------ 3–5. dependency / startup / compile */

/** Packages the in-browser preview runtime can actually resolve. */
export const RUNTIME_PACKAGES = [
  "react",
  "react-dom",
  "react-dom/client",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
];

const IMPORT_RE =
  /(?:import\s+(?:[\s\S]*?)\s+from\s*|import\s*|export\s+(?:[\s\S]*?)\s+from\s*)["']([^"']+)["']/g;

export interface ImportRef {
  from: string;
  specifier: string;
  names: string[];
  hasDefault: boolean;
}

const CODE_RE = /\.(?:tsx?|jsx?|mjs|cjs)$/;

export function scanImports(file: CoderFile): ImportRef[] {
  if (!CODE_RE.test(file.path)) return [];
  const out: ImportRef[] = [];
  const lines = file.content.split("\n");
  for (const line of lines) {
    IMPORT_RE.lastIndex = 0;
    const m = IMPORT_RE.exec(line);
    if (!m) continue;
    const specifier = m[1] ?? "";
    if (!specifier) continue;
    const clause = line.slice(0, m.index + m[0].length);
    const named = clause.match(/\{([^}]*)\}/)?.[1] ?? "";
    const names = named
      .split(",")
      .map((n) => n.split(/\s+as\s+/)[0]?.trim() ?? "")
      .filter(Boolean);
    const hasDefault = /import\s+(?:type\s+)?[A-Za-z_$][\w$]*\s*(?:,|from)/.test(clause);
    out.push({ from: file.path, specifier, names, hasDefault });
  }
  return out;
}

const EXT_TRIES = ["", ".tsx", ".ts", ".jsx", ".js", "/index.tsx", "/index.ts", "/index.jsx", "/index.js"];

function joinPath(from: string, spec: string) {
  const parts = from.split("/").slice(0, -1);
  for (const seg of spec.split("/")) {
    if (seg === "." || seg === "") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

export function resolveImport(files: CoderFile[], from: string, spec: string): string | null {
  const paths = new Set(files.map((f) => f.path));
  const base = spec.startsWith(".") ? joinPath(from, spec) : normalizePath(spec.replace(/^@\//, "src/"));
  for (const ext of EXT_TRIES) {
    const candidate = `${base}${ext}`;
    if (paths.has(candidate)) return candidate;
  }
  // Fallback: the generated code pointed at the right file name from the wrong
  // folder. Accept it when exactly one file in the session carries that name.
  const wanted = base.split("/").pop();
  if (wanted) {
    const matches = files.filter((f) => {
      const name = f.path.split("/").pop() ?? "";
      return name === wanted || name.replace(/\.[cm]?[jt]sx?$/, "") === wanted;
    });
    if (matches.length === 1 && matches[0]) return matches[0].path;
  }
  return null;
}

function declaredDependencies(files: CoderFile[]): string[] {
  const pkg = files.find((f) => f.path === "package.json");
  if (!pkg) return [];
  try {
    const json = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
    return Object.keys(json.dependencies ?? {});
  } catch {
    return [];
  }
}

function exportsOf(content: string): { names: Set<string>; hasDefault: boolean; wildcard: boolean } {
  const names = new Set<string>();
  const re =
    /export\s+(?:declare\s+)?(?:async\s+)?(?:const|let|var|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) if (m[1]) names.add(m[1]);
  const listRe = /export\s*\{([^}]*)\}/g;
  while ((m = listRe.exec(content))) {
    for (const part of (m[1] ?? "").split(",")) {
      const name = part.split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  return {
    names,
    hasDefault: /export\s+default\b/.test(content),
    wildcard: /export\s+\*\s+from/.test(content),
  };
}

const ENTRY_HTML = /\.html$/;

function findFile(files: CoderFile[], candidates: string[]) {
  return files.find((f) => candidates.includes(f.path));
}

/** Runs dependency, startup and compile validation over the session files. */
export function validateBuild(files: CoderFile[]): ValidationReport {
  const real = files.filter(
    (f) => fileName(f.path) !== FOLDER_KEEP && !isToolingFile(f.path),
  );
  const issues: ValidationIssue[] = [];
  const declared = declaredDependencies(real);
  const missingDependencies: string[] = [];

  /* 3. dependency validation */
  for (const file of real) {
    for (const ref of scanImports(file)) {
      const spec = ref.specifier;
      if (spec.startsWith(".") || spec.startsWith("/") || spec.startsWith("@/")) {
        const target = resolveImport(real, file.path, spec);
        if (!target) {
          issues.push({
            kind: "Import",
            severity: "error",
            path: file.path,
            message: `Unresolved module "${spec}" — no file in this build session matches it.`,
          });
          continue;
        }
        const ex = exportsOf(real.find((f) => f.path === target)?.content ?? "");
        if (!ex.wildcard) {
          for (const name of ref.names) {
            if (!ex.names.has(name)) {
              issues.push({
                kind: "Export",
                severity: "error",
                path: file.path,
                message: `"${name}" is not exported by ${target}.`,
              });
            }
          }
          if (ref.hasDefault && !ex.hasDefault && !spec.endsWith(".css")) {
            issues.push({
              kind: "Export",
              severity: "error",
              path: file.path,
              message: `${target} has no default export.`,
            });
          }
        }
        continue;
      }
      if (spec.endsWith(".css")) continue;
      const root = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0] ?? spec;
      if (RUNTIME_PACKAGES.includes(spec) || RUNTIME_PACKAGES.includes(root)) continue;
      if (!missingDependencies.includes(root)) missingDependencies.push(root);
      issues.push({
        kind: "Dependency",
        severity: "error",
        path: file.path,
        message: declared.includes(root)
          ? `Package "${root}" is declared but cannot be resolved by the build runtime. Only react and react-dom are available.`
          : `Missing dependency "${root}" — it is imported but not installed.`,
      });
    }
  }

  /* 4. startup validation */
  const html = real.find((f) => ENTRY_HTML.test(f.path));
  const main = findFile(real, ["src/main.tsx", "src/main.jsx", "src/main.ts", "src/main.js"]);
  const app = findFile(real, ["src/App.tsx", "src/App.jsx", "src/app.tsx"]);
  if (!html)
    issues.push({ kind: "Startup", severity: "error", message: "index.html is missing." });
  else if (!/id\s*=\s*["'](root|app)["']/.test(html.content))
    issues.push({
      kind: "Startup",
      severity: "error",
      path: html.path,
      message: "index.html has no mount point with id=\"root\".",
    });
  if (!main)
    issues.push({ kind: "Startup", severity: "error", message: "src/main.tsx is missing." });
  else if (!/createRoot\s*\(/.test(main.content) || !/\.render\s*\(/.test(main.content))
    issues.push({
      kind: "Startup",
      severity: "error",
      path: main.path,
      message: "src/main.tsx does not mount React with createRoot(...).render(...).",
    });
  if (!app) issues.push({ kind: "Startup", severity: "error", message: "src/App.tsx is missing." });
  else if (!/export\s+default/.test(app.content))
    issues.push({
      kind: "Startup",
      severity: "error",
      path: app.path,
      message: "src/App.tsx has no default-exported component.",
    });

  /* 5. compile validation */
  for (const file of real) {
    if (!CODE_RE.test(file.path)) continue;
    try {
      transform(file.content, {
        transforms: ["typescript", "jsx"],
        jsxRuntime: "automatic",
        filePath: file.path,
      });
    } catch (err) {
      issues.push({
        kind: "Syntax",
        severity: "error",
        path: file.path,
        message: err instanceof Error ? err.message : "Compile failed.",
      });
    }
  }

  const has = (kinds: ValidationIssue["kind"][]) =>
    issues.some((i) => i.severity === "error" && kinds.includes(i.kind));

  return {
    at: new Date().toISOString(),
    issues,
    dependencyStatus: real.length === 0 ? "Unknown" : has(["Dependency"]) ? "Fail" : "Pass",
    startupStatus: real.length === 0 ? "Unknown" : has(["Startup"]) ? "Fail" : "Pass",
    compileStatus: real.length === 0 ? "Unknown" : has(["Syntax", "Import", "Export"]) ? "Fail" : "Pass",
    missingDependencies,
  };
}

/* -------------------------------------- 6–8. traceability and health */

/** Marks a requirement In Progress / Completed from the files a turn produced. */
export function attachFiles(
  requirements: BuildRequirement[],
  paths: string[],
  at: string,
): BuildRequirement[] {
  if (!paths.length) return requirements;
  const words = (s: string) =>
    s
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
  return requirements.map((req) => {
    const keys = words(`${req.title} ${req.detail}`);
    const hit = paths.filter((path) => {
      const name = fileName(path).toLowerCase();
      return keys.some((k) => name.includes(k) || k.includes(name.split(".")[0] ?? ""));
    });
    if (!hit.length) return req;
    const merged = [...new Set([...req.files, ...hit])];
    return {
      ...req,
      files: merged,
      status: req.status === "Completed" ? req.status : "In Progress",
      updatedAt: at,
    };
  });
}

export function computeHealth(
  requirements: BuildRequirement[],
  plan: BuildPlan | undefined,
  files: CoderFile[],
  report: ValidationReport,
): BuildHealth {
  const real = files.filter((f) => fileName(f.path) !== FOLDER_KEEP);
  const total = requirements.length;
  const complete = requirements.filter((r) => r.status === "Completed").length;
  const failed = requirements.filter((r) => r.status === "Failed").length;
  const blocked = requirements.filter((r) => r.status === "Blocked").length;
  const planned = plan?.files.length ?? 0;
  const plannedCreated = plan
    ? plan.files.filter((f) => real.some((r) => r.path === f.path)).length
    : real.length;

  const reqScore = total ? complete / total : 0;
  const fileScore = planned ? plannedCreated / planned : real.length ? 1 : 0;
  const compileScore = report.compileStatus === "Pass" ? 1 : 0;
  const startupScore = report.startupStatus === "Pass" ? 1 : 0;
  const depScore = report.dependencyStatus === "Pass" ? 1 : 0;
  const completion = Math.round(
    (reqScore * 0.6 + fileScore * 0.15 + compileScore * 0.1 + startupScore * 0.1 + depScore * 0.05) *
      100,
  );

  const errors = report.issues.filter((i) => i.severity === "error");
  const complete_ = total > 0 && complete === total;
  return {
    requirementsTotal: total,
    requirementsComplete: complete,
    requirementsFailed: failed,
    requirementsBlocked: blocked,
    filesPlanned: planned,
    filesCreated: real.length,
    dependenciesMissing: report.missingDependencies.length,
    compileStatus: report.compileStatus,
    startupStatus: report.startupStatus,
    dependencyStatus: report.dependencyStatus,
    errorCount: errors.length,
    completion,
    /* 7. build completion logic — never file count alone */
    buildComplete:
      complete_ &&
      blocked === 0 &&
      failed === 0 &&
      errors.length === 0 &&
      report.compileStatus === "Pass" &&
      report.startupStatus === "Pass" &&
      report.dependencyStatus === "Pass",
  };
}

/** Feature generation is blocked while the application cannot build or boot. */
export function buildGate(report: ValidationReport): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (report.dependencyStatus === "Fail") reasons.push("dependency errors");
  if (report.startupStatus === "Fail") reasons.push("the application cannot start");
  if (report.compileStatus === "Fail") reasons.push("compile / import errors");
  return { blocked: reasons.length > 0, reasons };
}

export const REPAIR_MODES = ["Fix Errors", "Apply Fix", "Error Analysis", "Log Analysis"];

/** 9. automatic recovery — the repair instruction sent instead of new features. */
export function repairInstruction(report: ValidationReport): string {
  const errors = report.issues.filter((i) => i.severity === "error");
  return `REPAIR TASK — do not add features.

The build is BLOCKED. Fix the root cause of these validation failures and return the full corrected files.
Startup: ${report.startupStatus} · Compile: ${report.compileStatus} · Dependencies: ${report.dependencyStatus}

${errors.map((i) => `- [${i.kind}] ${i.path ? `${i.path}: ` : ""}${i.message}`).join("\n") || "- none"}

Rules:
- The session must contain index.html (with <div id="root"></div>), src/main.tsx mounting with createRoot, and src/App.tsx with a default-exported component.
- Only react and react-dom may be imported. Replace or remove every other package import.
- Every relative import must point at a file that exists in this session.
- Return complete files, never fragments.`;
}
