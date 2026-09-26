/**
 * Admin AI Home — read-only health widgets. Reads existing audit, runtime,
 * AI1, AI2, validation, snapshot and knowledge stores. Never writes.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Loader2, MoreVertical, RefreshCw, Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
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
  const [loading, setLoading] = useState(false);
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const load = useCallback(async (notify = false) => {
    setLoading(true);
    try {
      const q = (t: string, cols: string, n = 50) => db.from(t).select(cols).order("created_at", { ascending: false }).limit(n);
      const r = await Promise.all([
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
      ]);
      const k = ["builds", "val", "fails", "rt", "audits", "ai1", "snaps", "know", "reports", "repairs"];
      const err = r.find((x: Row) => x?.error)?.error;
      setD(Object.fromEntries(k.map((key, i) => [key, (r[i]?.data ?? []) as Row[]])) as Data);
      setRefreshedAt(new Date().toISOString());
      if (notify) { if (err) toast.error(`Reloaded with errors: ${err.message ?? "query failed"}`); else toast.success("Health data reloaded"); }
    } catch (e) {
      if (notify) toast.error(`Reload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (!d) return <div role="status" aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" aria-hidden />Loading health data…</div>;

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

  const copy = (text: string) => { void navigator.clipboard.writeText(text).then(() => toast.success("Summary copied"), () => toast.error("Copy failed")); };
  const refresh = () => void load(true);
  const cardProps = (id: string, summary: string) => ({ onOpen: () => setOpen(id), onRefresh: refresh, onCopy: () => copy(summary), loading });
  const Empty = ({ text }: { text: string }) => <div role="status" className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">{text}</div>;
  const riskSummary = `Risks — Critical ${riskCounts.Critical}, High ${riskCounts.High}, Medium ${riskCounts.Medium}, Low ${riskCounts.Low}`;
  const details: Record<string, { title: string; desc: string; body: ReactNode }> = {
    repo: { title: "Repository Health Score", desc: `Score ${repoScore} (${levelOf(repoScore)})`, body: <Kv rows={[["Build success", `${buildRate}%`], ["Validation success", `${valRate}%`], ["Open failures", openFails.length], ["Runtime errors", rtErr.length], ["Audit findings", auditFindings]]} /> },
    risk: { title: "Risk list", desc: riskSummary, body: risks.length ? <ul className="max-h-[60vh] space-y-1 overflow-auto">{[...risks].sort((a, b) => (a.at < b.at ? 1 : -1)).map((r, i) => <li key={i} className="flex justify-between gap-2 rounded border border-border px-2 py-1 text-xs"><span>{bucket(r.sev)} <span className="text-muted-foreground">({r.sev})</span></span><span className="font-mono text-muted-foreground">{fmt(r.at)}</span></li>)}</ul> : <Empty text="No risks detected." /> },
    summary: { title: "Project Health Summary", desc: `Overall: ${overall}`, body: <div className="space-y-1">{parts.map(([k, s]) => <div key={k} className="flex justify-between text-xs"><span>{k}</span><span className={cn("rounded border px-1.5 font-mono text-[10px]", tone[levelOf(s)])}>{s} · {levelOf(s)}</span></div>)}</div> },
    ai1: { title: "AI1 activity details", desc: "Latest builds and completion reports", body: d.builds.length || d.ai1.length ? <div className="max-h-[60vh] space-y-3 overflow-auto"><ul className="space-y-1">{d.builds.slice(0, 15).map((b, i) => <li key={i} className="rounded border border-border px-2 py-1 text-xs"><div className="font-medium">{b.prompt_title ?? b.build_code ?? "Build"}</div><div className="text-[10px] text-muted-foreground">{b.status ?? "—"} · {fmt(b.created_at)}</div></li>)}</ul><ul className="space-y-1">{d.ai1.map((a, i) => <li key={i} className="text-xs text-muted-foreground">Report {fmt(a.created_at)} · {arr(a.files_created).length + arr(a.files_modified).length} files</li>)}</ul></div> : <Empty text="No AI1 activity yet." /> },
    ai2: { title: "AI2 audit details", desc: "Latest audit findings and corrective prompt", body: lastAudit ? <div className="max-h-[60vh] space-y-2 overflow-auto text-xs"><Kv rows={[["Audit", fmt(lastAudit.created_at)], ["Score", lastAudit.score ?? "—"], ["Findings", auditFindings], ["Recommendations", recCount]]} />{findingsOf(lastAudit).length ? <ul className="space-y-1">{findingsOf(lastAudit).map((f, i) => <li key={i} className="rounded border border-border px-2 py-1"><span className="font-mono text-[10px] uppercase">{String(f.severity ?? f.level ?? "medium")}</span> {String(f.title ?? f.message ?? f.description ?? JSON.stringify(f))}</li>)}</ul> : <Empty text="No findings in latest audit." />}{lastAudit.corrective_prompt ? <pre className="whitespace-pre-wrap rounded bg-surface-2 p-2 text-[11px]">{lastAudit.corrective_prompt}</pre> : null}</div> : <Empty text="No AI2 activity yet." /> },
    recs: { title: "Recommendation details", desc: `${recs.length} most recent recommendations`, body: recs.length ? <ul className="space-y-1.5">{recs.map((r, i) => <li key={i} className="rounded border border-border px-2 py-1 text-xs"><div className="font-medium">{r.title}</div><div className="text-[10px] text-muted-foreground">{r.source} · {r.priority} · {fmt(r.at)}</div></li>)}</ul> : <Empty text="No recommendations recorded yet." /> },
  };
  const cur = open ? details[open] : null;

  return (
    <TooltipProvider delayDuration={300}>
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-2 text-[11px] text-muted-foreground" aria-live="polite">
        {loading ? <span role="status" className="flex items-center gap-1"><Loader2 className="size-3 animate-spin" aria-hidden />Refreshing…</span> : null}
        <span>Last refresh: {fmt(refreshedAt ?? undefined)}</span>
        <Tip label="Reload all health data"><button type="button" onClick={refresh} disabled={loading} aria-label="Reload health data" className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><RefreshCw className={cn("size-3", loading && "animate-spin")} aria-hidden />Reload</button></Tip>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Repository Health Score" {...cardProps("repo", `Repository Health ${repoScore} (${levelOf(repoScore)}); build ${buildRate}%, validation ${valRate}%, open failures ${openFails.length}, runtime errors ${rtErr.length}, audit findings ${auditFindings}`)}>
          <div className="flex items-end gap-3"><div className="font-mono text-4xl font-semibold tabular-nums">{repoScore}</div><Badge level={levelOf(repoScore)} /></div>
          <Kv rows={[["Build success", `${buildRate}%`], ["Validation success", `${valRate}%`], ["Open failures", openFails.length], ["Runtime errors", rtErr.length], ["Audit findings", auditFindings]]} />
        </Card>
        <Card title="Risk Dashboard" {...cardProps("risk", riskSummary)}>
          {risks.length ? <>
          <div className="grid grid-cols-4 gap-2 text-center">
            {(["Critical", "High", "Medium", "Low"] as const).map((k) => (
              <div key={k} className={cn("rounded border p-2", k === "Critical" ? tone.Critical : k === "High" ? "border-destructive/30 text-destructive/80" : k === "Medium" ? tone.Warning : "border-border text-muted-foreground")}>
                <div className="font-mono text-xl tabular-nums">{riskCounts[k]}</div><div className="text-[10px] uppercase">{k}</div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[11px] text-muted-foreground">Latest detected: {fmt(latestRisk)}</div></> : <Empty text="No risks detected." />}
        </Card>
        <Card title="Project Health Summary" {...cardProps("summary", `Project health ${overall}: ${parts.map(([k, s]) => `${k} ${s}`).join(", ")}`)}>
          <div className="mb-2"><Badge level={overall} /></div>
          <div className="space-y-1">{parts.map(([k, s]) => <div key={k} className="flex items-center justify-between text-xs"><span>{k}</span><span className={cn("rounded border px-1.5 font-mono text-[10px]", tone[levelOf(s)])}>{s}</span></div>)}</div>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <Card title="Last AI1 Activity" {...cardProps("ai1", `Last AI1: ${fmt(lb?.created_at ?? la1?.created_at)}, prompt ${lb?.prompt_title ?? "—"}, result ${lb?.status ?? "—"}`)}>
          {lb || la1 ? <Kv rows={[["Last build", fmt(lb?.created_at ?? la1?.created_at)], ["Last prompt", lb?.prompt_title ?? "—"], ["Result", lb?.status ?? "—"], ["Files modified", la1 ? arr(la1.files_created).length + arr(la1.files_modified).length : "—"]]} /> : <Empty text="No AI1 activity yet." />}
        </Card>
        <Card title="Last AI2 Activity" {...cardProps("ai2", `Last AI2 audit: ${fmt(lastAudit?.created_at)}, score ${lastAudit?.score ?? "—"}, findings ${lastAudit ? auditFindings : "—"}`)}>
          {lastAudit ? <Kv rows={[["Last audit", fmt(lastAudit?.created_at)], ["Score", lastAudit?.score ?? "—"], ["Findings", lastAudit ? auditFindings : "—"], ["Recommendations", lastAudit ? recCount : "—"]]} /> : <Empty text="No AI2 activity yet." />}
        </Card>
        <Card title="Recommendation Summary" {...cardProps("recs", recs.map((r) => `- ${r.title} (${r.source}, ${r.priority})`).join("\n") || "No recommendations")}>
          {recs.length ? <ul className="space-y-1.5">{recs.map((r, i) => <li key={i} className="text-xs"><div className="truncate font-medium">{r.title}</div><div className="text-[10px] text-muted-foreground">{r.source} · <span className={r.priority === "High" || r.priority === "Critical" ? "text-destructive" : ""}>{r.priority}</span> · {fmt(r.at)}</div></li>)}</ul> : <Empty text="No recommendations recorded yet." />}
        </Card>
      </div>
      <Dialog open={!!cur} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-2xl">
          {cur ? <><DialogHeader><DialogTitle>{cur.title}</DialogTitle><DialogDescription>{cur.desc}</DialogDescription></DialogHeader>{cur.body}</> : null}
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  );
}

function Tip({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip><TooltipTrigger asChild>{children}</TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

function Card({ title, children, onOpen, onRefresh, onCopy, loading }: { title: string; children: ReactNode; onOpen: () => void; onRefresh: () => void; onCopy: () => void; loading: boolean }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <section
      role="button" tabIndex={0} aria-label={`${title} — open details`}
      onClick={onOpen}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpen(); } }}
      className="cursor-pointer rounded-md border border-border bg-surface p-3 transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="label-mono">{title}</div>
        <div className="flex items-center gap-1" onClick={stop} onKeyDown={stop}>
          <Tip label="View details"><button type="button" onClick={onOpen} aria-label={`View details for ${title}`} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Maximize2 className="size-3" aria-hidden />View Details</button></Tip>
          <DropdownMenu>
            <Tip label="Card actions"><DropdownMenuTrigger asChild><button type="button" aria-label={`Actions for ${title}`} className="rounded p-1 text-muted-foreground hover:bg-surface-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><MoreVertical className="size-3.5" aria-hidden /></button></DropdownMenuTrigger></Tip>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled={loading} onSelect={onRefresh}>Refresh card</DropdownMenuItem>
              <DropdownMenuItem onSelect={onOpen}>View details</DropdownMenuItem>
              <DropdownMenuItem onSelect={onCopy}>Copy summary</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {children}
    </section>
  );
}
function Badge({ level }: { level: Level }) {
  return <span className={cn("rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider", tone[level])}>{level}</span>;
}
function Kv({ rows }: { rows: Array<[string, React.ReactNode]> }) {
  return <div className="mt-2 space-y-1">{rows.map(([k, v]) => <div key={k} className="flex justify-between gap-2 text-xs"><span className="text-muted-foreground">{k}</span><span className="truncate text-right font-mono">{v}</span></div>)}</div>;
}
