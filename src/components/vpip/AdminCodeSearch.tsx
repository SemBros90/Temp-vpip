import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { readFile, type TreeEntry } from "@/lib/vpip/admin-ai";

/** Read-only code search over the connected GitHub repository (Admin AI Stage 1). */
const TEXT_RE = /\.(tsx?|jsx?|mjs|cjs|json|sql|css|md|toml|ya?ml|html)$/i;
const SKIP_RE = /(^|\/)(node_modules|dist|build|\.git|\.lovable)\/|routeTree\.gen\.ts$|lock(file)?\.|bun\.lockb?$/;
type Mode = "text" | "references" | "imports" | "exports";
interface Hit { path: string; line: number; text: string }

function esc(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function AdminCodeSearch(props: {
  token: string;
  repo: string;
  branch: string;
  tree: TreeEntry[];
  onOpen: (path: string) => void;
}) {
  const [index, setIndex] = useState<Map<string, string>>(new Map());
  const [progress, setProgress] = useState<{ done: number; total: number; failed: number } | null>(null);
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("text");
  const [hits, setHits] = useState<Hit[] | null>(null);

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
    const re =
      mode === "references" ? new RegExp(`\\b${esc(term)}\\b`) :
      mode === "imports" ? new RegExp(`^\\s*import\\b.*(\\b${esc(term)}\\b|["'][^"']*${esc(term)}[^"']*["'])`) :
      mode === "exports" ? new RegExp(`^\\s*export\\b.*\\b${esc(term)}\\b`) :
      new RegExp(esc(term), "i");
    const out: Hit[] = [];
    for (const [path, content] of index) {
      const lines = content.split("\n");
      lines.forEach((l, i) => {
        if (out.length < 1000 && re.test(l)) out.push({ path, line: i + 1, text: l.trim().slice(0, 200) });
      });
    }
    setHits(out);
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
        </select>
        <Input className="max-w-md" placeholder={ready ? "Name or text to find" : "Read source files first"} value={q} disabled={!ready} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && search()} />
        <Button size="sm" disabled={!ready || !q.trim()} onClick={search}>Search</Button>
      </div>
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
    </div>
  );
}
