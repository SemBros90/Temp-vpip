/**
 * Admin AI Home — read-only health widgets. Reads existing audit, runtime,
 * AI1, AI2, validation, snapshot and knowledge stores. Never writes.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
type Data = { builds: Row[]; val: Row[]; fails: Row[]; rt: Row[]; audits: Row[]; ai1: Row[]; snaps: Row[]; know: Row[]; reports: Row[]; repairs: Row[] };
type Level = "Healthy" | "Warning" | "Critical";

const levelOf = (s: number): Level => (s >= 75 ? "Healthy" : s >= 50 ? "Warning" : "Critical");
const tone: Record<Level, string> = {
  Healthy: "text-success border-success/40 bg-success/10",
  Warning: "text-warning border-warning/40 bg-warning/10",
  Critical: "text-destructive border-destructive/40 bg-destructive/10",
};
const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");
const ratio = (ok: number, total: number) => (total ? Math.round((ok / total) * 100) : 100);
const arr = (v: unknown) => (Array.isArray(v) ? v : []);

export function AdminHomeHealth() {
  const [d, setD] = useState<Data | null>(null);
  useEffect(() => {
    const q = (t: string, cols: string, n = 50) => db.from(t).select(cols).order("created_at", { ascending: false }).limit(n);
    void Promise.all([
      q("vpip_build_records", "created_at,status,prompt_title,build_code"),
      q("vpip_validation_runs", "created_at,results,metrics", 20),
      q("vpip_failures", "created_at,title,status,code"),
      q("vpip_runtime_audit", "created_at,action,status,error", 100),
      q("vpip_ai2_audits", "created_at,score,findings,corrective_prompt,report", 20),
      q("vpip_ai1_reports", "created_at,files_created,files_modified,build_session_id", 10),
      q("vpip_repo_snapshots", "created_at,label", 20),
      q("vpip_knowledge", "created_at,status", 200),
      q("vpip_admin_ai_reports", "created_at,kind,title,status", 20),
      q("vpip_repair_proposals", "created_at,risk,problem,status", 50),
    ]).then((r) => {
      const k = ["builds", "val", "fails", "rt", "audits", "ai1", "snaps", "know", "reports", "repairs"];
      setD(Object.fromEntries(k.map((key, i) => [key, (r[i]?.data ?? []) as Row[]])) as Data);
    });
  }, []);
  if (!d) return <div className="text-xs text-muted-foreground">Loading health data…</div>;

  // ---- scores
  const done = d.builds.filter((b) => /succ|pass|complete|done/i.test(b.status ?? ""));
  const failedB = d.builds.filter((b) => /fail|error/i.test(b.status ?? ""));
  const buildRate = ratio(done.length, done.length + failedB.length);
  const valOk = d.val.filter((v) => { const s = JSON.stringify(v.results ?? v.metrics ?? "").toLowerCase(); return !/"fail"|"error"|blocked/.test(s); });
  const valRate = ratio(valOk.length, d.val.length);
  const openFails = d.fails.filter((f) => !/resolved|closed/i.test(f.status ?? ""));
  const rtErr = d.rt.filter((r) => r.status === "failed");
  const rtRate = ratio(d.rt.length - rtErr.length, d.rt.length);
  const lastAudit = d.audits[0];
  const findingsOf = (a?: Row) => arr(a?.findings) as Row[];
  const auditFindings = findingsOf(lastAudit).length;
  const repoScore = Math.max(0, Math.min(100, Math.round(buildRate * 0.3 + valRate * 0.25 + rtRate * 0.2 + (lastAudit?.score ?? 100) * 0.15 + 10 - openFails.length * 3 - Math.min(auditFindings, 10))));
  const snapScore = d.snaps.length ? (Date.now() - new Date(d.snaps[0].created_at).getTime() < 7 * 864e5 ? 100 : 60) : 30;
  const approved = d.know.filter((k) => /approved|active|accepted/i.test(k.status ?? "")).length;
  const knowScore = d.know.length ? ratio(approved, d.know.length) : 40;
  const parts: Array<[string, number]> = [["Repository Health", repoScore], ["Runtime Health", rtRate], ["Validation Health", valRate], ["Snapshot Health", snapScore], ["Knowledge Health", knowScore]];
  const overall: Level = parts.some(([, s]) => levelOf(s) === "Critical") ? "Critical" : parts.some(([, s]) => levelOf(s) === "Warning") ? "Warning" : "Healthy";

  // ---- risks
  const risks: Array<{ sev: string; at: string }> = [];
  for (const f of findingsOf(lastAudit)) risks.push({ sev: String(f.severity ?? f.level ?? "medium").toLowerCase(), at: lastAudit.created_at });
  for (const r of d.repairs) if (r.status !== "rejected" && r.status !== "applied") risks.push({ sev: String(r.risk ?? "medium").toLowerCase(), at: r.created_at });
  for (const f of openFails) risks.push({ sev: "high", at: f.created_at });
  for (const r of rtErr.slice(0, 20)) risks.push({ sev: "medium", at: r.created_at });
  const bucket = (s: string) => (/crit|block/.test(s) ? "Critical" : /high|major|error/.test(s) ? "High" : /low|info|minor/.test(s) ? "Low" : "Medium");
  const riskCounts = { Critical: 0, High: 0, Medium: 0, Low: 0 } as Record<string, number>;
  risks.forEach((r) => (riskCounts[bucket(r.sev)] = (riskCounts[bucket(r.sev)] ?? 0) + 1));
  const latestRisk = risks.map((r) => r.at).sort().pop();

  // ---- AI1 / AI2
  const lb = d.builds[0];
  const la1 = d.ai1[0];
  const recCount = lastAudit ? (String(lastAudit.corrective_prompt ?? "").match(/^\s*(\d+\.|[-*])\s/gm)?.length ?? (lastAudit.corrective_prompt ? 1 : 0)) : 0;

  // ---- recommendations
  const recs = [
    ...d.reports.map((r) => ({ title: r.title, source: `Admin AI · ${r.kind}`, priority: /root|recovery|risk/i.test(r.kind) ? "High" : "Medium", at: r.created_at })),
    ...d.audits.filter((a) => a.corrective_prompt?.trim()).map((a) => ({ title: String(a.corrective_prompt).split("\n").find((l: string) => l.trim())?.slice(0, 90) ?? "Corrective prompt", source: "AI2 Auditor", priority: (a.score ?? 100) < 50 ? "High" : "Medium", at: a.created_at })),
    ...d.repairs.filter((r) => r.status === "pending" || r.status === "proposed").map((r) => ({ title: String(r.problem).slice(0, 90), source: "Safe Repair", priority: bucket(String(r.risk)), at: r.created_at })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, 5);

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Repository Health Score">
          <div className="flex items-end gap-3"><div className="font-mono text-4xl font-semibold tabular-nums">{repoScore}</div><Badge level={levelOf(repoScore)} /></div>
          <Kv rows={[["Build success", `${buildRate}%`], ["Validation success", `${valRate}%`], ["Open failures", openFails.length], ["Runtime errors", rtErr.length], ["Audit findings", auditFindings]]} />
        </Card>
        <Card title="Risk Dashboard">
          <div className="grid grid-cols-4 gap-2 text-center">
            {(["Critical", "High", "Medium", "Low"] as const).map((k) => (
              <div key={k} className={cn("rounded border p-2", k === "Critical" ? tone.Critical : k === "High" ? "border-destructive/30 text-destructive/80" : k === "Medium" ? tone.Warning : "border-border text-muted-foreground")}>
                <div className="font-mono text-xl tabular-nums">{riskCounts[k]}</div><div className="text-[10px] uppercase">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Latest detected: {fmt(latestRisk)}</div>
        </Card>
        <Card title="Project Health Summary">
          <div className="mb-2"><Badge level={overall} /></div>
          <div className="space-y-1">{parts.map(([k, s]) => <div key={k} className="flex items-center justify-between text-xs"><span>{k}</span><span className={cn("rounded border px-1.5 font-mono text-[10px]", tone[levelOf(s)])}>{s}</span></div>)}</div>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Last AI1 Activity">
          <Kv rows={[["Last build", fmt(lb?.created_at ?? la1?.created_at)], ["Last prompt", lb?.prompt_title ?? "—"], ["Result", lb?.status ?? "—"], ["Files modified", la1 ? arr(la1.files_created).length + arr(la1.files_modified).length : "—"]]} />
        </Card>
        <Card title="Last AI2 Activity">
          <Kv rows={[["Last audit", fmt(lastAudit?.created_at)], ["Score", lastAudit?.score ?? "—"], ["Findings", lastAudit ? auditFindings : "—"], ["Recommendations", lastAudit ? recCount : "—"]]} />
        </Card>
        <Card title="Recommendation Summary">
          {recs.length ? <ul className="space-y-1.5">{recs.map((r, i) => <li key={i} className="text-xs"><div className="truncate font-medium">{r.title}</div><div className="text-[10px] text-muted-foreground">{r.source} · <span className={r.priority === "High" || r.priority === "Critical" ? "text-destructive" : ""}>{r.priority}</span> · {fmt(r.at)}</div></li>)}</ul> : <div className="text-xs text-muted-foreground">No recommendations recorded yet.</div>}
        </Card>
      </div>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="rounded-md border border-border bg-surface p-3"><div className="label-mono mb-2">{title}</div>{children}</div>;
}
function Badge({ level }: { level: Level }) {
  return <span className={cn("rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider", tone[level])}>{level}</span>;
}
function Kv({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <div className="mt-2 space-y-1">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{k}</span><span className="truncate text-right font-mono">{v}</span></div>)}</div>;
}
