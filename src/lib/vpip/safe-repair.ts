/**
 * Safe Repair — ingestion audit, extended classification, environment and
 * dependency audits, preview readiness, Rollback Point Zero, repair
 * simulation, change/impact/risk/confidence classification, approval and
 * audit trail. Simulation is pure: it never modifies files.
 */
import { supabase } from "@/integrations/supabase/client";
import type { IngestionAudit } from "./git-remote";
import {
  addMissingDependencies,
  classify,
  parseJsonc,
  parseLockfiles,
  scanEnv,
  type AnalyzerFile,
} from "./repo-analyzer";
import type { RepoReport } from "./types";

/* ------------------------------------------------------------------ types */

export type ChangeClass =
  | "Dependency Installation"
  | "Dependency Removal"
  | "Configuration Change"
  | "Environment Change"
  | "Source Code Change"
  | "File Creation"
  | "File Deletion"
  | "Build Configuration Change"
  | "Deployment Configuration Change"
  | "Database Change";

export type RiskLevel = "Safe" | "Medium Risk" | "High Risk" | "Critical Risk";

export const DEFAULT_RISK: Record<ChangeClass, RiskLevel> = {
  "Dependency Installation": "Safe",
  "Dependency Removal": "Medium Risk",
  "Configuration Change": "Medium Risk",
  "Environment Change": "Medium Risk",
  "Source Code Change": "High Risk",
  "File Creation": "Medium Risk",
  "File Deletion": "Critical Risk",
  "Build Configuration Change": "Medium Risk",
  "Deployment Configuration Change": "High Risk",
  "Database Change": "Critical Risk",
};

export type RepairOp =
  | { kind: "add-dep"; name: string; version: string; file: string }
  | { kind: "set-dep-version"; name: string; version: string; file: string }
  | { kind: "remove-dep"; name: string; file: string }
  | { kind: "add-alias"; alias: string; target: string; file: string }
  | { kind: "env"; key: string }
  | { kind: "create-file"; path: string; content: string };

export interface ImpactReport {
  why: string;
  solves: string;
  filesAffected: string[];
  dependencyCount: number;
  ui: string;
  businessLogic: string;
  build: string;
  deployment: string;
  database: string;
  security: string;
  plain: string;
  consequences: string;
  rollback: string;
  op: RepairOp;
  preview: Array<{ path: string; before: string; after: string }>;
}

export interface ProposalFile {
  path: string;
  action: "modify" | "create" | "delete" | "env";
}
export interface ProposalDep {
  name: string;
  version: string;
  op: "install" | "remove" | "pin";
}

export interface RepairProposal {
  id: string;
  projectId: string;
  repositoryId?: string | undefined;
  buildSessionId?: string | undefined;
  simulationId: string;
  classification: ChangeClass;
  risk: RiskLevel;
  confidence: number;
  confidenceNote: string;
  problem: string;
  fix: string;
  impact: ImpactReport;
  files: ProposalFile[];
  dependencies: ProposalDep[];
  status: "Proposed" | "Approved" | "Rejected" | "Applied" | "Reverted";
  approvedFiles: string[];
  snapshotId?: string | undefined;
  createdAt: string;
  decidedAt?: string | undefined;
  decidedBy?: string | undefined;
}

export interface RepoSnapshot {
  id: string;
  projectId: string;
  repositoryId?: string | undefined;
  buildSessionId?: string | undefined;
  label: string;
  isZero: boolean;
  files: AnalyzerFile[];
  tree: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  projectId: string;
  repositoryId?: string | undefined;
  user: string;
  action: string;
  changeType?: string | undefined;
  risk?: string | undefined;
  confidence?: number | undefined;
  files: string[];
  dependencies: string[];
  note: string;
  createdAt: string;
}

export const LOW_CONFIDENCE = 70;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const nowIso = () => new Date().toISOString();

/* ------------------------------------------------ Stage 1: ingestion audit */

export function ingestionFailure(a: IngestionAudit): string | null {
  if (a.missing.length || a.failed.length) {
    const lost = [...a.missing, ...a.failed.map((f) => `${f.path} (${f.reason})`)];
    return `Import stopped — ${lost.length} file(s) could not be imported: ${lost.slice(0, 10).join(", ")}${lost.length > 10 ? "…" : ""}`;
  }
  return null;
}

/* ---------------------------------------- Stage 2: extended classification */

export interface Evidence {
  value: string;
  evidence: string;
}
export interface ExtendedClassification {
  framework: Evidence;
  packageManager: Evidence;
  buildSystem: Evidence;
  repositoryType: Evidence;
  monorepo: Evidence;
  deployment: Evidence;
  cicd: Evidence;
}

const has = (files: AnalyzerFile[], re: RegExp) => files.find((f) => re.test(f.path))?.path;

