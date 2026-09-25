import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { download } from "@/lib/vpip/files";
import { listAudit, listSessions, type AuditRow } from "@/lib/vpip/discovery-db";
import type { DSession } from "@/lib/vpip/discovery";

export const Route = createFileRoute("/projects/$projectId/discovery/audit")({
  head: () => ({
    meta: [
      { title: "Discovery Audit — VPIP" },
      { name: "description", content: "Read-only audit trail of every discovery question, answer, assumption and phase change." },
      { property: "og:title", content: "Discovery Audit — VPIP" },
      { property: "og:description", content: "Searchable, filterable, exportable discovery audit trail." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditPage,
});

const PAGE = 50;

function AuditPage() {
  const { projectId } = Route.useParams();
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [sessions, setSessions] = useState<DSession[]>([]);
  const [q, setQ] = useState("");
  const [ev, setEv] = useState("");
  const [sid, setSid] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);

  useEffect(() => {
    Promise.all([listAudit(projectId), listSessions(projectId)])
      .then(([a, s]) => { setRows(a); setSessions(s); })
      .catch((e) => toast.error(String(e.message ?? e)));
  }, [projectId]);

  const events = useMemo(() => [...new Set((rows ?? []).map((r) => r.event))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = q.toLowerCase();
    return (rows ?? []).filter((r) =>
      (!ev || r.event === ev) &&
      (!sid || r.session_id === sid) &&
      (!from || r.created_at >= from) &&
      (!to || r.created_at.slice(0, 10) <= to) &&
      (!needle || `${r.event} ${JSON.stringify(r.detail)}`.toLowerCase().includes(needle)),
    );
  }, [rows, q, ev, sid, from, to]);
  useEffect(() => setPage(0), [q, ev, sid, from, to]);
  const idea = (id: string | null) => sessions.find((s) => s.id === id)?.idea ?? id ?? "—";

  const exportCsv = () => {
    const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
    const lines = ["timestamp,user,session,event,detail", ...filtered.map((r) => [r.created_at, r.actor, idea(r.session_id), r.event, JSON.stringify(r.detail)].map(esc).join(","))];
    download("discovery-audit.csv", lines.join("\n"), "text/csv");
  };
  const exportJson = () => download("discovery-audit.json", JSON.stringify(filtered, null, 2), "application/json");

  return (
    <Shell
      title="Discovery Audit"
      subtitle="Read-only record of the discovery process."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={exportCsv} disabled={!filtered.length}>Export CSV</Button>
          <Button variant="outline" onClick={exportJson} disabled={!filtered.length}>Export JSON</Button>
          <Button variant="outline" asChild><Link to="/projects/$projectId/discovery" params={{ projectId }}>Discovery</Link></Button>
        </div>
      }
    >
      <div className="flex flex-wrap gap-2 mb-4">
        <Input className="w-56" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="rounded-md border bg-background px-2 text-sm" value={ev} onChange={(e) => setEv(e.target.value)}>
          <option value="">All events</option>
          {events.map((e) => <option key={e}>{e}</option>)}
        </select>
        <select className="rounded-md border bg-background px-2 text-sm max-w-64" value={sid} onChange={(e) => setSid(e.target.value)}>
          <option value="">All sessions</option>
          {sessions.map((s) => <option key={s.id} value={s.id}>{s.idea}</option>)}
        </select>
        <Input type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        <Input type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      {rows === null ? <p className="text-sm text-muted-foreground">Loading…</p> : (
        <>
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr><th className="py-2">Timestamp</th><th>User</th><th>Session</th><th>Event</th><th>Detail</th></tr>
            </thead>
            <tbody>
              {filtered.slice(page * PAGE, page * PAGE + PAGE).map((r) => (
                <tr key={r.id} className="border-b align-top">
                  <td className="py-2 whitespace-nowrap">{new Date(r.created_at).toLocaleString()}</td>
                  <td>{r.actor}</td>
                  <td className="max-w-48 truncate">{idea(r.session_id)}</td>
                  <td className="whitespace-nowrap">{r.event}</td>
                  <td className="text-xs text-muted-foreground break-all">{Object.entries(r.detail).map(([k, v]) => `${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`).join(" · ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-2 mt-3 text-sm">
            <span>{filtered.length} events</span>
            <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</Button>
            <Button size="sm" variant="outline" disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next</Button>
          </div>
        </>
      )}
    </Shell>
  );
}
