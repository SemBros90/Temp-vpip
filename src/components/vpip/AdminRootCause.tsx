import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  rootCauseAudit,
  traceRootCause,
  type BranchEvidence,
  type CommitEvidence,
  type FailureEvidence,
  type RootCauseReport,
  type SnapshotEvidence,
} from "@/lib/vpip/root-cause";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (table: string) => any };

/** Phase 10: read-only correlation of retained failures, repository history, and snapshots. */
export function AdminRootCause(props: { commits: CommitEvidence[]; branches: BranchEvidence[] }) {
  const [failures, setFailures] = useState<FailureEvidence[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotEvidence[]>([]);
  const [builds, setBuilds] = useState<Array<{ created_at: string }>>([]);
  const [runtime, setRuntime] = useState<Array<{ created_at: string }>>([]);
  const [issueId, setIssueId] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setError("");
    try {
      const [f, s, b, r] = await Promise.all([
        db
          .from("vpip_failures")
          .select("id,code,title,root_cause,status,project_id,created_at")
          .order("created_at", { ascending: true })
          .limit(300),
        db
          .from("vpip_repo_snapshots")
          .select("id,label,project_id,metadata,files,created_at")
          .order("created_at", { ascending: true })
          .limit(300),
        db
          .from("vpip_build_records")
          .select("created_at")
          .order("created_at", { ascending: true })
          .limit(300),
        db
          .from("vpip_runtime_audit")
          .select("created_at")
          .order("created_at", { ascending: true })
          .limit(300),
      ]);
      const bad = [f, s, b, r].find((x) => x.error);
      if (bad?.error) throw new Error(bad.error.message);
      const next = f.data ?? [];
      setFailures(next);
      setSnapshots(s.data ?? []);
      setBuilds(b.data ?? []);
      setRuntime(r.data ?? []);
      setIssueId((current) => current || next[0]?.id || "");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read root-cause evidence.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  const report: RootCauseReport | null = useMemo(() => {
    const issue = failures.find((row) => row.id === issueId);
    return issue
      ? traceRootCause({
          issue,
          commits: props.commits,
          branches: props.branches,
          snapshots,
          builds,
          runtime,
        })
      : null;
  }, [issueId, failures, props.commits, props.branches, snapshots, builds, runtime]);
  const audit = rootCauseAudit(report);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <div className="text-sm font-semibold">Phase 10 — Root Cause Engine</div>
          <p className="text-xs text-muted-foreground">
            Read-only evidence correlation. It never edits, commits, restores, or deploys.
          </p>
        </div>
        <Button className="ml-auto" size="sm" variant="outline" onClick={() => void refresh()}>
          Run full root-cause audit
        </Button>
      </div>
      <div className="rounded-md border border-border bg-surface p-3 text-xs">
        <label className="font-semibold">Known issue </label>
        <select
          className="ml-2 rounded border border-border bg-background p-1"
          value={issueId}
          onChange={(e) => setIssueId(e.target.value)}
        >
          <option value="">Select…</option>
          {failures.map((f) => (
            <option key={f.id} value={f.id}>
              {f.code ?? f.id.slice(0, 8)} · {f.title ?? "Untitled failure"}
            </option>
          ))}
        </select>
        {error ? <div className="mt-2 text-destructive">FAIL · {error}</div> : null}
      </div>
      <div className="rounded-md border border-border bg-surface p-3 text-xs">
        <div className="mb-2 text-sm font-semibold">Full Phase 10 audit</div>
        <table className="w-full text-left">
          <thead className="label-mono border-b border-border">
            <tr>
              <th className="p-1">Capability</th>
              <th>Status</th>
              <th>Evidence</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((item) => (
              <tr key={item.capability} className="border-b border-border/60">
                <td className="p-1">{item.capability}</td>
                <td
                  className={`font-semibold ${item.status === "PASS" ? "text-primary" : "text-destructive"}`}
                >
                  {error ? "FAIL" : item.status}
                </td>
                <td>{error || item.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {report ? (
        <div className="grid gap-3 lg:grid-cols-2 text-xs">
          <Evidence title="First appearance" value={report.firstAppearance} />
          <Evidence
            title="First failing commit"
            value={
              report.firstCommit
                ? `${report.firstCommit.sha.slice(0, 7)} · ${report.firstCommit.message}`
                : "Not found"
            }
          />
          <Evidence
            title="First failing snapshot"
            value={report.firstSnapshot?.label ?? "Not found"}
          />
          <Evidence title="First failing branch" value={report.firstBranch?.name ?? "Not found"} />
          <Evidence
            title="Files involved"
            value={report.files.join("\n") || "No files correlated"}
          />
          <Evidence
            title="Dependency & import tracing"
            value={report.imports.join("\n") || "No internal import edges correlated"}
          />
          <Evidence
            title="Build & configuration tracing"
            value={report.config.join("\n") || "No config files correlated"}
          />
          <Evidence
            title="Timeline reconstruction"
            value={report.timeline
              .map((event) => `${event.at} · ${event.kind} · ${event.evidence}`)
              .join("\n")}
          />
          <Evidence
            title="Cause chain"
            value={report.causeChain.map((step, i) => `${i + 1}. ${step}`).join("\n")}
            wide
          />
        </div>
      ) : (
        <div className="rounded border border-border p-4 text-xs text-muted-foreground">
          No known issue is retained yet. The audit truthfully reports FAIL until one is available.
        </div>
      )}
    </div>
  );
}
function Evidence(props: { title: string; value: string; wide?: boolean }) {
  return (
    <div
      className={`rounded-md border border-border bg-surface p-3 ${props.wide ? "lg:col-span-2" : ""}`}
    >
      <div className="font-semibold">{props.title}</div>
      <pre className="mt-2 whitespace-pre-wrap text-[11px]">{props.value}</pre>
    </div>
  );
}
