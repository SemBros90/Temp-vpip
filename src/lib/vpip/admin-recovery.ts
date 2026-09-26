/**
 * Admin AI recovery layer: snapshot history, stable releases, comparison.
 * Snapshots live in vpip_repo_snapshots; Admin AI labels (stable/failed/tags)
 * are kept in each snapshot's metadata. Restores copy stored files exactly.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AnalyzerFile } from "./repo-analyzer";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };

export interface SnapMeta {
  kind?: string;
  prompt?: string;
  model?: string;
  provider?: string;
  commitSha?: string | null;
  buildCode?: string;
  stable?: string | null;
  failed?: boolean;
  tags?: string[];
  [k: string]: unknown;
}
export interface SnapRow {
  id: string;
  project_id: string;
  build_session_id: string | null;
  label: string;
  is_zero: boolean;
  tree: string[];
  metadata: SnapMeta;
  created_at: string;
}

export async function listProjectSnapshots(projectId: string): Promise<SnapRow[]> {
  const { data, error } = await db
    .from("vpip_repo_snapshots")
    .select("id,project_id,build_session_id,label,is_zero,tree,metadata,created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r: SnapRow) => ({ ...r, tree: r.tree ?? [], metadata: r.metadata ?? {} }));
}

export async function loadFiles(id: string): Promise<AnalyzerFile[]> {
  const { data, error } = await db.from("vpip_repo_snapshots").select("files").eq("id", id).single();
  if (error) throw new Error(error.message);
  return (data?.files ?? []) as AnalyzerFile[];
}

export async function updateMeta(s: SnapRow, patch: Partial<SnapMeta>): Promise<SnapMeta> {
  const metadata = { ...s.metadata, ...patch };
  const { error } = await db.from("vpip_repo_snapshots").update({ metadata }).eq("id", s.id);
  if (error) throw new Error(error.message);
  return metadata;
}

export interface SnapDiff {
  added: string[];
  deleted: string[];
  modified: string[];
  deps: string[];
  routes: string[];
}

function pkgDeps(files: AnalyzerFile[]): Record<string, string> {
  const pkg = files.find((f) => f.path === "package.json" || f.path.endsWith("/package.json"));
  if (!pkg) return {};
  try {
    const j = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    return { ...(j.dependencies ?? {}), ...(j.devDependencies ?? {}) };
  } catch {
    return {};
  }
}

function routes(files: AnalyzerFile[]): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    if (/(^|\/)(routes|pages|app)\//.test(f.path) && /\.(t|j)sx?$/.test(f.path)) out.add(`file:${f.path}`);
    for (const m of f.content.matchAll(/<Route[^>]*\spath=["'`]([^"'`]+)/g)) out.add(`path:${m[1]}`);
    for (const m of f.content.matchAll(/\bpath:\s*["'`](\/[^"'`]*)/g)) out.add(`path:${m[1]}`);
  }
  return out;
}

export function diffFiles(a: AnalyzerFile[], b: AnalyzerFile[]): SnapDiff {
  const A = new Map(a.map((f) => [f.path, f.content]));
  const B = new Map(b.map((f) => [f.path, f.content]));
  const added = [...B.keys()].filter((p) => !A.has(p)).sort();
  const deleted = [...A.keys()].filter((p) => !B.has(p)).sort();
  const modified = [...B.keys()].filter((p) => A.has(p) && A.get(p) !== B.get(p)).sort();
  const da = pkgDeps(a);
  const dbb = pkgDeps(b);
  const deps: string[] = [];
  for (const k of new Set([...Object.keys(da), ...Object.keys(dbb)])) {
    if (!(k in da)) deps.push(`+ ${k}@${dbb[k]}`);
    else if (!(k in dbb)) deps.push(`- ${k}@${da[k]}`);
    else if (da[k] !== dbb[k]) deps.push(`~ ${k} ${da[k]} → ${dbb[k]}`);
  }
  const ra = routes(a);
  const rb = routes(b);
  const rts = [...[...rb].filter((r) => !ra.has(r)).map((r) => `+ ${r}`), ...[...ra].filter((r) => !rb.has(r)).map((r) => `- ${r}`)];
  return { added, deleted, modified, deps: deps.sort(), routes: rts };
}

export function diffSummary(d: SnapDiff) {
  return `${d.added.length} added, ${d.deleted.length} deleted, ${d.modified.length} modified, ${d.deps.length} dependency changes, ${d.routes.length} route changes`;
}

export const snapCode = (i: number) => `Snapshot-${String(i + 1).padStart(3, "0")}`;

export const TRACE_INSTRUCTION = `Write "# Failure Trace Analysis": identify which snapshot most likely introduced each problem (e.g. "Snapshot-041 introduced router failure"), citing evidence from the snapshot diffs, AI 1 reports, AI 2 audits and logs. Then write "# Recovery Recommendation" with: Problem, Root Cause, Affected Files, Recommended Snapshot, Recommended Stable Release, Recovery Risk (Low/Medium/High with reason). You may recommend restoring a commit or creating a recovery branch, but state clearly that nothing is restored or pushed without human approval.`;
