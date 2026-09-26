/**
 * Admin AI (AI 3) — VPIP platform improvement layer.
 * Reads GitHub; writes only via admin-implement.ts (approved, branch + PR, never main).
 * Proposed pull requests are text only and need human approval.
 */
const API = "https://api.github.com";

async function gh<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      msg = (JSON.parse(text) as { message?: string }).message ?? text;
    } catch {
      /* raw */
    }
    throw new Error(`GitHub ${res.status}: ${msg}`);
  }
  return JSON.parse(text) as T;
}

export interface TreeEntry { path: string; type: "blob" | "tree"; sha?: string; size?: number }
export interface AdminBranch { name: string; sha: string; headCommittedAt: string }
export interface AdminRepoMetadata {
  owner: string;
  name: string;
  fullName: string;
  description: string;
  visibility: "public" | "private";
  htmlUrl: string;
}
export interface AdminRepoData {
  metadata: AdminRepoMetadata;
  defaultBranch: string;
  branches: AdminBranch[];
  tree: TreeEntry[];
  truncated: boolean;
  commits: Array<{ sha: string; message: string; author: string; date: string }>;
  pulls: Array<{ number: number; title: string; state: string; user: string; url: string }>;
  issues: Array<{ number: number; title: string; state: string; user: string; url: string }>;
  headSha: string;
  fileCount: number;
  folderCount: number;
  syncedAt: string;
  syncStatus: "current";
}

export interface VisibilityAuditItem {
  capability: string;
  status: "PASS" | "FAIL";
  evidence: string;
  source: string;
}

export interface RepositoryFileRead {
  path: string;
  size: number;
  sha: string;
  kind: "text" | "binary";
  content: string | null;
  source: string;
}

function decodeBase64(content: string) {
  const binary = atob(content.replace(/\n/g, ""));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function isBinary(bytes: Uint8Array) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 8_000));
  return sample.some((byte) => byte === 0 || (byte < 7 || (byte > 14 && byte < 32)));
}

/**
 * Independently reads an exact repository path. The Contents endpoint supplies
 * normal files; its Git Blob fallback supports large files up to GitHub's blob
 * response limit while still exposing binary files as metadata only.
 */
export async function readRepositoryFile(token: string, repo: string, ref: string, path: string): Promise<RepositoryFileRead> {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const file = await gh<{ path: string; size: number; sha: string; type: string; content?: string; encoding?: string }>(token, `/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`);
  if (file.type !== "file") throw new Error(`${path} is not a file.`);
  let content = file.content;
  let encoding = file.encoding;
  let source = "GET /repos/{owner}/{repo}/contents/{path}?ref={branch}";
  if (encoding !== "base64" || !content) {
    const blob = await gh<{ content?: string; encoding?: string }>(token, `/repos/${repo}/git/blobs/${file.sha}`);
    content = blob.content;
    encoding = blob.encoding;
    source = "GET /repos/{owner}/{repo}/contents/{path}?ref={branch} + GET /repos/{owner}/{repo}/git/blobs/{sha}";
  }
  if (encoding !== "base64" || !content) throw new Error(`GitHub returned metadata but no readable blob content for ${path}.`);
  const bytes = decodeBase64(content);
  if (isBinary(bytes)) return { path: file.path, size: file.size, sha: file.sha, kind: "binary", content: null, source };
  return { path: file.path, size: file.size, sha: file.sha, kind: "text", content: new TextDecoder().decode(bytes), source };
}

/** Root build/config files Admin AI always reads when a repository is connected. */
export const BUILD_CONFIG_RE = /^(package\.json|vite\.config\.(ts|js|mjs)|tsconfig(\.[\w-]+)?\.json|tailwind\.config\.(ts|js|cjs)|postcss\.config\.(js|cjs|mjs)|wrangler\.(toml|jsonc?)|components\.json|eslint\.config\.js|bunfig\.toml|supabase\/config\.toml|AGENTS\.md|README\.md)$/;

