/**
 * Generic git client for GitLab, Bitbucket and any https git remote.
 * Runs real git (clone / fetch / commit / push / merge) in the browser via
 * isomorphic-git, relayed through /api/git-proxy. For these repositories the
 * stored "fullName" is the https clone URL and "token" is "username:token".
 */
import type { GhBranch, GhCommit, GhFile, GhRepoInfo } from "./github";

export function isGenericRemote(fullName: string) {
  return /^https?:\/\//i.test(fullName);
}

export function packCredentials(username: string, token: string) {
  return `${username}:${token}`;
}

function creds(token: string) {
  const i = token.indexOf(":");
  if (i < 0) return { username: "oauth2", password: token };
  return { username: token.slice(0, i), password: token.slice(i + 1) };
}

async function load() {
  const { Buffer } = await import("buffer");
  const g = globalThis as unknown as { Buffer?: unknown };
  if (!g.Buffer) g.Buffer = Buffer;
  const [git, http, LFS] = await Promise.all([
    import("isomorphic-git"),
    import("isomorphic-git/http/web"),
    import("@isomorphic-git/lightning-fs"),
  ]);
  return { git: git.default ?? git, http: http.default ?? http, LightningFS: LFS.default };
}

async function session(url: string, token: string) {
  const { git, http, LightningFS } = await load();
  const name = `vpip-git-${Math.random().toString(36).slice(2)}`;
  const fs = new LightningFS(name, { wipe: true });
  const c = creds(token);
  const base = {
    fs,
    http,
    dir: "/repo",
    url,
    corsProxy: `${window.location.origin}/api/git-proxy`,
    onAuth: () => ({ username: c.username, password: c.password }),
    onAuthFailure: () => {
      throw new Error("Git host rejected the credentials (check username and token).");
    },
  };
  const author = { name: c.username || "vpip", email: `${c.username || "vpip"}@users.noreply.vpip` };
  const done = () => {
    try {
      indexedDB.deleteDatabase(name);
    } catch {
      /* ignore */
    }
  };
  return { git, fs, base, author, done };
}

function parse(url: string) {
  const u = new URL(url);
  const parts = u.pathname.replace(/\.git$/, "").split("/").filter(Boolean);
  const name = parts.pop() ?? u.hostname;
  return { owner: parts.join("/") || u.hostname, name, htmlUrl: `${u.origin}${u.pathname.replace(/\.git$/, "")}` };
}

async function refs(url: string, token: string) {
  const s = await session(url, token);
  try {
    const list = await s.git.listServerRefs({ ...s.base, symrefs: true });
    return list as Array<{ ref: string; oid: string; target?: string }>;
  } finally {
    s.done();
  }
}

export async function getRepository(token: string, url: string): Promise<GhRepoInfo> {
  const list = await refs(url, token);
  const head = list.find((r) => r.ref === "HEAD");
  const branches = list.filter((r) => r.ref.startsWith("refs/heads/"));
  const def = head?.target?.replace("refs/heads/", "") ?? branches[0]?.ref.replace("refs/heads/", "") ?? "main";
  const p = parse(url);
  return { ...p, fullName: url, description: "", visibility: "private", defaultBranch: def };
}

export async function listBranches(token: string, url: string): Promise<GhBranch[]> {
  const list = await refs(url, token);
  return list
    .filter((r) => r.ref.startsWith("refs/heads/"))
    .map((r) => ({ name: r.ref.replace("refs/heads/", ""), sha: r.oid }));
}

export async function whoAmI(token: string, url: string) {
  await refs(url, token);
  return creds(token).username;
}

async function walk(fs: { promises: any }, dir: string, out: GhFile[], root = dir) {
  for (const entry of (await fs.promises.readdir(dir)) as string[]) {
    if (entry === ".git") continue;
    const p = `${dir}/${entry}`;
    const st = await fs.promises.stat(p);
    if (st.isDirectory()) await walk(fs, p, out, root);
    else {
      try {
        const content = (await fs.promises.readFile(p, { encoding: "utf8" })) as string;
        out.push({ path: p.slice(root.length + 1), content });
      } catch {
        /* binary — skipped */
      }
    }
  }
}