export function classifyExtended(files: AnalyzerFile[]): ExtendedClassification {
  const c = classify(files);
  const U = (e = "No file proves this"): Evidence => ({ value: "Unknown", evidence: e });
  const pkgFile = files.find((f) => f.path === (c.appRoot ? `${c.appRoot}/package.json` : "package.json"));
  const pkgEvidence = pkgFile ? pkgFile.path : "";
  const framework: Evidence = c.frameworks.length
    ? { value: c.frameworks.join(" + "), evidence: pkgEvidence || has(files, /(vite|next|remix|astro|angular|svelte)\.config|index\.html$/) || "config files" }
    : has(files, /(^|\/)index\.html$/) && !pkgFile
      ? { value: "Static Site", evidence: has(files, /(^|\/)index\.html$/)! }
      : U();
  const lockMap: Array<[RegExp, string]> = [
    [/^bun\.lockb?$/, "bun"],
    [/^pnpm-lock\.yaml$/, "pnpm"],
    [/^yarn\.lock$/, "yarn"],
    [/^package-lock\.json$/, "npm"],
  ];
  let packageManager: Evidence = U("No lockfile or packageManager field");
  for (const [re, name] of lockMap) {
    const p = has(files, re);
    if (p) {
      packageManager = { value: name, evidence: p };
      break;
    }
  }
  if (packageManager.value === "Unknown" && pkgFile) {
    const pm = /"packageManager"\s*:\s*"([a-z]+)@/.exec(pkgFile.content)?.[1];
    if (pm) packageManager = { value: pm, evidence: `${pkgFile.path} packageManager` };
  }
  const buildMap: Array<[RegExp, string]> = [
    [/(^|\/)vite\.config\.[cm]?[jt]s$/, "Vite"],
    [/(^|\/)next\.config\.[cm]?[jt]s$/, "Next.js"],
    [/(^|\/)webpack\.config\.[cm]?[jt]s$/, "Webpack"],
    [/(^|\/)angular\.json$/, "Angular CLI"],
    [/(^|\/)astro\.config\.[cm]?[jt]s$/, "Astro"],
    [/(^|\/)remix\.config\.[cm]?[jt]s$/, "Remix"],
    [/(^|\/)svelte\.config\.[cm]?[jt]s$/, "SvelteKit"],
    [/(^|\/)rollup\.config\.[cm]?[jt]s$/, "Rollup"],
    [/(^|\/)tsconfig\.json$/, "TypeScript compiler (tsc)"],
  ];
  let buildSystem: Evidence = U();
  for (const [re, name] of buildMap) {
    const p = has(files, re);
    if (p) {
      buildSystem = { value: name, evidence: p };
      break;
    }
  }
  const monoFile =
    has(files, /^(turbo\.json|nx\.json|lerna\.json|pnpm-workspace\.yaml)$/) ??
    (pkgFile && /"workspaces"\s*:/.test(pkgFile.content) ? `${pkgFile.path} workspaces` : undefined);
  const monorepo: Evidence = monoFile ? { value: `Monorepo (${c.workspaceType})`, evidence: monoFile } : { value: "Single package", evidence: pkgEvidence || "No workspace config found" };
  const deps = pkgFile ? pkgFile.content : "";
  const backendDep = /"(express|@nestjs\/core|fastify|koa|hono)"/.exec(deps)?.[1];
  let repositoryType: Evidence;
  if (monoFile) repositoryType = { value: "Monorepo", evidence: monoFile };
  else if (/"@nestjs\/core"/.test(deps)) repositoryType = { value: "NestJS backend service", evidence: pkgEvidence };
  else if (backendDep && c.frameworks.some((f) => /React|Vue|Svelte|Angular/.test(f))) repositoryType = { value: "Full-stack application", evidence: `${pkgEvidence} (${backendDep})` };
  else if (backendDep) repositoryType = { value: backendDep === "express" ? "Express / Node.js service" : "Node.js service", evidence: pkgEvidence };
  else if (has(files, /(^|\/)supabase\/(functions|migrations)\//) && c.frameworks.length) repositoryType = { value: "Frontend + Supabase application", evidence: has(files, /(^|\/)supabase\/(functions|migrations)\//)! };
  else if (c.frameworks.length) repositoryType = { value: "Frontend application", evidence: pkgEvidence };
  else if (!pkgFile && has(files, /\.html$/)) repositoryType = { value: "Static Site", evidence: has(files, /\.html$/)! };
  else if (pkgFile && /"main"\s*:/.test(deps)) repositoryType = { value: "Node.js package", evidence: `${pkgEvidence} main` };
  else repositoryType = U();
  const deployMap: Array<[RegExp, string]> = [
    [/^vercel\.json$/, "Vercel"],
    [/^netlify\.toml$/, "Netlify"],
    [/^wrangler\.(toml|jsonc?)$/, "Cloudflare"],
    [/^firebase\.json$/, "Firebase Hosting"],
    [/^fly\.toml$/, "Fly.io"],
    [/^render\.yaml$/, "Render"],
    [/^app\.yaml$/, "Google App Engine"],
    [/^Procfile$/, "Heroku"],
    [/^amplify\.yml$/, "AWS Amplify"],
    [/^(Dockerfile|docker-compose\.ya?ml)$/, "Docker"],
    [/^\.lovable\//, "Lovable"],
  ];
  const deploys = deployMap.map(([re, n]) => [has(files, re), n] as const).filter(([p]) => p);
  const deployment: Evidence = deploys.length ? { value: deploys.map(([, n]) => n).join(" + "), evidence: deploys.map(([p]) => p).join(", ") } : U("No deployment config found");
  const ciMap: Array<[RegExp, string]> = [
    [/^\.github\/workflows\/.+\.ya?ml$/, "GitHub Actions"],
    [/^\.gitlab-ci\.yml$/, "GitLab CI"],
    [/^bitbucket-pipelines\.yml$/, "Bitbucket Pipelines"],
    [/^\.circleci\/config\.yml$/, "CircleCI"],
    [/^azure-pipelines\.yml$/, "Azure Pipelines"],
    [/^Jenkinsfile$/, "Jenkins"],
    [/^\.travis\.yml$/, "Travis CI"],
  ];
  const cis = ciMap.map(([re, n]) => [has(files, re), n] as const).filter(([p]) => p);
  const cicd: Evidence = cis.length ? { value: cis.map(([, n]) => n).join(" + "), evidence: cis.map(([p]) => p).join(", ") } : U("No CI/CD config found");
  return { framework, packageManager, buildSystem, repositoryType, monorepo, deployment, cicd };
}

/* --------------------------------------------- Stage 3: environment audit */

export interface EnvAudit {
  envFiles: string[];
  required: Array<{ key: string; sources: string[] }>;
  found: Array<{ key: string; where: string }>;
  missing: Array<{ key: string; sources: string[] }>;
}

export function envAudit(files: AnalyzerFile[], saved: Record<string, string>): EnvAudit {
  const envFiles = files.filter((f) => /(^|\/)\.env(\.[\w.-]+)?$/.test(f.path)).map((f) => f.path);
  const inFiles = new Map<string, string>();
  for (const p of envFiles) {
    const f = files.find((x) => x.path === p)!;
    for (const line of f.content.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*=\s*(.*)$/.exec(line);
      if (m?.[1] && m[2]!.trim() !== "" && !/\.(example|sample|template)$/.test(p)) inFiles.set(m[1], p);
    }
  }
  const required = scanEnv(files, new Set()).map((r) => ({ key: r.key, sources: r.sources.filter((s) => !/\.env/.test(s)) }));
  const found: EnvAudit["found"] = [];
  const missing: EnvAudit["missing"] = [];
  for (const r of required) {
    if (saved[r.key]) found.push({ key: r.key, where: "Saved in VPIP" });
    else if (inFiles.has(r.key)) found.push({ key: r.key, where: inFiles.get(r.key)! });
    else missing.push(r);
  }
  return { envFiles, required, found, missing };
}

/* ---------------------------------------------- Stage 4: dependency audit */

export interface DependencyAudit {
  manifests: string[];
  lockfiles: string[];
  lockSource: string;
  installed: Array<{ name: string; required: string; installed: string }>;
  missing: Array<{ name: string; required: string; usedBy: string[] }>;
  peer: Array<{ name: string; required: string; installed?: string | undefined; satisfied: boolean }>;
  conflicts: Array<{ name: string; required: string; installed: string }>;
  invalid: string[];
  unresolvedImports: Array<{ spec: string; referencedBy: string }>;
  codeProblems: Array<{ kind: string; spec: string; referencedBy: string; expectedPath: string }>;
  status: "Resolved" | "Resolved with warnings" | "Unresolved";
}

export function dependencyAudit(files: AnalyzerFile[], report: RepoReport | undefined): DependencyAudit {
  const manifests = files.filter((f) => /(^|\/)package\.json$/.test(f.path)).map((f) => f.path);
  const lockfiles = files.filter((f) => /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(f.path)).map((f) => f.path);
  const { versions, source } = parseLockfiles(files);
  const peer: DependencyAudit["peer"] = [];
  for (const m of manifests) {
    const j = parseJsonc(files.find((f) => f.path === m)!.content) as { peerDependencies?: Record<string, string> } | null;
    for (const [name, required] of Object.entries(j?.peerDependencies ?? {})) {
      const installed = versions[name];
      peer.push({ name, required, installed, satisfied: Boolean(installed) || !source });
    }
  }
  const rows = report?.dependencies ?? [];
  const installed = rows.filter((d) => d.installed && d.status !== "Missing").map((d) => ({ name: d.name, required: d.required, installed: d.installed! }));
  const missing = rows.filter((d) => d.status === "Missing").map((d) => ({ name: d.name, required: d.required, usedBy: d.usedBy ?? [] }));
  const conflicts = rows.filter((d) => d.status === "Version conflict").map((d) => ({ name: d.name, required: d.required, installed: d.installed ?? "" }));
  const invalid = rows.filter((d) => d.status === "Invalid").map((d) => d.name);
  const unresolvedImports = (report?.imports ?? []).filter((i) => i.kind === "Missing module").map((i) => ({ spec: i.spec, referencedBy: i.referencedBy }));
  const codeProblems = (report?.imports ?? []).filter((i) => i.kind !== "Missing module").map((i) => ({ ...i }));
  const status: DependencyAudit["status"] = missing.length || invalid.length || unresolvedImports.length ? "Unresolved" : conflicts.length || peer.some((p) => !p.satisfied) ? "Resolved with warnings" : "Resolved";
  return { manifests, lockfiles, lockSource: source, installed, missing, peer, conflicts, invalid, unresolvedImports, codeProblems, status };
}

/* ---------------------------------------------- Stage 5: preview readiness */

export interface ReadinessFailure {
  file: string;
  dependency: string;
  envVar: string;
  error: string;
}
export interface ReadinessReport {
  repositoryIntegrity: number;
  dependencyIntegrity: number;
  environmentIntegrity: number;
  previewReadiness: number;
  failures: ReadinessFailure[];
  at: string;
}

const pct = (a: number, b: number) => (b === 0 ? 100 : Math.round((a / b) * 100));

export function readiness(report: RepoReport | undefined, ingestion: IngestionAudit | undefined, env: EnvAudit, deps: DependencyAudit, runtimeErrors: string[]): ReadinessReport {
  const failures: ReadinessFailure[] = [];
  for (const m of deps.missing) for (const f of m.usedBy.length ? m.usedBy : ["package.json"]) failures.push({ file: f, dependency: m.name, envVar: "—", error: `Package "${m.name}" is imported but not declared in package.json` });
  for (const c of deps.conflicts) failures.push({ file: "package.json", dependency: c.name, envVar: "—", error: `Requires ${c.required} but lockfile has ${c.installed}` });
  for (const n of deps.invalid) failures.push({ file: "package.json", dependency: n, envVar: "—", error: `"${n}" is not a valid package name` });
  for (const u of deps.unresolvedImports) failures.push({ file: u.referencedBy, dependency: u.spec, envVar: "—", error: `Cannot resolve module "${u.spec}"` });
  for (const p of deps.codeProblems) failures.push({ file: p.referencedBy, dependency: "—", envVar: "—", error: `${p.kind}: cannot resolve "${p.spec}" (expected ${p.expectedPath})` });
  for (const e of env.missing) failures.push({ file: e.sources[0] ?? "—", dependency: "—", envVar: e.key, error: `Environment variable ${e.key} is used but has no value` });
  for (const u of report?.unsupported ?? []) if (u.blocking) failures.push({ file: u.evidence, dependency: "—", envVar: "—", error: u.reason });
  for (const r of runtimeErrors) {
    const file = /((?:src|app|pages|components|lib)\/[\w./-]+\.[jt]sx?)/.exec(r)?.[1] ?? "—";
    const dep = /missing dependency: ([^\s]+)/.exec(r)?.[1] ?? "—";
    failures.push({ file, dependency: dep, envVar: "—", error: r });
  }
  const repositoryIntegrity = ingestion ? pct(ingestion.imported.length + ingestion.ignored.length, ingestion.found.length) : 0;
  const totalDeps = (report?.dependencies.length ?? 0) || 1;
  const badDeps = deps.missing.length + deps.conflicts.length + deps.invalid.length;
  const dependencyIntegrity = Math.max(0, pct(totalDeps - badDeps, totalDeps));
  const environmentIntegrity = pct(env.found.length, env.required.length);
  const previewReadiness = Math.round(report ? report.health.previewReadiness * 0.6 + dependencyIntegrity * 0.2 + environmentIntegrity * 0.1 + repositoryIntegrity * 0.1 : 0);
  return { repositoryIntegrity, dependencyIntegrity, environmentIntegrity, previewReadiness, failures, at: nowIso() };
}

/* ------------------------------------ Stage 8: change classification by path */

export function classifyChange(path: string, action: ProposalFile["action"]): ChangeClass {
  if (action === "delete") return "File Deletion";
  if (action === "env") return "Environment Change";
  if (/(^|\/)(supabase\/migrations|migrations|prisma)\/|\.sql$|schema\.prisma$/.test(path)) return "Database Change";
  if (/^(vercel\.json|netlify\.toml|wrangler\.|firebase\.json|fly\.toml|render\.yaml|Procfile|Dockerfile|docker-compose|\.github\/workflows)/.test(path)) return "Deployment Configuration Change";
  if (/(^|\/)(vite|next|webpack|rollup|astro|remix|svelte)\.config\.|(^|\/)tsconfig(\.[\w]+)?\.json$|(^|\/)jsconfig\.json$|(^|\/)babel\.config|(^|\/)postcss\.config|(^|\/)tailwind\.config/.test(path)) return "Build Configuration Change";
  if (action === "create") return "File Creation";
  if (/\.(json|ya?ml|toml|ini|rc)$|(^|\/)\.[\w]+rc$/.test(path)) return "Configuration Change";
  return "Source Code Change";
}

/* ------------------------------------- Stage 9: impact explanation helpers */

function impactFor(c: ChangeClass): Pick<ImpactReport, "ui" | "businessLogic" | "build" | "deployment" | "database" | "security"> {
  const none = "None";
  switch (c) {
    case "Dependency Installation":
      return { ui: none, businessLogic: none, build: "The package is added to package.json so imports resolve.", deployment: "Deployments will install one more package.", database: none, security: "Adds third-party code from the npm registry." };
    case "Dependency Removal":
      return { ui: "Anything using the package stops working.", businessLogic: "Code importing it will fail.", build: "The package is removed from package.json.", deployment: "Deployments install one fewer package.", database: none, security: "Removes third-party code." };
    case "Build Configuration Change":
      return { ui: none, businessLogic: none, build: "Changes how imports are resolved when building.", deployment: "The next build uses the new setting.", database: none, security: none };
    case "Environment Change":
      return { ui: "Features that read this value start working.", businessLogic: "Code reading this variable receives your value.", build: none, deployment: "Value is stored in VPIP only; your .env files and hosting settings are not changed.", database: none, security: "The value is stored with the project; AI only sees the name." };
    case "File Creation":
      return { ui: "The new file may render as an empty or neutral placeholder.", businessLogic: "Imports that were broken now receive a minimal stand-in.", build: "Removes a build error for a missing file.", deployment: "The new file is deployed with the app.", database: none, security: none };
    case "File Deletion":
      return { ui: "Anything rendered by this file disappears.", businessLogic: "Code importing it breaks.", build: "May cause build errors.", deployment: "The file is no longer deployed.", database: none, security: none };
    case "Database Change":
      return { ui: none, businessLogic: "Data access may change.", build: none, deployment: "Requires a database migration.", database: "Changes database schema or data.", security: "May change data access rules." };
    case "Deployment Configuration Change":
      return { ui: none, businessLogic: none, build: none, deployment: "Changes how the app is deployed.", database: none, security: "May change headers, redirects or secrets handling." };
    case "Configuration Change":
      return { ui: none, businessLogic: none, build: "Tooling configuration changes.", deployment: none, database: none, security: none };
    default:
      return { ui: "Screens rendered by the file may change.", businessLogic: "Logic in the file changes.", build: "The file is recompiled.", deployment: "Deployed code changes.", database: none, security: "Review the diff before approving." };
  }
}

/* ------------------------------------------------ Stage 7: repair simulation */

function pkgPath(report: RepoReport | undefined) {
  return report?.classification.appRoot ? `${report.classification.appRoot}/package.json` : "package.json";
}

function setDepVersion(content: string, name: string, version: string | null): string {
  const j = (parseJsonc(content) ?? {}) as Record<string, Record<string, string> | unknown>;
  for (const k of ["dependencies", "devDependencies", "peerDependencies"]) {
    const sec = j[k] as Record<string, string> | undefined;
    if (sec && name in sec) {
      if (version === null) delete sec[name];
      else sec[name] = version;
    }
  }
  return `${JSON.stringify(j, null, 2)}\n`;
}

function addAlias(content: string | undefined, alias: string, target: string): string {
  const j = ((content ? parseJsonc(content) : null) ?? {}) as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } };
  j.compilerOptions ??= {};
  j.compilerOptions.baseUrl ??= ".";
  j.compilerOptions.paths ??= {};
  j.compilerOptions.paths[`${alias}/*`] = [`${target}/*`];
  return `${JSON.stringify(j, null, 2)}\n`;
}

/** Applies one operation to a file list and returns the changed files (pure). */
export function applyOp(files: AnalyzerFile[], op: RepairOp, env?: string): Array<{ path: string; before: string; after: string }> {
  const get = (p: string) => files.find((f) => f.path === p)?.content;
  switch (op.kind) {
    case "add-dep": {
      const before = get(op.file) ?? "";
      const after = addMissingDependencies(before || undefined, [{ name: op.name, required: op.version, dev: false, status: "Missing" }]).content;
      return [{ path: op.file, before, after }];
    }
    case "set-dep-version": {
      const before = get(op.file) ?? "{}";
      return [{ path: op.file, before, after: setDepVersion(before, op.name, op.version) }];
    }
    case "remove-dep": {
      const before = get(op.file) ?? "{}";
      return [{ path: op.file, before, after: setDepVersion(before, op.name, null) }];
    }
    case "add-alias": {
      const before = get(op.file) ?? "";
      return [{ path: op.file, before, after: addAlias(before || undefined, op.alias, op.target) }];
    }
    case "create-file":
      return [{ path: op.path, before: "", after: op.content }];
    case "env":
      return [{ path: `env:${op.key}`, before: "(no value)", after: env ? "(value you entered)" : "(value required at approval)" }];
  }
}

function confidenceFor(op: RepairOp): { score: number; note: string } {
  switch (op.kind) {
    case "add-dep":
      return { score: 98, note: "The package is imported by name in the code and is published on npm; adding it to package.json is the standard fix." };
    case "set-dep-version":
      return { score: 90, note: "The lockfile records the version actually used; pinning package.json to it removes the conflict without changing code." };
    case "remove-dep":
      return { score: 80, note: "The entry is not a valid npm package name, so it cannot be installed. Removing it may hide a typo that should instead be corrected." };
    case "add-alias":
      return { score: 75, note: "The alias is used in imports and the target folder exists, but the original project may define it in a bundler config VPIP cannot read." };
    case "env":
      return { score: 95, note: "The variable is read by the code and has no value. Your value is used exactly as entered." };
    case "create-file":
      return { score: 60, note: "The referenced file does not exist in the repository. A minimal stand-in lets the rest of the app load, but it cannot reproduce the original content." };
  }
}

function stubFor(path: string): string {
  if (/\.(css|scss|sass|less)$/.test(path)) return "/* VPIP stand-in: original file was not in the repository */\n";
  if (/\.json$/.test(path)) return "{}\n";
  if (/\.svg$/.test(path)) return '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>\n';
  if (/\.(png|jpe?g|gif|webp|ico|avif)$/.test(path)) return "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";
  return "// VPIP stand-in: original file was not in the repository.\nconst Stub = () => null;\nexport default Stub;\n";
}

/** Generates proposals from detected problems. Makes ZERO changes. Dependency fixes come first (Stage 15). */
export function simulateRepair(
  files: AnalyzerFile[],
  report: RepoReport,
  env: EnvAudit,
  deps: DependencyAudit,
  ctx: { projectId: string; repositoryId?: string | undefined; buildSessionId?: string | undefined },
): RepairProposal[] {
  const simulationId = uid();
  const out: RepairProposal[] = [];
  const pj = pkgPath(report);
  const paths = new Set(files.map((f) => f.path));
  const push = (op: RepairOp, problem: string, fix: string, why: string, solves: string, dep?: ProposalDep) => {
    const changes = applyOp(files, op);
    const pfiles: ProposalFile[] = op.kind === "env" ? [{ path: `env:${op.key}`, action: "env" }] : changes.map((c) => ({ path: c.path, action: paths.has(c.path) ? "modify" : "create" }));
    const classification: ChangeClass =
      op.kind === "add-dep" || op.kind === "set-dep-version" ? "Dependency Installation" : op.kind === "remove-dep" ? "Dependency Removal" : classifyChange(pfiles[0]!.path, pfiles[0]!.action);
    const { score, note } = confidenceFor(op);
    const risk = op.kind === "create-file" ? "High Risk" : DEFAULT_RISK[classification];
    const base = impactFor(classification);
    out.push({
      id: uid(),
      ...ctx,
      simulationId,
      classification,
      risk,
      confidence: score,
      confidenceNote: note,
      problem,
      fix,
      impact: {
        why,
        solves,
        filesAffected: pfiles.map((f) => f.path),
        dependencyCount: dep ? 1 : 0,
        ...base,
        plain: `${fix}. ${why}`,
        consequences: `${base.ui !== "None" ? base.ui + " " : ""}${base.build !== "None" ? base.build : ""}`.trim() || "No visible change to the app beyond fixing the problem.",
        rollback: op.kind === "env" ? "Yes — the saved value can be restored from the snapshot/audit and removed." : "Yes — a snapshot is taken before applying; Revert restores it exactly.",
        op,
        preview: changes,
      },
      files: pfiles,
      dependencies: dep ? [dep] : [],
      status: "Proposed",
      approvedFiles: pfiles.map((f) => f.path),
      createdAt: nowIso(),
    });
  };
  // 1. dependencies first
  for (const m of deps.missing)
    push({ kind: "add-dep", name: m.name, version: "latest", file: pj }, `"${m.name}" is imported by ${m.usedBy.slice(0, 3).join(", ") || "the code"} but not declared`, `Add "${m.name}" to ${pj}`, "The code imports this package, so the preview and builds cannot resolve it.", `Resolves the missing package "${m.name}".`, { name: m.name, version: "latest", op: "install" });
  for (const c of deps.conflicts)
    push({ kind: "set-dep-version", name: c.name, version: c.installed, file: pj }, `"${c.name}" requires ${c.required} but the lockfile installs ${c.installed}`, `Pin "${c.name}" to ${c.installed} in ${pj}`, "package.json and the lockfile disagree, which can install a different version than the project was built with.", `Removes the version conflict for "${c.name}".`, { name: c.name, version: c.installed, op: "pin" });
  for (const n of deps.invalid)
    push({ kind: "remove-dep", name: n, file: pj }, `"${n}" is not a valid package name`, `Remove "${n}" from ${pj}`, "An invalid name cannot be installed and makes dependency resolution fail.", `Lets dependency resolution complete.`, { name: n, version: "", op: "remove" });
  // 2. configuration
  const aliasTargets = new Set<string>();
  for (const i of report.imports.filter((x) => x.kind === "Broken alias")) {
    const alias = /^([@~#][\w-]*)\//.exec(i.spec)?.[1];
    if (!alias || aliasTargets.has(alias)) continue;
    const root = report.classification.appRoot ? `${report.classification.appRoot}/src` : "src";
    if (![...paths].some((p) => p.startsWith(`${root}/`))) continue;
    aliasTargets.add(alias);
    const ts = paths.has("tsconfig.json") ? "tsconfig.json" : paths.has("jsconfig.json") ? "jsconfig.json" : "tsconfig.json";
    push({ kind: "add-alias", alias, target: "./src", file: ts }, `Imports use "${alias}/…" but no alias maps it (e.g. ${i.spec} in ${i.referencedBy})`, `Map "${alias}/*" to "./src/*" in ${ts}`, "Without the mapping these imports cannot be resolved.", `Resolves every "${alias}/…" import.`);
  }
  // 3. environment (values required at approval — never automatic)
  for (const e of env.missing)
    push({ kind: "env", key: e.key }, `${e.key} is used in ${e.sources.slice(0, 2).join(", ") || "the code"} but has no value`, `Store a value for ${e.key} in VPIP`, "Features that read this variable fail or behave differently without it.", `Provides ${e.key} to the preview.`);
  // 4. code — only for problems no dependency/config fix can solve
  const created = new Set<string>();
  for (const i of report.imports.filter((x) => x.kind === "Missing file" || x.kind === "Broken relative path" || x.kind === "Missing asset")) {
    const target = i.expectedPath.replace(/^\.\//, "");
    if (!target || created.has(target) || paths.has(target) || aliasTargets.size && i.kind === "Broken alias") continue;
    created.add(target);
    push({ kind: "create-file", path: target, content: stubFor(target) }, `${i.referencedBy} imports "${i.spec}" but ${target} does not exist`, `Create a minimal stand-in at ${target}`, "The file is missing from the repository, so the import fails and can stop the page from loading.", `Lets ${i.referencedBy} load; the original content is not recreated.`);
  }
  return out;
}

/* ----------------------------------------------------------- persistence */

const T = {
  snap: "vpip_repo_snapshots",
  prop: "vpip_repair_proposals",
  audit: "vpip_repair_audit",
  val: "vpip_validation_runs",
} as const;

// The new tables are not in the workspace full-sync; they are written directly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

async function withFkRetry<T>(fn: () => Promise<{ data: T; error: { code?: string; message: string } | null }>): Promise<T> {
  for (let i = 0; ; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    // Project rows are saved a moment after creation; wait for them.
    if (error.code === "23503" && i < 30) {
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    throw new Error(error.message);
  }
}

export async function logAudit(e: Omit<AuditEntry, "id" | "createdAt">): Promise<void> {
  await withFkRetry(() =>
    db.from(T.audit).insert({
      id: uid(),
      project_id: e.projectId,
      repository_id: e.repositoryId ?? null,
      user: e.user,
      action: e.action,
      change_type: e.changeType ?? null,
      risk: e.risk ?? null,
      confidence: e.confidence ?? null,
      files: e.files,
      dependencies: e.dependencies,
      note: e.note,
      created_at: nowIso(),
    }),
  );
}

export async function listAudit(projectId: string): Promise<AuditEntry[]> {
  const { data, error } = await db.from(T.audit).select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    projectId: r.project_id,
    repositoryId: r.repository_id ?? undefined,
    user: r.user,
    action: r.action,
    changeType: r.change_type ?? undefined,
    risk: r.risk ?? undefined,
    confidence: r.confidence ?? undefined,
    files: r.files ?? [],
    dependencies: r.dependencies ?? [],
    note: r.note ?? "",
    createdAt: r.created_at,
  })) as AuditEntry[];
}

export async function createSnapshot(s: Omit<RepoSnapshot, "id" | "createdAt" | "tree">): Promise<RepoSnapshot> {
  const snap: RepoSnapshot = { ...s, id: uid(), createdAt: nowIso(), tree: s.files.map((f) => f.path).sort() };
  await withFkRetry(() =>
    db.from(T.snap).insert({
      id: snap.id,
      project_id: snap.projectId,
      repository_id: snap.repositoryId ?? null,
      build_session_id: snap.buildSessionId ?? null,
      label: snap.label,
      is_zero: snap.isZero,
      files: snap.files,
      tree: snap.tree,
      metadata: snap.metadata,
      created_at: snap.createdAt,
    }),
  );
  return snap;
}

export async function listSnapshots(projectId: string): Promise<Array<Omit<RepoSnapshot, "files">>> {
  const { data, error } = await db.from(T.snap).select("id,project_id,repository_id,build_session_id,label,is_zero,tree,metadata,created_at").eq("project_id", projectId).order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    projectId: r.project_id,
    repositoryId: r.repository_id ?? undefined,
    buildSessionId: r.build_session_id ?? undefined,
    label: r.label,
    isZero: r.is_zero,
    tree: r.tree ?? [],
    metadata: r.metadata ?? {},
    createdAt: r.created_at,
  })) as Array<Omit<RepoSnapshot, "files">>;
}

