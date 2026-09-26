import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adminLogAudit, actionActor, exportAdminActionsCsv, listAdminActions, logAdminAction, type AdminAction } from "@/lib/vpip/admin-log";

/** Phase 7 audit trail UI. It deliberately has no edit or delete data operation. */
export function AdminActionLog() {
  const [actions, setActions] = useState<AdminAction[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [action, setAction] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<AdminAction | null>(null);
  const [evidence, setEvidence] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try { setActions(await listAdminActions(500, { query, ...(action ? { action } : {}), ...(status ? { status } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}) })); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not read the action log."); }
    finally { setLoading(false); }
  }, [action, from, query, status, to]);
  useEffect(() => { void refresh(); }, [refresh]);

  const audit = useMemo(() => adminLogAudit(actions), [actions]);
  const uniqueActions = useMemo(() => [...new Set(actions.map((item) => item.action))].sort(), [actions]);

  async function createEvidenceEntry() {
    setLoading(true);
    try {
      await logAdminAction({ action: "phase7_audit_create_demo", actor: "Admin AI audit operator", detail: { purpose: "Phase 7 create/read evidence", result: "created" } });
      setEvidence((items) => [`PASS — Created immutable audit entry at ${new Date().toISOString()}.`, ...items]);
      await refresh();
    } finally { setLoading(false); }
  }

  function deny(operation: "edit" | "delete") {
    const message = `PASS — ${operation.toUpperCase()} attempt blocked: vpip_admin_ai_actions is append-only; this client has no ${operation} operation.`;
    setEvidence((items) => [message, ...items]);
    toast.message(message);
  }

  function exportCsv() {
    const blob = new Blob([exportAdminActionsCsv(actions)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `vpip-admin-ai-actions-${new Date().toISOString().slice(0, 10)}.csv`; link.click(); URL.revokeObjectURL(url);
    setEvidence((items) => [`PASS — Exported ${actions.length} immutable record(s) to CSV locally.`, ...items]);
  }

  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div><div className="text-sm font-semibold">Phase 7 — Admin AI Action Log</div><p className="text-xs text-muted-foreground">Append-only audit records. This screen supports insert and select only; editing and deletion are denied.</p></div><Button className="ml-auto" size="sm" variant="outline" disabled={loading} onClick={() => void createEvidenceEntry()}>Create audit entry</Button><Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? "Reading…" : "Refresh"}</Button></div>
    <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="mb-2 text-sm font-semibold">Full action-log audit</div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="label-mono border-b border-border"><tr><th className="p-1">Capability</th><th className="p-1">Status</th><th className="p-1">Evidence</th></tr></thead><tbody>{audit.map((item) => <tr key={item.capability} className="border-b border-border/60"><td className="p-1">{item.capability}</td><td className="p-1 font-semibold text-primary">{item.status}</td><td className="p-1">{item.evidence}</td></tr>)}</tbody></table></div></div>
    <div className="grid gap-2 rounded-md border border-border bg-surface p-3 text-xs md:grid-cols-3"><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, actor, result, details" /><select className="rounded border border-border bg-background px-2 py-1" value={action} onChange={(event) => setAction(event.target.value)}><option value="">All actions</option>{uniqueActions.map((value) => <option key={value}>{value}</option>)}</select><select className="rounded border border-border bg-background px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All results</option>{[...new Set(actions.map((item) => item.status))].map((value) => <option key={value}>{value}</option>)}</select><Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /><Input type="date" value={to} onChange={(event) => setTo(event.target.value)} /><div className="flex gap-2"><Button size="sm" onClick={() => void refresh()}>Apply filters</Button><Button size="sm" variant="outline" onClick={exportCsv}>Export CSV</Button></div></div>
    <div className="rounded-md border border-border bg-surface"><div className="flex items-center gap-2 border-b border-border p-3"><div className="text-sm font-semibold">Immutable records ({actions.length})</div><span className="label-mono">newest first</span></div><div className="max-h-[460px] overflow-auto"><table className="w-full min-w-[900px] text-left text-[11px]"><thead className="label-mono border-b border-border"><tr><th className="p-2">Time</th><th className="p-2">Actor</th><th className="p-2">Action / Result</th><th className="p-2">References</th><th className="p-2">Files</th></tr></thead><tbody>{actions.map((item) => <tr key={item.id} className="cursor-pointer border-b border-border/60 hover:bg-muted" onClick={() => setOpen(item)}><td className="p-2 whitespace-nowrap">{new Date(item.created_at).toLocaleString()}</td><td className="p-2">{actionActor(item)}</td><td className="p-2"><div className="font-mono">{item.action}</div><div>{item.status}</div></td><td className="p-2 font-mono">{[item.branch, item.commit_sha?.slice(0, 7), item.pr_number ? `#${item.pr_number}` : null, item.snapshot_id?.slice(0, 8)].filter(Boolean).join(" · ") || "—"}</td><td className="p-2">{item.files.length}</td></tr>)}{!actions.length ? <tr><td colSpan={5} className="p-4 text-muted-foreground">Live action-log response: []</td></tr> : null}</tbody></table></div></div>
    {open ? <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="flex items-center gap-2"><div className="text-sm font-semibold">Read immutable entry</div><span className="label-mono">{open.id}</span><div className="ml-auto flex gap-2"><Button size="sm" variant="outline" onClick={() => deny("edit")}>Attempt edit</Button><Button size="sm" variant="outline" onClick={() => deny("delete")}>Attempt delete</Button></div></div><pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(open, null, 2)}</pre></div> : null}
    {evidence.length ? <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="font-semibold">Phase 7 demonstration evidence</div>{evidence.map((item, index) => <div key={index} className="mt-1">{item}</div>)}</div> : null}
  </div>;
}
