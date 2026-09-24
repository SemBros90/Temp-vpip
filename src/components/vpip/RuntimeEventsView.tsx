import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useVpip } from "@/lib/vpip/store";
import { runtimeEvents } from "@/lib/vpip/runtime/runtime.functions";
import { EVENT_TYPES, USER_ACTIONS, eventCategory, eventLabel, eventSeverity, type EventCategory } from "@/lib/vpip/runtime/providers";

type Ev = Awaited<ReturnType<typeof runtimeEvents>>["rows"][number];

const HISTORY_TYPES = ["Launch", "Sync", "Install", "Start", "Stop", "Pause", "Resume", "Destroy", "Cleanup", "Validation", "Error", "Environment", "Preview"] as const;
const CATEGORIES: Array<{ id: EventCategory; label: string }> = [
  { id: "runtime", label: "Runtime" },
  { id: "sandbox", label: "Sandbox" },
  { id: "validation", label: "Validation" },
  { id: "environment", label: "Environment" },
  { id: "sync", label: "Sync" },
  { id: "cleanup", label: "Cleanup" },
  { id: "install", label: "Install" },
  { id: "preview", label: "Preview" },
  { id: "provider", label: "Provider" },
];

function actionsFor(kind: "type" | "category", value: string): string[] {
  return Object.entries(EVENT_TYPES)
    .filter(([, v]) => (kind === "category" ? v.category === value : v.label.startsWith(value)))
    .map(([k]) => k);
}

const PAGE = 50;

