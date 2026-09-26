import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { readFile, type TreeEntry } from "@/lib/vpip/admin-ai";
import { buildGraph, traceImpact, impactMarkdown, type DepGraph, type Impact } from "@/lib/vpip/dep-trace";

/** Search Center: live search, history, statistics, dependency graph and impact over real repository files. */
const TEXT_RE = /\.(tsx?|jsx?|mjs|cjs|json|sql|css|md|toml|ya?ml|html)$/i;
const SKIP_RE = /(^|\/)(node_modules|dist|build|\.git|\.lovable)\/|routeTree\.gen\.ts$|lock(file)?\.|bun\.lockb?$/;
type Mode = "text" | "symbol" | "imports" | "exports" | "routes" | "filenames" | "references" | "functions" | "components" | "tables" | "regex";
const MODE_LABEL: Record<Mode, string> = {
  text: "Text Search", symbol: "Symbol Search", imports: "Import Search", exports: "Export Search", routes: "Route Search",
  filenames: "File Name Search", references: "Find references", functions: "Find functions", components: "Find components",
  tables: "Find database tables", regex: "Regex search",
};
interface Hit { path: string; line: number; text: string; matchType: string }
interface RunInfo { term: string; mode: Mode; hits: Hit[]; ms: number; at: string }
interface Check { capability: string; status: "PASS" | "FAIL"; evidence: string; source: string }
interface HistoryRow { id: string; term: string; search_type: string; user_label: string; result_count: number; files_matched: number; duration_ms: number; created_at: string }
type EdgeType = "import" | "route registration" | "component reference" | "service reference" | "hook reference";
interface Edge { parent: string; child: string; type: EdgeType }

function esc(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function makeRegex(mode: Mode, term: string) {
  if (mode === "regex") return new RegExp(term, "i");
  if (mode === "references") return new RegExp(`\\b${esc(term)}\\b`);
  if (mode === "imports") return new RegExp(`^\\s*import\\b.*(\\b${esc(term)}\\b|["'][^"']*${esc(term)}[^"']*["'])`);
  if (mode === "symbol") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function|const|let|class|interface|type|enum)\\s+${esc(term)}\\b`);
  if (mode === "functions") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${esc(term)}\\b|^\\s*(export\\s+)?(const|let)\\s+${esc(term)}\\s*=\\s*(async\\s*)?\\(`);
  if (mode === "components") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(function|const)\\s+${esc(term)}\\b`);
  if (mode === "routes") return new RegExp(`createFileRoute\\(\\s*["'][^"']*${esc(term)}[^"']*["']`, "i");
  if (mode === "tables") return new RegExp(`\\b(create\\s+table|from|join|into|update)\\s+[^\\n]*${esc(term)}\\b`, "i");
  if (mode === "exports") return new RegExp(`^\\s*export\\b.*\\b${esc(term)}\\b`);
  return new RegExp(esc(term), "i");
}

function runSearch(index: Map<string, string>, tree: TreeEntry[], mode: Mode, term: string): Hit[] {
  if (mode === "filenames") return tree.filter((e) => e.type === "blob" && e.path.toLowerCase().includes(term.toLowerCase())).slice(0, 1000).map((e) => ({ path: e.path, line: 1, text: e.path, matchType: "file name" }));
  const re = makeRegex(mode, term);
  const out: Hit[] = [];
  for (const [path, content] of index) {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length && out.length < 1000; i++) if (re.test(lines[i]!)) out.push({ path, line: i + 1, text: lines[i]!.trim().slice(0, 240), matchType: MODE_LABEL[mode] });
  }
  return out;
}

const isHook = (p: string) => /(^|\/)(hooks\/|use[A-Z][\w-]*\.tsx?$)/.test(p);
const isComponent = (p: string) => p.startsWith("src/components/");
const isService = (p: string) => p.startsWith("src/lib/") || p.includes("/services/") || /\.(server|functions)\.tsx?$/.test(p);
const isRoute = (p: string) => p.startsWith("src/routes/") && !p.endsWith(".gen.ts");

