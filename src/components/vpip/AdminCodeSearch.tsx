import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readFile, type TreeEntry } from "@/lib/vpip/admin-ai";
import { buildGraph, traceImpact, impactMarkdown, type Impact } from "@/lib/vpip/dep-trace";

/** Read-only code search over the connected GitHub repository (Admin AI Stage 1). */
const TEXT_RE = /\.(tsx?|jsx?|mjs|cjs|json|sql|css|md|toml|ya?ml|html)$/i;
const SKIP_RE = /(^|\/)(node_modules|dist|build|\.git|\.lovable)\/|routeTree\.gen\.ts$|lock(file)?\.|bun\.lockb?$/;
type Mode = "text" | "references" | "imports" | "exports" | "definitions" | "functions" | "components" | "routes" | "tables" | "filenames" | "regex";
interface Hit { path: string; line: number; text: string }
interface SearchAudit { query: string; status: "PASS" | "FAIL"; hits: Hit[]; error?: string }

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeSearchRegex(mode: Mode, term: string) {
  if (mode === "regex") return new RegExp(term, "i");
  if (mode === "references") return new RegExp(`\\b${esc(term)}\\b`);
  if (mode === "imports") return new RegExp(`^\\s*import\\b.*(\\b${esc(term)}\\b|["'][^"']*${esc(term)}[^"']*["'])`);
  if (mode === "definitions") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?(function|const|let|class|interface|type|enum)\\s+${esc(term)}\\b`);
  if (mode === "functions") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(async\\s+)?function\\s+${esc(term)}\\b|^\\s*(export\\s+)?(const|let)\\s+${esc(term)}\\s*=\\s*(async\\s*)?\\(`);
  if (mode === "components") return new RegExp(`^\\s*(export\\s+)?(default\\s+)?(function|const)\\s+${esc(term)}\\b`);
  if (mode === "routes") return new RegExp(`createFileRoute\\(\\s*["'][^"']*${esc(term)}[^"']*["']`, "i");
  if (mode === "tables") return new RegExp(`\\b(create\\s+table|from|join|into|update)\\s+[^\\n]*${esc(term)}\\b`, "i");
  if (mode === "exports") return new RegExp(`^\\s*export\\b.*\\b${esc(term)}\\b`);
  return new RegExp(esc(term), "i");
}

function searchRepository(index: Map<string, string>, tree: TreeEntry[], mode: Mode, term: string): Hit[] {
  if (mode === "filenames") return tree.filter((entry) => entry.type === "blob" && entry.path.toLowerCase().includes(term.toLowerCase())).slice(0, 1000).map((entry) => ({ path: entry.path, line: 1, text: "(file name match)" }));
  const re = makeSearchRegex(mode, term);
  const out: Hit[] = [];
  for (const [path, content] of index) {
    content.split("\n").forEach((line, index) => {
      if (out.length < 1000 && re.test(line)) out.push({ path, line: index + 1, text: line.trim().slice(0, 200) });
    });
  }
  return out;
}