export async function readBranchFiles(token: string, url: string, branch: string): Promise<GhFile[]> {
  const s = await session(url, token);
  try {
    await s.git.clone({ ...s.base, ref: branch, singleBranch: true, depth: 1 });
    const out: GhFile[] = [];
    await walk(s.fs, "/repo", out);
    return out;
  } finally {
    s.done();
  }
}

export async function listCommits(token: string, url: string, branch: string): Promise<GhCommit[]> {
  const s = await session(url, token);
  try {
    await s.git.clone({ ...s.base, ref: branch, singleBranch: true, depth: 50, noCheckout: true });
    const log = await s.git.log({ fs: s.fs, dir: "/repo", ref: branch, depth: 50 });
    const web = parse(url).htmlUrl;
    return log.map((c: any) => ({
      sha: c.oid,
      message: c.commit.message,
      author: c.commit.author.name,
      date: new Date(c.commit.author.timestamp * 1000).toISOString(),
      htmlUrl: `${web}/commit/${c.oid}`,
    }));
  } finally {
    s.done();
  }
}

async function mkdirp(fs: { promises: any }, path: string) {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur += `/${part}`;
    try {
      await fs.promises.mkdir(cur);
    } catch {
      /* exists */
    }
  }
}

export async function commitFiles(
  token: string,
  url: string,
  branch: string,
  message: string,
  files: GhFile[],
): Promise<GhCommit> {
  if (files.length === 0) throw new Error("No files selected for this commit.");
  const s = await session(url, token);
  try {
    await s.git.clone({ ...s.base, ref: branch, singleBranch: true, depth: 1 });
    for (const f of files) {
      const path = f.path.replace(/^\/+/, "");
      const dir = path.split("/").slice(0, -1).join("/");
      if (dir) await mkdirp(s.fs, `/repo/${dir}`);
      await s.fs.promises.writeFile(`/repo/${path}`, f.content, "utf8");
      await s.git.add({ fs: s.fs, dir: "/repo", filepath: path });
    }
    const sha = await s.git.commit({ fs: s.fs, dir: "/repo", message, author: s.author });
    const res = await s.git.push({ ...s.base, ref: branch, remoteRef: branch });
    if (res && res.ok === false) throw new Error(`Push rejected: ${res.error ?? "unknown"}`);
    return { sha, message, author: s.author.name, date: new Date().toISOString(), htmlUrl: `${parse(url).htmlUrl}/commit/${sha}` };
  } finally {
    s.done();
  }
}

export async function createBranch(token: string, url: string, name: string, fromBranch: string): Promise<GhBranch> {
  const s = await session(url, token);
  try {
    await s.git.clone({ ...s.base, ref: fromBranch, singleBranch: true, depth: 1, noCheckout: true });
    const sha = await s.git.resolveRef({ fs: s.fs, dir: "/repo", ref: fromBranch });
    await s.git.push({ ...s.base, ref: fromBranch, remoteRef: `refs/heads/${name}` });
    return { name, sha };
  } finally {
    s.done();
  }
}

export async function mergeBranch(token: string, url: string, base: string, head: string, message: string) {
  const s = await session(url, token);
  try {
    await s.git.clone({ ...s.base, ref: base, singleBranch: false, noCheckout: true });
    await s.git.branch({ fs: s.fs, dir: "/repo", ref: head, object: `refs/remotes/origin/${head}` }).catch(() => {});
    const r = await s.git.merge({ fs: s.fs, dir: "/repo", ours: base, theirs: head, message, author: s.author });
    await s.git.push({ ...s.base, ref: base, remoteRef: base });
    return (r.oid as string) ?? "";
  } finally {
    s.done();
  }
}
