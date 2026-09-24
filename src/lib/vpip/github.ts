/**
 * Module 13 — GitHub client.
 * Credentials are supplied by the user per repository and stored in their own
 * vault. Nothing here is hardcoded and no token is ever defaulted.
 */

import * as remote from "./git-remote";

const API = "https://api.github.com";

export interface GhRepoInfo {
  owner: string;
  name: string;
  fullName: string;
  description: string;
  visibility: "public" | "private";
  defaultBranch: string;
  htmlUrl: string;
}

export interface GhBranch {
  name: string;
  sha: string;
}

export interface GhCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  htmlUrl: string;
}

export interface GhFile {
  path: string;
  content: string;
}

/** Accepts "owner/repo" or any github.com URL and returns "owner/repo". */
export function normalizeGithubName(input: string) {
  const m = input.trim().match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i);
  return m ? `${m[1]}/${m[2]!.replace(/\.git$/, "")}` : input.trim();
}

function headers(token: string) {
  return {
    Accept: "application/vnd.github+json",
    ...(token.trim() ? { Authorization: `Bearer ${token}` } : {}),
    "X-GitHub-Api-Version": "2022-11-28",
    "Content-Type": "application/json",
  };
}

async function call<T>(
  token: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init?.method ?? "GET",
    headers: headers(token),
    ...(init?.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed.message) detail = parsed.message;
    } catch {
      /* keep raw text */
    }
    throw new Error(`GitHub ${res.status}: ${detail}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

interface RawRepo {
  name: string;
  full_name: string;
  description: string | null;
  private: boolean;
  default_branch: string;
  html_url: string;
  owner: { login: string };
}

function toInfo(r: RawRepo): GhRepoInfo {
  return {
    owner: r.owner.login,
    name: r.name,
    fullName: r.full_name,
    description: r.description ?? "",
    visibility: r.private ? "private" : "public",
    defaultBranch: r.default_branch,
    htmlUrl: r.html_url,
  };
}

export async function whoAmI(token: string, fullName?: string) {
  if (fullName && remote.isGenericRemote(fullName)) return remote.whoAmI(token, fullName);
  const user = await call<{ login: string }>(token, "/user");
  return user.login;
}

export async function createRepository(
  token: string,
  input: { name: string; description: string; visibility: "public" | "private" },
): Promise<GhRepoInfo> {
  const raw = await call<RawRepo>(token, "/user/repos", {
    method: "POST",
    body: {
      name: input.name,
      description: input.description,
      private: input.visibility === "private",
      auto_init: true,
    },
  });
  return toInfo(raw);
}

export async function getRepository(token: string, fullName: string): Promise<GhRepoInfo> {
  fullName = normalizeGithubName(fullName);
  if (remote.isGenericRemote(fullName)) return remote.getRepository(token, fullName);
  return toInfo(await call<RawRepo>(token, `/repos/${fullName}`));
}

export async function listBranches(token: string, fullName: string): Promise<GhBranch[]> {
  if (remote.isGenericRemote(fullName)) return remote.listBranches(token, fullName);
  const raw = await call<Array<{ name: string; commit: { sha: string } }>>(
    token,
    `/repos/${fullName}/branches?per_page=100`,
  );
  return raw.map((b) => ({ name: b.name, sha: b.commit.sha }));
}

export async function listCommits(
  token: string,
  fullName: string,
  branch: string,
): Promise<GhCommit[]> {
  if (remote.isGenericRemote(fullName)) return remote.listCommits(token, fullName, branch);
  const raw = await call<
    Array<{
      sha: string;
      html_url: string;
      commit: { message: string; author: { name?: string; date?: string } };
    }>
  >(token, `/repos/${fullName}/commits?sha=${encodeURIComponent(branch)}&per_page=50`);
  return raw.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    author: c.commit.author?.name ?? "unknown",
    date: c.commit.author?.date ?? "",
    htmlUrl: c.html_url,
  }));
}

export async function createBranch(
  token: string,
  fullName: string,
  name: string,
  fromBranch: string,
): Promise<GhBranch> {
  if (remote.isGenericRemote(fullName)) return remote.createBranch(token, fullName, name, fromBranch);
  const ref = await call<{ object: { sha: string } }>(
    token,
    `/repos/${fullName}/git/ref/heads/${encodeURIComponent(fromBranch)}`,
  );
  await call(token, `/repos/${fullName}/git/refs`, {
    method: "POST",
    body: { ref: `refs/heads/${name}`, sha: ref.object.sha },
  });
  return { name, sha: ref.object.sha };
}

export async function mergeBranch(
  token: string,
  fullName: string,
  base: string,
  head: string,
  message: string,
): Promise<string> {
  if (remote.isGenericRemote(fullName)) return remote.mergeBranch(token, fullName, base, head, message);
  const res = await call<{ sha?: string }>(token, `/repos/${fullName}/merges`, {
    method: "POST",
    body: { base, head, commit_message: message },
  });
  return res.sha ?? "";
}

/** Fetch — read remote refs without touching local files. */
export async function fetchRefs(token: string, fullName: string) {
  const [info, branches] = await Promise.all([
    getRepository(token, fullName),
    listBranches(token, fullName),
  ]);
  return { info, branches };
}

/** Clone / Pull — read every text file on a branch. */
export async function readBranchFiles(
  token: string,
  fullName: string,
  branch: string,
): Promise<GhFile[]> {
  if (remote.isGenericRemote(fullName)) return remote.readBranchFiles(token, fullName, branch);
  // Real git clone through the relay: one request, no API rate limits.
  try {
    const cred = token.trim() ? `x-access-token:${token.trim()}` : "";
    return await remote.readBranchFiles(cred, `https://github.com/${fullName}.git`, branch);
  } catch {
    /* fall back to the REST API below */
  }
  const tree = await call<{
    tree: Array<{ path: string; type: string; sha: string; size?: number }>;
  }>(token, `/repos/${fullName}/git/trees/${encodeURIComponent(branch)}?recursive=1`);

  const blobs = tree.tree.filter(
    (t) => t.type === "blob" && ((t.size ?? 0) <= 400_000 || Boolean(remote.ASSET_MIME[t.path.split(".").pop()?.toLowerCase() ?? ""])),
  );
  const out: GhFile[] = [];
  for (const blob of blobs) {
    const data = await call<{ content: string; encoding: string }>(
      token,
      `/repos/${fullName}/git/blobs/${blob.sha}`,
    );
    if (data.encoding !== "base64") continue;
    const mime = remote.ASSET_MIME[blob.path.split(".").pop()?.toLowerCase() ?? ""];
    if (mime) {
      out.push({ path: blob.path, content: (blob.size ?? 0) > 2_000_000 ? `vpip-skipped:too-large:${blob.size}` : `data:${mime};base64,${data.content.replace(/\n/g, "")}` });
      continue;
    }
    try {
      const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, "")), (c) =>
        c.charCodeAt(0),
      );
      out.push({ path: blob.path, content: new TextDecoder().decode(bytes) });
    } catch {
      /* binary or undecodable — skipped */
    }
  }
  return out;
}

