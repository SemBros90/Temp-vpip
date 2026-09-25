import { fileName, FOLDER_KEEP } from "./coder-fs";
import type { CoderFile, KnowledgeItem } from "./types";

/**
 * AI 2 — Auditor & Prompt Engineer (VPIP-AI2-001).
 * Read-only: every function here only reads build files and returns findings.
 * AI 2 never writes, commits, pushes or deploys.
 */

export type AuditKind =
  | "repository"
  | "compliance"
  | "build"
  | "preview"
  | "routes"
  | "workflows"
  | "everything";

export const AUDIT_LABEL: Record<AuditKind, string> = {
  repository: "Audit Repository",
  compliance: "Audit Prompt Compliance",
  build: "Audit Build",
  preview: "Audit Preview",
  routes: "Audit Routes",
  workflows: "Audit Workflows",
  everything: "Audit Everything",
};

export type PromptKind =
  | "corrective"
  | "missing-files"
  | "route-repair"
  | "ui-repair"
  | "build-completion"
  | "production-readiness";

export const PROMPT_LABEL: Record<PromptKind, string> = {
  corrective: "Corrective Prompt",
  "missing-files": "Missing Files Prompt",
  "route-repair": "Route Repair Prompt",
  "ui-repair": "UI Repair Prompt",
  "build-completion": "Build Completion Prompt",
  "production-readiness": "Production Readiness Prompt",
};

export type AuditMode = "audit" | "audit_prompt" | "audit_prompt_completeness";
export const MODE_LABEL: Record<AuditMode, string> = {
  audit: "Audit only",
  audit_prompt: "Audit + Corrective Prompt",
  audit_prompt_completeness: "Audit + Prompt + Completeness",
};

export type Severity = "blocker" | "major" | "minor" | "info";
export interface Finding {
  module: string;
  severity: Severity;
  file?: string;
  message: string;
}

export interface CrawlResult {
  route: string;
  status: number;
  bytes: number;
  verdict: "ok" | "404" | "500" | "blank" | "error";
  note?: string;
}

export interface StaticAudit {
  files: number;
  routes: string[];
  links: string[];
  deadLinks: { link: string; file: string }[];
  orphanRoutes: string[];
  placeholders: string[];
  mockData: string[];
  brokenImports: { file: string; spec: string }[];
  missingPackages: string[];
  hasPackageJson: boolean;
  findings: Finding[];
  score: number;
}

const real = (files: CoderFile[]) => files.filter((f) => fileName(f.path) !== FOLDER_KEEP);
const CODE = /\.(tsx?|jsx?|mjs|cjs|vue|svelte)$/;
const BUILTINS = new Set(
  "assert buffer child_process crypto events fs http https net os path stream url util zlib worker_threads querystring readline tty dns module process timers".split(" "),
);

function norm(route: string) {
  let r = route.split(/[?#]/)[0] ?? "/";
  if (!r.startsWith("/")) r = `/${r}`;
  r = r.replace(/\/+$/, "") || "/";
  return r;
}

/** Converts a route pattern to a matcher (supports :param, $param, [param], *). */
function matcher(route: string) {
  const src = route
    .replace(/[.+^${}()|\\]/g, (c) => (c === "$" ? "$" : `\\${c}`))
    .replace(/\/(:[^/]+|\$[^/]*|\[[^\]]+\])/g, "/[^/]+")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${src}$`);
  } catch {
    return null;
  }
}

function routesFrom(files: CoderFile[]): string[] {
  const out = new Set<string>();
  for (const f of files) {
    const p = f.path;
    // React Router style
    for (const m of f.content.matchAll(/\bpath\s*[:=]\s*["'`](\/?[^"'`]*)["'`]/g)) {
      const v = m[1] ?? "";
      if (v && !v.includes(".") && CODE.test(p)) out.add(norm(v));
    }
    // TanStack file routes
    const ts = p.match(/^src\/routes\/(.+)\.(tsx|ts|jsx)$/);
    if (ts && !ts[1]!.startsWith("__") && !ts[1]!.startsWith("api")) {
      const seg = ts[1]!
        .replace(/\/index$|^index$/, "")
        .split(/[./]/)
        .filter((s) => s && !s.startsWith("_"))
        .join("/");
      out.add(norm(seg));
    }
    // Next.js pages/app
    const nx = p.match(/^(?:src\/)?pages\/(.+)\.(tsx|jsx|ts|js)$/);
    if (nx && !nx[1]!.startsWith("_") && !nx[1]!.startsWith("api/")) out.add(norm(nx[1]!.replace(/\/?index$/, "")));
    const ap = p.match(/^(?:src\/)?app\/(.*)page\.(tsx|jsx|ts|js)$/);
    if (ap) out.add(norm(ap[1]!.split("/").filter((s) => s && !s.startsWith("(")).join("/")));
    // Static html
    if (/\.html$/.test(p) && !p.includes("/")) out.add(p === "index.html" ? "/" : norm(p));
  }
  return [...out].sort();
}

