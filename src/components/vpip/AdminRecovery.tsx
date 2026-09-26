import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { supabase } from "@/integrations/supabase/client";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { coderTrace } from "@/lib/vpip/coder";
import { createSnapshot } from "@/lib/vpip/safe-repair";
import {
  diffFiles,
  diffSummary,
  listProjectSnapshots,
  loadFiles,
  snapCode,
  TRACE_INSTRUCTION,
  updateMeta,
  type SnapDiff,
  type SnapRow,
} from "@/lib/vpip/admin-recovery";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };
type Filter = "all" | "latest" | "stable" | "failed" | "tagged";

export function AdminRecovery({ runAi, streaming }: { runAi: (instruction: string, context: string, title: string) => Promise<void>; streaming: boolean }) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const projects = ws.projects.filter((p) => !p.archived);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [snaps, setSnaps] = useState<SnapRow[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [changed, setChanged] = useState<Record<string, number>>({});
  const [reports, setReports] = useState<{ ai1: Array<{ build_session_id: string; created_at: string; report: string }>; ai2: Array<{ build_session_id: string; created_at: string; kind: string; score: number | null; report: string; corrective_prompt: string }> }>({ ai1: [], ai2: [] });
  const [cmpA, setCmpA] = useState("");
  const [cmpB, setCmpB] = useState("");
  const [diff, setDiff] = useState<SnapDiff | null>(null);
  const [open, setOpen] = useState<SnapRow | null>(null);
  const [busy, setBusy] = useState("");

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const [list, a1, a2] = await Promise.all([
        listProjectSnapshots(projectId),
        db.from("vpip_ai1_reports").select("build_session_id,created_at,report").eq("project_id", projectId).order("created_at"),
        db.from("vpip_ai2_audits").select("build_session_id,created_at,kind,score,report,corrective_prompt").eq("project_id", projectId).order("created_at"),
      ]);
      setSnaps(list);
      setReports({ ai1: a1.data ?? [], ai2: a2.data ?? [] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load snapshots.");
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const code = useMemo(() => new Map(snaps.map((s, i) => [s.id, snapCode(i)])), [snaps]);
  const builds = ws.buildSessions ?? [];

  /** The next snapshot in the same build (or the build's current files) bounds what this run changed. */
  function nextOf(s: SnapRow) {
    return snaps.find((x) => x.build_session_id === s.build_session_id && x.created_at > s.created_at);
  }
  function linked(s: SnapRow) {
    const end = nextOf(s)?.created_at ?? "9999";
    const inRange = (r: { build_session_id: string; created_at: string }) => r.build_session_id === s.build_session_id && r.created_at >= s.created_at && r.created_at < end;
    return { ai1: reports.ai1.filter(inRange), ai2: reports.ai2.filter(inRange) };
  }
  async function currentOrNext(s: SnapRow) {
    const n = nextOf(s);
    if (n) return loadFiles(n.id);
    const b = builds.find((x) => x.id === s.build_session_id);
    return (b?.files ?? []).map((f) => ({ path: f.path, content: f.content }));
  }

  async function countChanged(s: SnapRow) {
    const d = diffFiles(await loadFiles(s.id), await currentOrNext(s));
    setChanged((c) => ({ ...c, [s.id]: d.added.length + d.deleted.length + d.modified.length }));
  }

  async function patch(s: SnapRow, p: Parameters<typeof updateMeta>[1]) {
    const metadata = await updateMeta(s, p);
    setSnaps((all) => all.map((x) => (x.id === s.id ? { ...x, metadata } : x)));
    setOpen((o) => (o?.id === s.id ? { ...o, metadata } : o));
  }

  async function restore(s: SnapRow) {
    const build = builds.find((b) => b.id === s.build_session_id);
    if (!build) return toast.error("The build this snapshot belongs to no longer exists.");
    if (!window.confirm(`Restore ${code.get(s.id)} "${s.label}" into build ${build.code}?\n\nFiles are copied back exactly as stored. The current files are snapshotted first so this can be undone.`)) return;
    setBusy("Restoring…");
    try {
      const cur = (build.files ?? []).map((f) => ({ path: f.path, content: f.content }));
      await createSnapshot({ projectId, buildSessionId: build.id, repositoryId: build.repositoryId ?? undefined, label: `Before restoring ${code.get(s.id)}`, isZero: false, files: cur, metadata: { kind: "pre-restore", restoredFrom: s.id } });
      const target = await loadFiles(s.id);
      const want = new Map(target.map((f) => [f.path, f.content]));
      const trace = coderTrace(build, [], []);
      let n = 0;
      for (const f of build.files ?? []) if (!want.has(f.path)) { actions.deleteCoderPath(build.id, f.path); n++; }
      for (const [path, content] of want) {
        if (build.files?.find((f) => f.path === path)?.content !== content) { actions.writeCoderFile(build.id, path, content, { note: `Admin AI restore ${code.get(s.id)}`, trace }); n++; }
      }
      toast.success(`Restored ${code.get(s.id)}: ${n} files changed`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    } finally {
      setBusy("");
    }
  }

  async function compare() {
    if (!cmpA || !cmpB) return;
    setBusy("Comparing…");
    try {
      setDiff(diffFiles(await loadFiles(cmpA), await loadFiles(cmpB)));
    } finally {
      setBusy("");
    }
  }

  async function trace() {
    setBusy("Collecting evidence…");
    try {
      const recent = snaps.slice(-12);
      const lines: string[] = ["## Snapshots (oldest first)"];
      for (const s of recent) {
        const d = diffFiles(await loadFiles(s.id), await currentOrNext(s));
        lines.push(`### ${code.get(s.id)} · ${s.created_at} · ${s.metadata.stable ? `STABLE ${s.metadata.stable}` : ""}${s.metadata.failed ? " FAILED" : ""}\nPrompt: ${s.metadata.prompt ?? s.label}\nModel: ${s.metadata.model ?? "—"} · commit ${s.metadata.commitSha ?? "—"}\nChange after this snapshot: ${diffSummary(d)}\nFiles: ${[...d.added.map((p) => `+${p}`), ...d.deleted.map((p) => `-${p}`), ...d.modified.map((p) => `~${p}`)].slice(0, 40).join(", ")}\nDeps: ${d.deps.join("; ") || "none"}\nRoutes: ${d.routes.join("; ") || "none"}`);
        const l = linked(s);
        for (const r of l.ai1) lines.push(`AI 1 report:\n${r.report.slice(0, 1500)}`);
        for (const a of l.ai2) lines.push(`AI 2 audit (${a.kind}, score ${a.score ?? "—"}):\n${a.report.slice(0, 1500)}`);
      }
      const buildLogs = builds.filter((b) => b.projectId === projectId).flatMap((b) => (b.terminal ?? []).slice(-15).filter((t) => t.stream === "error" || t.stream === "build").map((t) => `[${b.code}] ${t.output.slice(0, 300)}`));
      lines.push(`## Build / preview error logs\n${buildLogs.join("\n") || "none"}`);
      setBusy("");
      await runAi(TRACE_INSTRUCTION, lines.join("\n\n"), "Failure Trace & Recovery Recommendation");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Trace failed.");
    } finally {
      setBusy("");
    }
  }

  const latestId = snaps.at(-1)?.id;
  const shown = [...snaps].reverse().filter((s) =>
    filter === "all" ? true : filter === "latest" ? s.id === latestId || snaps.indexOf(s) >= snaps.length - 10 : filter === "stable" ? !!s.metadata.stable : filter === "failed" ? !!s.metadata.failed : (s.metadata.tags ?? []).length > 0,
  );
  const stable = snaps.filter((s) => s.metadata.stable);
  const status = (s: SnapRow) => (s.metadata.failed ? "Failed" : s.metadata.stable ? `Stable ${s.metadata.stable}` : s.id === latestId ? "Latest" : s.is_zero ? "Rollback Point Zero" : "Snapshot");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="label-mono">Project</span>
        <select className="rounded border border-border bg-background px-2 py-1" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Tag>{snaps.length} snapshots</Tag>
        <Tag>{stable.length} stable releases</Tag>
        <Button size="sm" variant="outline" onClick={() => void refresh()}>Refresh</Button>
        <Button size="sm" variant="outline" disabled={streaming || !!busy || !snaps.length} onClick={() => void trace()}>Trace failures & recommend recovery</Button>
        {busy ? <span className="text-muted-foreground">{busy}</span> : null}
      </div>
      <div className="label-mono">A snapshot is taken automatically before every AI 1 coding run. Nothing is ever restored automatically — Restore always asks you first.</div>

      {stable.length ? (
        <div className="rounded-md border border-border bg-surface p-3">
          <div className="mb-2 text-sm font-semibold">Stable releases</div>
          <div className="flex flex-wrap gap-2">
            {stable.map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
                <b>{s.metadata.stable}</b> · {code.get(s.id)} · {new Date(s.created_at).toLocaleDateString()}
                <Button size="sm" variant="outline" onClick={() => void restore(s)}>Restore</Button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <div className="rounded-md border border-border bg-surface">
          <div className="flex items-center gap-1 border-b border-border p-2 text-xs">
            <span className="text-sm font-semibold mr-2">Snapshot History</span>
            {(["all", "latest", "stable", "failed", "tagged"] as Filter[]).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`rounded px-2 py-0.5 capitalize ${filter === f ? "bg-muted text-foreground" : "text-muted-foreground"}`}>{f === "tagged" ? "User tagged" : f}</button>
            ))}
          </div>
          <div className="max-h-[560px] overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground"><tr><th className="p-2">ID</th><th>Date</th><th>Prompt</th><th>Model</th><th>Files changed</th><th>Status</th></tr></thead>
              <tbody>
                {shown.map((s) => (
                  <tr key={s.id} onClick={() => { setOpen(s); if (changed[s.id] === undefined) void countChanged(s); }} className={`cursor-pointer border-t border-border hover:bg-muted ${open?.id === s.id ? "bg-muted" : ""}`}>
                    <td className="p-2 font-mono">{code.get(s.id)}</td>
                    <td>{new Date(s.created_at).toLocaleString()}</td>
                    <td className="max-w-[260px] truncate">{s.metadata.prompt ?? s.label}</td>
                    <td className="truncate">{s.metadata.model ?? "—"}</td>
                    <td>{changed[s.id] ?? "…"}</td>
                    <td>{status(s)}{(s.metadata.tags ?? []).map((t) => <Tag key={t} className="ml-1">{t}</Tag>)}</td>
                  </tr>
                ))}
                {!shown.length ? <tr><td colSpan={6} className="p-4 text-muted-foreground">No snapshots here yet.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {open ? (
            <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-xs">
              <div className="text-sm font-semibold">{code.get(open.id)} · {status(open)}</div>
              <div><b>Prompt:</b> {open.metadata.prompt ?? open.label}</div>
              <div><b>Model:</b> {open.metadata.model ?? "—"} · <b>Commit:</b> {open.metadata.commitSha ?? "—"} · <b>Files stored:</b> {open.tree.length}</div>
              <div className="flex flex-wrap gap-1 pt-1">
                <Button size="sm" onClick={() => void restore(open)}>Restore snapshot</Button>
                <Button size="sm" variant="outline" onClick={() => { const v = window.prompt("Stable release version (e.g. 1.0)", open.metadata.stable ?? ""); if (v !== null) void patch(open, { stable: v.trim() ? `Stable Release ${v.trim().replace(/^Stable Release\s*/i, "")}` : null }); }}>{open.metadata.stable ? "Edit stable" : "Mark as stable"}</Button>
                <Button size="sm" variant="outline" onClick={() => void patch(open, { failed: !open.metadata.failed })}>{open.metadata.failed ? "Clear failed" : "Mark failed"}</Button>
                <Button size="sm" variant="outline" onClick={() => { const t = window.prompt("Tag"); if (t?.trim()) void patch(open, { tags: [...new Set([...(open.metadata.tags ?? []), t.trim()])] }); }}>Add tag</Button>
                {(open.metadata.tags ?? []).length ? <Button size="sm" variant="ghost" onClick={() => void patch(open, { tags: [] })}>Clear tags</Button> : null}
              </div>
              {(() => {
                const l = linked(open);
                return (
                  <div className="space-y-1 pt-2">
                    <div className="font-semibold">Linked reports</div>
                    {l.ai1.map((r, i) => <details key={`a${i}`}><summary className="cursor-pointer">AI 1 completion report · {new Date(r.created_at).toLocaleString()}</summary><Markdown source={r.report} /></details>)}
                    {l.ai2.map((r, i) => <details key={`b${i}`}><summary className="cursor-pointer">AI 2 {r.kind} · score {r.score ?? "—"}</summary><Markdown source={r.report} />{r.corrective_prompt ? <><div className="font-semibold mt-2">Corrective prompt</div><Markdown source={r.corrective_prompt} /></> : null}</details>)}
                    {!l.ai1.length && !l.ai2.length ? <div className="text-muted-foreground">No AI 1 / AI 2 reports for this run.</div> : null}
                  </div>
                );
              })()}
            </div>
          ) : null}

          <div className="space-y-2 rounded-md border border-border bg-surface p-3 text-xs">
            <div className="text-sm font-semibold">Compare snapshots</div>
            {[["A", cmpA, setCmpA], ["B", cmpB, setCmpB]].map(([k, v, set]) => (
              <select key={k as string} className="w-full rounded border border-border bg-background px-2 py-1" value={v as string} onChange={(e) => (set as (x: string) => void)(e.target.value)}>
                <option value="">Snapshot {k as string}…</option>
                {snaps.map((s) => <option key={s.id} value={s.id}>{code.get(s.id)} · {(s.metadata.prompt ?? s.label).slice(0, 50)}</option>)}
              </select>
            ))}
            <Button size="sm" variant="outline" disabled={!cmpA || !cmpB} onClick={() => void compare()}>Compare</Button>
            {diff ? (
              <div className="space-y-1">
                <div className="font-semibold">{diffSummary(diff)}</div>
                {([["Files added", diff.added], ["Files deleted", diff.deleted], ["Files modified", diff.modified], ["Dependency changes", diff.deps], ["Route changes", diff.routes]] as const).map(([t, xs]) => (
                  <details key={t}><summary className="cursor-pointer">{t} ({xs.length})</summary><pre className="max-h-40 overflow-auto whitespace-pre-wrap">{xs.join("\n") || "None"}</pre></details>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
