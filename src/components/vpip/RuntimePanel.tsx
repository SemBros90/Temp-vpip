import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Play, Square, Pause, RotateCcw, Trash2, RefreshCw, ExternalLink, AlertTriangle, History } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  runtimeInfo,
  runtimeLaunch,
  runtimeStop,
  runtimePause,
  runtimeResume,
  runtimeStart,
  runtimeDestroy,
  runtimeStatusFn,
  runtimeHeartbeat,
  runtimePreviewAccess,
} from "@/lib/vpip/runtime/runtime.functions";
import { PHASE_LABEL, type RuntimePhase } from "@/lib/vpip/runtime/detect";

type Info = Awaited<ReturnType<typeof runtimeInfo>>;
type Row = NonNullable<Info["row"]>;
type Logs = { install: string; dev: string; run: string };
type Health = { sandboxAlive: boolean; processAlive: boolean; previewReachable: boolean; localHttpCode: number; previewHttpCode: number; devServerUrl: string | null; previewUrl: string | null };

const STEPS: RuntimePhase[] = ["sandbox_created", "synced", "installing", "installed", "starting", "running", "preview_ready"];
const STEP_ORDER: Record<string, number> = {
  creating: 0, sandbox_created: 0, syncing: 1, synced: 1, sync_failed: 1, preparing_node: 2,
  installing: 2, installed: 3, install_failed: 2, starting: 4, running: 5, runtime_failed: 4, preview_ready: 6,
};