export async function snapshotFiles(id: string): Promise<AnalyzerFile[]> {
  const { data, error } = await db.from(T.snap).select("files").eq("id", id).single();
  if (error) throw new Error(error.message);
  return (data?.files ?? []) as AnalyzerFile[];
}

export async function saveProposals(list: RepairProposal[]): Promise<void> {
  if (!list.length) return;
  await withFkRetry(() => db.from(T.prop).insert(list.map(toRow)));
}

export async function updateProposal(p: RepairProposal): Promise<void> {
  const { error } = await db.from(T.prop).update(toRow(p)).eq("id", p.id);
  if (error) throw new Error(error.message);
}

export async function listProposals(projectId: string): Promise<RepairProposal[]> {
  const { data, error } = await db.from(T.prop).select("*").eq("project_id", projectId).order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    projectId: r.project_id,
    repositoryId: r.repository_id ?? undefined,
    buildSessionId: r.build_session_id ?? undefined,
    simulationId: r.simulation_id,
    classification: r.classification,
    risk: r.risk,
    confidence: r.confidence,
    confidenceNote: r.confidence_note,
    problem: r.problem,
    fix: r.fix,
    impact: r.impact,
    files: r.files ?? [],
    dependencies: r.dependencies ?? [],
    status: r.status,
    approvedFiles: r.approved_files ?? [],
    snapshotId: r.snapshot_id ?? undefined,
    createdAt: r.created_at,
    decidedAt: r.decided_at ?? undefined,
    decidedBy: r.decided_by ?? undefined,
  })) as RepairProposal[];
}

