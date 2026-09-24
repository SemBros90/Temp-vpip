import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { AlertTriangle, CheckCircle2, Loader2, PackagePlus, RefreshCw, Sparkles, Wrench, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { compileCheck } from "@/lib/vpip/coder-fs";
import {
  analyzeRepository,
  importVerdict,
  repoDiagnosticsSummary,
  type AnalyzerFile,
} from "@/lib/vpip/repo-analyzer";
import type { BuildSession, RepoReport, Repository } from "@/lib/vpip/types";

/** Latest compatibility report for a repository or build session. */
export function useRepoReport(projectId: string, repositoryId?: string, buildSessionId?: string): RepoReport | undefined {
  const { ws } = useVpip();
  return useMemo(() => {
    const list = (ws.repoReports ?? []).filter((r) => r.projectId === projectId);
    return (
      (repositoryId ? list.find((r) => r.repositoryId === repositoryId) : undefined) ??
      (buildSessionId ? list.find((r) => r.buildSessionId === buildSessionId) : undefined)
    );
  }, [ws.repoReports, projectId, repositoryId, buildSessionId]);
}

export function useRepoEnv(repositoryId?: string): Record<string, string> {
  const { ws } = useVpip();
  return useMemo(() => {
    const out: Record<string, string> = {};
    for (const e of ws.repoEnv ?? []) if (e.repositoryId === repositoryId && e.value) out[e.key] = e.value;
    return out;
  }, [ws.repoEnv, repositoryId]);
}

/** Runs the analyzer and saves the report. Returns the saved report. */
export function useRunCompatibility() {
  const actions = useVpipActions();
  const { ws } = useVpip();
  return (
    projectId: string,
    files: AnalyzerFile[],
    opts: { repository?: Repository | undefined; build?: BuildSession | undefined; runtimeErrors?: string[]; repairs?: string[]; buildStatus?: string },
  ) => {
    const configured = (ws.repoEnv ?? []).filter((e) => e.repositoryId === opts.repository?.id && e.value).map((e) => e.key);
    const repoId = opts.repository?.id ?? opts.build?.repositoryId;
    const previous = (ws.repoReports ?? []).find((r) => r.projectId === projectId && ((repoId && r.repositoryId === repoId) || (opts.build && r.buildSessionId === opts.build.id)));
    const baseOpts = {
      configuredEnv: configured,
      branch: opts.repository?.currentBranch ?? opts.build?.repositoryBranch ?? "",
      commitSha: opts.repository?.lastCommitSha ?? opts.build?.lastCommitSha,
      repositoryId: opts.repository?.id ?? opts.build?.repositoryId,
      buildSessionId: opts.build?.id,
      previewDiagnostics: {
        buildStatus: opts.buildStatus ?? "Validated",
        repairs: opts.repairs ?? [],
        runtimeErrors: opts.runtimeErrors ?? [],
        lastRunAt: new Date().toISOString(),
      },
      previousStages: previous?.stages,
    };
    // First pass finds backend files; the compile check then runs on frontend code only.
    const first = analyzeRepository(files, baseOpts);
    const backend = Object.entries(first.previewDiagnostics.insights?.codeSplit ?? {}).filter(([, v]) => v === "Backend").map(([k]) => k);
    let compileErrors: string[] | undefined;
    try {
      compileErrors = compileCheck(files, backend);
    } catch {
      compileErrors = undefined;
    }
    const result = analyzeRepository(files, { ...baseOpts, compileErrors });
    return actions.saveRepoReport({ ...result, projectId });
  };
}

function pctTone(n: number) {
  return n >= 90 ? "text-success" : n >= 60 ? "text-warning" : "text-destructive";
}

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-success" : "text-destructive"}`}>
      {ok ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
      {label}
    </span>
  );
}

