/**
 * Phase 4A.1 — Validation Engine Calibration.
 *
 * Pure, read-only classification of Validation Center findings into two
 * classes (BLOCKER / WARNING) plus a separate ENVIRONMENT LIMITATIONS list.
 * A successful real runtime (synced + installed + running + preview ready)
 * overrides every static-analysis guess. Never touches repositories,
 * sandboxes, packages or repair tasks.
 */
import type { RepoReport, ValidationIssue, ValidationReport } from "./types";
import type { AnalyzerFile } from "./repo-analyzer";

export type FindingClass = "BLOCKER" | "WARNING";
export interface Finding {
  cls: FindingClass;
  category: "Manifest" | "Install" | "Runtime" | "Sync" | "Integrity" | "Preview" | "Dependency" | "Lockfile" | "Import" | "Alias" | "Browser Preview";
  title: string;
  detail: string;
}
export interface EnvLimitation {
  key: string;
  impact: string;
  sources: string[];
}

export type StepState = "success" | "failed" | "not_run";
export interface RuntimeEvidence {
  synced: StepState;
  installed: StepState;
  running: StepState;
  previewReady: StepState;
  checksumMismatch?: boolean;
  syncError?: string | undefined;
  installError?: string | undefined;
  runError?: string | undefined;
  previewError?: string | undefined;
  lastAt?: string | undefined;
}

export interface CalibratedReport {
  runtimeResult: "PASS" | "FAIL" | "NOT RUN";
  runtimeOverride: boolean;
  validationResult: "PASS" | "PASS WITH WARNINGS" | "BLOCKED";
  blockers: Finding[];
  warnings: Finding[];
  environment: EnvLimitation[];
  /** Pre-calibration view, for before/after comparison. */
  before: { blockers: number; warnings: number };
}

export const OVERRIDE_LABEL = "Static Analysis Finding — Runtime Execution Successful";

type AuditRow = { action: string; status: string; error?: string | null; detail?: unknown; created_at: string };

/** Derives runtime evidence from the (read-only) runtime audit log, newest first. */
export function evidenceFromAudit(rows: AuditRow[]): RuntimeEvidence {
  const latest = (actions: string[]) => rows.find((r) => actions.includes(r.action) && (r.status === "success" || r.status === "failed"));
  const st = (r: AuditRow | undefined): StepState => (!r ? "not_run" : r.status === "success" ? "success" : "failed");
  const sync = latest(["repository_sync"]);
  const install = latest(["dependency_install"]);
  const run = latest(["runtime_startup", "sandbox_start"]);
  const preview = latest(["preview_create", "preview_health", "preview_recovery"]);
  const d = (sync?.detail ?? {}) as Record<string, unknown>;
  const mismatch = sync?.status === "failed" && (/missing or corrupted/i.test(sync.error ?? "") || (Array.isArray(d["errors"]) && (d["errors"] as unknown[]).length > 0));
  return {
    synced: st(sync),
    installed: st(install),
    running: st(run),
    previewReady: st(preview),
    checksumMismatch: mismatch,
    syncError: sync?.status === "failed" ? sync.error ?? undefined : undefined,
    installError: install?.status === "failed" ? install.error ?? undefined : undefined,
    runError: run?.status === "failed" ? run.error ?? undefined : undefined,
    previewError: preview?.status === "failed" ? preview.error ?? undefined : undefined,
    lastAt: rows[0]?.created_at,
  };
}

const ENV_IMPACT: Array<[RegExp, string]> = [
  [/SERVICE_ROLE/i, "Server-side privileged database actions will fail; the site still starts."],
  [/SUPABASE_URL|DATABASE_URL|DB_/i, "Database features (sign-in, data loading) will fail; pages still render."],
  [/ANON_KEY|PUBLISHABLE/i, "Client database calls will be rejected; static pages still render."],
  [/SITE_URL|BASE_URL|PUBLIC_URL|APP_URL/i, "Absolute links, redirects and share URLs may point to the wrong address."],
  [/KEY|TOKEN|SECRET/i, "The integration using this credential will not work."],
];
const impactOf = (k: string) => ENV_IMPACT.find(([re]) => re.test(k))?.[1] ?? "Features reading this value may behave differently.";