function toRow(p: RepairProposal) {
  return {
    id: p.id,
    project_id: p.projectId,
    repository_id: p.repositoryId ?? null,
    build_session_id: p.buildSessionId ?? null,
    simulation_id: p.simulationId,
    classification: p.classification,
    risk: p.risk,
    confidence: p.confidence,
    confidence_note: p.confidenceNote,
    problem: p.problem,
    fix: p.fix,
    impact: p.impact,
    files: p.files,
    dependencies: p.dependencies,
    status: p.status,
    approved_files: p.approvedFiles,
    snapshot_id: p.snapshotId ?? null,
    created_at: p.createdAt,
    decided_at: p.decidedAt ?? null,
    decided_by: p.decidedBy ?? null,
  };
}

export async function saveReportExtras(reportId: string, extras: { ingestion?: IngestionAudit; readiness?: ReadinessReport }): Promise<void> {
  await withFkRetry(() => db.from("vpip_repo_reports").update(extras).eq("id", reportId));
}

/* ---------------------------------------------------- Stage 14: validation */

export interface ValidationTarget {
  category: string;
  repo: string;
  branch?: string | undefined;
}
export interface ValidationResult {
  category: string;
  repo: string;
  imported: boolean;
  filesFound: number;
  filesImported: number;
  classification?: string | undefined;
  compatible: boolean;
  previewRendered: boolean;
  repairable: boolean;
  proposals: number;
  failures: string[];
  durationMs: number;
}
export interface ValidationMetrics {
  importSuccessRate: number;
  previewSuccessRate: number;
  repairSuccessRate: number;
  compatibilitySuccessRate: number;
}
export interface ValidationRun {
  id: string;
  targets: ValidationTarget[];
  results: ValidationResult[];
  metrics: ValidationMetrics;
  createdAt: string;
}

