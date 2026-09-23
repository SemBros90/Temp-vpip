import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Download, HardDriveDownload, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, relTime } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { download, slug } from "@/lib/vpip/files";
import { BUILD_STATUSES, PROVIDER_LABEL, type BuildStatus } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/builds")({
  head: () => ({
    meta: [
      { title: "Build Sessions — VPIP" },
      {
        name: "description",
        content:
          "Every prompt handed off for coding is recorded as a build session with its frozen context package, provider and status.",
      },
      { property: "og:title", content: "Build Sessions — VPIP" },
      {
        property: "og:description",
        content: "The prompt-to-coder handoff ledger: build ID, prompt, date, provider, status.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BuildsPage,
});

function BuildsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const [openId, setOpenId] = useState<string | null>(null);

  const open = p.buildSessions.find((b) => b.id === openId) ?? p.buildSessions[0];

  return (
    <Shell title="Build Sessions" subtitle={`${p.buildSessions.length} handoffs recorded`}>
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {p.buildSessions.length === 0 ? (
          <EmptyState
            title="No build sessions yet"
            description="Open a prompt, link its decisions, requirements, documents and discussions, then use Execute In Coder to record a handoff."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
            <div className="panel divide-y divide-border self-start">
              {p.buildSessions.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setOpenId(b.id)}
                  className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                    open?.id === b.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <HardDriveDownload className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-xs">{b.code}</span>
                    <span className="block truncate">{b.promptTitle}</span>
                    <span className="label-mono">
                      {b.status} · {(b.turns?.length ?? 0)} coder turns · {relTime(b.createdAt)}
                    </span>
                  </span>
                  <Trash2
                    className="mt-0.5 size-3.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.deleteBuildSession(b.id);
                    }}
                  />
                </button>
              ))}
            </div>

            {open ? (
              <div className="panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">
                      <span className="font-mono text-sm text-muted-foreground">{open.code}</span>{" "}
                      {open.promptTitle}
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Tag>{open.promptKind}</Tag>
                      <Tag>V{open.promptVersion}</Tag>
                      <Tag>{open.provider ? PROVIDER_LABEL[open.provider] : "No provider"}</Tag>
                      {open.model ? <Tag>{open.model}</Tag> : null}
                      <Tag>{new Date(open.createdAt).toLocaleString()}</Tag>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Tag>{open.counts.decisions} decisions</Tag>
                      <Tag>{open.counts.requirements} requirements</Tag>
                      <Tag>{open.counts.documents} documents</Tag>
                      <Tag>{open.counts.discussions} discussions</Tag>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={open.status}
                      onValueChange={(v) =>
                        actions.updateBuildSession(open.id, { status: v as BuildStatus })
                      }
                    >
                      <SelectTrigger className="h-8 w-[150px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BUILD_STATUSES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" className="h-8" asChild>
                      <Link
                        to="/projects/$projectId/coder/$buildId"
                        params={{ projectId, buildId: open.id }}
                      >
                        <Terminal className="size-4" /> Open AI Coder
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        void navigator.clipboard.writeText(open.contextPackage);
                        toast.success("Context package copied");
                      }}
                    >
                      <Copy className="size-4" /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() =>
                        download(open.contextPackage, `${slug(open.code)}-context.md`)
                      }
                    >
                      <Download className="size-4" /> Markdown
                    </Button>
                  </div>
                </div>

                <div className="label-mono">
                  Repository ·{" "}
                  {open.repositoryFullName ? (
                    <>
                      {open.repositoryFullName} ({open.repositoryProvider}) · branch{" "}
                      {open.repositoryBranch} · commit{" "}
                      {open.lastCommitSha ? open.lastCommitSha.slice(0, 7) : "none"}{" "}
                      {open.lastCommitAt ? `· ${new Date(open.lastCommitAt).toLocaleString()}` : ""}
                    </>
                  ) : (
                    <>
                      not linked ·{" "}
                      <Link
                        to="/projects/$projectId/repositories"
                        params={{ projectId }}
                        className="underline"
                      >
                        open Repositories
                      </Link>
                    </>
                  )}
                </div>

                <div className="label-mono">
                  Source prompt ·{" "}
                  <Link
                    to="/projects/$projectId/prompts"
                    params={{ projectId }}
                    className="underline"
                  >
                    open in Prompts
                  </Link>
                </div>

                <Markdown source={open.contextPackage} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}
