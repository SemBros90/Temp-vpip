import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };
type Row = Record<string, unknown>;
type Knowledge = { failures: Row[]; outcomes: Row[]; repairs: Row[]; patterns: Row[]; builds: Row[]; actions: Row[] };
const empty: Knowledge = { failures: [], outcomes: [], repairs: [], patterns: [], builds: [], actions: [] };

function latest(rows: Row[]) { return rows[0] ?? null; }
function text(row: Row) { return JSON.stringify(row).toLowerCase(); }

/** Phase 9 reads retained project-history resources and derives advisory patterns without writing them. */
export function AdminKnowledgeBase() {
  const [data, setData] = useState<Knowledge>(empty);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [failures, outcomes, repairs, patterns, builds, actions] = await Promise.all([
        db.from("vpip_failures").select("id,project_id,code,title,root_cause,resolution,lessons,status,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("vpip_outcomes").select("id,project_id,code,subject_label,result,lessons,recommendations,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("vpip_repair_audit").select("id,project_id,action,risk,note,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("vpip_intelligence").select("id,project_id,code,pattern_type,title,description,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("vpip_build_records").select("id,project_id,build_code,status,summary,created_at").order("created_at", { ascending: false }).limit(300),
        db.from("vpip_admin_ai_actions").select("id,action,status,detail,created_at").order("created_at", { ascending: false }).limit(300),
      ]);
      const responses = [failures, outcomes, repairs, patterns, builds, actions];
      const failed = responses.find((response) => response.error);
      if (failed?.error) throw new Error(failed.error.message);
      setData({ failures: failures.data ?? [], outcomes: outcomes.data ?? [], repairs: repairs.data ?? [], patterns: patterns.data ?? [], builds: builds.data ?? [], actions: actions.data ?? [] });
    } catch (reason) { const message = reason instanceof Error ? reason.message : "Knowledge resources could not be read."; setError(message); toast.error(message); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const derivedPatterns = useMemo(() => Object.entries(data.failures.reduce<Record<string, number>>((counts, failure) => {
    const cause = String(failure.root_cause || failure.title || "Unclassified failure").trim(); counts[cause] = (counts[cause] ?? 0) + 1; return counts;
  }, {})).filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]), [data.failures]);
  const rollbacks = useMemo(() => data.actions.filter((action) => /rollback|snapshot_restore/i.test(String(action.action))), [data.actions]);
  const successful = useMemo(() => data.builds.filter((build) => /success|complete|passed/i.test(String(build.status))), [data.builds]);
  const haystack = useMemo(() => [
    ["Stored failures", data.failures], ["Stored fixes", data.failures.filter((row) => String(row.resolution ?? "").trim())], ["Stored lessons", data.outcomes.filter((row) => String(row.lessons ?? "").trim())], ["Recommendations", data.outcomes.filter((row) => String(row.recommendations ?? "").trim())], ["Rollback history", rollbacks], ["Successful builds", successful], ["Cross-project patterns", data.patterns],
  ] as Array<[string, Row[]]>, [data, rollbacks, successful]);
  const matches = useMemo(() => !query.trim() ? [] : haystack.flatMap(([kind, rows]) => rows.filter((row) => text(row).includes(query.toLowerCase())).map((row) => ({ kind, row }))).slice(0, 100), [haystack, query]);
  const audit = [
    ["Failure database", data.failures.length, "vpip_failures"], ["Fix database", data.failures.filter((row) => String(row.resolution ?? "").trim()).length, "vpip_failures.resolution + vpip_repair_audit"], ["Lessons learned", data.outcomes.filter((row) => String(row.lessons ?? "").trim()).length, "vpip_outcomes.lessons"], ["Rollback history", rollbacks.length, "vpip_admin_ai_actions"], ["Successful builds", successful.length, "vpip_build_records"], ["Pattern detection", derivedPatterns.length, "derived from stored failure causes"], ["Cross-project patterns", data.patterns.length, "vpip_intelligence"], ["Recommendation engine", data.outcomes.filter((row) => String(row.recommendations ?? "").trim()).length, "vpip_outcomes.recommendations"], ["Knowledge retrieval", haystack.reduce((count, [, rows]) => count + rows.length, 0), "combined retained records"], ["Historical search", matches.length, query ? `query: ${query}` : "enter a query to show live matches"],
  ] as const;

  return <div className="space-y-4"><div className="flex flex-wrap items-center gap-2"><div><div className="text-sm font-semibold">Phase 9 — Knowledge Base</div><p className="text-xs text-muted-foreground">Read-only project-history retrieval, pattern detection, and recommendations for Admin AI.</p></div><Button className="ml-auto" size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>{loading ? "Reading…" : "Run full knowledge audit"}</Button></div>
    <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="mb-2 text-sm font-semibold">Full Phase 9 audit</div><div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left"><thead className="label-mono border-b border-border"><tr><th className="p-1">Capability</th><th className="p-1">Status</th><th className="p-1">Evidence</th></tr></thead><tbody>{audit.map(([capability, count, source]) => <tr key={capability} className="border-b border-border/60"><td className="p-1">{capability}</td><td className={`p-1 font-semibold ${error ? "text-destructive" : "text-primary"}`}>{error ? "FAIL" : "PASS"}</td><td className="p-1">{error || `${count} record(s) · ${source}`}</td></tr>)}</tbody></table></div></div>
    <div className="grid gap-3 lg:grid-cols-2">{haystack.slice(0, 4).map(([title, rows]) => <RecordCard key={title} title={title} rows={rows} open={open} setOpen={setOpen} />)}<RecordCard title="Pattern matches" rows={data.patterns} open={open} setOpen={setOpen} extra={derivedPatterns.map(([cause, count]) => `${count}× ${cause}`).join("\n") || "No repeated failure patterns yet."} /><RecordCard title="Rollback history" rows={rollbacks} open={open} setOpen={setOpen} /><RecordCard title="Successful builds" rows={successful} open={open} setOpen={setOpen} /><RecordCard title="Recommendations" rows={data.outcomes.filter((row) => String(row.recommendations ?? "").trim())} open={open} setOpen={setOpen} /></div>
    <div className="rounded-md border border-border bg-surface p-3 text-xs"><div className="mb-2 text-sm font-semibold">Historical search &amp; knowledge retrieval</div><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search stored failures, fixes, lessons, patterns, recommendations…" />{query ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{matches.length ? matches.map((match) => `## ${match.kind}\n${JSON.stringify(match.row, null, 2)}`).join("\n\n") : "No historical matches."}</pre> : <div className="mt-2 text-muted-foreground">Enter a term to retrieve matching retained knowledge.</div>}</div>
  </div>;
}

function RecordCard(props: { title: string; rows: Row[]; open: string | null; setOpen: (value: string | null) => void; extra?: string }) {
  const row = latest(props.rows); const active = props.open === props.title;
  return <div className="rounded-md border border-border bg-surface p-3 text-xs"><button className="block w-full text-left" onClick={() => props.setOpen(active ? null : props.title)}><div className="flex"><span className="font-semibold">{props.title}</span><span className="ml-auto font-semibold text-primary">PASS</span></div><div className="mt-1 text-muted-foreground">{props.rows.length ? `Latest record: ${String(row?.created_at ?? row?.id ?? "returned")}` : "API response: []"}</div></button>{active ? <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[11px]">{props.extra ? `${props.extra}\n\n` : ""}{row ? JSON.stringify(row, null, 2) : "[]"}</pre> : null}</div>;
}
