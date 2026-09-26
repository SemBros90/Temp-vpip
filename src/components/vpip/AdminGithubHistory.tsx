import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { listTags, listReleases, getCommit, getPull, filesDiffMarkdown } from "@/lib/vpip/admin-ai";
import { listAdminActions, logAdminAction, type AdminAction } from "@/lib/vpip/admin-log";

/** Read-only GitHub history (tags, releases, commit + PR diffs) and the append-only Admin AI action log. */
export function AdminGithubHistory(props: { token: string; repo: string; onAsk: (md: string) => void }) {
  const { token, repo } = props;
  const [tags, setTags] = useState<Awaited<ReturnType<typeof listTags>> | null>(null);
  const [rels, setRels] = useState<Awaited<ReturnType<typeof listReleases>> | null>(null);
  const [ref, setRef] = useState("");
  const [diff, setDiff] = useState<{ title: string; md: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [actions, setActions] = useState<AdminAction[]>([]);

  const reloadLog = () => listAdminActions().then(setActions).catch((e) => toast.error(e instanceof Error ? e.message : "Action log unavailable"));
  useEffect(() => { void reloadLog(); }, []);

  async function wrap(name: string, fn: () => Promise<void>) {
    setBusy(name);
    try { await fn(); } catch (e) { toast.error(e instanceof Error ? e.message : `${name} failed`); } finally { setBusy(""); }
  }

  const loadTagsReleases = () => wrap("tags", async () => {
    const [t, r] = await Promise.all([listTags(token, repo), listReleases(token, repo)]);
    setTags(t); setRels(r);
  });

  const openRef = () => wrap("diff", async () => {
    const v = ref.trim().replace(/^#/, "");
    if (/^\d+$/.test(v)) {
      const p = await getPull(token, repo, Number(v));
      setDiff({ title: `PR #${p.number} · ${p.title} · ${p.state} · ${p.head} → ${p.base} · ${p.changedFiles} files +${p.additions} −${p.deletions}`, md: `${p.body ? `${p.body}\n` : ""}${filesDiffMarkdown(p.files)}` });
      await logAdminAction({ action: "read_pr_diff", pr_number: p.number, pr_url: p.url, files: p.files.map((f) => f.filename) });
    } else {
      const c = await getCommit(token, repo, v);
      setDiff({ title: `Commit ${c.sha.slice(0, 7)} · ${c.author} · ${c.date} · ${c.message.split("\n")[0]} · +${c.stats?.additions ?? 0} −${c.stats?.deletions ?? 0}`, md: filesDiffMarkdown(c.files) });
      await logAdminAction({ action: "read_commit_diff", commit_sha: c.sha, files: c.files.map((f) => f.filename) });
    }
    void reloadLog();
  });

  const connected = !!(token && repo);
  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold">GitHub History (read-only)</div>
          <Button size="sm" variant="outline" className="ml-auto" disabled={!connected || !!busy} onClick={() => void loadTagsReleases()}>
            {busy === "tags" ? "Reading…" : "Read tags & releases"}
          </Button>
        </div>
        {tags ? (
          <div className="grid gap-3 md:grid-cols-2 text-xs">
            <div>
              <div className="label-mono mb-1">Tags ({tags.length})</div>
              <div className="max-h-40 overflow-y-auto font-mono text-[11px]">
                {tags.length ? tags.map((t) => <button key={t.name} className="block hover:text-primary" onClick={() => setRef(t.sha)}>{t.name} · {t.sha.slice(0, 7)}</button>) : <span className="text-muted-foreground">No tags in this repository.</span>}
              </div>
            </div>
            <div>
              <div className="label-mono mb-1">Releases ({rels?.length ?? 0})</div>
              <div className="max-h-40 overflow-y-auto text-[11px]">
                {rels?.length ? rels.map((r) => <a key={r.id} href={r.url} target="_blank" rel="noreferrer" className="block hover:text-primary">{r.name} ({r.tag}){r.draft ? " · draft" : ""}{r.prerelease ? " · pre-release" : ""} · {r.published.slice(0, 10)}</a>) : <span className="text-muted-foreground">No releases in this repository.</span>}
              </div>
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-md" placeholder="Commit SHA or PR number (e.g. #12)" value={ref} disabled={!connected} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ref.trim() && void openRef()} />
          <Button size="sm" disabled={!connected || !ref.trim() || !!busy} onClick={() => void openRef()}>{busy === "diff" ? "Reading…" : "Show diff"}</Button>
          {diff ? <Button size="sm" variant="outline" onClick={() => props.onAsk(`## ${diff.title}\n${diff.md}\n\nReview this change: what it does, risks, and anything that may break.`)}>Send to Admin AI chat</Button> : null}
        </div>
        {diff ? (
          <div>
            <div className="text-xs font-medium">{diff.title}</div>
            <pre className="mt-1 max-h-[420px] overflow-auto rounded bg-muted p-2 text-[11px]">{diff.md}</pre>
          </div>
        ) : null}
      </div>

      <div className="space-y-2 rounded-md border border-border bg-surface p-4">
        <div className="flex items-center gap-2">
          <div className="text-sm font-semibold">Admin AI Action Log</div>
          <span className="label-mono">{actions.length} entries · append-only</span>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void reloadLog()}>Refresh</Button>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="label-mono"><tr><th className="py-1">When</th><th>Action</th><th>Status</th><th>Branch / Commit / PR</th><th>Files</th></tr></thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="border-t border-border align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                  <td className="pr-2 font-mono">{a.action}</td>
                  <td className={`pr-2 ${a.status === "ok" ? "" : "text-destructive"}`}>{a.status}</td>
                  <td className="pr-2 font-mono">{[a.branch, a.commit_sha?.slice(0, 7), a.pr_number ? `#${a.pr_number}` : null, a.snapshot_id ? `snap ${a.snapshot_id.slice(0, 8)}` : null].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="font-mono">{a.files.length ? `${a.files.length}: ${a.files.slice(0, 3).join(", ")}${a.files.length > 3 ? "…" : ""}` : "—"}</td>
                </tr>
              ))}
              {!actions.length ? <tr><td colSpan={5} className="py-2 text-muted-foreground">No actions logged yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