function linksFrom(files: CoderFile[]) {
  const out: { link: string; file: string }[] = [];
  const re = /(?:\bto|\bhref)\s*=\s*\{?\s*["'`](\/[^"'`\s{}$]*)["'`]|navigate\(\s*["'`](\/[^"'`\s{}$]*)["'`]/g;
  for (const f of files) {
    if (!CODE.test(f.path) && !f.path.endsWith(".html")) continue;
    for (const m of f.content.matchAll(re)) {
      const l = m[1] ?? m[2];
      if (l && !/\.(png|jpe?g|svg|webp|css|ico|pdf|js)$/i.test(l) && !l.startsWith("//")) out.push({ link: norm(l), file: f.path });
    }
  }
  return out;
}

export function runStaticAudit(files: CoderFile[]): StaticAudit {
  const fs = real(files);
  const paths = new Set(fs.map((f) => f.path));
  const findings: Finding[] = [];
  const pkgFile = fs.find((f) => f.path === "package.json");
  let deps = new Set<string>();
  if (pkgFile) {
    try {
      const j = JSON.parse(pkgFile.content) as Record<string, Record<string, string> | undefined>;
      deps = new Set([...Object.keys(j["dependencies"] ?? {}), ...Object.keys(j["devDependencies"] ?? {}), ...Object.keys(j["peerDependencies"] ?? {})]);
    } catch {
      findings.push({ module: "Repository", severity: "blocker", file: "package.json", message: "package.json is not valid JSON." });
    }
  } else {
    findings.push({ module: "Build", severity: "blocker", file: "package.json", message: "No package.json at the project root — nothing can be installed or run." });
  }

  const routes = routesFrom(fs);
  const linkRefs = linksFrom(fs);
  const matchers = routes.map((r) => ({ r, m: matcher(r) }));
  const hit = (l: string) => matchers.some(({ r, m }) => r === l || (m ? m.test(l) : false));
  const deadLinks = linkRefs.filter((x) => !hit(x.link));
  const dedupDead = [...new Map(deadLinks.map((d) => [d.link, d])).values()];
  const linked = new Set(linkRefs.map((l) => l.link));
  const orphanRoutes = routes.filter((r) => r !== "/" && !r.includes("*") && ![...linked].some((l) => l === r || matcher(r)?.test(l)));

  const placeholders: string[] = [];
  const mockData: string[] = [];
  const brokenImports: StaticAudit["brokenImports"] = [];
  const missing = new Set<string>();

  for (const f of fs) {
    if (!CODE.test(f.path)) continue;
    const c = f.content;
    if (/lorem ipsum|coming soon|under construction|placeholder page|TODO:? (implement|add)/i.test(c)) placeholders.push(f.path);
    else if (/pages?\/|routes\//.test(f.path) && c.split("\n").length < 15) placeholders.push(f.path);
    if (/\b(mock|dummy|fake|sample)(Data|Products|Users|Items|_data)?\b|faker\./i.test(c)) mockData.push(f.path);
    for (const m of c.matchAll(/(?:import[^'"]*from\s*|import\s*\(\s*|require\(\s*)["']([^"']+)["']/g)) {
      const spec = m[1]!;
      if (spec.startsWith(".")) {
        const base = f.path.split("/").slice(0, -1);
        for (const part of spec.split("/")) {
          if (part === "..") base.pop();
          else if (part !== ".") base.push(part);
        }
        const t = base.join("/");
        const ok = [t, ...[".ts", ".tsx", ".js", ".jsx", ".mjs", ".css", ".json", ".vue", ".svelte"].map((e) => t + e), ...["/index.ts", "/index.tsx", "/index.js", "/index.jsx"].map((e) => t + e)].some((x) => paths.has(x));
        if (!ok) brokenImports.push({ file: f.path, spec });
      } else if (spec.startsWith("@/") || spec.startsWith("~/") || spec.startsWith("/") || spec.startsWith("virtual:") || spec.includes("?")) {
        if (spec.startsWith("@/")) {
          const t = `src/${spec.slice(2)}`;
          const ok = [t, ".ts", ".tsx", ".js", ".jsx", ".css", "/index.ts", "/index.tsx"].some((e, i) => paths.has(i === 0 ? t : t + e));
          if (!ok) brokenImports.push({ file: f.path, spec });
        }
      } else {
        const name = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]!;
        const bare = name.replace(/^node:/, "");
        if (!spec.startsWith("node:") && !BUILTINS.has(bare) && pkgFile && !deps.has(name)) missing.add(name);
      }
    }
  }

  if (!routes.length) findings.push({ module: "Routes", severity: "major", message: "No routes were detected in the project." });
  for (const d of dedupDead) findings.push({ module: "Routes", severity: "major", file: d.file, message: `Dead link: ${d.link} has no matching route.` });
  for (const r of orphanRoutes) findings.push({ module: "Routes", severity: "minor", message: `Orphan route: ${r} is not linked from any navigation or button.` });
  for (const pth of placeholders) findings.push({ module: "UI", severity: "major", file: pth, message: "Placeholder or near-empty page." });
  for (const pth of mockData) findings.push({ module: "Data", severity: "minor", file: pth, message: "Uses mock / dummy / sample data." });
  for (const b of brokenImports) findings.push({ module: "Repository", severity: "blocker", file: b.file, message: `Broken import: ${b.spec} does not resolve to a file.` });
  for (const m of missing) findings.push({ module: "Build", severity: "major", file: "package.json", message: `Package "${m}" is imported but not declared.` });

  const w = { blocker: 15, major: 5, minor: 1, info: 0 } as const;
  const penalty = findings.reduce((a, f) => a + w[f.severity], 0);
  return {
    files: fs.length,
    routes,
    links: [...linked].sort(),
    deadLinks: dedupDead,
    orphanRoutes,
    placeholders,
    mockData,
    brokenImports,
    missingPackages: [...missing].sort(),
    hasPackageJson: Boolean(pkgFile),
    findings,
    score: Math.max(0, 100 - penalty),
  };
}

/** Live crawl through VPIP's private runtime relay (same origin, read-only GETs). */
export async function crawlPreview(previewPath: string, routes: string[], signal?: AbortSignal): Promise<CrawlResult[]> {
  const base = previewPath.replace(/\/+$/, "");
  const out: CrawlResult[] = [];
  const list = [...new Set(["/", ...routes.filter((r) => !/[:$[*]/.test(r))])].slice(0, 60);
  for (const r of list) {
    try {
      const res = await fetch(`${base}${r === "/" ? "/" : r}`, { signal: signal ?? null, credentials: "same-origin" });
      const text = await res.text();
      const bodyText = text.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, "").trim();
      let verdict: CrawlResult["verdict"] = "ok";
      if (res.status === 404) verdict = "404";
      else if (res.status >= 500) verdict = "500";
      else if (text.length < 200) verdict = "blank";
      out.push({
        route: r,
        status: res.status,
        bytes: text.length,
        verdict,
        ...(verdict === "ok" && !bodyText && /id=["']root["']/.test(text) ? { note: "Client-rendered shell; content is drawn by JavaScript." } : {}),
      });
    } catch (e) {
      out.push({ route: r, status: 0, bytes: 0, verdict: "error", note: e instanceof Error ? e.message : String(e) });
    }
  }
  return out;
}

/* ------------------------------------------------------------ prompts */

const GOLDEN_RULE = `AI 2 GOLDEN RULE: AI 2 never decides. AI 2 never modifies code. AI 2 never deploys. AI 2 never commits. AI 2 reports facts. AI 2 generates prompts. The user decides the next action.`;

const FEASIBILITY_RULE = `FEASIBILITY REPORT: Add a section headed exactly "## Feasibility Report" ONLY IF you detect an impossible requirement, missing infrastructure, missing credentials, a missing service, a platform limitation or an architecture conflict. If none exists, do NOT include this section at all. For each issue use:
**Issue:** …
**Reason:** …
**Impact:** …
**Possible Solutions:** numbered list
**User Decision Required:** …`;

export function auditorSystemPrompt() {
  return `You are AI 2 — Auditor & Prompt Engineer inside VPIP.
You NEVER write production code, edit files, commit, push or deploy. You only audit the work of AI 1 (the Coder) and produce corrective instructions for AI 1.
Base every finding on the evidence provided (file tree, file excerpts, static findings, build logs, crawl results, requirements, AI 1 build completion reports). If evidence is missing, say so; never invent.
Treat an AI 1 Build Completion Report as a claim to verify against the repository evidence, not as fact.
Cite file paths and requirement codes (R-xxx) and decision codes (D-xxx) where relevant.
${GOLDEN_RULE}
${FEASIBILITY_RULE}`;
}

export function auditorChatSystemPrompt(context: string) {
  return `${auditorSystemPrompt()}

You are in CHAT MODE: the user talks to you directly, like they talk to AI 1. Answer their question from the evidence below.
When the user asks for an audit, structure the answer as "## Audit Report", "## Root Cause Analysis" and, when a fix is needed, "## Corrective Prompt" (a ready-to-paste instruction for AI 1).
When asked for a repair or completion prompt, put it under "## Corrective Prompt".

=== CURRENT BUILD EVIDENCE ===
${context}`;
}

export function chatContext(opts: { buildCode: string; files: CoderFile[]; audit: StaticAudit; buildLogs: string; requirements: KnowledgeItem[]; originalPrompt: string }) {
  const fs = real(opts.files);
  const a = opts.audit;
  let budget = 40000;
  const ex: string[] = [];
  for (const f of [...fs].sort((x, y) => score(y.path) - score(x.path))) {
    if (budget <= 0) break;
    const body = f.content.slice(0, Math.min(3000, budget));
    budget -= body.length;
    ex.push(`--- ${f.path}\n${body}`);
  }
  return `Build ${opts.buildCode}. Static score ${a.score}/100. Routes: ${a.routes.join(", ") || "none"}. Dead links: ${a.deadLinks.map((d) => d.link).join(", ") || "none"}. Orphans: ${a.orphanRoutes.join(", ") || "none"}. Placeholders: ${a.placeholders.join(", ") || "none"}. Broken imports: ${a.brokenImports.map((b) => `${b.file}→${b.spec}`).join(", ") || "none"}. Undeclared packages: ${a.missingPackages.join(", ") || "none"}.
Requirements: ${opts.requirements.map((r) => `${r.code} ${r.status} ${r.title}`).join("; ") || "none"}
Original prompt: ${opts.originalPrompt.slice(0, 6000) || "none"}
Build logs:
${opts.buildLogs.slice(-4000) || "none"}
File tree:
${fs.map((f) => `- ${f.path}`).join("\n") || "empty"}
File excerpts:
${ex.join("\n\n")}`;
}

const MODULES: Record<AuditKind, string> = {
  repository: "MODULE 1 Repository Audit: missing files/folders, broken imports, duplicate components, dead code, unused files, architecture violations.",
  compliance: "MODULE 2 Prompt Compliance Audit: compare the original prompt and requirements against the repository. Output Requirement Coverage %, a Requirement Matrix table (code | requirement | status Implemented/Partial/Missing | evidence), and lists of missing, partial and unimplemented requirements.",
  build: "MODULE 7 Build Audit: compile errors, warnings, dependency issues, runtime issues, missing packages.",
  preview: "MODULE 8 Preview Crawl Audit: 404 pages, 500 pages, blank pages, missing content, dead ends. Use the crawl results and route analysis.",
  routes: "MODULE 3 Route Audit (planned vs created vs reachable, dead routes, orphan routes) and MODULE 4 UI Audit (buttons, links, menus, forms, missing pages, missing content).",
  workflows: "MODULE 5 Workflow Audit: RFQ, quote, customer, admin, order, approval and email flows — for each, state whether it exists end to end, which screens/routes it uses, and where it breaks. MODULE 6 Data Audit: data models, tables, schemas, APIs, seed data, dummy data.",
  everything: "ALL MODULES: 1 Repository, 2 Prompt Compliance (with coverage % and matrix), 3 Routes, 4 UI, 5 Workflows, 6 Data, 7 Build, 8 Preview Crawl, 9 Production Readiness (architecture, scalability, security, completeness, deployment readiness). Title the report MASTER AUDIT REPORT.",
};

const PROMPT_FOCUS: Record<PromptKind, string> = {
  corrective: "Fix every blocker and major finding.",
  "missing-files": "Create every missing file, page and folder only.",
  "route-repair": "Repair dead links, orphan routes and missing routes only.",
  "ui-repair": "Repair missing/placeholder pages, buttons, menus, forms and content only.",
  "build-completion": "Make the project install, compile and run cleanly.",
  "production-readiness": "Close production-readiness gaps: security, completeness, deployment configuration.",
};

export function auditUserPrompt(opts: {
  kind: AuditKind;
  mode: AuditMode;
  promptKind: PromptKind;
  buildCode: string;
  originalPrompt: string;
  requirements: KnowledgeItem[];
  files: CoderFile[];
  audit: StaticAudit;
  buildLogs: string;
  crawl: CrawlResult[] | null;
  ai1Report?: string | undefined;
}) {
  const fs = real(opts.files);
  const tree = fs.map((f) => `- ${f.path} (${f.content.split("\n").length} lines)`).join("\n");
  let budget = 60000;
  const excerpts: string[] = [];
  const priority = [...fs].sort((a, b) => score(b.path) - score(a.path));
  for (const f of priority) {
    if (budget <= 0) break;
    const body = f.content.slice(0, Math.min(4000, budget));
    budget -= body.length;
    excerpts.push(`--- ${f.path}\n${body}`);
  }
  const a = opts.audit;
  const staticBlock = [
    `Files: ${a.files}. package.json: ${a.hasPackageJson ? "present" : "MISSING"}. Static score: ${a.score}/100`,
    `Routes (${a.routes.length}): ${a.routes.join(", ") || "none"}`,
    `Dead links: ${a.deadLinks.map((d) => `${d.link} (${d.file})`).join(", ") || "none"}`,
    `Orphan routes: ${a.orphanRoutes.join(", ") || "none"}`,
    `Placeholder pages: ${a.placeholders.join(", ") || "none"}`,
    `Mock data files: ${a.mockData.join(", ") || "none"}`,
    `Broken imports: ${a.brokenImports.map((b) => `${b.file} → ${b.spec}`).join(", ") || "none"}`,
    `Undeclared packages: ${a.missingPackages.join(", ") || "none"}`,
  ].join("\n");
  const crawl = opts.crawl
    ? opts.crawl.map((c) => `- ${c.route}: HTTP ${c.status}, ${c.bytes} bytes, ${c.verdict}${c.note ? ` (${c.note})` : ""}`).join("\n")
    : "_No live crawl (runtime not running or not requested). Rely on static route analysis._";

  const promptSection =
    opts.mode === "audit"
      ? "Mode: AUDIT ONLY. Do not produce a corrective prompt."
      : `Then write a section headed exactly "## Corrective Prompt" containing a ${PROMPT_LABEL[opts.promptKind]} for AI 1. Focus: ${PROMPT_FOCUS[opts.promptKind]}
It must follow this template:
${opts.buildCode}
### Problem Summary
### Root Cause
### Files Affected
### Requirements Missing
### Required Changes
### Implementation Instructions
### Validation Criteria
### Expected Result`;
  const completeness =
    opts.mode === "audit_prompt_completeness"
      ? `\nAlso add a section "## Completeness Report" with Repository Functional Completeness %, dead routes, dead links, orphan pages, placeholder pages and missing products/content.`
      : "";

  return `AUDIT REQUEST — ${AUDIT_LABEL[opts.kind]} for ${opts.buildCode}
${MODULES[opts.kind]}

Write "## Audit Report" first: a score line "Score: NN/100", then findings as a markdown table (severity | module | file | finding | root cause).
Then write "## Root Cause Analysis": the underlying causes behind the findings, grouped.
${promptSection}${completeness}
Add "## Feasibility Report" only under the conditions in your rules; otherwise omit it.
${opts.ai1Report ? `\n=== AI 1 BUILD COMPLETION REPORT (claims to verify) ===\n${opts.ai1Report.slice(0, 8000)}\n` : ""}

=== ORIGINAL PROMPT / CONTEXT ===
${opts.originalPrompt.slice(0, 12000) || "_none_"}

=== REQUIREMENTS ===
${opts.requirements.map((r) => `- ${r.code} · ${r.status} — ${r.title}`).join("\n") || "_none linked_"}

=== STATIC ANALYSIS (deterministic, trustworthy) ===
${staticBlock}

=== BUILD / RUNTIME LOGS ===
${opts.buildLogs.slice(-6000) || "_none_"}

=== PREVIEW CRAWL ===
${crawl}

=== FILE TREE ===
${tree || "_empty_"}

=== FILE EXCERPTS ===
${excerpts.join("\n\n")}`;
}

function score(p: string) {
  if (p === "package.json") return 100;
  if (/App\.(t|j)sx?$|main\.(t|j)sx?$|router|routes/.test(p)) return 80;
  if (/pages?\/|routes\/|components\/(layout|nav|header|sidebar)/i.test(p)) return 60;
  if (/\.(t|j)sx?$/.test(p)) return 30;
  return 5;
}

export function splitReport(md: string) {
  const i = md.search(/^#{1,3}\s*Corrective Prompt\s*$/im);
  if (i === -1) return { report: md.trim(), prompt: "" };
  const rest = md.slice(i).replace(/^#{1,3}\s*Corrective Prompt\s*$/im, "");
  const next = rest.search(/^##\s+(Completeness Report|Feasibility Report)/im);
  const prompt = (next === -1 ? rest : rest.slice(0, next)).trim();
  const report = (md.slice(0, i) + (next === -1 ? "" : `\n${rest.slice(next)}`)).trim();
  return { report, prompt };
}

export function scoreFrom(md: string, fallback: number) {
  const m = md.match(/Score:\s*(\d{1,3})\s*\/\s*100/i);
  return m ? Math.min(100, Number(m[1])) : fallback;
}