export function AdminCodeSearch(props: {
  token: string;
  repo: string;
  branch: string;
  tree: TreeEntry[];
  onOpen: (path: string) => void;
  onAsk?: (markdown: string) => void;
}) {
  const [impact, setImpact] = useState<Impact | null>(null);
  const [target, setTarget] = useState("");
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("text");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searchError, setSearchError] = useState("");
  const [audit, setAudit] = useState<SearchAudit[]>([]);

  const candidates = useMemo(
    () => props.tree.filter((t) => t.type === "blob" && TEXT_RE.test(t.path) && !SKIP_RE.test(t.path) && (t.size ?? 0) < 300_000),
    [props.tree],
  );

  async function buildIndex() {
    const map = new Map<string, string>();
    let done = 0;
    let failed = 0;
    setProgress({ done, total: candidates.length, failed });
    const queue = [...candidates];
    const worker = async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try {
          map.set(f.path, await readFile(props.token, props.repo, props.branch, f.path));
        } catch {
          failed++;
        }
        done++;
        setProgress({ done, total: candidates.length, failed });
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
    setIndex(map);
  }

  function search() {
    const term = q.trim();
    if (!term) return;
    try {
      setSearchError("");
      setHits(searchRepository(index, props.tree, mode, term));
    } catch (error) {
      setHits([]);
      setSearchError(error instanceof Error ? error.message : "Invalid search expression.");
    }
  }

  function runSearchAudit() {
    const queries = ["createFileRoute", "admin-ai", "buildContext", "useEffect"];
    setAudit(queries.map((query) => {
      try {
        const found = searchRepository(index, props.tree, "text", query);
        return { query, status: found.length ? "PASS" : "FAIL", hits: found, error: found.length ? undefined : "No live repository-content matches were returned." };
      } catch (error) {
        return { query, status: "FAIL", hits: [], error: error instanceof Error ? error.message : String(error) };
      }
    }));
  }

  const graph = useMemo(() => (index.size ? buildGraph(index) : null), [index]);
  function trace() {
    if (!graph) return;
    const t = target.trim();
    const match = index.has(t) ? t : [...index.keys()].find((k) => k.endsWith(t));
    if (match) setImpact(traceImpact(graph, index, match));
  }
  const ready = index.size > 0;
  return (
    <div className="space-y-3 rounded-md border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="text-sm font-semibold">Code Search</div>
        <span className="label-mono">
          {ready ? `${index.size} files indexed${progress?.failed ? ` · ${progress.failed} unreadable` : ""}` : `${candidates.length} source files available`}
        </span>
        <Button size="sm" variant="outline" className="ml-auto" disabled={progress !== null && progress.done < progress.total} onClick={() => void buildIndex()}>
          {progress && progress.done < progress.total ? `Reading ${progress.done}/${progress.total}…` : ready ? "Re-read files" : "Read all source files"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <select className="rounded border border-border bg-background px-2 py-1 text-xs" value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
          <option value="text">Search code</option>
          <option value="references">Find references</option>
          <option value="imports">Find imports</option>
          <option value="exports">Find exports</option>
          <option value="definitions">Find symbol definitions</option>
          <option value="functions">Find functions</option>
          <option value="components">Find components</option>
          <option value="routes">Find route definitions</option>
          <option value="tables">Find database tables</option>
          <option value="filenames">Search file names</option>
          <option value="regex">Regex search</option>
        </select>
        <Input className="max-w-md" placeholder={ready ? "Name or text to find" : "Read source files first"} value={q} disabled={!ready} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <Button size="sm" disabled={!ready || !q.trim()} onClick={search}>Search</Button>
      </div>
      {searchError ? <div className="text-xs text-destructive">Search failed: {searchError}</div> : null}
      {hits ? (
        <div className="max-h-[420px] overflow-y-auto font-mono text-[11px]">
          <div className="label-mono mb-1">{hits.length}{hits.length >= 1000 ? "+" : ""} matches in {new Set(hits.map((h) => h.path)).size} files</div>
          {hits.map((h, i) => (
            <button key={i} onClick={() => props.onOpen(h.path)} className="block w-full truncate rounded px-2 py-0.5 text-left hover:bg-muted">
              <span className="text-primary">{h.path}:{h.line}</span> <span className="text-muted-foreground">{h.text}</span>
            </button>
          ))}
        </div>
      ) : null}
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex flex-wrap items-center gap-2"><div className="text-sm font-semibold">Phase 3 — Search Audit</div><Button size="sm" variant="outline" className="ml-auto" disabled={!ready} onClick={runSearchAudit}>Run live search audit</Button></div>
        <p className="text-xs text-muted-foreground">Runs the required queries against the repository files read into this VPIP search index. Results are not manually supplied.</p>
        {audit.map((result) => <details key={result.query} className="rounded border border-border p-2 text-xs" open>
          <summary className="cursor-pointer"><b className={result.status === "PASS" ? "text-primary" : "text-destructive"}>{result.status}</b> · Query: <code>{result.query}</code> · {result.hits.length}{result.hits.length >= 1000 ? "+" : ""} matches · {new Set(result.hits.map((hit) => hit.path)).size} files</summary>
          {result.error ? <div className="mt-1 text-destructive">Evidence: {result.error}</div> : <div className="mt-1 max-h-48 overflow-auto font-mono text-[11px]">{result.hits.map((hit, index) => <button key={index} onClick={() => props.onOpen(hit.path)} className="block text-left hover:text-primary">{hit.path}:{hit.line} · {hit.text}</button>)}</div>}
        </details>)}
      </div>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="text-sm font-semibold">Dependency Tracing — "If I change this file, what breaks?"</div>
        <div className="flex flex-wrap gap-2">
          <Input className="max-w-md" list="dep-files" placeholder={ready ? "File path, e.g. src/lib/vpip/db.ts" : "Read source files first"} value={target} disabled={!ready} onChange={(e) => setTarget(e.target.value)} onKeyDown={(e) => e.key === "Enter" && trace()} />
          <datalist id="dep-files">{[...index.keys()].slice(0, 2000).map((k) => <option key={k} value={k} />)}</datalist>
          <Button size="sm" disabled={!ready || !target.trim()} onClick={trace}>Trace impact</Button>
          {impact && props.onAsk ? <Button size="sm" variant="outline" onClick={() => props.onAsk!(impactMarkdown(impact))}>Send to Admin AI chat</Button> : null}
        </div>
        {impact ? (
          <div className="space-y-2 text-xs">
            <div><span className="label-mono">Risk</span> <b className={impact.risk === "Low" ? "" : "text-destructive"}>{impact.risk}</b> — {impact.reason}</div>
            {([["Directly imported by", impact.direct], ["Affected pages/routes", impact.routes], ["Affected server/API files", impact.apis], ["Affected components", impact.components], ["Database objects", impact.dbObjects], ["Exports", impact.exports], ["Imports", impact.imports], ["Packages", impact.packages]] as const).map(([label, arr]) => (
              <div key={label}>
                <div className="label-mono">{label} ({arr.length})</div>
                <div className="flex flex-wrap gap-1 font-mono text-[11px]">
                  {arr.length ? arr.map((x) => <button key={x} className="rounded bg-muted px-1.5 py-0.5 hover:text-primary" onClick={() => index.has(x) && props.onOpen(x)}>{x}</button>) : <span className="text-muted-foreground">none</span>}
                </div>
              </div>
            ))}
            <div className="label-mono">All affected files ({impact.transitive.length})</div>
            <div className="max-h-48 overflow-y-auto font-mono text-[11px]">
              {impact.transitive.map((t) => <button key={t.path} className="block hover:text-primary" onClick={() => props.onOpen(t.path)}>depth {t.depth} · {t.path}</button>)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
