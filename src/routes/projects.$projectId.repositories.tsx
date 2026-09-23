import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  Github,
  Link2Off,
  Plus,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { ExtractButton } from "@/components/vpip/ExtractButton";
import { repositorySource, artifactSource } from "@/lib/vpip/upgrade";
import { EmptyState, Tag, relTime } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpip, useVpipActions } from "@/lib/vpip/store";
import * as gh from "@/lib/vpip/github";
import { coderTrace } from "@/lib/vpip/coder";
import type {
  BuildSession,
  RepoVisibility,
  Repository,
} from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/repositories")({
  head: () => ({
    meta: [
      { title: "Repositories — VPIP" },
      {
        name: "description",
        content:
          "Version control for AI-generated software: GitHub repositories linked to the project, its build sessions, prompts, decisions and requirements.",
      },
      { property: "og:title", content: "Repositories — VPIP" },
      {
        property: "og:description",
        content:
          "Create or connect a GitHub repository, commit build session files and trace every commit back to its requirement.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RepositoriesPage,
});

function RepositoriesPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const { ws } = useVpip();
  const [openId, setOpenId] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "create" | "connect">("none");

  const repos = p.repositories;
  const repo = repos.find((r) => r.id === openId) ?? repos[0];

  return (
    <Shell
      title="Repository Management"
      subtitle={`${repos.length} ${repos.length === 1 ? "repository" : "repositories"} linked to this project`}
      actions={
        <div className="flex items-center gap-2">
          <Button size="sm" className="h-8" onClick={() => setMode("create")}>
            <Plus className="size-4" /> Create repository
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setMode("connect")}
          >
            <Github className="size-4" /> Connect existing
          </Button>
          {repo ? (
            <ExtractButton
              projectId={projectId}
              source={repositorySource(repo, p.repoCommits)}
              label="Extract repo knowledge"
            />
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {mode !== "none" ? (
          <RepoForm
            projectId={projectId}
            kind={mode}
            onDone={(id) => {
              setMode("none");
              if (id) setOpenId(id);
            }}
          />
        ) : null}

        {repos.length === 0 ? (
          <EmptyState
            title="No repository linked yet"
            description="Create a new GitHub repository or connect an existing one with your own access token. Nothing is stored anywhere except your vault."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <div className="panel divide-y divide-border self-start">
              {repos.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setOpenId(r.id)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                    repo?.id === r.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Github className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{r.fullName}</span>
                    <span className="label-mono">
                      {r.status} · {r.currentBranch} · {relTime(r.updatedAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {repo ? (
              <RepoDetail
                key={repo.id}
                repo={repo}
                projectId={projectId}
                builds={p.buildSessions}
                onDisconnected={() => setOpenId(null)}
                knowledge={ws.knowledge}
              />
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}

/* --------------------------------------------------- create / connect */

function RepoForm({
  projectId,
  kind,
  onDone,
}: {
  projectId: string;
  kind: "create" | "connect";
  onDone: (id?: string) => void;
}) {
  const actions = useVpipActions();
  const [token, setToken] = useState("");
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<RepoVisibility>("private");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      const info =
        kind === "create"
          ? await gh.createRepository(token, { name: name.trim(), description, visibility })
          : await gh.getRepository(token, fullName.trim());
      const created = actions.addRepository({
        projectId,
        provider: "GitHub",
        owner: info.owner,
        name: info.name,
        fullName: info.fullName,
        description: kind === "create" ? description : info.description,
        visibility: info.visibility,
        defaultBranch: info.defaultBranch,
        currentBranch: info.defaultBranch,
        htmlUrl: info.htmlUrl,
        token,
        status: "Connected",
        validatedAt: new Date().toISOString(),
      });
      const branches = await gh.listBranches(token, info.fullName);
      actions.syncRepoBranches(created.id, branches);
      toast.success(
        kind === "create" ? `Repository ${info.fullName} created` : `Connected to ${info.fullName}`,
      );
      onDone(created.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Repository request failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel space-y-3 p-5">
      <div className="text-sm font-medium">
        {kind === "create" ? "Create repository" : "Connect existing repository"}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {kind === "create" ? (
          <>
            <Field label="Repository name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="my-app" />
            </Field>
            <Field label="Visibility">
              <Select value={visibility} onValueChange={(v) => setVisibility(v as RepoVisibility)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="private">Private</SelectItem>
                  <SelectItem value="public">Public</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </>
        ) : (
          <Field label="Repository (owner/name)">
            <Input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="octocat/my-app"
            />
          </Field>
        )}
        <Field label="GitHub access token">
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="your own token"
          />
        </Field>
      </div>
      {kind === "create" ? (
        <Field label="Description">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            placeholder="What this repository holds"
          />
        </Field>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-8" disabled={busy} onClick={() => void submit()}>
          {busy ? "Working…" : kind === "create" ? "Create and link" : "Connect and link"}
        </Button>
        <Button size="sm" variant="ghost" className="h-8" onClick={() => onDone()}>
          Cancel
        </Button>
        <span className="label-mono">
          Token stays in this vault only · nothing is hardcoded
        </span>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="label-mono">{label}</span>
      {children}
    </label>
  );
}

/* ------------------------------------------------------------- detail */

function RepoDetail({
  repo,
  projectId,
  builds,
  onDisconnected,
  knowledge,
}: {
  repo: Repository;
  projectId: string;
  builds: BuildSession[];
  onDisconnected: () => void;
  knowledge: import("@/lib/vpip/types").KnowledgeItem[];
}) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const [busy, setBusy] = useState<string | null>(null);

  const branches = (ws.repoBranches ?? []).filter((b) => b.repositoryId === repo.id);
  const commits = (ws.repoCommits ?? []).filter((c) => c.repositoryId === repo.id);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "GitHub request failed";
      toast.error(msg);
      if (/401|403|404/.test(msg)) {
        actions.updateRepository(repo.id, { status: "Invalid", statusMessage: msg });
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel space-y-4 p-5">
      {/* ------------------------------------------ repository information */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Github className="size-4" />
            <a href={repo.htmlUrl} target="_blank" rel="noreferrer" className="hover:underline">
              {repo.fullName}
            </a>
          </h2>
          {repo.description ? (
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">{repo.description}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{repo.provider}</Tag>
            <Tag>{repo.visibility}</Tag>
            <Tag>default {repo.defaultBranch}</Tag>
            <Tag>current {repo.currentBranch}</Tag>
            <Tag>{repo.status}</Tag>
            {repo.validatedAt ? <Tag>validated {relTime(repo.validatedAt)}</Tag> : null}
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            Last commit ·{" "}
            {repo.lastCommitSha ? (
              <span className="font-mono">
                {gh.shortSha(repo.lastCommitSha)} — {repo.lastCommitMessage} (
                {relTime(repo.lastCommitAt)})
              </span>
            ) : (
              "none recorded yet"
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy !== null}
            onClick={() =>
              void run("validate", async () => {
                const login = await gh.whoAmI(repo.token);
                const info = await gh.getRepository(repo.token, repo.fullName);
                actions.updateRepository(repo.id, {
                  status: "Connected",
                  statusMessage: `Authenticated as ${login}`,
                  validatedAt: new Date().toISOString(),
                  defaultBranch: info.defaultBranch,
                  visibility: info.visibility,
                  description: info.description,
                });
                toast.success(`Connection valid — authenticated as ${login}`);
              })
            }
          >
            <ShieldCheck className="size-4" /> Validate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={busy !== null}
            onClick={() =>
              void run("fetch", async () => {
                const { info, branches: remote } = await gh.fetchRefs(repo.token, repo.fullName);
                actions.syncRepoBranches(repo.id, remote);
                actions.updateRepository(repo.id, {
                  defaultBranch: info.defaultBranch,
                  visibility: info.visibility,
                  status: "Connected",
                });
                toast.success(`Fetched ${remote.length} branches`);
              })
            }
          >
            <RefreshCw className="size-4" /> Fetch
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-destructive"
            onClick={() => {
              actions.removeRepository(repo.id);
              onDisconnected();
              toast.success("Repository disconnected and token removed");
            }}
          >
            <Link2Off className="size-4" /> Disconnect
          </Button>
        </div>
      </div>
      {repo.statusMessage ? (
        <div className="label-mono">{repo.statusMessage}</div>
      ) : null}

      <Tabs defaultValue="operations">
        <TabsList>
          <TabsTrigger value="operations">Operations</TabsTrigger>
          <TabsTrigger value="commits">Commits</TabsTrigger>
          <TabsTrigger value="branches">Branches</TabsTrigger>
        </TabsList>

        <TabsContent value="operations" className="pt-3">
          <Operations repo={repo} builds={builds} busy={busy} run={run} />
        </TabsContent>

        <TabsContent value="commits" className="pt-3">
          <CommitPanel
            repo={repo}
            projectId={projectId}
            builds={builds}
            knowledge={knowledge}
            busy={busy}
            run={run}
          />
          <CommitHistory repo={repo} commits={commits} projectId={projectId} busy={busy} run={run} />
        </TabsContent>

        <TabsContent value="branches" className="pt-3">
          <BranchPanel repo={repo} branches={branches} busy={busy} run={run} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

type Runner = (label: string, fn: () => Promise<void>) => Promise<void>;

/* -------------------------------------------------------- operations */

function Operations({
  repo,
  builds,
  busy,
  run,
}: {
  repo: Repository;
  builds: BuildSession[];
  busy: string | null;
  run: Runner;
}) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const [buildId, setBuildId] = useState(builds[0]?.id ?? "");
  const build = builds.find((b) => b.id === buildId);

  function traceFor(session: BuildSession) {
    const prompt = ws.prompts.find((p) => p.id === session.promptId);
    const decisions = ws.knowledge.filter((k) =>
      (prompt?.linkedDecisionIds ?? []).includes(k.id),
    );
    const requirements = ws.knowledge.filter((k) =>
      (prompt?.linkedRequirementIds ?? []).includes(k.id),
    );
    return coderTrace(session, decisions, requirements);
  }

  async function pullInto(session: BuildSession, label: string) {
    const files = await gh.readBranchFiles(repo.token, repo.fullName, repo.currentBranch);
    const trace = traceFor(session);
    for (const f of files) {
      actions.writeCoderFile(session.id, f.path, f.content, {
        note: `${label} from ${repo.fullName}@${repo.currentBranch}`,
        trace,
      });
    }
    actions.logCoderAction(session.id, {
      kind: "Generate Code",
      summary: `${label} ${files.length} files from ${repo.fullName}@${repo.currentBranch}`,
      filesModified: files.map((f) => f.path),
      trace,
    });
    actions.linkBuildRepository(session.id, {
      repositoryId: repo.id,
      repositoryFullName: repo.fullName,
      repositoryProvider: repo.provider,
      repositoryBranch: repo.currentBranch,
    });
    toast.success(`${label} complete — ${files.length} files in ${session.code}`);
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Build session used for clone / pull / push">
          <Select value={buildId} onValueChange={setBuildId}>
            <SelectTrigger>
              <SelectValue placeholder="Select a build session" />
            </SelectTrigger>
            <SelectContent>
              {builds.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.code} — {b.promptTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Working branch">
          <Input
            value={repo.currentBranch}
            onChange={(e) => actions.updateRepository(repo.id, { currentBranch: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!build || busy !== null}
          onClick={() => void run("clone", () => pullInto(build!, "Clone"))}
        >
          <ArrowDownToLine className="size-4" /> Clone repository
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={!build || busy !== null}
          onClick={() => void run("pull", () => pullInto(build!, "Pull"))}
        >
          <ArrowDownToLine className="size-4" /> Pull changes
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy !== null}
          onClick={() =>
            void run("fetch", async () => {
              const { branches } = await gh.fetchRefs(repo.token, repo.fullName);
              actions.syncRepoBranches(repo.id, branches);
              toast.success("Remote refs fetched");
            })
          }
        >
          <RefreshCw className="size-4" /> Fetch changes
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Push changes is on the Commits tab — every push is recorded as a commit with its build
        session, prompt, decisions and requirements.
      </p>
      {build ? (
        <div className="label-mono">
          {build.code} holds {(build.files ?? []).length} files ·{" "}
          {build.repositoryFullName
            ? `linked to ${build.repositoryFullName}@${build.repositoryBranch}`
            : "not linked to a repository yet"}
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ commits */

function CommitPanel({
  repo,
  projectId,
  builds,
  knowledge,
  busy,
  run,
}: {
  repo: Repository;
  projectId: string;
  builds: BuildSession[];
  knowledge: import("@/lib/vpip/types").KnowledgeItem[];
  busy: string | null;
  run: Runner;
}) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const [buildId, setBuildId] = useState(builds[0]?.id ?? "");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<string[]>([]);

  const build = builds.find((b) => b.id === buildId);
  const files = build?.files ?? [];
  const prompt = ws.prompts.find((p) => p.id === build?.promptId);
  const decisions = useMemo(
    () => knowledge.filter((k) => (prompt?.linkedDecisionIds ?? []).includes(k.id)),
    [knowledge, prompt],
  );
  const requirements = useMemo(
    () => knowledge.filter((k) => (prompt?.linkedRequirementIds ?? []).includes(k.id)),
    [knowledge, prompt],
  );

  const chosen = files.filter((f) => selected.includes(f.path));

  async function push() {
    if (!build) return;
    const commit = await gh.commitFiles(
      repo.token,
      repo.fullName,
      repo.currentBranch,
      message.trim() || `${build.code}: update from VPIP`,
      chosen.map((f) => ({ path: f.path, content: f.content })),
    );
    actions.addRepoCommit({
      repositoryId: repo.id,
      projectId,
      sha: commit.sha,
      message: commit.message,
      branch: repo.currentBranch,
      files: chosen.map((f) => f.path),
      htmlUrl: commit.htmlUrl,
      author: commit.author,
      buildSessionId: build.id,
      buildCode: build.code,
      promptId: build.promptId,
      promptTitle: build.promptTitle,
      promptVersion: build.promptVersion,
      decisionCodes: decisions.map((d) => d.code),
      requirementCodes: requirements.map((r) => r.code),
      provider: repo.provider,
    });
    setMessage("");
    setSelected([]);
    toast.success(`Committed ${gh.shortSha(commit.sha)} to ${repo.currentBranch}`);
  }

  return (
    <div className="space-y-3 border-b border-border pb-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Build session">
          <Select
            value={buildId}
            onValueChange={(v) => {
              setBuildId(v);
              setSelected([]);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a build session" />
            </SelectTrigger>
            <SelectContent>
              {builds.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.code} — {b.promptTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Commit message">
          <Input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={build ? `${build.code}: ...` : "message"}
          />
        </Field>
      </div>

      {build ? (
        <div className="flex flex-wrap gap-1.5">
          <Tag>prompt {build.promptTitle} V{build.promptVersion}</Tag>
          {decisions.map((d) => (
            <Tag key={d.id}>{d.code}</Tag>
          ))}
          {requirements.map((r) => (
            <Tag key={r.id}>{r.code}</Tag>
          ))}
        </div>
      ) : null}

      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          This build session has no files yet. Generate files in the AI Coder first.
        </p>
      ) : (
        <div className="max-h-56 overflow-y-auto rounded-sm border border-border">
          {files.map((f) => (
            <label
              key={f.path}
              className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs last:border-b-0"
            >
              <Checkbox
                checked={selected.includes(f.path)}
                onCheckedChange={(v) =>
                  setSelected((prev) =>
                    v ? [...prev, f.path] : prev.filter((x) => x !== f.path),
                  )
                }
              />
              <span className="font-mono">{f.path}</span>
              <span className="label-mono ml-auto">V{f.versions.length}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-8"
          disabled={!build || chosen.length === 0 || busy !== null}
          onClick={() => void run("push", push)}
        >
          <ArrowUpFromLine className="size-4" /> Push changes ({chosen.length})
        </Button>
        {files.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() =>
              setSelected(selected.length === files.length ? [] : files.map((f) => f.path))
            }
          >
            {selected.length === files.length ? "Clear selection" : "Select all files"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CommitHistory({
  repo,
  commits,
  projectId,
  busy,
  run,
}: {
  repo: Repository;
  commits: import("@/lib/vpip/types").RepoCommit[];
  projectId: string;
  busy: string | null;
  run: Runner;
}) {
  const [remote, setRemote] = useState<gh.GhCommit[]>([]);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Commit history</div>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          disabled={busy !== null}
          onClick={() =>
            void run("history", async () => {
              setRemote(await gh.listCommits(repo.token, repo.fullName, repo.currentBranch));
            })
          }
        >
          <RefreshCw className="size-4" /> Load from {repo.currentBranch}
        </Button>
      </div>

      {commits.length === 0 ? (
        <p className="text-xs text-muted-foreground">No commits recorded from this vault yet.</p>
      ) : (
        <div className="space-y-2">
          {commits.map((c) => (
            <div key={c.id} className="rounded-sm border border-border px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" />
                <span className="font-mono text-xs">{gh.shortSha(c.sha)}</span>
                <span className="min-w-0 truncate">{c.message}</span>
                {c.htmlUrl ? (
                  <a
                    href={c.htmlUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="label-mono ml-auto underline"
                  >
                    view
                  </a>
                ) : null}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                <Tag>{c.branch}</Tag>
                <Tag>{c.provider}</Tag>
                {c.buildCode ? <Tag>{c.buildCode}</Tag> : null}
                {c.promptVersion ? <Tag>prompt V{c.promptVersion}</Tag> : null}
                {c.decisionCodes.map((d) => (
                  <Tag key={d}>{d}</Tag>
                ))}
                {c.requirementCodes.map((r) => (
                  <Tag key={r}>{r}</Tag>
                ))}
                <Tag>{c.files.length} files</Tag>
                <Tag>{new Date(c.createdAt).toLocaleString()}</Tag>
              </div>
              {c.buildSessionId ? (
                <div className="label-mono mt-1.5">
                  Trace ·{" "}
                  <Link
                    to="/projects/$projectId/coder/$buildId"
                    params={{ projectId, buildId: c.buildSessionId }}
                    className="underline"
                  >
                    open {c.buildCode} in AI Coder
                  </Link>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {remote.length > 0 ? (
        <div className="space-y-1.5">
          <div className="label-mono">Remote history · {repo.currentBranch}</div>
          {remote.map((c) => (
            <div
              key={c.sha}
              className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-xs"
            >
              <span className="font-mono">{gh.shortSha(c.sha)}</span>
              <span className="min-w-0 truncate">{c.message.split("\n")[0]}</span>
              <span className="label-mono ml-auto shrink-0">
                {c.author} · {relTime(c.date)}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------- branches */

function BranchPanel({
  repo,
  branches,
  busy,
  run,
}: {
  repo: Repository;
  branches: import("@/lib/vpip/types").RepoBranch[];
  busy: string | null;
  run: Runner;
}) {
  const actions = useVpipActions();
  const [newBranch, setNewBranch] = useState("");
  const [from, setFrom] = useState(repo.currentBranch);
  const [mergeHead, setMergeHead] = useState("");

  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">
        <Field label="New branch name">
          <Input
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            placeholder="feature/x"
          />
        </Field>
        <Field label="Created from">
          <Select value={from} onValueChange={setFrom}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[...new Set([repo.defaultBranch, ...branches.map((b) => b.name)])].map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button
            size="sm"
            className="h-8"
            disabled={!newBranch.trim() || busy !== null}
            onClick={() =>
              void run("branch", async () => {
                const created = await gh.createBranch(
                  repo.token,
                  repo.fullName,
                  newBranch.trim(),
                  from,
                );
                actions.addRepoBranch({
                  repositoryId: repo.id,
                  name: created.name,
                  sha: created.sha,
                  baseBranch: from,
                });
                actions.updateRepository(repo.id, { currentBranch: created.name });
                setNewBranch("");
                toast.success(`Branch ${created.name} created and switched to`);
              })
            }
          >
            <GitBranch className="size-4" /> Create branch
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <Field label="Merge branch into current">
          <Select value={mergeHead} onValueChange={setMergeHead}>
            <SelectTrigger>
              <SelectValue placeholder="Select source branch" />
            </SelectTrigger>
            <SelectContent>
              {branches
                .filter((b) => b.name !== repo.currentBranch)
                .map((b) => (
                  <SelectItem key={b.id} value={b.name}>
                    {b.name}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </Field>
        <div className="flex items-end">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={!mergeHead || busy !== null}
            onClick={() =>
              void run("merge", async () => {
                const sha = await gh.mergeBranch(
                  repo.token,
                  repo.fullName,
                  repo.currentBranch,
                  mergeHead,
                  `Merge ${mergeHead} into ${repo.currentBranch}`,
                );
                const remote = await gh.listBranches(repo.token, repo.fullName);
                actions.syncRepoBranches(repo.id, remote);
                toast.success(
                  sha ? `Merged ${mergeHead} — ${gh.shortSha(sha)}` : `${mergeHead} already merged`,
                );
              })
            }
          >
            <GitMerge className="size-4" /> Merge branch
          </Button>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="label-mono">Branches · current {repo.currentBranch}</div>
        {branches.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No branches loaded yet — use Fetch to read them from GitHub.
          </p>
        ) : (
          branches.map((b) => (
            <div
              key={b.id}
              className="flex items-center gap-2 rounded-sm border border-border px-3 py-1.5 text-xs"
            >
              {b.name === repo.currentBranch ? (
                <CheckCircle2 className="size-3.5 text-success" />
              ) : (
                <GitBranch className="size-3.5 text-muted-foreground" />
              )}
              <span className="font-mono">{b.name}</span>
              <span className="label-mono">{gh.shortSha(b.sha)}</span>
              {b.baseBranch ? <Tag>from {b.baseBranch}</Tag> : null}
              {b.name !== repo.currentBranch ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-auto h-7"
                  onClick={() => {
                    actions.updateRepository(repo.id, { currentBranch: b.name });
                    toast.success(`Switched to ${b.name}`);
                  }}
                >
                  Switch
                </Button>
              ) : (
                <span className="label-mono ml-auto">current</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
