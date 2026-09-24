import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import * as gh from "@/lib/vpip/github";
import { isGenericRemote } from "@/lib/vpip/git-remote";
import type { GhFile } from "@/lib/vpip/github";
import { coderTrace } from "@/lib/vpip/coder";

/** Detect the framework from package.json and config files. */
export function detectFramework(files: GhFile[]): string {
  const has = (re: RegExp) => files.some((f) => re.test(f.path));
  let deps: Record<string, string> = {};
  const pkg = files.find((f) => f.path === "package.json");
  if (pkg) {
    try {
      const j = JSON.parse(pkg.content) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      deps = { ...j.dependencies, ...j.devDependencies };
    } catch {
      /* invalid package.json */
    }
  }
  const found: string[] = [];
  if (deps["next"] || has(/^next\.config\./)) found.push("Next.js");
  if (deps["@remix-run/react"] || deps["@remix-run/dev"]) found.push("Remix");
  if (deps["@angular/core"] || has(/^angular\.json$/)) found.push("Angular");
  if (deps["vue"] || has(/\.vue$/)) found.push("Vue");
  if (deps["react"]) found.push("React");
  if (deps["vite"] || has(/^vite\.config\./)) found.push("Vite");
  return found.length ? found.join(" + ") : pkg ? "Node.js" : "Static / unknown";
}

function tree(files: GhFile[]) {
  return files
    .map((f) => f.path)
    .sort()
    .map((p) => `- \`${p}\``)
    .join("\n");
}

export function PullRepositoryDialog() {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState("");

  const generic = /^https?:\/\//i.test(url.trim()) && !/github\.com/i.test(url);
  const target = generic ? url.trim() : gh.normalizeGithubName(url);
  // Reuse a token already saved with an earlier repository on the same host.
  const host = generic ? (() => { try { return new URL(target).host; } catch { return ""; } })() : "github.com";
  const saved = (ws.repositories ?? []).find((r) =>
    r.token &&
    (host === "github.com" ? !isGenericRemote(r.fullName) : isGenericRemote(r.fullName) && r.fullName.includes(host)),
  )?.token;

  async function run() {
    const cred = token.trim() || saved || "";
    try {
      if (!target) throw new Error("Enter a repository URL.");
      setBusy("Reading repository…");
      const info = await gh.getRepository(cred, target);
      const br = branch.trim() || info.defaultBranch;
      const [branches, commits] = await Promise.all([
        gh.listBranches(cred, info.fullName),
        gh.listCommits(cred, info.fullName, br).catch(() => []),
      ]);
      if (!branches.some((b) => b.name === br)) throw new Error(`Branch "${br}" does not exist.`);
      setBusy("Downloading files…");
      const files = await gh.readBranchFiles(cred, info.fullName, br);
      if (files.length === 0) throw new Error("No readable files were found on this branch.");
      const framework = detectFramework(files);
      const last = commits[0];
      const pulledAt = new Date().toISOString();

      setBusy("Creating project…");
      const project = actions.createProject(
        info.name,
        `Repository-based project imported from ${info.htmlUrl || info.fullName} (branch ${br}). Framework: ${framework}.`,
      );
      const repo = actions.addRepository({
        projectId: project.id,
        provider: generic ? "Git" : "GitHub",
        owner: info.owner,
        name: info.name,
        fullName: info.fullName,
        description: info.description,
        visibility: info.visibility,
        defaultBranch: info.defaultBranch,
        currentBranch: br,
        htmlUrl: info.htmlUrl,
        token: cred,
        status: "Connected",
        statusMessage: `Last pull ${pulledAt} · ${files.length} files · ${framework}`,
        validatedAt: pulledAt,
        lastCommitSha: last?.sha,
        lastCommitMessage: last?.message,
        lastCommitAt: last?.date,
      });
      actions.syncRepoBranches(repo.id, branches);

      setBusy("Indexing files…");
      actions.addDocument({
        projectId: project.id,
        kind: "Architecture Summary",
        title: `Repository index — ${info.fullName}@${br}`,
        markdown: [
          `# Repository index`,
          ``,
          `- Repository: ${info.htmlUrl || info.fullName}`,
          `- Owner: ${info.owner}`,
          `- Branch: ${br} (default ${info.defaultBranch})`,
          `- Framework: ${framework}`,
          `- Last commit: ${last ? `${gh.shortSha(last.sha)} — ${last.message.split("\n")[0]} (${last.date})` : "unknown"}`,
          `- Pulled: ${pulledAt}`,
          `- Files: ${files.length}`,
          ``,
          `## File tree`,
          ``,
          tree(files),
        ].join("\n"),
      });

      const session = actions.createBuildSession({
        projectId: project.id,
        promptId: "",
        promptTitle: `Imported ${info.fullName}@${br}`,
        promptKind: "Lovable Prompt",
        promptVersion: 1,
        status: "In Progress",
        contextPackage: `Imported from git repository ${info.fullName} (branch ${br}, commit ${last?.sha ?? "unknown"}). Framework: ${framework}.`,
        counts: { decisions: 0, requirements: 0, documents: 1, discussions: 0 },
        note: `Imported from ${info.htmlUrl || info.fullName}`,
      });
      const trace = coderTrace(session, [], []);
      for (const f of files) {
        actions.writeCoderFile(session.id, f.path, f.content, {
          note: `Import from ${info.fullName}@${br}`,
          trace,
        });
      }
      actions.logCoderAction(session.id, {
        kind: "Generate Code",
        summary: `Import ${files.length} files from ${info.fullName}@${br}${last ? ` (${gh.shortSha(last.sha)})` : ""}`,
        filesModified: files.map((f) => f.path),
        trace,
      });
      actions.linkBuildRepository(session.id, {
        repositoryId: repo.id,
        repositoryFullName: info.fullName,
        repositoryProvider: generic ? "Git" : "GitHub",
        repositoryBranch: br,
      });
      actions.createDiscussion({ projectId: project.id, title: `Repository: ${info.name}`, type: "Architecture" });

      toast.success(`Imported ${info.fullName} — ${files.length} files, ${framework}`);
      setOpen(false);
      setUrl("");
      setBranch("");
      setToken("");
      void navigate({
        to: "/projects/$projectId/coder/$buildId",
        params: { projectId: project.id, buildId: session.id },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Repository import failed");
    } finally {
      setBusy("");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-8">
          <GitBranch className="size-4" /> Pull repository
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pull a repository into a new project</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="https://github.com/owner/repo or any https git URL"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Input placeholder="Branch (optional — default branch)" value={branch} onChange={(e) => setBranch(e.target.value)} />
          <Input
            type="password"
            placeholder={saved ? "Saved token will be reused (optional)" : generic ? "username:token (only for private repos)" : "Access token (only for private repos)"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Works with repositories from Lovable, Cursor, Replit, Bolt, Windsurf, GitHub, GitLab, Bitbucket or any https git host.
          </p>
        </div>
        <DialogFooter>
          <Button onClick={() => void run()} disabled={!!busy || !url.trim()}>
            {busy ? <><Loader2 className="size-4 animate-spin" /> {busy}</> : "Pull & create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