export const DEFAULT_TARGETS: ValidationTarget[] = [
  { category: "React", repo: "ahfarmer/calculator" },
  { category: "Vite", repo: "SemBros90/sembros-ind" },
  { category: "Next.js", repo: "vercel/nextjs-subscription-payments" },
  { category: "Remix", repo: "remix-run/indie-stack" },
  { category: "Monorepo", repo: "t3-oss/create-t3-turbo" },
  { category: "Supabase Project", repo: "vercel/nextjs-subscription-payments" },
  { category: "Static Website", repo: "h5bp/html5-boilerplate" },
  { category: "External GitHub Repository", repo: "SemBros90/calco" },
];

export function metricsOf(results: ValidationResult[]): ValidationMetrics {
  const n = results.length || 1;
  const imported = results.filter((r) => r.imported);
  const ni = imported.length || 1;
  return {
    importSuccessRate: pct(imported.length, n),
    previewSuccessRate: pct(imported.filter((r) => r.previewRendered).length, ni),
    repairSuccessRate: pct(imported.filter((r) => r.repairable).length, ni),
    compatibilitySuccessRate: pct(imported.filter((r) => r.compatible).length, ni),
  };
}

export async function saveValidationRun(run: ValidationRun): Promise<void> {
  const { error } = await db.from(T.val).insert({ id: run.id, targets: run.targets, results: run.results, metrics: run.metrics, created_at: run.createdAt });
  if (error) throw new Error(error.message);
}

export async function listValidationRuns(): Promise<ValidationRun[]> {
  const { data, error } = await db.from(T.val).select("*").order("created_at", { ascending: false }).limit(100);
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: Record<string, unknown>) => ({ id: r.id, targets: r.targets, results: r.results, metrics: r.metrics, createdAt: r.created_at })) as ValidationRun[];
}

export { uid as safeRepairId };