function toBase64(text: string) {
  const m = /^data:[\w/+.-]+;base64,(.*)$/s.exec(text);
  if (m) return m[1]!;
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Push — commit a set of files onto a branch. */
export async function commitFiles(
  token: string,
  fullName: string,
  branch: string,
  message: string,
  files: GhFile[],
): Promise<GhCommit> {
  if (remote.isGenericRemote(fullName)) return remote.commitFiles(token, fullName, branch, message, files);
  if (files.length === 0) throw new Error("No files selected for this commit.");

  const ref = await call<{ object: { sha: string } }>(
    token,
    `/repos/${fullName}/git/ref/heads/${encodeURIComponent(branch)}`,
  );
  const parentSha = ref.object.sha;
  const parentCommit = await call<{ tree: { sha: string } }>(
    token,
    `/repos/${fullName}/git/commits/${parentSha}`,
  );

  const tree: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    if (file.content.startsWith("vpip-skipped:")) continue;
    const blob = await call<{ sha: string }>(token, `/repos/${fullName}/git/blobs`, {
      method: "POST",
      body: { content: toBase64(file.content), encoding: "base64" },
    });
    tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
  }

  const newTree = await call<{ sha: string }>(token, `/repos/${fullName}/git/trees`, {
    method: "POST",
    body: { base_tree: parentCommit.tree.sha, tree },
  });
  const commit = await call<{
    sha: string;
    html_url?: string;
    message: string;
    author?: { name?: string; date?: string };
  }>(token, `/repos/${fullName}/git/commits`, {
    method: "POST",
    body: { message, tree: newTree.sha, parents: [parentSha] },
  });
  await call(token, `/repos/${fullName}/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: { sha: commit.sha },
  });

  return {
    sha: commit.sha,
    message,
    author: commit.author?.name ?? "vault",
    date: commit.author?.date ?? new Date().toISOString(),
    htmlUrl: commit.html_url ?? `https://github.com/${fullName}/commit/${commit.sha}`,
  };
}

export function shortSha(sha: string) {
  return sha.slice(0, 7);
}