export function calibrate(report: RepoReport | undefined, files: AnalyzerFile[], ev: RuntimeEvidence | undefined): CalibratedReport {
  const blockers: Finding[] = [];
  const warnings: Finding[] = [];
  const staticFindings: Finding[] = [];
  const e = ev ?? { synced: "not_run", installed: "not_run", running: "not_run", previewReady: "not_run" };
  const runtimeOk = e.synced === "success" && e.installed === "success" && e.running === "success" && e.previewReady === "success";
  const anyFail = [e.synced, e.installed, e.running, e.previewReady].includes("failed");
  const runtimeResult: CalibratedReport["runtimeResult"] = runtimeOk ? "PASS" : anyFail ? "FAIL" : "NOT RUN";

  // ---- Real blockers (the only allowed BLOCKER sources)
  if (!files.some((f) => /(^|\/)package\.json$/.test(f.path)))
    blockers.push({ cls: "BLOCKER", category: "Manifest", title: "package.json missing", detail: "No package manifest in the repository." });
  for (const d of report?.dependencies ?? [])
    if (d.status === "Invalid") blockers.push({ cls: "BLOCKER", category: "Manifest", title: "Invalid package name", detail: `"${d.name}" is not a valid npm package name.` });
  if (e.synced === "failed") blockers.push({ cls: "BLOCKER", category: "Sync", title: "Sync failure", detail: e.syncError ?? "Repository sync to the sandbox failed." });
  if (e.checksumMismatch) blockers.push({ cls: "BLOCKER", category: "Integrity", title: "Checksum mismatch", detail: "Files differ from the VPIP master copy after upload." });
  if (e.installed === "failed") blockers.push({ cls: "BLOCKER", category: "Install", title: "Install failure", detail: e.installError ?? "Dependency install failed in the sandbox." });
  if (e.running === "failed") blockers.push({ cls: "BLOCKER", category: "Runtime", title: "Runtime start failure", detail: e.runError ?? "The dev server did not start." });
  if (e.previewReady === "failed") blockers.push({ cls: "BLOCKER", category: "Preview", title: "Runtime cannot generate preview", detail: e.previewError ?? "The preview relay did not answer." });

  // ---- Static-analysis findings (always WARNING)
  for (const d of report?.dependencies ?? []) {
    if (d.status === "Missing")
      staticFindings.push({ cls: "WARNING", category: "Dependency", title: d.installed ? "Undeclared dependency installed by lockfile" : "Undeclared dependency (static guess)", detail: `"${d.name}" imported by ${d.usedBy?.[0] ?? "code"} but not in package.json${d.installed ? ` — lockfile installs ${d.installed}` : ""}.` });
    else if (d.status === "Version conflict")
      staticFindings.push({ cls: "WARNING", category: "Dependency", title: "Version mismatch", detail: `${d.name}: requires ${d.required}, lockfile has ${d.installed ?? "?"}.` });
    else if (d.status === "Not locked")
      staticFindings.push({ cls: "WARNING", category: "Lockfile", title: "Lockfile advisory", detail: `${d.name} not found by the lockfile reader (interpretation may be incomplete).` });
  }
  for (const i of report?.imports ?? []) {
    if (i.kind === "Missing asset") continue;
    staticFindings.push({
      cls: "WARNING",
      category: i.kind === "Broken alias" ? "Alias" : "Import",
      title: i.kind === "Broken alias" ? "Alias not resolved by static reader" : `Static import finding: ${i.kind}`,
      detail: `"${i.spec}" in ${i.referencedBy} → ${i.expectedPath}`,
    });
  }
  const bp = report?.stages;
  if (bp && (bp.preview.status === "Fail" || bp.runtime.status === "Fail"))
    warnings.push({ cls: "WARNING", category: "Browser Preview", title: "Browser Preview limitation", detail: "The in-browser preview could not render this repository; this does not describe the real runtime." });
  for (const u of report?.unsupported ?? [])
    warnings.push({ cls: "WARNING", category: "Browser Preview", title: `Browser Preview limitation: ${u.reason}`, detail: u.evidence });

  const runtimeOverride = runtimeOk && staticFindings.length > 0;
  for (const f of staticFindings) warnings.push(runtimeOk ? { ...f, title: `${f.title} · ${OVERRIDE_LABEL}` } : f);

  const environment: EnvLimitation[] = (report?.environment ?? []).filter((x) => !x.configured).map((x) => ({ key: x.key, sources: x.sources, impact: impactOf(x.key) }));

  // Pre-calibration counts: old engine treated Missing/Invalid deps, unresolved imports, env and preview failures as blocking.
  const oldBlock =
    (report?.dependencies ?? []).filter((d) => d.status === "Missing" || d.status === "Invalid").length +
    (report?.imports ?? []).length +
    environment.length +
    (bp?.preview.status === "Fail" ? 1 : 0) +
    (report?.unsupported ?? []).filter((u) => u.blocking).length;
  const oldWarn = (report?.dependencies ?? []).filter((d) => d.status === "Version conflict" || d.status === "Not locked").length;

  const validationResult: CalibratedReport["validationResult"] = blockers.length ? "BLOCKED" : warnings.length || environment.length ? "PASS WITH WARNINGS" : "PASS";
  return { runtimeResult, runtimeOverride, validationResult, blockers, warnings, environment, before: { blockers: oldBlock, warnings: oldWarn } };
}