export async function compareCommits(token: string, repo: string, base: string, head: string) {
  return compareBranches(token, repo, base, head);
}

export async function loadRepo(token: string, repo: string, branch?: string): Promise<AdminRepoData> {
  const info = await gh<{
    name: string; full_name: string; description: string | null; private: boolean;
    default_branch: string; html_url: string; owner: { login: string };
  }>(token, `/repos/${repo}`);
  const ref = branch || info.default_branch;
  const [branches, tree, commits, pulls, issues] = await Promise.all([
    gh<Array<{ name: string; commit: { sha: string } }>>(token, `/repos/${repo}/branches?per_page=100`),
    gh<{ tree: TreeEntry[]; truncated: boolean }>(token, `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    gh<Array<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } } }>>(token, `/repos/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=30`),
    gh<Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string }>>(token, `/repos/${repo}/pulls?state=all&per_page=30`),
    gh<Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string; pull_request?: unknown }>>(token, `/repos/${repo}/issues?state=all&per_page=30`),
  ]);
  // GitHub's branch-list response has no timestamp. Read every returned branch
  // head so the audit can truthfully show the five most recently committed heads.
  const branchHeads: AdminBranch[] = [];
  const pending = [...branches];
  // Limit detail reads to avoid flooding GitHub while retaining an auditable
  // timestamp for every returned branch head.
  await Promise.all(Array.from({ length: Math.min(8, pending.length) }, async () => {
    for (let branchHead = pending.shift(); branchHead; branchHead = pending.shift()) {
      const detail = await gh<{ commit: { author?: { date?: string }; committer?: { date?: string } } }>(token, `/repos/${repo}/commits/${encodeURIComponent(branchHead.commit.sha)}`);
      branchHeads.push({ name: branchHead.name, sha: branchHead.commit.sha, headCommittedAt: detail.commit.author?.date ?? detail.commit.committer?.date ?? "" });
    }
  }));
  return {
    metadata: {
      owner: info.owner.login,
      name: info.name,
      fullName: info.full_name,
      description: info.description ?? "",
      visibility: info.private ? "private" : "public",
      htmlUrl: info.html_url,
    },
    defaultBranch: info.default_branch,
    branches: branchHeads.sort((a, b) => b.headCommittedAt.localeCompare(a.headCommittedAt)),
    tree: tree.tree.filter((t) => t.type === "blob" || t.type === "tree"),
    truncated: tree.truncated,
    commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message, author: c.commit.author?.name ?? "unknown", date: c.commit.author?.date ?? "" })),
    pulls: pulls.map((p) => ({ number: p.number, title: p.title, state: p.state, user: p.user.login, url: p.html_url })),
    issues: issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, user: i.user.login, url: i.html_url })),
    headSha: commits[0]?.sha ?? "",
    fileCount: tree.tree.filter((t) => t.type === "blob").length,
    folderCount: tree.tree.filter((t) => t.type === "tree").length,
    syncedAt: new Date().toISOString(),
    syncStatus: "current",
  };
}

/**
 * Phase 1 audit generated strictly from the successful live GitHub responses
 * stored in AdminRepoData. A truncated tree cannot verify an exact inventory.
 */
export function repositoryVisibilityAudit(data: AdminRepoData | null): VisibilityAuditItem[] {
  if (!data) {
    return [{ capability: "Repository connection", status: "FAIL", evidence: "No successful GitHub response is available.", source: "GitHub REST API" }];
  }
  const treeStatus = data.truncated ? "FAIL" : "PASS";
  const treeEvidence = data.truncated
    ? "GitHub marked the recursive tree response as truncated; exact file and folder totals are unavailable."
    : `${data.fileCount} files and ${data.folderCount} folders were returned in the recursive tree.`;
  return [
    { capability: "Repository connection", status: "PASS", evidence: `Connected to ${data.metadata.fullName} at ${data.syncedAt}.`, source: "GET /repos/{owner}/{repo}" },
    { capability: "Repository metadata", status: "PASS", evidence: `Owner: ${data.metadata.owner}; name: ${data.metadata.name}; visibility: ${data.metadata.visibility}.`, source: "GET /repos/{owner}/{repo}" },
    { capability: "Default branch detection", status: "PASS", evidence: `Default branch: ${data.defaultBranch}.`, source: "GET /repos/{owner}/{repo}" },
    { capability: "Branch list", status: "PASS", evidence: `${data.branches.length} branches returned; latest five by branch-head commit: ${data.branches.slice(0, 5).map((b) => `${b.name} (${b.sha.slice(0, 7)}, ${b.headCommittedAt || "undated"})`).join(", ") || "none"}.`, source: "GET /repos/{owner}/{repo}/branches?per_page=100 + GET /repos/{owner}/{repo}/commits/{sha}" },
    { capability: "Commit list", status: "PASS", evidence: `${data.commits.length} commits returned; latest ten: ${data.commits.slice(0, 10).map((c) => c.sha.slice(0, 7)).join(", ") || "none"}.`, source: "GET /repos/{owner}/{repo}/commits?sha={branch}&per_page=30" },
    { capability: "Commit details", status: data.headSha ? "PASS" : "FAIL", evidence: data.headSha ? `Latest commit ${data.headSha} is available for detail retrieval.` : "No commit SHA was returned.", source: "GET /repos/{owner}/{repo}/commits/{sha}" },
    { capability: "File tree", status: treeStatus, evidence: treeEvidence, source: "GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1" },
    { capability: "Folder tree", status: treeStatus, evidence: treeEvidence, source: "GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1" },
    { capability: "Repository statistics", status: treeStatus, evidence: treeEvidence, source: "GET /repos/{owner}/{repo}/git/trees/{branch}?recursive=1" },
    { capability: "Repository synchronization status", status: "PASS", evidence: `Live read completed at ${data.syncedAt}; head SHA ${data.headSha || "not returned"}; status ${data.syncStatus}.`, source: "Live GitHub REST read" },
  ];
}

export async function readFile(token: string, repo: string, ref: string, path: string): Promise<string> {
  return (await readRepositoryFile(token, repo, ref, path)).content ?? "";
}

export async function compareBranches(token: string, repo: string, base: string, head: string) {
  const r = await gh<{ status: string; ahead_by: number; behind_by: number; files?: Array<{ filename: string; status: string; additions: number; deletions: number }> }>(
    token,
    `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  return r;
}

export interface GhFile { filename: string; status: string; additions: number; deletions: number; patch?: string; previous_filename?: string }

export async function listTags(token: string, repo: string) {
  const r = await gh<Array<{ name: string; commit: { sha: string } }>>(token, `/repos/${repo}/tags?per_page=100`);
  return r.map((t) => ({ name: t.name, sha: t.commit.sha }));
}

export async function listReleases(token: string, repo: string) {
  const r = await gh<Array<{ id: number; tag_name: string; name: string | null; draft: boolean; prerelease: boolean; published_at: string | null; html_url: string; body: string | null }>>(token, `/repos/${repo}/releases?per_page=50`);
  return r.map((x) => ({ id: x.id, tag: x.tag_name, name: x.name ?? x.tag_name, draft: x.draft, prerelease: x.prerelease, published: x.published_at ?? "", url: x.html_url, body: x.body ?? "" }));
}

export async function getCommit(token: string, repo: string, sha: string) {
  const c = await gh<{ sha: string; html_url: string; commit: { message: string; author?: { name?: string; date?: string } }; parents: Array<{ sha: string }>; stats?: { additions: number; deletions: number; total: number }; files?: GhFile[] }>(token, `/repos/${repo}/commits/${encodeURIComponent(sha)}`);
  return { sha: c.sha, url: c.html_url, message: c.commit.message, author: c.commit.author?.name ?? "unknown", date: c.commit.author?.date ?? "", parents: c.parents.map((p) => p.sha), stats: c.stats, files: c.files ?? [] };
}

export async function getPull(token: string, repo: string, n: number) {
  const [p, files] = await Promise.all([
    gh<{ number: number; title: string; state: string; merged: boolean; body: string | null; html_url: string; head: { ref: string; sha: string }; base: { ref: string }; user: { login: string }; additions: number; deletions: number; changed_files: number }>(token, `/repos/${repo}/pulls/${n}`),
    gh<GhFile[]>(token, `/repos/${repo}/pulls/${n}/files?per_page=100`),
  ]);
  return { number: p.number, title: p.title, state: p.merged ? "merged" : p.state, body: p.body ?? "", url: p.html_url, head: p.head.ref, headSha: p.head.sha, base: p.base.ref, user: p.user.login, additions: p.additions, deletions: p.deletions, changedFiles: p.changed_files, files };
}

/** Markdown view of a file list with patches, for display and for Admin AI chat context. */
export function filesDiffMarkdown(files: GhFile[], max = 20000) {
  let out = "";
  for (const f of files) {
    out += `\n### ${f.status} ${f.previous_filename ? `${f.previous_filename} → ` : ""}${f.filename} (+${f.additions} −${f.deletions})\n\`\`\`diff\n${f.patch ?? "(binary or too large — no patch from GitHub)"}\n\`\`\`\n`;
    if (out.length > max) return `${out.slice(0, max)}\n…[truncated]`;
  }
  return out;
}

export const REPORT_KINDS = {

  improvement: "VPIP Improvement Report",
  changes: "Recommended Platform Changes",
  pr: "Proposed Pull Request",
  learning: "Platform Improvement Suggestions (failure learning)",
  proposal: "Change Proposal (approval request)",
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;

const RULES = `You are Admin AI (AI 3) for VPIP — the Vaigyanic Project Intelligence Platform.
You improve VPIP ITSELF only: never customer projects, never user repositories.
You cannot change anything without explicit human approval. Approved changes are only ever applied on a separate branch with a pull request — never directly to the main branch. You never merge, push to main, or deploy on your own.
Base claims on the supplied evidence (repository tree, files, AI 1 build reports, AI 2 audits, user feedback, platform logs). Say "insufficient evidence" instead of guessing.
Repository access rule: only claim you can see the VPIP repository when the "Repository Status" section says "Connected: Yes". Use the verified numbers in that section (e.g. total files) exactly. If it says "Connected: No", say plainly that no repository is connected and you cannot read its files — never invent file names, counts or contents. For files not included below, tell the user to name the file path so it can be read.`;

export function adminSystemPrompt(context: string) {
  return `${RULES}\n\n# Evidence\n${context}`;
}

export function reportInstruction(kind: ReportKind) {
  switch (kind) {
    case "improvement":
      return `Write "# VPIP Improvement Report" analysing: VPIP architecture, VPIP limitations, AI 1 failure patterns, AI 2 failure patterns, prompt failures, repository issues, user pain points. For each finding give: Problem, Root Cause, Affected Files, Risk Level, Recommended Fix, Estimated Impact. Cite the evidence.`;
    case "changes":
      return `Write "# Recommended Platform Changes": a prioritised markdown table (priority | change | reason | evidence | affected VPIP files | risk), then a short rollout order.`;
    case "pr":
      return `Write "# Proposed Pull Request" for the single highest-value VPIP change: Title, Branch name, Summary, Motivation (evidence), Files to change with the concrete edits described or shown as unified diffs, Test plan, Risks. State clearly: "Draft only, not committed. Needs human approval."`;
    case "proposal":
      return `Write "# Change Proposal" for the single highest-value VPIP change, with these exact sections: ## Problem, ## Root Cause, ## Affected Files, ## Files To Create, ## Files To Modify, ## Files To Delete, ## Risk Level (Low/Medium/High with reason), ## Expected Benefit, ## Implementation Plan (numbered steps), ## Rollback Plan. Only list files that exist in the evidence (or new paths under Files To Create). End with: "Awaiting approval. Will be applied on a separate branch with a pull request; main is never written directly."`;
    case "learning":
      return `Write "# Platform Improvement Suggestions" by finding: repeated build failures, repeated audit findings, missing VPIP features, missing integrations, workflow bottlenecks. For each: pattern, frequency seen in evidence, suggestion.`;
  }
}

export function buildContext(opts: {
  repo: string;
  branch: string;
  data: AdminRepoData | null;
  error?: string;
  configFiles: Array<{ path: string; content: string }>;
  snapshots: Array<{ label: string; created_at: string; project: string; files: Array<{ path: string; content?: string }> }>;
  tree: TreeEntry[];
  pinned: Array<{ path: string; content: string }>;
  ai1: Array<{ created_at: string; report: string }>;
  ai2: Array<{ created_at: string; kind: string; score: number | null; report: string }>;
  feedback: Array<{ kind: string; content: string; created_at: string }>;
}) {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
  const lines: string[] = [];
  const d = opts.data;
  lines.push(`## Repository Status (verified by live GitHub read)
- Connected: ${d ? "Yes" : "No"}${!d && opts.error ? ` (last error: ${opts.error})` : ""}
- Repository: ${opts.repo || "none"}
- Branch: ${d ? opts.branch : "—"}
- Commit: ${d?.headSha || "—"}
- Total files: ${d ? `${d.fileCount}${d.truncated ? " (GitHub truncated the tree; real count is higher)" : ""}` : "unknown"}
- Directories: ${d ? d.tree.filter((t) => t.type === "tree").length : "unknown"}
- Last sync: ${d?.syncedAt ?? "never"}`);
  if (d) {
    lines.push(`### Branches (${d.branches.length}, newest branch heads first)\n${d.branches.map((b) => `${b.name} (${b.sha.slice(0, 7)}, ${b.headCommittedAt || "undated"})`).join(", ")}`);
    lines.push(`### Recent commits\n${d.commits.slice(0, 20).map((c) => `- ${c.sha.slice(0, 7)} ${c.date} ${c.author}: ${c.message.split("\n")[0]}`).join("\n")}`);
    lines.push("### Full file list");
    lines.push(opts.tree.filter((t) => t.type === "blob").map((t) => t.path).slice(0, 1500).join("\n"));
    for (const f of opts.configFiles) lines.push(`### Build/config file: ${f.path}\n\`\`\`\n${cut(f.content, 8000)}\n\`\`\``);
  }
  if (opts.snapshots.length) {
    lines.push(`## VPIP snapshots (latest ${opts.snapshots.length})`);
    for (const sn of opts.snapshots) {
      const pkg = sn.files.find((f) => f.path === "package.json")?.content;
      lines.push(`### ${sn.label} · ${sn.project} · ${sn.created_at} · ${sn.files.length} files\n${sn.files.map((f) => f.path).slice(0, 200).join("\n")}${pkg ? `\npackage.json:\n\`\`\`\n${cut(pkg, 3000)}\n\`\`\`` : ""}`);
    }
  }
  for (const f of opts.pinned) lines.push(`### File: ${f.path}\n\`\`\`\n${cut(f.content, 12000)}\n\`\`\``);
  lines.push(`## AI 1 build reports (latest ${opts.ai1.length})`);
  for (const r of opts.ai1) lines.push(`### ${r.created_at}\n${cut(r.report, 2500)}`);
  lines.push(`## AI 2 audits (latest ${opts.ai2.length})`);
  for (const a of opts.ai2) lines.push(`### ${a.created_at} · ${a.kind} · score ${a.score ?? "—"}\n${cut(a.report, 2500)}`);
  lines.push(`## User feedback`);
  for (const f of opts.feedback) lines.push(`- [${f.kind}] ${f.content}`);
  return lines.join("\n\n");
}
