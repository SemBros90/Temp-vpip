/**
 * Admin AI (AI 3) — VPIP platform improvement layer.
 * Read-only on GitHub: it never commits, pushes, merges or deploys.
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

export interface TreeEntry { path: string; type: "blob" | "tree"; size?: number }
export interface AdminRepoData {
  defaultBranch: string;
  branches: string[];
  tree: TreeEntry[];
  truncated: boolean;
  commits: Array<{ sha: string; message: string; author: string; date: string }>;
  pulls: Array<{ number: number; title: string; state: string; user: string; url: string }>;
  issues: Array<{ number: number; title: string; state: string; user: string; url: string }>;
}

export async function loadRepo(token: string, repo: string, branch?: string): Promise<AdminRepoData> {
  const info = await gh<{ default_branch: string }>(token, `/repos/${repo}`);
  const ref = branch || info.default_branch;
  const [branches, tree, commits, pulls, issues] = await Promise.all([
    gh<Array<{ name: string }>>(token, `/repos/${repo}/branches?per_page=100`),
    gh<{ tree: TreeEntry[]; truncated: boolean }>(token, `/repos/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    gh<Array<{ sha: string; commit: { message: string; author?: { name?: string; date?: string } } }>>(token, `/repos/${repo}/commits?sha=${encodeURIComponent(ref)}&per_page=30`),
    gh<Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string }>>(token, `/repos/${repo}/pulls?state=all&per_page=30`),
    gh<Array<{ number: number; title: string; state: string; user: { login: string }; html_url: string; pull_request?: unknown }>>(token, `/repos/${repo}/issues?state=all&per_page=30`),
  ]);
  return {
    defaultBranch: info.default_branch,
    branches: branches.map((b) => b.name),
    tree: tree.tree.filter((t) => t.type === "blob" || t.type === "tree"),
    truncated: tree.truncated,
    commits: commits.map((c) => ({ sha: c.sha, message: c.commit.message, author: c.commit.author?.name ?? "unknown", date: c.commit.author?.date ?? "" })),
    pulls: pulls.map((p) => ({ number: p.number, title: p.title, state: p.state, user: p.user.login, url: p.html_url })),
    issues: issues.filter((i) => !i.pull_request).map((i) => ({ number: i.number, title: i.title, state: i.state, user: i.user.login, url: i.html_url })),
  };
}

export async function readFile(token: string, repo: string, ref: string, path: string): Promise<string> {
  const f = await gh<{ content?: string; encoding?: string }>(token, `/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
  if (f.encoding !== "base64" || !f.content) return "";
  const bin = atob(f.content.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export async function compareBranches(token: string, repo: string, base: string, head: string) {
  const r = await gh<{ status: string; ahead_by: number; behind_by: number; files?: Array<{ filename: string; status: string; additions: number; deletions: number }> }>(
    token,
    `/repos/${repo}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
  );
  return r;
}

export const REPORT_KINDS = {
  improvement: "VPIP Improvement Report",
  changes: "Recommended Platform Changes",
  pr: "Proposed Pull Request",
  learning: "Platform Improvement Suggestions (failure learning)",
} as const;
export type ReportKind = keyof typeof REPORT_KINDS;

const RULES = `You are Admin AI (AI 3) for VPIP — the Vaigyanic Project Intelligence Platform.
You improve VPIP ITSELF only: never customer projects, never user repositories.
You are advisory and read-only. You cannot deploy, merge, push, commit or modify VPIP. Every change you propose needs explicit human approval.
Base claims on the supplied evidence (repository tree, files, AI 1 build reports, AI 2 audits, user feedback, platform logs). Say "insufficient evidence" instead of guessing.`;

export function adminSystemPrompt(context: string) {
  return `${RULES}\n\n# Evidence\n${context}`;
}

export function reportInstruction(kind: ReportKind) {
  switch (kind) {
    case "improvement":
      return `Write "# VPIP Improvement Report" analysing: VPIP architecture, VPIP limitations, AI 1 failure patterns, AI 2 failure patterns, prompt failures, repository issues, user pain points. Cite the evidence for each point.`;
    case "changes":
      return `Write "# Recommended Platform Changes": a prioritised markdown table (priority | change | reason | evidence | affected VPIP files | risk), then a short rollout order.`;
    case "pr":
      return `Write "# Proposed Pull Request" for the single highest-value VPIP change: Title, Branch name, Summary, Motivation (evidence), Files to change with the concrete edits described or shown as unified diffs, Test plan, Risks. State clearly: "Draft only, not committed. Needs human approval."`;
    case "learning":
      return `Write "# Platform Improvement Suggestions" by finding: repeated build failures, repeated audit findings, missing VPIP features, missing integrations, workflow bottlenecks. For each: pattern, frequency seen in evidence, suggestion.`;
  }
}

export function buildContext(opts: {
  repo: string;
  branch: string;
  tree: TreeEntry[];
  pinned: Array<{ path: string; content: string }>;
  ai1: Array<{ created_at: string; report: string }>;
  ai2: Array<{ created_at: string; kind: string; score: number | null; report: string }>;
  feedback: Array<{ kind: string; content: string; created_at: string }>;
}) {
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n…[truncated]` : s);
  const lines: string[] = [];
  lines.push(`## VPIP repository: ${opts.repo || "not connected"} @ ${opts.branch || "—"}`);
  if (opts.tree.length) {
    lines.push("### File tree (source files)");
    lines.push(opts.tree.filter((t) => t.type === "blob").map((t) => t.path).slice(0, 600).join("\n"));
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
