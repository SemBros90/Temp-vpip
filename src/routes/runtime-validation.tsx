import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeNav } from "@/components/vpip/RuntimeEventsView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVpip } from "@/lib/vpip/store";
import { runtimeEvents, runtimeReadiness } from "@/lib/vpip/runtime/runtime.functions";
import { analyzeRepository, type AnalyzerFile } from "@/lib/vpip/repo-analyzer";
import { calibrate, evidenceFromAudit, type CalibratedReport, type Finding, type RuntimeEvidence } from "@/lib/vpip/validation-calibration";
import type { BuildSession, RepoReport } from "@/lib/vpip/types";

export const Route = createFileRoute("/runtime-validation")({
  head: () => ({
    meta: [
      { title: "Runtime Validation Center · VPIP" },
      { name: "description", content: "Readiness for the Pull → Sync → Integrity → Install → Run → Preview → Pause → Resume → Destroy runtime validation workflow." },
      { property: "og:title", content: "Runtime Validation Center · VPIP" },
      { property: "og:description", content: "Runtime validation workflow readiness for VPIP build sessions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type R = Awaited<ReturnType<typeof runtimeReadiness>>;

const STEP_LABEL: Record<string, string> = { success: "PASS", failed: "FAIL", not_run: "not run" };

function Page() {
  const { ws } = useVpip();
  const check = useServerFn(runtimeReadiness);
  const events = useServerFn(runtimeEvents);
  const builds = (ws.buildSessions ?? []) as BuildSession[];
  const [buildId, setBuildId] = useState("");
  const [result, setResult] = useState<R | null>(null);
  const [cal, setCal] = useState<{ report: CalibratedReport; ev: RuntimeEvidence } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pname = (id: string) => ws.projects.find((p: { id: string; name: string }) => p.id === id)?.name ?? id;

  const go = async () => {
    setBusy(true);
    try {
      const [r, audit] = await Promise.all([
        check({ data: { buildId } }),
        events({ data: { buildId, actions: ["repository_sync", "dependency_install", "runtime_startup", "sandbox_start", "preview_create", "preview_health", "preview_recovery"], page: 0, pageSize: 500 } }),
      ]);
      setResult(r);
      const build = builds.find((b) => b.id === buildId);
      const files: AnalyzerFile[] = (build?.files ?? []).map((f) => ({ path: f.path, content: f.content }));
      const saved = ((ws.repoReports ?? []) as RepoReport[])
        .filter((x) => x.buildSessionId === buildId || (!x.buildSessionId && x.projectId === build?.projectId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const analysis = files.length
        ? ({ ...analyzeRepository(files, { configuredEnv: saved?.environment.filter((e) => e.configured).map((e) => e.key), previousStages: saved?.stages }), id: "calibration", projectId: build?.projectId ?? "", createdAt: new Date().toISOString() } as RepoReport)
        : saved;
      const ev = evidenceFromAudit(audit.rows as never);
      setCal({ report: calibrate(analysis, files, ev), ev });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const list = (items: Finding[], empty: string) =>
    items.length ? (
      <ul className="max-h-80 space-y-1 overflow-auto">
        {items.slice(0, 300).map((f, i) => (
          <li key={i} className="rounded border border-border p-2 text-xs">
            <span className="font-medium">{f.category}</span> · {f.title}
            <div className="text-muted-foreground">{f.detail}</div>
          </li>
        ))}
      </ul>
    ) : (
      <div className="text-xs text-muted-foreground">{empty}</div>
    );

  return (
    <Shell title="Runtime Validation Center">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtime Validation Center</h1>
          <p className="text-sm text-muted-foreground">Checks readiness only. It never creates a sandbox, runs commands, or changes files.</p>
        </div>
        <RuntimeNav />
        <div className="flex gap-2">
          <select className="h-9 flex-1 rounded border border-border bg-background px-2 text-sm" value={buildId} onChange={(e) => setBuildId(e.target.value)} aria-label="Build session">
            <option value="">Select a build session…</option>
            {builds.map((b) => <option key={b.id} value={b.id}>{pname(b.projectId)} · {b.code}</option>)}
          </select>
          <Button onClick={() => void go()} disabled={!buildId || busy}><ShieldCheck className="size-4" /> Check readiness</Button>
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}

        {cal ? (
          <div className="space-y-3 rounded border border-border p-3">
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <div className="text-xs text-muted-foreground">Runtime Result (primary source of truth)</div>
                <Badge variant={cal.report.runtimeResult === "FAIL" ? "destructive" : cal.report.runtimeResult === "PASS" ? "default" : "secondary"}>{cal.report.runtimeResult}</Badge>
                <div className="mt-1 text-xs text-muted-foreground">
                  Synced {STEP_LABEL[cal.ev.synced]} · Installed {STEP_LABEL[cal.ev.installed]} · Running {STEP_LABEL[cal.ev.running]} · Preview {STEP_LABEL[cal.ev.previewReady]}
                  {cal.ev.lastAt ? ` · last event ${new Date(cal.ev.lastAt).toLocaleString()}` : ""}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Validation Result</div>
                <Badge variant={cal.report.validationResult === "BLOCKED" ? "destructive" : "default"}>{cal.report.validationResult}</Badge>
                <div className="mt-1 text-xs text-muted-foreground">
                  {cal.report.runtimeOverride ? "Runtime Success Override applied to static findings. " : ""}
                  Before calibration: {cal.report.before.blockers} blocking · {cal.report.before.warnings} warnings. After: {cal.report.blockers.length} blockers · {cal.report.warnings.length} warnings · {cal.report.environment.length} environment limitations.
                </div>
              </div>
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Blockers ({cal.report.blockers.length})</div>
              {list(cal.report.blockers, "None")}
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Warnings ({cal.report.warnings.length})</div>
              {list(cal.report.warnings, "None")}
            </div>
            <div>
              <div className="mb-1 text-sm font-medium">Environment Limitations ({cal.report.environment.length})</div>
              {cal.report.environment.length ? (
                <ul className="space-y-1">
                  {cal.report.environment.map((e) => (
                    <li key={e.key} className="rounded border border-border p-2 text-xs"><span className="font-mono">{e.key}</span> — {e.impact}</li>
                  ))}
                </ul>
              ) : <div className="text-xs text-muted-foreground">None</div>}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="space-y-2">
            <div className="text-sm">Runtime readiness: <Badge variant={result.ready ? "default" : "destructive"}>{result.ready ? "Ready to validate" : "Blocked"}</Badge></div>
            <ol className="space-y-1">
              {result.stages.map((s, i) => (
                <li key={s.stage} className="flex items-start gap-3 rounded border border-border p-2 text-sm">
                  <span className="w-5 text-muted-foreground">{i + 1}</span>
                  <span className="w-32 font-medium">{s.stage}</span>
                  <Badge variant={s.state === "blocked" ? "destructive" : s.state === "ready" ? "default" : "secondary"}>{s.state}</Badge>
                  <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