export function RuntimePanel({ projectId, buildId }: { projectId: string; buildId: string }) {
  const info = useServerFn(runtimeInfo);
  const launch = useServerFn(runtimeLaunch);
  const stop = useServerFn(runtimeStop);
  const pause = useServerFn(runtimePause);
  const resume = useServerFn(runtimeResume);
  const start = useServerFn(runtimeStart);
  const destroy = useServerFn(runtimeDestroy);
  const status = useServerFn(runtimeStatusFn);
  const beat = useServerFn(runtimeHeartbeat);
  const access = useServerFn(runtimePreviewAccess);

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [row, setRow] = useState<Row | null>(null);
  const [logs, setLogs] = useState<Logs>({ install: "", dev: "", run: "" });
  const [health, setHealth] = useState<Health | null>(null);
  const [logTab, setLogTab] = useState<keyof Logs>("run");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const rowRef = useRef<Row | null>(null);
  rowRef.current = row;

  const refreshInfo = useCallback(async () => {
    try {
      const r = await info({ data: { projectId, buildId } });
      setConfigured(r.configured);
      setRow(r.row);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [info, projectId, buildId]);

  useEffect(() => {
    void refreshInfo();
  }, [refreshInfo]);

  // Poll status/logs while a sandbox is alive.
  useEffect(() => {
    if (!row || row.status === "destroyed") return;
    let stopped = false;
    const tick = async () => {
      const cur = rowRef.current;
      if (!cur || stopped) return;
      try {
        const s = await status({ data: { rowId: cur.id } });
        if (stopped) return;
        setRow(s.row as Row);
        setLogs(s.logs);
        setHealth(s.health);
      } catch (e) {
        if (!stopped) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void tick();
    const id = setInterval(tick, row.status === "running" ? 4000 : 15000);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [row?.id, row?.status, status]);

  // Heartbeat keeps an actively viewed sandbox from idling out.
  useEffect(() => {
    if (!row || row.status !== "running") return;
    const id = setInterval(() => void beat({ data: { rowId: row.id } }).catch(() => undefined), 60000);
    return () => clearInterval(id);
  }, [row?.id, row?.status, beat]);

  // Issue preview access once the dev server is ready.
  useEffect(() => {
    if (!row || row.phase !== "preview_ready" || row.status !== "running") {
      setPreviewPath(null);
      return;
    }
    if (previewPath) return;
    access({ data: { rowId: row.id } })
      .then((r) => { setPreviewPath(r.path); setFrameKey((k) => k + 1); })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [row?.id, row?.phase, row?.status, previewPath, access]);

  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setError(null);
    try {
      await fn();
      if (name === "Destroy") setPreviewPath(null);
      await refreshInfo();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const phase = (row?.phase ?? "none") as RuntimePhase;
  const idx = STEP_ORDER[phase] ?? -1;
  const failed = phase.endsWith("failed");
  const env = (row?.env_report ?? {}) as { missing?: string[]; invalid?: string[]; warnings?: string[] };
  const syncStats = (row?.sync_stats ?? {}) as { total?: number; uploaded?: number; verified?: number };
  const syncErrors = (Array.isArray(row?.sync_errors) ? row?.sync_errors : []) as Array<{ path?: string; error?: string } | string>;
  const alive = row && row.status !== "destroyed";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Badge variant={failed ? "destructive" : "secondary"} className="text-[10px]">
          {row ? `${row.status} · ${PHASE_LABEL[phase] ?? phase}` : "No sandbox"}
        </Badge>
        <div className="ml-auto flex flex-wrap gap-1">
          <Button size="sm" className="h-7" disabled={!!busy || !configured || (!!alive && row?.status !== "stopped")}
            onClick={() => act("Launch", () => launch({ data: { buildId } }))}>
            <Play className="size-3.5" /> {busy === "Launch" ? "Launching…" : "Launch"}
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={!!busy || row?.status !== "running"}
            onClick={() => act("Stop", () => stop({ data: { rowId: row!.id } }))}>
            <Square className="size-3.5" /> Stop
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={!!busy || row?.status !== "running"}
            onClick={() => act("Pause", () => pause({ data: { rowId: row!.id } }))}>
            <Pause className="size-3.5" /> Pause
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={!!busy || row?.status !== "paused"}
            onClick={() => act("Resume", () => { setPreviewPath(null); setFrameKey((k) => k + 1); return resume({ data: { rowId: row!.id } }); })}>
            <RotateCcw className="size-3.5" /> Resume
          </Button>
          <Button size="sm" variant="outline" className="h-7" title="Restart the app's server in this sandbox"
            disabled={!!busy || row?.status !== "running" || !["stopped", "runtime_failed", "installed"].includes(row?.phase ?? "")}
            onClick={() => act("Restart", () => { setPreviewPath(null); return start({ data: { rowId: row!.id } }); })}>
            <Play className="size-3.5" /> {busy === "Restart" ? "Restarting…" : "Restart app"}
          </Button>
          <Button size="sm" variant="outline" className="h-7" disabled={!!busy || !alive}
            onClick={() => act("Destroy", () => destroy({ data: { rowId: row!.id } }))}>
            <Trash2 className="size-3.5" /> Destroy
          </Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => void refreshInfo()} title="Refresh status">
            <RefreshCw className="size-3.5" />
          </Button>
          <Link to="/runtime-history" search={{ projectId, buildId }} className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs hover:bg-surface-2" title="Runtime History">
            <History className="size-3.5" /> History
          </Link>
        </div>
      </div>

      {configured === false ? (
        <div className="border-b border-border bg-surface-2 px-3 py-2 text-xs">
          <AlertTriangle className="mr-1 inline size-3.5 text-destructive" />
          Runtime not configured: add the E2B API key to enable real sandboxes. The browser preview remains available.
        </div>
      ) : null}
      {error ? <div className="border-b border-border px-3 py-2 text-xs text-destructive">{error}</div> : null}

      <div className="grid grid-cols-7 gap-1 border-b border-border px-2 py-2">
        {STEPS.map((s, i) => (
          <div key={s} className={`rounded px-1 py-1 text-center text-[10px] ${
            failed && i === idx ? "bg-destructive/15 text-destructive" : i <= idx ? "bg-primary/15 text-foreground" : "bg-surface-2 text-muted-foreground"}`}>
            {PHASE_LABEL[s]}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2 border-b border-border px-3 py-2 text-[11px]">
        <div>
          <div className="label-mono">Sync</div>
          <div>{row?.sync_status ?? "—"}{syncStats.total != null ? ` · ${syncStats.verified ?? 0}/${syncStats.total} verified` : ""}</div>
          <div className="text-muted-foreground">{row?.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : "never"}</div>
          {syncErrors.slice(0, 3).map((e, i) => (
            <div key={i} className="text-destructive">{typeof e === "string" ? e : `${e.path ?? ""} ${e.error ?? ""}`}</div>
          ))}
        </div>
        <div>
          <div className="label-mono">Runtime</div>
          <div>{row?.package_manager ?? "—"} · Node {row?.node_version ?? "—"}</div>
          <div className="truncate text-muted-foreground" title={row?.dev_command ?? ""}>{row?.dev_command ?? ""}</div>
        </div>
        <div>
          <div className="label-mono">Environment</div>
          {!row ? "—" : !(env.missing?.length || env.invalid?.length || env.warnings?.length) ? "No warnings" : null}
          {env.missing?.length ? <div className="text-destructive">Missing: {env.missing.join(", ")}</div> : null}
          {env.invalid?.length ? <div className="text-destructive">Invalid: {env.invalid.join(", ")}</div> : null}
          {env.warnings?.map((w) => <div key={w} className="text-muted-foreground">{w}</div>)}
        </div>
      </div>
      {row ? (
        <div className="grid grid-cols-3 gap-2 border-b border-border px-3 py-2 text-[11px]">
          <div><span className="label-mono">Sandbox</span><div>{health?.sandboxAlive ? "Alive" : "Unavailable"}</div></div>
          <div><span className="label-mono">Process</span><div>{health?.processAlive ? `Alive · HTTP ${health.localHttpCode || "—"}` : "Not running"}</div></div>
          <div><span className="label-mono">Preview</span><div>{health?.previewReachable ? `Reachable · HTTP ${health.previewHttpCode}` : "Not reachable"}</div></div>
        </div>
      ) : null}
      {row?.last_error ? <div className="border-b border-border px-3 py-1.5 text-[11px] text-destructive">{row.last_error}</div> : null}

      <div className="relative min-h-0 flex-1 bg-background">
        {previewPath ? (
          <>
            <iframe key={frameKey} title="Runtime preview" src={previewPath} className="size-full border-0" />
            <div className="absolute right-2 top-2 flex gap-1">
              <Button size="sm" variant="outline" className="h-7" onClick={() => setFrameKey((k) => k + 1)}>
                <RefreshCw className="size-3.5" />
              </Button>
              <Button size="sm" variant="outline" className="h-7" onClick={() => window.open(previewPath, "_blank")}>
                <ExternalLink className="size-3.5" />
              </Button>
            </div>
          </>
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            {row?.status === "running" ? "Waiting for the dev server to become ready…" : "Launch a sandbox to see the real running application here."}
          </div>
        )}
      </div>

      <div className="h-40 shrink-0 border-t border-border bg-surface-2">
        <div className="flex gap-1 px-2 pt-1">
          {(["run", "install", "dev"] as const).map((k) => (
            <button key={k} onClick={() => setLogTab(k)}
              className={`rounded px-2 py-0.5 text-[10px] uppercase ${logTab === k ? "bg-background text-foreground" : "text-muted-foreground"}`}>
              {k === "run" ? "Steps" : k}
            </button>
          ))}
        </div>
        <pre className="h-32 overflow-auto whitespace-pre-wrap px-2 py-1 font-mono text-[10px]">{logs[logTab] || "no output"}</pre>
      </div>
    </div>
  );
}
