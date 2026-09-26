/**
 * Admin AI Stage 2 — apply an APPROVED change proposal.
 * Order: snapshot (original files + base commit) → new branch → one commit → pull request.
 * Never writes to the default/main branch, never merges, never deploys.
 */
const API = "https://api.github.com";

async function gh<T>(token: string, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token.trim()}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { msg = (JSON.parse(text) as { message?: string }).message ?? text; } catch { /* raw */ }
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export type ChangeOp =
  | { op: "create" | "modify"; path: string; content: string }
  | { op: "delete"; path: string }
  | { op: "rename"; from: string; path: string; content?: string };

export interface ChangeSet { title: string; branch: string; summary: string; changes: ChangeOp[] }

export const PROTECTED = new Set(["main", "master", "production", "prod"]);

export function changeSetInstruction(proposal: string, files: Array<{ path: string; content: string }>) {
  return `The user APPROVED this change proposal. Produce the exact edits as ONE JSON object and nothing else (no prose, no code fence).
Shape: {"title": string, "branch": "admin-ai/<short-kebab-name>", "summary": string, "changes": [ {"op":"create"|"modify","path":string,"content":"<FULL new file content>"} | {"op":"delete","path":string} | {"op":"rename","from":string,"path":string,"content"?:"<full content if also edited>"} ]}
Rules: full file contents only (no diffs, no "..."), only touch files named in the proposal, never a branch named main/master.

# Approved proposal
${proposal}

# Current contents of affected files (read live from the repository)
${files.map((f) => `## ${f.path}\n\`\`\`\n${f.content.slice(0, 20000)}\n\`\`\``).join("\n\n") || "(none found)"}`;
}

export function parseChangeSet(raw: string): ChangeSet {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e < s) throw new Error("AI did not return a change set.");
  const cs = JSON.parse(raw.slice(s, e + 1)) as ChangeSet;
  if (!Array.isArray(cs.changes) || !cs.changes.length) throw new Error("Change set is empty.");
  cs.branch = (cs.branch || `admin-ai/change-${Date.now()}`).replace(/[^\w./-]/g, "-");
  if (!cs.branch.startsWith("admin-ai/")) cs.branch = `admin-ai/${cs.branch}`;
  return cs;
}

/** Paths mentioned in the proposal that exist in the tree. */
export function affectedPaths(proposal: string, tree: string[]) {
  return tree.filter((p) => proposal.includes(p)).slice(0, 15);
}

function lineCount(s: string) { return s ? s.split("\n").length : 0; }

/** Rough line stats per file (added/removed) against original contents. */
export function changeStats(cs: ChangeSet, originals: Record<string, string>) {
  return cs.changes.map((c) => {
    const before = c.op === "rename" ? originals[c.from] ?? "" : c.op === "create" ? "" : originals[c.path] ?? "";
    const after = c.op === "delete" ? "" : c.op === "rename" ? c.content ?? before : c.content;
    const a = new Set(before.split("\n"));
    const b = new Set(after.split("\n"));
    const added = after ? after.split("\n").filter((l) => !a.has(l)).length : 0;
    const removed = before ? before.split("\n").filter((l) => !b.has(l)).length : 0;
    return { op: c.op, path: c.op === "rename" ? `${c.from} → ${c.path}` : c.path, added, removed, before: lineCount(before), after: lineCount(after) };
  });
}

/** Creates branch + single commit + PR. Refuses protected/default branches. */
export async function applyChangeSet(token: string, repo: string, base: string, cs: ChangeSet) {
  const info = await gh<{ default_branch: string }>(token, `/repos/${repo}`);
  if (PROTECTED.has(cs.branch) || cs.branch === info.default_branch || cs.branch === base) throw new Error("Refused: Admin AI never writes to the main/default branch.");
  const ref = await gh<{ object: { sha: string } }>(token, `/repos/${repo}/git/ref/heads/${encodeURIComponent(base)}`);
  const baseSha = ref.object.sha;
  const baseCommit = await gh<{ tree: { sha: string } }>(token, `/repos/${repo}/git/commits/${baseSha}`);
  const tree: Array<{ path: string; mode: string; type: string; content?: string; sha?: null }> = [];
  for (const c of cs.changes) {
    if (c.op === "delete") tree.push({ path: c.path, mode: "100644", type: "blob", sha: null });
    else if (c.op === "rename") {
      const content = c.content ?? (await readRaw(token, repo, baseSha, c.from));
      tree.push({ path: c.from, mode: "100644", type: "blob", sha: null }, { path: c.path, mode: "100644", type: "blob", content });
    } else tree.push({ path: c.path, mode: "100644", type: "blob", content: c.content });
  }
  const newTree = await gh<{ sha: string }>(token, `/repos/${repo}/git/trees`, { method: "POST", body: { base_tree: baseCommit.tree.sha, tree } });
  const commit = await gh<{ sha: string }>(token, `/repos/${repo}/git/commits`, { method: "POST", body: { message: `Admin AI: ${cs.title}`, tree: newTree.sha, parents: [baseSha] } });
  await gh(token, `/repos/${repo}/git/refs`, { method: "POST", body: { ref: `refs/heads/${cs.branch}`, sha: commit.sha } });
  const pr = await gh<{ number: number; html_url: string }>(token, `/repos/${repo}/pulls`, {
    method: "POST",
    body: { title: `Admin AI: ${cs.title}`, head: cs.branch, base, body: `${cs.summary}\n\n_Created by VPIP Admin AI after explicit approval. Not merged automatically._` },
  });
  return { baseSha, commitSha: commit.sha, prNumber: pr.number, prUrl: pr.html_url };
}

async function readRaw(token: string, repo: string, ref: string, path: string) {
  const f = await gh<{ content?: string }>(token, `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${ref}`);
  const bin = atob((f.content ?? "").replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

/** Undo = close the PR and delete its branch. main is untouched. */
export async function undoChange(token: string, repo: string, prNumber: number, branch: string) {
  await gh(token, `/repos/${repo}/pulls/${prNumber}`, { method: "PATCH", body: { state: "closed" } });
  await gh(token, `/repos/${repo}/git/refs/heads/${branch.split("/").map(encodeURIComponent).join("/")}`, { method: "DELETE" });
}