/* ------------------------------------------------------------------ *
 * Phase 4C — Validation Engine Unification.
 * One verdict for Build Manager, Import Diagnostics, Safe Repair and the
 * Runtime Validation Center: the calibrated engine above. The legacy
 * Coder checker (orchestration.validateBuild) is only an input.
 * ------------------------------------------------------------------ */

export const RUNTIME_AUDIT_ACTIONS = ["repository_sync", "dependency_install", "runtime_startup", "sandbox_start", "preview_create", "preview_health", "preview_recovery"];

/** Deduplicates legacy issues: one Dependency issue per package, one issue per identical message. */
function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const i of issues) {
    const pkg = i.kind === "Dependency" ? /"([^"]+)"/.exec(i.message)?.[1] : undefined;
    const key = pkg ? `dep:${pkg}` : `${i.kind}:${i.path ?? ""}:${i.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/**
 * Converts the legacy report into the unified verdict.
 * - Runtime PASS: every static finding becomes a warning; statuses Pass; nothing blocks.
 * - Calibrated BLOCKERs (install/run/sync/manifest failures) are the only errors.
 * - No runtime evidence for an imported repository: static findings are warnings
 *   (static guesses never block), calibrated blockers still block.
 */
export function unifyValidation(legacy: ValidationReport, cal: CalibratedReport | undefined, imported: boolean): ValidationReport {
  const deduped = dedupe(legacy.issues);
  const missing = [...new Set(legacy.missingDependencies)];
  if (!cal || (!imported && cal.runtimeResult !== "PASS")) return { ...legacy, issues: deduped, missingDependencies: missing };
  const warnings = deduped.map((i) => ({ ...i, severity: "warning" as const }));
  const blockers: ValidationIssue[] = cal.blockers.map((b) => ({
    kind: b.category === "Install" || b.category === "Manifest" ? "Dependency" : "Startup",
    severity: "error",
    message: `${b.title} — ${b.detail}`,
  }));
  const depFail = blockers.some((b) => b.kind === "Dependency");
  const startFail = blockers.some((b) => b.kind === "Startup");
  const ok = cal.runtimeResult === "PASS";
  return {
    at: legacy.at,
    issues: [...blockers, ...warnings],
    dependencyStatus: depFail ? "Fail" : ok ? "Pass" : "Unknown",
    startupStatus: startFail ? "Fail" : ok ? "Pass" : "Unknown",
    compileStatus: startFail ? "Fail" : ok ? "Pass" : "Unknown",
    // Only real failures count as missing; static guesses stay in the warning list.
    missingDependencies: depFail ? missing : [],
  };
}