export function RepoCompatibilityPanel({
  projectId,
  repository,
  build,
  loadFiles,
  runtimeErrors = [],
  onPreview,
  onAskAI,
  onRequestRepair,
  compact = false,
}: {
  projectId: string;
  repository?: Repository | undefined;
  build?: BuildSession | undefined;
  /** Supplies the files to scan (build files, or a fresh download). */
  loadFiles: () => Promise<AnalyzerFile[]>;
  runtimeErrors?: string[];
  onPreview?: (() => void) | undefined;
  onAskAI?: ((summary: string) => void) | undefined;
  /** Opens the Safe Repair simulation → approval flow. No file changes happen here. */
  onRequestRepair?: (() => void) | undefined;
  compact?: boolean;
}) {
  const actions = useVpipActions();
  const navigate = useNavigate();
  const requestRepair = () => (onRequestRepair ? onRequestRepair() : void navigate({ to: "/projects/$projectId/import-diagnostics", params: { projectId } }));
  const report = useRepoReport(projectId, repository?.id ?? build?.repositoryId, build?.id);
  const env = useRepoEnv(repository?.id ?? build?.repositoryId);
  const run = useRunCompatibility();
  const [busy, setBusy] = useState("");
  const [envDraft, setEnvDraft] = useState<Record<string, string>>({});
  const repoId = repository?.id ?? build?.repositoryId;

  async function scan(extra: { repairs?: string[]; buildStatus?: string } = {}, filesOverride?: AnalyzerFile[]) {
    const files = filesOverride ?? (await loadFiles());
    if (!files.length) throw new Error("No files to scan — pull the repository into a build first.");
    return run(projectId, files, { repository, build, runtimeErrors, ...extra });
  }

  async function wrap(label: string, fn: () => Promise<unknown>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const c = report?.classification;
  const badDeps = report?.dependencies.filter((d) => d.status !== "OK") ?? [];
  const codeIssues = report?.imports.filter((i) => i.kind !== "Missing asset") ?? [];
  const assetIssues = report?.imports.filter((i) => i.kind === "Missing asset") ?? [];
  const missingEnv = report?.environment.filter((e) => !e.configured) ?? [];

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => void wrap("Scanning…", () => scan())}>
          <RefreshCw className="size-4" /> {report ? "Re-scan" : "Scan repository"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!!busy || !report || !report.dependencies.some((d) => d.status === "Missing")}
          onClick={requestRepair}
          title="Opens Safe Repair: simulate, review and approve"
        >
          <PackagePlus className="size-4" /> Install missing dependencies
        </Button>
        <Button size="sm" className="h-8" disabled={!!busy} onClick={requestRepair}>
          <Wrench className="size-4" /> Auto Repair (simulate &amp; approve)
        </Button>
        {onAskAI && report ? (
          <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => onAskAI(repoDiagnosticsSummary(report))}>
            <Sparkles className="size-4" /> Ask AI to fix
          </Button>
        ) : null}
        {busy ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {busy}
          </span>
        ) : null}
      </div>

      {!report || !c ? (
        <p className="text-muted-foreground">No compatibility report yet. Click Scan repository.</p>
      ) : (
        <>
          <div className={`grid gap-3 ${compact ? "grid-cols-2" : "md:grid-cols-3"}`}>
            <div className="rounded-md border border-border p-3">
              <div className="label-mono mb-1">Repository health</div>
              <div className={`text-3xl font-semibold ${pctTone(report.health.overall)}`}>{report.health.overall}%</div>
              <div className="mt-2 space-y-0.5 text-xs">
                {(
                  [
                    ["Dependencies", report.health.dependencies],
                    ["Imports", report.health.imports],
                    ["Assets", report.health.assets],
                    ["Environment", report.health.environment],
                    ["Preview readiness", report.health.previewReadiness],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{k}</span>
                    <span className={pctTone(v)}>{v}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border p-3 text-xs">
              <div className="label-mono mb-1">Classification</div>
              <div>Framework: <strong>{c.frameworks.join(" + ") || c.primary}</strong></div>
              <div>Language: {c.language}</div>
              <div>Package manager: {c.packageManager}</div>
              <div>Build system: {c.buildSystem}</div>
              <div>Workspace: {c.workspaceType}{c.appRoot ? ` (app: ${c.appRoot})` : ""}</div>
              <div className="mt-1 text-muted-foreground">Scanned {new Date(report.createdAt).toLocaleString()}{report.branch ? ` · ${report.branch}` : ""}</div>
            </div>
            <div className="rounded-md border border-border p-3 text-xs">
              <div className="label-mono mb-1">Preview diagnostics</div>
              <div>Build: {report.previewDiagnostics.buildStatus}</div>
              <div><Status ok={!badDeps.length} label={`Dependencies${badDeps.length ? ` (${badDeps.length})` : ""}`} /></div>
              <div><Status ok={!codeIssues.length} label={`Imports${codeIssues.length ? ` (${codeIssues.length})` : ""}`} /></div>
              <div><Status ok label={`Aliases (${report.aliases.length})`} /></div>
              <div><Status ok={!assetIssues.length} label={`Assets${assetIssues.length ? ` (${assetIssues.length})` : ""}`} /></div>
              <div><Status ok={!missingEnv.length} label={`Environment${missingEnv.length ? ` (${missingEnv.length} missing)` : ""}`} /></div>
              {report.previewDiagnostics.repairs.length ? (
                <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                  {report.previewDiagnostics.repairs.map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              ) : null}
            </div>
          </div>

          <StagesView report={report} />

          {report.unsupported.length ? (
            <Section title="Why the preview may not run">
              {report.unsupported.map((u, i) => (
                <div key={i} className="flex gap-2 py-1">
                  <AlertTriangle className={`mt-0.5 size-4 shrink-0 ${u.blocking ? "text-destructive" : "text-warning"}`} />
                  <div>
                    <strong>{u.reason}</strong>{u.blocking ? " — blocks preview" : ""}
                    <div className="text-xs text-muted-foreground">{u.evidence}</div>
                  </div>
                </div>
              ))}
            </Section>
          ) : null}

          {runtimeErrors.length ? (
            <Section title={`Runtime errors from the preview (${runtimeErrors.length})`}>
              {runtimeErrors.slice(-20).map((e, i) => <div key={i} className="font-mono text-xs text-destructive">{e}</div>)}
            </Section>
          ) : null}

          <Section title={`Dependencies (${report.dependencies.length}, ${badDeps.length} with problems)`}>
            <Table
              head={["Package", "Required", "Installed", "Status", "Used by"]}
              rows={(compact ? badDeps : report.dependencies).slice(0, 300).map((d) => [
                d.name + (d.dev ? " (dev)" : ""),
                d.required,
                d.installed ?? "—",
                <span key="s" className={d.status === "OK" ? "text-success" : d.status === "Not locked" ? "text-warning" : "text-destructive"}>{d.status}</span>,
                d.usedBy?.slice(0, 2).join(", ") ?? "",
              ])}
              empty="No problems."
            />
          </Section>

          <Section title={`Imports & assets (${report.imports.length} unresolved)`}>
            <Table
              head={["Problem", "File", "Referenced by", "Expected path"]}
              rows={report.imports.slice(0, 300).map((i) => [i.kind, i.spec, i.referencedBy, i.expectedPath])}
              empty="All imports resolve."
            />
          </Section>

          <Section title={`Aliases (${report.aliases.length})`}>
            <Table head={["Alias", "Maps to", "Source"]} rows={report.aliases.map((a) => [a.alias, a.target, a.source])} empty="No aliases." />
          </Section>

          <Section title={`Environment variables (${report.environment.length} required, ${missingEnv.length} missing)`}>
            {report.environment.length === 0 ? (
              <p className="text-xs text-muted-foreground">No environment variables referenced.</p>
            ) : (
              <div className="space-y-1.5">
                {report.environment.map((e) => (
                  <div key={e.key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-center gap-2 text-xs">
                    <div className="truncate font-mono" title={e.sources.join(", ")}>
                      {e.key} <span className={e.configured || env[e.key] ? "text-success" : "text-destructive"}>{e.configured || env[e.key] ? "configured" : "missing"}</span>
                    </div>
                    <Input
                      type="password"
                      className="h-7 text-xs"
                      placeholder={repoId ? (env[e.key] ? "•••••• saved" : "Enter value") : "Connect a repository to store values"}
                      disabled={!repoId}
                      value={envDraft[e.key] ?? ""}
                      onChange={(ev) => setEnvDraft((d) => ({ ...d, [e.key]: ev.target.value }))}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      disabled={!repoId || !(envDraft[e.key] ?? "").trim()}
                      onClick={() => {
                        actions.setRepoEnv(projectId, repoId!, e.key, envDraft[e.key]!.trim());
                        setEnvDraft((d) => ({ ...d, [e.key]: "" }));
                        toast.success(`${e.key} saved — re-scan to update the report`);
                      }}
                    >
                      Save
                    </Button>
                  </div>
                ))}
                <p className="text-[11px] text-muted-foreground">Values are stored with the project and injected into the preview. The AI only sees variable names.</p>
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border">
      <div className="border-b border-border bg-surface-2 px-3 py-1.5 text-xs font-medium">{title}</div>
      <div className="max-h-72 overflow-auto p-2">{children}</div>
    </div>
  );
}

export function Table({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) {
  if (!rows.length) return <p className="text-xs text-muted-foreground">{empty}</p>;
  return (
    <table className="w-full text-left text-xs">
      <thead>
        <tr className="text-muted-foreground">{head.map((h) => <th key={h} className="px-1 py-1 font-medium">{h}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-border align-top">
            {r.map((c, j) => <td key={j} className="break-all px-1 py-1 font-mono">{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const STAGE_LABEL = { dependencies: "Dependency resolution", imports: "Import resolution", compile: "Compile", runtime: "Runtime", preview: "Preview" } as const;

export function StagesView({ report }: { report: RepoReport }) {
  const v = importVerdict(report);
  const tone = v.verdict === "Preview can run" ? "text-success" : v.verdict === "Preview cannot run" ? "text-destructive" : "text-warning";
  return (
    <Section title={`Build health stages — ${v.verdict}`}>
      <div className={`mb-1 text-xs font-medium ${tone}`}>{v.verdict}</div>
      {(Object.keys(STAGE_LABEL) as Array<keyof typeof STAGE_LABEL>).map((k) => {
        const st = report.stages?.[k] ?? { status: "Not run" as const, detail: "Re-scan to compute this stage." };
        const c = st.status === "Pass" ? "text-success" : st.status === "Warn" ? "text-warning" : st.status === "Fail" ? "text-destructive" : "text-muted-foreground";
        return (
          <div key={k} className="grid grid-cols-[10rem_4rem_minmax(0,1fr)] gap-2 border-t border-border py-1 text-xs first:border-t-0">
            <span>{STAGE_LABEL[k]}</span>
            <span className={`font-medium ${c}`}>{st.status}</span>
            <span className="break-words text-muted-foreground">{st.detail}</span>
          </div>
        );
      })}
    </Section>
  );
}
