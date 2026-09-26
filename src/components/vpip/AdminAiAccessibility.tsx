import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

type Resource = { capability: string; source: string; record: Record<string, unknown> | null; error?: string };

const SOURCES = [
  ["AI 1 reports", "vpip_ai1_reports", "id,project_id,build_session_id,report,created_at", "created_at"],
  ["AI 1 prompts", "vpip_prompts", "id,project_id,title,kind,version,status,markdown,created_at", "created_at"],
  ["AI 1 build results", "vpip_build_records", "id,project_id,build_code,status,summary,provider,model,logs,created_at", "created_at"],
  ["AI 1 file changes", "vpip_ai1_reports", "id,project_id,build_session_id,files_created,files_modified,created_at", "created_at"],
  ["AI 2 audits", "vpip_ai2_audits", "id,project_id,build_session_id,kind,mode,score,report,created_at", "created_at"],
  ["AI 2 findings", "vpip_ai2_audits", "id,project_id,kind,score,findings,created_at", "created_at"],
  ["AI 2 corrective prompts", "vpip_ai2_audits", "id,project_id,kind,corrective_prompt,created_at", "created_at"],
  ["AI 2 recommendations", "vpip_ai2_audits", "id,project_id,kind,report,findings,created_at", "created_at"],
  ["Runtime reports", "vpip_runtime_audit", "id,project_id,action,status,error,detail,created_at", "created_at"],
  ["Validation reports", "vpip_validation_runs", "id,targets,results,metrics,created_at", "created_at"],
] as const;

/** Phase 8 reads latest AI/runtime/validation evidence directly from each source table. */
export function AdminAiAccessibility() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const results = await Promise.all(SOURCES.map(async ([capability, table, columns, order]) => {
      const { data, error } = await db.from(table).select(columns).order(order, { ascending: false }).limit(1).maybeSingle();
      return { capability, source: `SELECT ${columns} FROM ${table} ORDER BY ${order} DESC LIMIT 1`, record: data as Record<string, unknown> | null, error: error?.message };
    }));
    setResources(results);
    setLoading(false);
    if (results.some((result) => result.error)) toast.error("One or more Phase 8 evidence sources could not be read.");
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const passed = useMemo(() => resources.filter((resource) => !resource.error).length, [resources]);
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-2"><div><div className="text-sm font-semibold">Phase 8 — AI 1 / AI 2 Accessibility</div><p className="text-xs text-muted-foreground">Admin AI independently reads the latest record from every AI, runtime, and validation resource. No source is edited.</p></div><Button className="ml-auto" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? "Reading…" : "Run full accessibility audit"}</Button></div>
    <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="mb-2 text-sm font-semibold">Full Phase 8 audit — {passed}/{SOURCES.length} sources accessible</div><div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left"><thead className="label-mono border-b border-border"><tr><th className="p-1">Resource</th><th className="p-1">Status</th><th className="p-1">Evidence</th></tr></thead><tbody>{resources.length ? resources.map((resource) => <tr key={resource.capability} className="border-b border-border/60"><td className="p-1">{resource.capability}</td><td className={`p-1 font-semibold ${resource.error ? "text-destructive" : "text-primary"}`}>{resource.error ? "FAIL" : "PASS"}</td><td className="p-1">{resource.error ? resource.error : resource.record ? `Latest record: ${String(resource.record.created_at ?? resource.record.id ?? "returned")}` : "API response: null (no records yet)."}</td></tr>) : <tr><td colSpan={3} className="p-2 text-muted-foreground">Audit has not returned a response yet.</td></tr>}</tbody></table></div></div>
    <div className="grid gap-3 lg:grid-cols-2">{resources.map((resource) => <div key={resource.capability} className="rounded-md border border-border bg-surface p-3 text-xs"><button className="block w-full text-left" onClick={() => setOpen(open === resource.capability ? null : resource.capability)}><div className="flex items-center gap-2"><span className="font-semibold">{resource.capability}</span><span className={`ml-auto font-semibold ${resource.error ? "text-destructive" : "text-primary"}`}>{resource.error ? "FAIL" : "PASS"}</span></div><div className="label-mono mt-1 truncate">{resource.source}</div></button>{open === resource.capability ? <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{resource.error ? `FAIL: ${resource.error}` : JSON.stringify(resource.record, null, 2) || "null"}</pre> : <div className="mt-2 text-muted-foreground">Latest: {resource.record ? String(resource.record.created_at ?? resource.record.id ?? "record returned") : "API response: null"}</div>}</div>)}</div>
  </div>;
}