function buildEdges(g: DepGraph): Edge[] {
  const edges: Edge[] = [];
  for (const [parent, children] of g.imports) for (const child of children) {
    const type: EdgeType = isRoute(parent) && child.startsWith("src/routes/") ? "route registration" : isHook(child) ? "hook reference" : isComponent(child) ? "component reference" : isService(child) ? "service reference" : "import";
    edges.push({ parent, child, type });
  }
  return edges;
}

function indirectDeps(g: DepGraph, target: string) {
  const direct = new Set(g.imports.get(target) ?? []);
  const seen = new Set<string>();
  const queue = [...direct];
  while (queue.length) {
    const p = queue.shift()!;
    for (const q of g.imports.get(p) ?? []) if (!seen.has(q) && !direct.has(q) && q !== target) { seen.add(q); queue.push(q); }
  }
  return [...seen].sort();
}

function apiRefs(content: string) {
  return [...new Set([...content.matchAll(/fetch\(\s*[`"']([^`"']+)[`"']|createServerFn\b|["'`](\/api\/[\w\-/.$]+)["'`]/g)].map((m) => m[1] ?? m[2] ?? "createServerFn"))];
}

export function AdminCodeSearch(props: {
  token: string; repo: string; branch: string; tree: TreeEntry[];
  onOpen: (path: string) => void; onAsk?: (markdown: string) => void;
}) {
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [indexError, setIndexError] = useState("");
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("text");
  const [run, setRun] = useState<RunInfo | null>(null);
  const [searchError, setSearchError] = useState("");
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyError, setHistoryError] = useState("");
  const [viewer, setViewer] = useState<{ path: string; line: number; term: string } | null>(null);
  const [target, setTarget] = useState("");
  const [impact, setImpact] = useState<Impact | null>(null);
  const [searchAudit, setSearchAudit] = useState<Check[] | null>(null);
  const [depAudit, setDepAudit] = useState<Check[] | null>(null);

  const candidates = useMemo(() => props.tree.filter((t) => t.type === "blob" && TEXT_RE.test(t.path) && !SKIP_RE.test(t.path) && (t.size ?? 0) < 300_000), [props.tree]);
  const ready = index.size > 0;
  const indexing = progress !== null && progress.done < progress.total;
  const repoLabel = `${props.repo}@${props.branch}`;

  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.from("vpip_search_history").select("*").order("created_at", { ascending: false }).limit(200);
    if (error) setHistoryError(error.message); else { setHistoryError(""); setHistory((data ?? []) as HistoryRow[]); }
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  async function buildIndex() {
    const map = new Map<string, string>();
    let done = 0, failed = 0;
    setIndexError("");
    setProgress({ done, total: candidates.length, failed });
    const queue = [...candidates];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try { map.set(f.path, await readFile(props.token, props.repo, props.branch, f.path)); } catch { failed++; }
        done++; setProgress({ done, total: candidates.length, failed });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    if (!map.size) setIndexError(`No files could be read from ${repoLabel} (${failed} failed).`);
    setIndex(map);
  }

  async function search() {
    const term = q.trim();
    if (!term || !ready) return;
    const t0 = performance.now();
    let hits: Hit[] = [];
    try { setSearchError(""); hits = runSearch(index, props.tree, mode, term); } catch (e) { setSearchError(e instanceof Error ? e.message : "Invalid search expression."); }
    const ms = Math.round(performance.now() - t0);
    const at = new Date().toISOString();
    setRun({ term, mode, hits, ms, at });
    const { error } = await supabase.from("vpip_search_history").insert({ term, search_type: MODE_LABEL[mode], user_label: "owner", repository: props.repo, branch: props.branch, result_count: hits.length, files_matched: new Set(hits.map((h) => h.path)).size, duration_ms: ms });
    if (error) setHistoryError(`History save failed: ${error.message}`);
    void loadHistory();
  }

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const t = history.filter((h) => h.created_at.slice(0, 10) === today);
    return { executed: history.length, today: t.length, matchesToday: t.reduce((s, h) => s + h.result_count, 0), last: history[0]?.created_at ?? null };
  }, [history]);

  const graph = useMemo(() => (ready ? buildGraph(index) : null), [index, ready]);
  const edges = useMemo(() => (graph ? buildEdges(graph) : []), [graph]);

  function resolveTarget(t: string) { return index.has(t) ? t : [...index.keys()].find((k) => k.endsWith(t)); }
  function trace(path?: string) {
    if (!graph) return;
    const m = resolveTarget((path ?? target).trim());
    if (m) { setTarget(m); setImpact(traceImpact(graph, index, m)); }
  }

  function runSearchAuditNow() {
    const src = `${repoLabel} · ${index.size} indexed files`;
    const probe = (capability: string, m: Mode, term: string): Check => {
      try {
        const h = runSearch(index, props.tree, m, term);
        return h.length ? { capability, status: "PASS", evidence: `"${term}" → ${h.length} matches; first: ${h[0]!.path}:${h[0]!.line} "${h[0]!.text.slice(0, 80)}"`, source: src } : { capability, status: "FAIL", evidence: `"${term}" returned 0 matches.`, source: src };
      } catch (e) { return { capability, status: "FAIL", evidence: e instanceof Error ? e.message : String(e), source: src }; }
    };
    // Derive probe terms from real repository content (no hardcoded answers).
    const firstExport = graph ? [...graph.exports.values()].flat()[0] : undefined;
    const firstImportPkg = graph ? [...graph.packages.values()].flat()[0] : undefined;
    const routeFile = [...index.entries()].find(([, c]) => /createFileRoute\(\s*["']([^"']+)["']/.test(c));
    const routeTerm = routeFile ? /createFileRoute\(\s*["']([^"']+)["']/.exec(routeFile[1])![1]! : undefined;
    const someFile = [...index.keys()][0];
    const fileWord = someFile ? someFile.split("/").pop()!.replace(/\.\w+$/, "") : undefined;
    const miss = (capability: string, why: string): Check => ({ capability, status: "FAIL", evidence: why, source: src });
    setSearchAudit([
      ready ? { capability: "Repository Indexed", status: "PASS", evidence: `${index.size} of ${candidates.length} source files read${progress?.failed ? `, ${progress.failed} unreadable` : ""}`, source: repoLabel } : miss("Repository Indexed", "No files indexed."),
      ready ? { capability: "Search Engine Available", status: "PASS", evidence: "In-browser regex engine over indexed content", source: src } : miss("Search Engine Available", "Index empty."),
      probe("File Search Working", "text", "import"),
      firstExport ? probe("Symbol Search Working", "symbol", firstExport) : miss("Symbol Search Working", "No exported symbol found in repository."),
      firstImportPkg ? probe("Import Search Working", "imports", firstImportPkg) : miss("Import Search Working", "No import statements found."),
      firstExport ? probe("Export Search Working", "exports", firstExport) : miss("Export Search Working", "No exports found."),
      routeTerm ? probe("Route Search Working", "routes", routeTerm) : miss("Route Search Working", "No createFileRoute definitions found."),
      fileWord ? probe("Filename Search Working", "filenames", fileWord) : miss("Filename Search Working", "Tree empty."),
    ]);
  }

  function runDepAuditNow() {
    const src = `${repoLabel} · live import graph`;
    if (!graph) { setDepAudit([{ capability: "Dependency Graph Built", status: "FAIL", evidence: "Source files not indexed.", source: repoLabel }]); return; }
    const nodes = graph.imports.size;
    const importEdges = edges.length;
    const exportCount = [...graph.exports.values()].reduce((s, a) => s + a.length, 0);
    const routeFiles = [...index.keys()].filter((p) => p.startsWith("src/routes/") && /createFileRoute/.test(index.get(p)!));
    const t = [...graph.importedBy.entries()].sort((a, b) => b[1].length - a[1].length)[0]?.[0];
    const imp = t ? traceImpact(graph, index, t) : null;
    const c = (capability: string, ok: boolean, evidence: string): Check => ({ capability, status: ok ? "PASS" : "FAIL", evidence, source: src });
    setDepAudit([
      c("Dependency Graph Built", nodes > 0, `${nodes} code files, ${importEdges} internal edges`),
      c("Import Analysis Working", importEdges > 0, importEdges ? `e.g. ${edges[0]!.parent} → ${edges[0]!.child} (${edges[0]!.type})` : "No internal imports resolved."),
      c("Export Analysis Working", exportCount > 0, `${exportCount} exported symbols detected`),
      c("Route Analysis Working", routeFiles.length > 0, routeFiles.length ? `${routeFiles.length} route files, e.g. ${routeFiles[0]}` : "No route files found."),
      c("Impact Analysis Working", !!imp, imp ? `${imp.target}: ${imp.transitive.length} affected, risk ${imp.risk} (${imp.riskScore}/100)` : "No file has dependents."),
      c("Dependency Tracing Working", !!imp && imp.direct.length > 0, imp ? `${imp.direct.length} direct importers of ${imp.target}` : "No trace possible."),
    ]);
  }

  const files = run ? new Set(run.hits.map((h) => h.path)).size : 0;
  const deps = impact && graph ? { direct: impact.imports, indirect: indirectDeps(graph, impact.target), hooks: [...new Set([...impact.imports, ...impact.transitive.map((t) => t.path)])].filter(isHook), api: apiRefs(index.get(impact.target) ?? "") } : null;

  return (
    <div className="space-y-4 rounded-md border border-border bg-surface p-4">
      {/* Ingestion + statistics */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">Search Center</div>
        <span className="label-mono">{repoLabel}</span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={indexing} onClick={() => void buildIndex()}>
          {indexing ? `Reading ${progress!.done}/${progress!.total}…` : ready ? "Re-read files" : "Read All Source Files"}
        </Button>
      </div>
      {indexError ? <div className="text-xs text-destructive">FAIL: {indexError}</div> : null}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        {([
          ["Files Indexed", ready ? `${index.size}` : "0"],
          ["Searches Executed", `${stats.executed}`],
          ["Searches Today", `${stats.today}`],
          ["Matches Found Today", `${stats.matchesToday}`],
          ["Last Search Time", stats.last ? new Date(stats.last).toLocaleString() : "never"],
          ["Index Status", indexing ? "Indexing" : ready ? `Ready${progress?.failed ? ` (${progress.failed} unreadable)` : ""}` : "Not indexed"],
        ] as const).map(([l, v]) => <div key={l} className="rounded border border-border p-2"><div className="label-mono">{l}</div><div className="text-sm font-semibold">{v}</div></div>)}
      </div>

      {/* Search */}
      {!ready ? <div className="rounded border border-border bg-muted p-2 text-xs">Repository source files must be read before search is available.</div> : null}
      <div className="flex flex-wrap gap-2">
        <select aria-label="Search type" className="rounded border border-border bg-background px-2 py-1 text-xs" value={mode} disabled={!ready} onChange={(e) => setMode(e.target.value as Mode)}>
          {(Object.keys(MODE_LABEL) as Mode[]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
        <Input className="max-w-md" placeholder={ready ? "Name or text to find" : "Read source files first"} value={q} disabled={!ready} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void search()} />
        <Button size="sm" disabled={!ready || !q.trim()} onClick={() => void search()}>Search</Button>
      </div>
      {searchError ? <div className="text-xs text-destructive">FAIL: {searchError}</div> : null}
      {run ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-3 text-xs">
            <span><span className="label-mono">Term</span> <code>{run.term}</code></span>
            <span><span className="label-mono">Type</span> {MODE_LABEL[run.mode]}</span>
            <span><span className="label-mono">Matches</span> {run.hits.length}{run.hits.length >= 1000 ? "+" : ""}</span>
            <span><span className="label-mono">Files</span> {files}</span>
            <span><span className="label-mono">Time</span> {run.ms} ms</span>
          </div>
          {!run.hits.length ? <div className="text-xs text-destructive">FAIL: no matches in {index.size} indexed files.</div> : null}
          <div className="max-h-[360px] overflow-y-auto rounded border border-border">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-surface"><tr className="text-left"><th className="p-1">File</th><th className="p-1">Line</th><th className="p-1">Evidence</th><th className="p-1">Match</th><th className="p-1"></th></tr></thead>
              <tbody>
                {run.hits.map((h, i) => (
                  <tr key={i} className="border-t border-border align-top" title={`Source: ${repoLabel} · ${run.at}`}>
                    <td className="p-1 font-mono text-primary">{h.path}</td>
                    <td className="p-1 font-mono">{h.line}</td>
                    <td className="p-1 font-mono text-muted-foreground">"{h.text}"</td>
                    <td className="p-1">{h.matchType}</td>
                    <td className="p-1"><Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={() => setViewer({ path: h.path, line: h.line, term: run.mode === "filenames" ? "" : run.term })}>Open</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="label-mono">Evidence source: {repoLabel} · searched {new Date(run.at).toLocaleString()}</div>
        </div>
      ) : null}

      {viewer ? <FileViewer path={viewer.path} line={viewer.line} term={viewer.term} content={index.get(viewer.path)} onClose={() => setViewer(null)} onExternal={() => props.onOpen(viewer.path)} onTrace={() => trace(viewer.path)} /> : null}

      {/* History */}
      <details className="border-t border-border pt-3" open>
        <summary className="cursor-pointer text-sm font-semibold">Search History ({history.length})</summary>
        {historyError ? <div className="text-xs text-destructive">FAIL: {historyError}</div> : null}
        <div className="mt-2 max-h-56 overflow-auto text-[11px]">
          {history.length ? history.map((h) => (
            <button key={h.id} className="flex w-full gap-3 rounded px-1 py-0.5 text-left hover:bg-muted" onClick={() => { const m = (Object.keys(MODE_LABEL) as Mode[]).find((k) => MODE_LABEL[k] === h.search_type); if (m) setMode(m); setQ(h.term); }}>
              <span className="w-36 shrink-0 text-muted-foreground">{new Date(h.created_at).toLocaleString()}</span>
              <code className="truncate">{h.term}</code>
              <span className="text-muted-foreground">{h.search_type}</span>
              <span className="ml-auto">{h.result_count} results · {h.user_label}</span>
            </button>
          )) : <div className="text-muted-foreground">No searches recorded yet.</div>}
        </div>
      </details>

      {/* Dependency + impact */}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-semibold">Dependency Tracing & Impact — "If I change this file, what breaks?"</div>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-md" list="dep-files" placeholder={ready ? "File path, e.g. src/lib/vpip/db.ts" : "Read source files first"} value={target} disabled={!ready} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && trace()} />
          <datalist id="dep-files">{[...index.keys()].slice(0, 2000).map((k) => <option key={k} value={k} />)}</datalist>
          <Button size="sm" disabled={!ready || !target.trim()} onClick={() => trace()}>Trace impact</Button>
          {impact && props.onAsk ? <Button size="sm" variant="outline" onClick={() => props.onAsk!(impactMarkdown(impact))}>Send to Admin AI chat</Button> : null}
        </div>
        {target.trim() && ready && !resolveTarget(target.trim()) ? <div className="text-xs text-destructive">FAIL: file not in index.</div> : null}
        {impact && deps ? (
          <div className="space-y-2 text-xs">
            <div><span className="label-mono">Selected file</span> <span className="font-mono">{impact.target}</span></div>
            <div><span className="label-mono">Risk</span> <b className={impact.risk === "Low" ? "" : "text-destructive"}>{impact.risk} ({impact.riskScore}/100)</b> — {impact.reason}</div>
            {([
              ["Direct dependencies", deps.direct], ["Indirect dependencies", deps.indirect], ["Exports", impact.exports], ["Packages", impact.packages],
              ["Directly affected files", impact.direct], ["Indirectly affected files", impact.transitive.filter((t) => t.depth > 1).map((t) => t.path)],
              ["Affected pages / routes", impact.routes], ["Affected components", impact.components], ["Hooks", deps.hooks], ["Services", impact.services],
              ["Affected APIs", impact.apis], ["API references in file", deps.api], ["Database calls", impact.dbObjects],
            ] as const).map(([label, arr]) => (
              <div key={label}>
                <div className="label-mono">{label} ({arr.length})</div>
                <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                  {arr.length ? arr.map((x) => <button key={x} className="rounded bg-muted px-1.5 py-0.5 hover:text-primary" onClick={() => index.has(x) && setViewer({ path: x, line: 1, term: "" })}>{x}</button>) : <span className="text-muted-foreground">none</span>}
                </div>
              </div>
            ))}
            <div className="label-mono">Dependency graph edges for this file</div>
            <div className="max-h-48 overflow-auto font-mono text-[11px]">
              {edges.filter((e) => e.parent === impact.target || e.child === impact.target).map((e, i) => <div key={i}>{e.parent} → {e.child} <span className="text-muted-foreground">[{e.type}]</span></div>)}
            </div>
            <div className="label-mono">Circular dependencies ({impact.cycles.length})</div>
            <div className="font-mono text-[11px]">{impact.cycles.length ? impact.cycles.map((c) => c.join(" → ")).join("\n") : "none"}</div>
          </div>
        ) : null}
        {graph ? (
          <details className="text-xs">
            <summary className="cursor-pointer">Full repository dependency graph ({edges.length} edges)</summary>
            <div className="mt-1 max-h-64 overflow-auto font-mono text-[11px]">{edges.slice(0, 3000).map((e, i) => <div key={i}>{e.parent} → {e.child} <span className="text-muted-foreground">[{e.type}]</span></div>)}</div>
          </details>
        ) : null}
      </div>

      <AuditBlock title="Search Audit Report" button="Run live search audit" disabled={!ready} onRun={runSearchAuditNow} rows={searchAudit} />
      <AuditBlock title="Dependency Audit Report" button="Run live dependency audit" disabled={!ready} onRun={runDepAuditNow} rows={depAudit} />
    </div>
  );
}

function AuditBlock(p: { title: string; button: string; disabled: boolean; onRun: () => void; rows: Check[] | null }) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="flex items-center gap-2"><div className="text-sm font-semibold">{p.title}</div><Button size="sm" variant="outline" className="ml-auto" disabled={p.disabled} onClick={p.onRun}>{p.button}</Button></div>
      {p.rows ? (
        <table className="w-full text-[11px]">
          <thead><tr className="text-left"><th className="p-1">Capability</th><th className="p-1">Status</th><th className="p-1">Evidence</th><th className="p-1">Source</th></tr></thead>
          <tbody>{p.rows.map((r) => <tr key={r.capability} className="border-t border-border align-top"><td className="p-1">{r.capability}</td><td className={`p-1 font-bold ${r.status === "PASS" ? "text-primary" : "text-destructive"}`}>{r.status}</td><td className="p-1 font-mono">{r.evidence}</td><td className="p-1 text-muted-foreground">{r.source}</td></tr>)}</tbody>
        </table>
      ) : <div className="text-xs text-muted-foreground">{p.disabled ? "Read source files first." : "Not run yet."}</div>}
    </div>
  );
}

function FileViewer(p: { path: string; line: number; term: string; content: string | undefined; onClose: () => void; onExternal: () => void; onTrace: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.querySelector(`[data-line="${p.line}"]`)?.scrollIntoView({ block: "center" }); }, [p.path, p.line]);
  const lines = p.content?.split("\n") ?? [];
  const re = p.term ? new RegExp(`(${esc(p.term)})`, "ig") : null;
  return (
    <div className="rounded border border-border">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1">
        <span className="truncate font-mono text-xs">{p.path}:{p.line}</span>
        <Button size="sm" variant="outline" className="ml-auto h-6 text-[10px]" onClick={p.onTrace}>Trace impact</Button>
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={p.onExternal}>Open in Explorer</Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={p.onClose}>Close</Button>
      </div>
      {p.content === undefined ? <div className="p-2 text-xs text-destructive">FAIL: file content not in index (not a readable source file).</div> : (
        <div ref={ref} className="max-h-[420px] overflow-auto font-mono text-[11px] leading-relaxed">
          {lines.map((l, i) => (
            <div key={i} data-line={i + 1} className={`flex ${i + 1 === p.line ? "bg-accent" : ""}`}>
              <span className="w-12 shrink-0 select-none pr-2 text-right text-muted-foreground">{i + 1}</span>
              <span className="whitespace-pre">{re && i + 1 === p.line ? l.split(re).map((s, j) => (j % 2 ? <mark key={j} className="bg-primary text-primary-foreground">{s}</mark> : s)) : l}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
