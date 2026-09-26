import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tag } from "@/components/vpip/common";
import { readFile, type TreeEntry } from "@/lib/vpip/admin-ai";
import { buildGraph, traceImpact } from "@/lib/vpip/dep-trace";
import { classifyFile, moduleOf, fileOwnership, type FileClass, type Ownership } from "@/lib/vpip/repo-map";

const SRC_RE = /\.(tsx?|jsx?|mjs|cjs|sql)$/;

async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  const q = [...items];
  await Promise.all(Array.from({ length: n }, async () => { for (let t = q.shift(); t !== undefined; t = q.shift()) await fn(t); }));
}

export function AdminRepoInsights(props: { token: string; repo: string; branch: string; tree: TreeEntry[]; selected: string | null; onOpen: (p: string) => void }) {
  const blobs = useMemo(() => props.tree.filter((t) => t.type === "blob"), [props.tree]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [own, setOwn] = useState<Record<string, Ownership>>({});
  const [ownBusy, setOwnBusy] = useState<string>("");
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  const [idxBusy, setIdxBusy] = useState("");

  const classCounts = useMemo(() => {
    const m = new Map<FileClass, number>();
    for (const b of blobs) m.set(classifyFile(b.path), (m.get(classifyFile(b.path)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [blobs]);

  const modules = useMemo(() => {
    const top = new Map<string, Map<string, string[]>>();
    for (const b of blobs) {
      const [t, s] = moduleOf(b.path);
      if (!top.has(t)) top.set(t, new Map());
      const sub = top.get(t)!;
      sub.set(s, [...(sub.get(s) ?? []), b.path]);
    }
    return top;
  }, [blobs]);

  const stats = (paths: string[]) => {
    const folders = new Set(paths.map((p) => p.split("/").slice(0, -1).join("/")).filter(Boolean));
    const known = paths.map((p) => own[p]).filter(Boolean) as Ownership[];
    const last = known.map((o) => o.lastDate).sort().pop();
    const people = new Set(known.flatMap((o) => o.contributors));
    return { files: paths.length, folders: folders.size, last: last ? last.slice(0, 10) : known.length ? "—" : "load ownership", contributors: known.length ? people.size : "—", coverage: `${known.length}/${paths.length}` };
  };

  const loadOwnership = async (paths: string[]) => {
    setOwnBusy(`0/${paths.length}`);
    let done = 0;
    try {
      await pool(paths.filter((p) => !own[p]), 6, async (p) => {
        try { const o = await fileOwnership(props.token, props.repo, props.branch, p); setOwn((m) => ({ ...m, [p]: o })); } catch { /* skip */ }
        setOwnBusy(`${++done}/${paths.length}`);
      });
    } finally { setOwnBusy(""); }
  };

  const buildIndex = async () => {
    const src = blobs.filter((b) => SRC_RE.test(b.path) && (b.size ?? 0) < 300_000);
    const m = new Map<string, string>(); let done = 0;
    setIdxBusy(`0/${src.length}`);
    try {
      await pool(src, 8, async (b) => { try { m.set(b.path, await readFile(props.token, props.repo, props.branch, b.path)); } catch { /* skip */ } setIdxBusy(`${++done}/${src.length}`); });
      setIndex(m);
    } finally { setIdxBusy(""); }
  };

  const graph = useMemo(() => (index.size ? buildGraph(index) : null), [index]);
  const rel = useMemo(() => (graph && props.selected && index.has(props.selected) ? traceImpact(graph, index, props.selected) : null), [graph, index, props.selected]);
  const sel = props.selected;
  const selOwn = sel ? own[sel] : undefined;

  const Links = ({ title, rows }: { title: string; rows: string[] }) => (
    <div><div className="label-mono mb-1">{title} ({rows.length})</div>
      {rows.length ? rows.slice(0, 40).map((r) => <button key={r} onClick={() => props.onOpen(r)} className="block w-full truncate text-left font-mono text-[11px] hover:underline">{r}</button>) : <div className="text-[11px] text-muted-foreground">none</div>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="mb-1 text-sm font-semibold">File Classification</div>
        <p className="mb-2 text-xs text-muted-foreground">Automatic, path-based. Shown beside each file in the list above.</p>
        <div className="flex flex-wrap gap-2">{classCounts.map(([c, n]) => <Tag key={c}>{c}: {n}</Tag>)}</div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-md border border-border bg-surface p-4">
          <div className="mb-2 flex items-center gap-2"><div className="text-sm font-semibold">Visual Repository Map & Modules</div>
            <Button className="ml-auto" size="sm" variant="outline" disabled={!!ownBusy} onClick={() => void loadOwnership(blobs.map((b) => b.path))}>{ownBusy ? `Reading history ${ownBusy}` : "Load ownership (all files)"}</Button></div>
          <div className="font-mono text-[11px]">
            <div className="font-semibold">{props.repo}</div>
            {[...modules.entries()].map(([top, subs], i, arr) => {
              const allPaths = [...subs.values()].flat(); const s = stats(allPaths); const k = top;
              return (
                <div key={top}>
                  <button onClick={() => setOpen((o) => ({ ...o, [k]: !o[k] }))} className="w-full text-left hover:bg-muted">
                    {i === arr.length - 1 ? "└── " : "├── "}{open[k] ? "▾" : "▸"} {top} <span className="text-muted-foreground">· {s.files} files · {s.folders} folders · updated {s.last} · {s.contributors} contributors</span>
                  </button>
                  {open[k] ? [...subs.entries()].map(([sub, paths]) => {
                    const ss = stats(paths); const kk = `${top}/${sub}`;
                    return (
                      <div key={sub} className="pl-6">
                        <button onClick={() => setOpen((o) => ({ ...o, [kk]: !o[kk] }))} className="w-full text-left hover:bg-muted">{open[kk] ? "▾" : "▸"} {sub} <span className="text-muted-foreground">· {ss.files} files · {ss.folders} folders · {ss.last} · {ss.contributors} contrib.</span></button>
                        {open[kk] ? <div className="pl-5">{paths.map((p) => <button key={p} onClick={() => props.onOpen(p)} className="block w-full truncate text-left text-muted-foreground hover:text-foreground">{p}</button>)}</div> : null}
                      </div>
                    );
                  }) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-md border border-border bg-surface p-4">
            <div className="mb-2 flex items-center gap-2"><div className="text-sm font-semibold">Ownership</div>
              {sel ? <Button className="ml-auto" size="sm" variant="outline" disabled={!!ownBusy} onClick={() => void loadOwnership([sel])}>Read history</Button> : null}</div>
            {!sel ? <div className="text-xs text-muted-foreground">Select a file.</div> : selOwn ? (
              <table className="w-full text-xs"><tbody>
                <tr><td className="label-mono py-1">File</td><td className="font-mono">{sel}</td></tr>
                <tr><td className="label-mono py-1">Last contributor</td><td>{selOwn.lastContributor}</td></tr>
                <tr><td className="label-mono py-1">Last commit</td><td className="font-mono">{selOwn.lastSha.slice(0, 7) || "—"}</td></tr>
                <tr><td className="label-mono py-1">Last modified</td><td>{selOwn.lastDate ? new Date(selOwn.lastDate).toLocaleString() : "—"}</td></tr>
                <tr><td className="label-mono py-1">Total commits</td><td>{selOwn.commits}{selOwn.commits >= 500 ? "+" : ""}</td></tr>
                <tr><td className="label-mono py-1">Contributors</td><td>{selOwn.contributors.join(", ")}</td></tr>
              </tbody></table>
            ) : <div className="text-xs text-muted-foreground">{sel} · click "Read history" to fetch from GitHub.</div>}
          </div>

          <div className="rounded-md border border-border bg-surface p-4">
            <div className="mb-2 flex items-center gap-2"><div className="text-sm font-semibold">File Relationships</div>
              <Button className="ml-auto" size="sm" variant="outline" disabled={!!idxBusy} onClick={() => void buildIndex()}>{idxBusy ? `Indexing ${idxBusy}` : index.size ? `Re-index (${index.size})` : "Analyze relationships"}</Button></div>
            {!sel ? <div className="text-xs text-muted-foreground">Select a file.</div> : !graph ? <div className="text-xs text-muted-foreground">Read-only analysis: click "Analyze relationships" to index source files.</div> : !rel ? <div className="text-xs text-muted-foreground">{sel} is not a source file in the index.</div> : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Links title="Imports" rows={rel.imports} />
                <Links title="Imported by" rows={rel.direct} />
                <Links title="Related routes" rows={rel.routes} />
                <Links title="Related APIs" rows={rel.apis} />
                <div><div className="label-mono mb-1">Database objects ({rel.dbObjects.length})</div><div className="font-mono text-[11px]">{rel.dbObjects.slice(0, 40).join(", ") || "none"}</div></div>
                <div><div className="label-mono mb-1">Packages ({rel.packages.length})</div><div className="font-mono text-[11px]">{rel.packages.join(", ") || "none"}</div></div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
