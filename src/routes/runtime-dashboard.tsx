import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Pause, RotateCcw, Square, Trash2, RefreshCw } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeNav } from "@/components/vpip/RuntimeEventsView";
import { Button } from "@/components/ui/button";
import { useVpip } from "@/lib/vpip/store";
import {
  runtimeDashboard,
  runtimeStop,
  runtimePause,
  runtimeResume,
  runtimeDestroy,
} from "@/lib/vpip/runtime/runtime.functions";
import { COST_PER_HOUR_USD, PHASE_LABEL, type RuntimePhase } from "@/lib/vpip/runtime/detect";

export const Route = createFileRoute("/runtime-dashboard")({
  head: () => ({
    meta: [
      { title: "Runtime Dashboard · VPIP" },
      { name: "description", content: "All VPIP Coder runtime sandboxes with status, runtime hours, idle time and estimated cost." },
      { property: "og:title", content: "Runtime Dashboard · VPIP" },
      { property: "og:description", content: "All VPIP Coder runtime sandboxes with status, hours, idle time and cost." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RuntimeDashboardPage,
});

type Row = Awaited<ReturnType<typeof runtimeDashboard>>["rows"][number];

function hours(r: Row) {
  const live = r.running_since ? (Date.now() - new Date(r.running_since).getTime()) / 1000 : 0;
  return (Number(r.runtime_seconds) + live) / 3600;
}
function idle(r: Row) {
  if (r.status === "destroyed") return "—";
  const m = Math.floor((Date.now() - new Date(r.last_active_at).getTime()) / 60000);
  return m < 60 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

function RuntimeDashboardPage() {
  const { ws } = useVpip();
  const load = useServerFn(runtimeDashboard);
  const stop = useServerFn(runtimeStop);
  const pause = useServerFn(runtimePause);
  const resume = useServerFn(runtimeResume);
  const destroy = useServerFn(runtimeDestroy);
  const [rows, setRows] = useState<Row[]>([]);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await load();
      setRows(r.rows);
      setConfigured(r.configured);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [load]);
  useEffect(() => {
    void refresh();
    const id = setInterval(refresh, 30000);
    return () => clearInterval(id);
  }, [refresh]);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
      void refresh();
    }
  };

  const active = rows.filter((r) => r.status !== "destroyed");
  const totalH = rows.reduce((a, r) => a + hours(r), 0);
  const projectName = (id: string) => ws.projects.find((p: { id: string; name: string }) => p.id === id)?.name ?? id;

  return (
    <Shell title="Runtime Dashboard">
      <div className="mx-auto max-w-6xl space-y-4 p-6">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Runtime Dashboard</h1>
            <p className="text-sm text-muted-foreground">Real sandboxes for VPIP Coder. Idle sandboxes pause after 10 minutes and are destroyed after 24 hours.</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void refresh()}><RefreshCw className="size-3.5" /> Refresh</Button>
        </div>
        <RuntimeNav />
        {configured === false ? <div className="rounded border border-border bg-surface-2 p-3 text-sm">Provider Not Configured — E2B key missing or provider disconnected (Runtime Settings). Sandboxes cannot be created yet.</div> : null}
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <div className="grid grid-cols-4 gap-3">
          {[
            ["Active sandboxes", String(active.length)],
            ["Total instances", String(rows.length)],
            ["Runtime hours", totalH.toFixed(2)],
            ["Estimated cost", `$${(totalH * COST_PER_HOUR_USD).toFixed(2)}`],
          ].map(([k, v]) => (
            <div key={k} className="rounded border border-border p-3">
              <div className="label-mono">{k}</div>
              <div className="text-xl font-semibold">{v}</div>
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded border border-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-2 text-left text-xs text-muted-foreground">
              <tr>{["Project / build", "Status", "Step", "Hours", "Cost", "Idle", "Actions"].map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">No runtime instances yet. Launch one from VPIP Coder → Runtime Preview.</td></tr>
              ) : rows.map((r) => {
                const h = hours(r);
                return (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <Link to="/projects/$projectId/coder/$buildId" params={{ projectId: r.project_id, buildId: r.build_id }} className="hover:underline">{projectName(r.project_id)}</Link>
                      <div className="font-mono text-[10px] text-muted-foreground">{r.e2b_sandbox_id ?? r.id}</div>
                    </td>
                    <td className="px-3 py-2">{r.status}</td>
                    <td className="px-3 py-2">{PHASE_LABEL[r.phase as RuntimePhase] ?? r.phase}</td>
                    <td className="px-3 py-2">{h.toFixed(2)}</td>
                    <td className="px-3 py-2">${(h * COST_PER_HOUR_USD).toFixed(3)}</td>
                    <td className="px-3 py-2">{idle(r)}</td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline" className="h-7" title="Stop" disabled={!!busy || r.status !== "running"} onClick={() => act(r.id, () => stop({ data: { rowId: r.id } }))}><Square className="size-3.5" /></Button>
                        <Button size="sm" variant="outline" className="h-7" title="Pause" disabled={!!busy || r.status !== "running"} onClick={() => act(r.id, () => pause({ data: { rowId: r.id } }))}><Pause className="size-3.5" /></Button>
                        <Button size="sm" variant="outline" className="h-7" title="Resume" disabled={!!busy || r.status !== "paused"} onClick={() => act(r.id, () => resume({ data: { rowId: r.id } }))}><RotateCcw className="size-3.5" /></Button>
                        <Button size="sm" variant="outline" className="h-7" title="Destroy" disabled={!!busy || r.status === "destroyed"} onClick={() => act(r.id, () => destroy({ data: { rowId: r.id } }))}><Trash2 className="size-3.5" /></Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
}
