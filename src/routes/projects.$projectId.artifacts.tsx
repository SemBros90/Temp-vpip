import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import JSZip from "jszip";
import {
  Download,
  FileArchive,
  FileCode2,
  Package,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { ExtractButton } from "@/components/vpip/ExtractButton";
import { artifactSource } from "@/lib/vpip/upgrade";
import { EmptyState, Tag, relTime } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { download, slug } from "@/lib/vpip/files";
import { artifactSize, classifyArtifact, formatSize } from "@/lib/vpip/artifacts";
import {
  ARTIFACT_TYPES,
  BUILD_RECORD_STATUSES,
  PROVIDER_LABEL,
  type Artifact,
  type ArtifactType,
  type BuildRecordStatus,
} from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/artifacts")({
  head: () => ({
    meta: [
      { title: "Artifacts & Builds — VPIP" },
      {
        name: "description",
        content:
          "Permanent storage for every development output, with build records, build logs and full change history traced back to prompt, decision and requirement.",
      },
      { property: "og:title", content: "Artifacts & Builds — VPIP" },
      {
        property: "og:description",
        content: "Artifact explorer, build history and change history for the project.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ArtifactsPage,
});

function ArtifactsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();

  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | ArtifactType>("all");
  const [buildFilter, setBuildFilter] = useState<"all" | string>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [captureId, setCaptureId] = useState<string>(p.buildSessions[0]?.id ?? "");
  const [openRunId, setOpenRunId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return p.artifacts.filter((a) => {
      if (typeFilter !== "all" && a.type !== typeFilter) return false;
      if (buildFilter !== "all" && a.buildSessionId !== buildFilter) return false;
      if (!q) return true;
      return (
        a.name.toLowerCase().includes(q) ||
        a.path.toLowerCase().includes(q) ||
        a.code.toLowerCase().includes(q) ||
        a.content.toLowerCase().includes(q) ||
        (a.buildCode ?? "").toLowerCase().includes(q) ||
        a.decisionCodes.join(" ").toLowerCase().includes(q) ||
        a.requirementCodes.join(" ").toLowerCase().includes(q)
      );
    });
  }, [p.artifacts, query, typeFilter, buildFilter]);

  const open = filtered.find((a) => a.id === openId) ?? filtered[0];
  const openRun = p.buildRecords.find((r) => r.id === openRunId) ?? p.buildRecords[0];

  function capture() {
    const session = p.buildSessions.find((b) => b.id === captureId);
    if (!session) {
      toast.error("Pick a build session first");
      return;
    }
    const files = (session.files ?? []).filter((f) => !f.path.endsWith(".folder"));
    const trace = {
      decisionCodes: session.agentTasks?.[0]?.trace.decisionCodes ?? [],
      requirementCodes: session.agentTasks?.[0]?.trace.requirementCodes ?? [],
    };

    const items = files.map((f) => {
      const task = (session.agentTasks ?? []).find((t) =>
        t.changes.some((c) => c.path === f.path),
      );
      return {
        projectId,
        type: classifyArtifact(f.path),
        name: f.path.split("/").pop() ?? f.path,
        path: f.path,
        content: f.content,
        size: artifactSize(f.content),
        buildSessionId: session.id,
        buildCode: session.code,
        taskId: task?.id,
        taskCode: task?.code,
        promptId: session.promptId,
        promptTitle: session.promptTitle,
        promptVersion: session.promptVersion,
        decisionCodes: task?.trace.decisionCodes ?? trace.decisionCodes,
        requirementCodes: task?.trace.requirementCodes ?? trace.requirementCodes,
        repositoryFullName: session.repositoryFullName,
        branch: session.repositoryBranch,
        commitSha: session.lastCommitSha,
        provider: session.provider,
        model: session.model,
      };
    });

    const logLines = (session.terminal ?? [])
      .filter((t) => t.stream === "build" || t.stream === "error")
      .slice(-60)
      .map((t) => `[${t.stream}] ${t.command ? `${t.command} — ` : ""}${t.output}`);

    if (logLines.length) {
      items.push({
        projectId,
        type: "Logs" as ArtifactType,
        name: `${session.code}-build.log`,
        path: `logs/${slug(session.code)}-build.log`,
        content: logLines.join("\n"),
        size: artifactSize(logLines.join("\n")),
        buildSessionId: session.id,
        buildCode: session.code,
        taskId: undefined,
        taskCode: undefined,
        promptId: session.promptId,
        promptTitle: session.promptTitle,
        promptVersion: session.promptVersion,
        decisionCodes: trace.decisionCodes,
        requirementCodes: trace.requirementCodes,
        repositoryFullName: session.repositoryFullName,
        branch: session.repositoryBranch,
        commitSha: session.lastCommitSha,
        provider: session.provider,
        model: session.model,
      });
    }

    const summaries = (session.agentTasks ?? [])
      .map((t) => t.buildSummary)
      .filter(Boolean)
      .join("\n\n");

    actions.captureBuild({
      record: {
        projectId,
        buildSessionId: session.id,
        buildCode: session.code,
        repositoryId: session.repositoryId,
        repositoryFullName: session.repositoryFullName,
        branch: session.repositoryBranch,
        commitSha: session.lastCommitSha,
        promptId: session.promptId,
        promptTitle: session.promptTitle,
        promptVersion: session.promptVersion,
        provider: session.provider,
        model: session.model,
        status: "Running" as BuildRecordStatus,
        startedAt: new Date().toISOString(),
        logs: [`Capture started for ${session.code}`, `${files.length} session files read`],
        artifactIds: [],
        decisionCodes: trace.decisionCodes,
        requirementCodes: trace.requirementCodes,
      },
      items,
      summary:
        summaries ||
        `${files.length} files stored from ${session.code} (${session.promptTitle} V${session.promptVersion}).`,
      output: items.map((i) => `${i.type} · ${i.path} · ${formatSize(i.size)}`).join("\n"),
    });
    toast.success("Build captured");
  }

  async function downloadAll() {
    const zip = new JSZip();
    for (const a of filtered) zip.file(`${a.code}-${a.path}`, a.content);
    const blob = await zip.generateAsync({ type: "blob" });
    download(blob, `artifacts-${slug(p.project?.name ?? "project")}.zip`);
  }

  return (
    <Shell
      title="Artifacts & Builds"
      subtitle={`${p.artifacts.length} artifacts · ${p.buildRecords.length} build runs · ${p.changeRecords.length} recorded changes`}
      actions={
        <div className="flex items-center gap-2">
          <Select value={captureId} onValueChange={setCaptureId}>
            <SelectTrigger className="h-8 w-[220px] font-mono text-xs">
              <SelectValue placeholder="Build session" />
            </SelectTrigger>
            <SelectContent>
              {p.buildSessions.map((b) => (
                <SelectItem key={b.id} value={b.id} className="font-mono text-xs">
                  {b.code} · {b.promptTitle}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" className="h-8" onClick={capture} disabled={!p.buildSessions.length}>
            <Play className="size-4" /> Capture build
          </Button>
          {open ? (
            <ExtractButton
              projectId={projectId}
              source={artifactSource(open)}
              label="Extract artifact knowledge"
            />
          ) : null}
        </div>
      }
    >
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <Tabs defaultValue="artifacts">
          <TabsList>
            <TabsTrigger value="artifacts">Artifact Explorer</TabsTrigger>
            <TabsTrigger value="builds">Build History</TabsTrigger>
            <TabsTrigger value="changes">Change History</TabsTrigger>
          </TabsList>

          {/* ------------------------------------------- artifact explorer */}
          <TabsContent value="artifacts" className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[240px] flex-1">
                <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search artifacts, paths, codes, contents"
                  className="h-9 pl-8"
                />
              </div>
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                <SelectTrigger className="h-9 w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  {ARTIFACT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={buildFilter} onValueChange={setBuildFilter}>
                <SelectTrigger className="h-9 w-[190px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All build sessions</SelectItem>
                  {p.buildSessions.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="h-9"
                onClick={() => void downloadAll()}
                disabled={!filtered.length}
              >
                <FileArchive className="size-4" /> Download all
              </Button>
            </div>

            {!p.artifacts.length ? (
              <EmptyState
                title="No artifacts stored yet"
                description="Pick a build session above and press Capture build. Every file, document, SQL script and log in that session is stored permanently with its full trace."
              />
            ) : !filtered.length ? (
              <EmptyState title="Nothing matches" description="Adjust the search or filters." />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                <div className="panel divide-y divide-border self-start">
                  {filtered.map((a) => (
                    <button
                      key={a.id}
                      onClick={() => setOpenId(a.id)}
                      className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                        open?.id === a.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <FileCode2 className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">{a.code}</span>
                        <span className="block truncate">{a.path}</span>
                        <span className="label-mono">
                          {a.type} · {formatSize(a.size)} · {relTime(a.updatedAt)}
                        </span>
                      </span>
                      <Trash2
                        className="mt-0.5 size-3.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.deleteArtifact(a.id);
                        }}
                      />
                    </button>
                  ))}
                </div>

                {open ? <ArtifactDetail a={open} projectId={projectId} /> : null}
              </div>
            )}
          </TabsContent>

          {/* ------------------------------------------------ build history */}
          <TabsContent value="builds" className="mt-4 space-y-3">
            {!p.buildRecords.length ? (
              <EmptyState
                title="No build runs recorded"
                description="Capturing a build session creates a build record with its status, start and end time, summary, output and logs."
              />
            ) : (
              <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                <div className="panel divide-y divide-border self-start">
                  {p.buildRecords.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setOpenRunId(r.id)}
                      className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                        openRun?.id === r.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      <Package className="mt-0.5 size-4 shrink-0" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-mono text-xs">
                          {r.code} · {r.buildCode}
                        </span>
                        <span className="block truncate">{r.promptTitle}</span>
                        <span className="label-mono">
                          {r.status} · {r.artifactIds.length} artifacts · {relTime(r.startedAt)}
                        </span>
                      </span>
                      <Trash2
                        className="mt-0.5 size-3.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.deleteBuildRecord(r.id);
                        }}
                      />
                    </button>
                  ))}
                </div>

                {openRun ? (
                  <div className="panel space-y-4 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h2 className="text-base font-semibold">
                          <span className="font-mono text-sm text-muted-foreground">
                            {openRun.code}
                          </span>{" "}
                          {openRun.promptTitle}
                        </h2>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <Tag>{openRun.buildCode}</Tag>
                          <Tag>V{openRun.promptVersion}</Tag>
                          <Tag>
                            {openRun.provider ? PROVIDER_LABEL[openRun.provider] : "No provider"}
                          </Tag>
                          {openRun.repositoryFullName ? (
                            <Tag>{openRun.repositoryFullName}</Tag>
                          ) : null}
                          {openRun.branch ? <Tag>{openRun.branch}</Tag> : null}
                          {openRun.commitSha ? <Tag>{openRun.commitSha.slice(0, 7)}</Tag> : null}
                        </div>
                        <div className="label-mono mt-2">
                          Start {new Date(openRun.startedAt).toLocaleString()} · End{" "}
                          {openRun.endedAt ? new Date(openRun.endedAt).toLocaleString() : "—"}
                        </div>
                      </div>
                      <Select
                        value={openRun.status}
                        onValueChange={(v) =>
                          actions.updateBuildRecord(openRun.id, {
                            status: v as BuildRecordStatus,
                          })
                        }
                      >
                        <SelectTrigger className="h-8 w-[150px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUILD_RECORD_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <Section title="Build summary">
                      <p className="whitespace-pre-wrap text-sm text-muted-foreground">
                        {openRun.summary ?? "—"}
                      </p>
                    </Section>
                    <Section title="Build output">
                      <pre className="max-h-64 overflow-auto rounded-sm bg-surface-2 p-3 font-mono text-[11px]">
                        {openRun.output ?? "—"}
                      </pre>
                    </Section>
                    <Section title="Build logs">
                      <pre className="max-h-64 overflow-auto rounded-sm bg-surface-2 p-3 font-mono text-[11px]">
                        {openRun.logs.join("\n") || "—"}
                      </pre>
                    </Section>
                    <div className="label-mono">
                      Build session ·{" "}
                      <Link
                        to="/projects/$projectId/coder/$buildId"
                        params={{ projectId, buildId: openRun.buildSessionId }}
                        className="underline"
                      >
                        open in AI Coder
                      </Link>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </TabsContent>

          {/* ----------------------------------------------- change history */}
          <TabsContent value="changes" className="mt-4">
            {!p.changeRecords.length ? (
              <EmptyState
                title="No changes recorded"
                description="Created, modified, deleted and renamed files are recorded each time a build is captured."
              />
            ) : (
              <div className="panel divide-y divide-border">
                {p.changeRecords.map((c) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <Tag>{c.action}</Tag>
                    <span className="font-mono text-xs">{c.path}</span>
                    {c.fromPath ? (
                      <span className="label-mono">from {c.fromPath}</span>
                    ) : null}
                    <span className="ml-auto flex flex-wrap items-center gap-1.5">
                      {c.buildCode ? <Tag>{c.buildCode}</Tag> : null}
                      {c.buildRunCode ? <Tag>{c.buildRunCode}</Tag> : null}
                      {c.taskCode ? <Tag>{c.taskCode}</Tag> : null}
                      {c.provider ? <Tag>{PROVIDER_LABEL[c.provider]}</Tag> : null}
                      <span className="label-mono">{new Date(c.createdAt).toLocaleString()}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </Shell>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="label-mono">{title}</div>
      {children}
    </div>
  );
}

function ArtifactDetail({ a, projectId }: { a: Artifact; projectId: string }) {
  return (
    <div className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">
            <span className="font-mono text-sm text-muted-foreground">{a.code}</span> {a.name}
          </h2>
          <div className="label-mono mt-1">{a.path}</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Tag>{a.type}</Tag>
            <Tag>{formatSize(a.size)}</Tag>
            {a.buildCode ? <Tag>{a.buildCode}</Tag> : null}
            {a.buildRunCode ? <Tag>{a.buildRunCode}</Tag> : null}
            {a.taskCode ? <Tag>{a.taskCode}</Tag> : null}
            {a.promptTitle ? <Tag>{`${a.promptTitle} V${a.promptVersion ?? 1}`}</Tag> : null}
            {a.decisionCodes.map((d) => (
              <Tag key={d}>{d}</Tag>
            ))}
            {a.requirementCodes.map((r) => (
              <Tag key={r}>{r}</Tag>
            ))}
            {a.repositoryFullName ? <Tag>{a.repositoryFullName}</Tag> : null}
            {a.branch ? <Tag>{a.branch}</Tag> : null}
            {a.commitSha ? <Tag>{a.commitSha.slice(0, 7)}</Tag> : null}
            {a.provider ? <Tag>{PROVIDER_LABEL[a.provider]}</Tag> : null}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8"
          onClick={() => download(a.content, a.name)}
        >
          <Download className="size-4" /> Download
        </Button>
      </div>

      <pre className="max-h-[520px] overflow-auto rounded-sm bg-surface-2 p-3 font-mono text-[11px] leading-relaxed">
        {a.content || "(empty)"}
      </pre>

      {a.buildSessionId ? (
        <div className="label-mono">
          Traceability · requirement → decision → prompt → build session → task → artifact ·{" "}
          <Link
            to="/projects/$projectId/coder/$buildId"
            params={{ projectId, buildId: a.buildSessionId }}
            className="underline"
          >
            open build session
          </Link>
        </div>
      ) : null}
    </div>
  );
}