export function RuntimeEventsView({ mode, initialProjectId, initialBuildId }: { mode: "history" | "audit"; initialProjectId?: string | undefined; initialBuildId?: string | undefined }) {
  const { ws } = useVpip();
  const load = useServerFn(runtimeEvents);
  const [projectId, setProjectId] = useState(initialProjectId ?? "");
  const [buildId] = useState(initialBuildId ?? "");
  const [runtimeId, setRuntimeId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Ev[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useMemo(() => {
    const actions = typeFilter ? actionsFor(mode === "audit" ? "category" : "type", typeFilter) : undefined;
    return {
      projectId: projectId || undefined,
      buildId: buildId || undefined,
      runtimeId: runtimeId.trim() || undefined,
      actions: typeFilter === "Error" ? undefined : actions,
      status: (typeFilter === "Error" ? "failed" : status || undefined) as "started" | "success" | "failed" | "info" | undefined,
      from: from ? new Date(from).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      search: search.trim() || undefined,
    };
  }, [projectId, buildId, runtimeId, typeFilter, status, from, to, search, mode]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await load({ data: { ...query, page, pageSize: PAGE } });
      setRows(r.rows);
      setTotal(r.total);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [load, query, page]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setPage(0); }, [query]);

  const projectName = (id: string) => ws.projects.find((p: { id: string; name: string }) => p.id === id)?.name ?? id;

  const exportAll = async (fmt: "csv" | "json") => {
    const all: Ev[] = [];
    for (let p = 0; ; p++) {
      const r = await load({ data: { ...query, page: p, pageSize: 1000 } });
      all.push(...r.rows);
      if (r.rows.length < 1000) break;
    }
    let body: string;
    if (fmt === "json") body = JSON.stringify(all, null, 2);
    else {
      const cols = ["created_at", "project_id", "build_id", "sandbox_row_id", "e2b_sandbox_id", "action", "status", "duration_ms", "error", "user_id", "detail"] as const;
      const esc = (v: unknown) => {
        const s = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      body = [cols.join(","), ...all.map((r) => cols.map((c) => esc(r[c])).join(","))].join("\n");
    }
    const url = URL.createObjectURL(new Blob([body], { type: fmt === "json" ? "application/json" : "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vpip-runtime-audit-${new Date().toISOString().slice(0, 10)}.${fmt}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const sel = "h-8 rounded border border-border bg-background px-2 text-xs";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-8 w-56 text-xs" placeholder="Search action, error, runtime, build…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className={sel} value={projectId} onChange={(e) => setProjectId(e.target.value)} aria-label="Project">
          <option value="">All projects</option>
          {ws.projects.map((p: { id: string; name: string }) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <Input className="h-8 w-40 text-xs" placeholder="Runtime ID" value={runtimeId} onChange={(e) => setRuntimeId(e.target.value)} />
        <select className={sel} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} aria-label="Event type">
          <option value="">All event types</option>
          {mode === "audit"
            ? CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label} events</option>)
            : HISTORY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          <option value="success">Success</option>
          <option value="failed">Failed</option>
          <option value="started">Started</option>
          <option value="info">Info</option>
        </select>
        <input type="date" className={sel} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <input type="date" className={sel} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        <Button size="sm" variant="outline" className="h-8" onClick={() => void refresh()} disabled={loading}><RefreshCw className="size-3.5" /></Button>
        {mode === "audit" ? (
          <>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void exportAll("csv")}><Download className="size-3.5" /> CSV</Button>
            <Button size="sm" variant="outline" className="h-8" onClick={() => void exportAll("json")}><Download className="size-3.5" /> JSON</Button>
          </>
        ) : null}
      </div>
      {buildId ? <div className="text-xs text-muted-foreground">Filtered to build session <span className="font-mono">{buildId}</span></div> : null}
      {error ? <div className="text-sm text-destructive">{error}</div> : null}
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-muted-foreground">
            <tr>{["Timestamp", "Project", "Build session", "Runtime ID", mode === "audit" ? "Category" : "Event", "Event type", "Status", "Duration", "Error", "User action"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">{loading ? "Loading…" : "No runtime events match these filters."}</td></tr>
            ) : rows.map((r) => {
              const sev = eventSeverity(r);
              return (
                <tr key={r.id} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono">{new Date(r.created_at).toLocaleString()}</td>
                  <td className="px-2 py-1.5">{projectName(r.project_id)}</td>
                  <td className="px-2 py-1.5 font-mono">
                    {r.build_id ? <Link to="/projects/$projectId/coder/$buildId" params={{ projectId: r.project_id, buildId: r.build_id }} className="hover:underline">{r.build_id}</Link> : "—"}
                  </td>
                  <td className="px-2 py-1.5 font-mono">{r.e2b_sandbox_id ?? r.sandbox_row_id ?? "—"}</td>
                  <td className="px-2 py-1.5">{mode === "audit" ? eventCategory(r.action) : eventLabel(r.action)}</td>
                  <td className="px-2 py-1.5 font-mono">{r.action}</td>
                  <td className="px-2 py-1.5">
                    <Badge variant={sev === "error" ? "destructive" : sev === "ok" ? "default" : "secondary"}>{sev === "warning" ? "warning" : r.status}</Badge>
                  </td>
                  <td className="px-2 py-1.5">{r.duration_ms != null ? `${(r.duration_ms / 1000).toFixed(1)}s` : "—"}</td>
                  <td className="max-w-xs px-2 py-1.5 text-destructive">{r.error ?? ""}</td>
                  <td className="px-2 py-1.5">{USER_ACTIONS.has(r.action) ? "User" : r.user_id ? "System (owner session)" : "System"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{total} event(s)</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span>Page {page + 1} / {pages}</span>
          <Button size="sm" variant="outline" className="h-7" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      </div>
    </div>
  );
}

export function RuntimeNav() {
  const cls = "rounded border border-border px-2 py-1 text-xs hover:bg-surface-2";
  return (
    <div className="flex flex-wrap gap-2">
      <Link to="/runtime-dashboard" className={cls}>Dashboard</Link>
      <Link to="/runtime-history" className={cls}>History</Link>
      <Link to="/runtime-audit" className={cls}>Audit Center</Link>
      <Link to="/runtime-validation" className={cls}>Validation Center</Link>
      <Link to="/runtime-settings" className={cls}>Runtime Settings</Link>
    </div>
  );
}
