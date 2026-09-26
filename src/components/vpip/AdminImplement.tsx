import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { readFile } from "@/lib/vpip/admin-ai";
import { affectedPaths, applyChangeSet, changeSetInstruction, changeStats, parseChangeSet, undoChange, type ChangeSet } from "@/lib/vpip/admin-implement";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

interface Report { id: string; kind: string; title: string; content: string; status: string; engine: string | null; created_at: string }
interface Props {
  report: Report;
  token: string;
  repo: string;
  base: string;
  tree: string[];
  runAi: (instruction: string) => Promise<string>;
  onReport: (row: Report) => void;
  onStatus: (r: Report, status: string) => Promise<void>;
}

const META_RE = /<!--admin-meta (.*?)-->/s;

export function AdminImplement({ report, token, repo, base, tree, runAi, onReport, onStatus }: Props) {
  const [cs, setCs] = useState<ChangeSet | null>(null);
  const [orig, setOrig] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const connected = !!(token && repo && tree.length);

  if (report.kind === "implementation") {
    const m = report.content.match(META_RE);
    const meta = m ? (JSON.parse(m[1] ?? "{}") as { prNumber: number; branch: string }) : null;
    if (!meta || report.status === "Undone") return null;
    return (
      <Button size="sm" variant="outline" disabled={!!busy || !connected} onClick={async () => {
        if (!confirm(`Undo this Admin AI change? This closes PR #${meta.prNumber} and deletes branch ${meta.branch}. Main is not touched.`)) return;
        setBusy("undo");
        try { await undoChange(token, repo, meta.prNumber, meta.branch); await logAdminAction({ action: "rollback_pr", report_id: report.id, branch: meta.branch, pr_number: meta.prNumber }); await onStatus(report, "Undone"); toast.success("Change undone"); }
        catch (e) { void logAdminAction({ action: "rollback_pr", status: "failed", report_id: report.id, branch: meta.branch, pr_number: meta.prNumber, detail: { error: e instanceof Error ? e.message : String(e) } }); toast.error(e instanceof Error ? e.message : "Undo failed"); }
        finally { setBusy(""); }
      }}>Undo this change</Button>
    );
  }
  if (report.kind !== "proposal") return null;
  const approved = report.status === "Approved";

  async function prepare() {
    setBusy("prepare");
    try {
      const paths = affectedPaths(report.content, tree);
      const files: Array<{ path: string; content: string }> = [];
      for (const p of paths) files.push({ path: p, content: await readFile(token, repo, base, p) });
      setOrig(Object.fromEntries(files.map((f) => [f.path, f.content])));
      setCs(parseChangeSet(await runAi(changeSetInstruction(report.content, files))));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not prepare changes");
    } finally { setBusy(""); }
  }

  async function implement() {
    if (!cs) return;
    setBusy("apply");
    // 1. Mandatory snapshot — exact original files + base commit.
    const snap = { repo, base, created_at: new Date().toISOString(), proposal_id: report.id, files: orig };
    const { data: snapRow, error: snapErr } = await db.from("vpip_admin_ai_reports")
      .insert({ kind: "snapshot", title: `Snapshot before: ${cs.title}`, status: "Stored", content: `# Pre-change snapshot\nRepository ${repo} @ ${base}\n\n${Object.keys(orig).map((p) => `- ${p}`).join("\n")}\n\n<!--admin-meta ${JSON.stringify(snap)}-->` })
      .select("*").single();
    if (snapErr || !snapRow) {
      setBusy("");
      void logAdminAction({ action: "snapshot_create", status: "failed", report_id: report.id, files: Object.keys(orig), detail: { error: snapErr?.message } });
      toast.error("Implementation blocked because snapshot creation failed.");
      return;
    }
    void logAdminAction({ action: "snapshot_create", report_id: report.id, snapshot_id: snapRow.id, files: Object.keys(orig), detail: { base } });
    onReport(snapRow);
    try {
      // 2–4. Branch → commit → pull request (never main).
      const res = await applyChangeSet(token, repo, base, cs);
      void logAdminAction({ action: "implement_pr", report_id: report.id, snapshot_id: snapRow.id, branch: cs.branch, commit_sha: res.commitSha, pr_number: res.prNumber, pr_url: res.prUrl, files: cs.changes.map((c) => c.path), detail: { base, approved_status: report.status } });
      const stats = changeStats(cs, orig);
      const add = stats.reduce((n, s) => n + s.added, 0);
      const rem = stats.reduce((n, s) => n + s.removed, 0);
      const content = `# Implementation Report — ${cs.title}

**Pull request:** [#${res.prNumber}](${res.prUrl}) · **Branch:** \`${cs.branch}\` → \`${base}\` (not merged)

## Files Changed
| op | file | + | − |
|---|---|---|---|
${stats.map((s) => `| ${s.op} | ${s.path} | ${s.added} | ${s.removed} |`).join("\n")}

**Lines added:** ${add} · **Lines removed:** ${rem}

## Build Impact
Not built by Admin AI. Review the PR checks on GitHub before merging.

## Recovery Plan
- Before merge: "Undo this change" closes the PR and deletes the branch.
- After merge: revert the PR on GitHub. Original files are stored in snapshot "${snapRow.title}".

## Pull Request Summary
${cs.summary}

<!--admin-meta ${JSON.stringify({ ...res, branch: cs.branch, snapshot: snapRow.id })}-->`;
      const { data: row } = await db.from("vpip_admin_ai_reports").insert({ kind: "implementation", title: `Implementation: ${cs.title}`, status: "PR open", content }).select("*").single();
      if (row) onReport(row);
      await onStatus(report, `Implemented (PR #${res.prNumber})`);
      setCs(null);
      toast.success(`Pull request #${res.prNumber} opened`);
    } catch (e) {
      void logAdminAction({ action: "implement_pr", status: "failed", report_id: report.id, snapshot_id: snapRow.id, branch: cs.branch, files: cs.changes.map((c) => c.path), detail: { error: e instanceof Error ? e.message : String(e) } });
      toast.error(e instanceof Error ? e.message : "Implementation failed");
    } finally { setBusy(""); }
  }

  return (
    <div className="mt-4 space-y-2 rounded-md border border-border p-3 text-xs">
      <div className="font-semibold">Implement approved proposal</div>
      {!approved ? <div className="text-muted-foreground">Approve this proposal first. Nothing can be edited before approval.</div> : null}
      {approved && !connected ? <div className="text-muted-foreground">Connect the repository (token with write access) in the Repository tab first.</div> : null}
      {approved && connected && !cs ? (
        <Button size="sm" disabled={!!busy} onClick={() => void prepare()}>{busy === "prepare" ? "Preparing…" : "Prepare exact changes"}</Button>
      ) : null}
      {cs ? (
        <>
          <div>Branch <code>{cs.branch}</code> → pull request into <code>{base}</code></div>
          <table className="w-full">
            <tbody>
              {changeStats(cs, orig).map((s) => (
                <tr key={s.path}><td className="pr-2">{s.op}</td><td className="truncate">{s.path}</td><td>+{s.added}</td><td>−{s.removed}</td></tr>
              ))}
            </tbody>
          </table>
          <details><summary className="cursor-pointer">View new file contents</summary>
            {cs.changes.map((c) => (
              <div key={c.path} className="mt-2"><div className="font-medium">{c.op} {c.path}</div>
                {"content" in c && c.content ? <pre className="max-h-60 overflow-auto rounded bg-muted p-2">{c.content}</pre> : null}
              </div>
            ))}
          </details>
          <div className="flex gap-2">
            <Button size="sm" disabled={!!busy} onClick={() => void implement()}>{busy === "apply" ? "Working…" : "Confirm: snapshot → branch → pull request"}</Button>
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => setCs(null)}>Discard</Button>
          </div>
        </>
      ) : null}
    </div>
  );
}
