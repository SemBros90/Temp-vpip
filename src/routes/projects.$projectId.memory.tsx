import { createFileRoute, Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { Stat, Tag, relTime } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { useProject, useVpip } from "@/lib/vpip/store";
import { download, slug } from "@/lib/vpip/files";
import { PROVIDER_LABEL } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/memory")({
  head: () => ({
    meta: [
      { title: "Project Memory — VPIP" },
      {
        name: "description",
        content:
          "The permanent memory layer of the project: discussions, decisions, requirements, documents, prompts, build sessions, repositories and artifacts.",
      },
      { property: "og:title", content: "Project Memory — VPIP" },
      {
        property: "og:description",
        content: "Memory belongs to the project and never changes when the AI engine changes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: MemoryPage,
});

function MemoryPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const { ws } = useVpip();

  const decisions = p.approved.filter((k) => k.type === "Decision");
  const requirements = p.approved.filter((k) => k.type === "Requirement");

  const exportMemory = () => {
    const lines = [
      `# Project Memory — ${p.project?.name ?? ""}`,
      "",
      `Exported ${new Date().toISOString()} · memory is independent of the selected AI engine.`,
      "",
      `- Discussions: ${p.discussions.length}`,
      `- Decisions: ${decisions.length}`,
      `- Requirements: ${requirements.length}`,
      `- Documents: ${p.documents.length}`,
      `- Prompts: ${p.prompts.length}`,
      `- Build sessions: ${p.buildSessions.length}`,
      `- Repositories: ${p.repositories.length}`,
      `- Artifacts: ${p.artifacts.length}`,
      `- Context packages: ${p.contextPackages.length}`,
      `- Outcomes: ${p.outcomes.length}`,
      `- Failures: ${p.failures.length}`,
      "",
    ];
    download(lines.join("\n"), `${slug(p.project?.name ?? "project")}-project-memory.md`);
  };

  const sections: Array<{
    label: string;
    count: number;
    to: string;
    items: Array<{ id: string; primary: string; secondary: string }>;
  }> = [
    {
      label: "Discussions",
      count: p.discussions.length,
      to: "/projects/$projectId/discussions",
      items: p.discussions.slice(0, 6).map((d) => ({
        id: d.id,
        primary: d.title,
        secondary: `${d.type} · ${d.messages.length} messages · ${relTime(d.updatedAt)}`,
      })),
    },
    {
      label: "Decisions",
      count: decisions.length,
      to: "/projects/$projectId/register",
      items: decisions.slice(0, 6).map((k) => ({
        id: k.id,
        primary: `${k.code} — ${k.title}`,
        secondary: `V${k.version ?? 1} · ${k.provider ?? "no engine"} · ${relTime(k.updatedAt)}`,
      })),
    },
    {
      label: "Requirements",
      count: requirements.length,
      to: "/projects/$projectId/register",
      items: requirements.slice(0, 6).map((k) => ({
        id: k.id,
        primary: `${k.code} — ${k.title}`,
        secondary: `V${k.version ?? 1} · ${k.provider ?? "no engine"} · ${relTime(k.updatedAt)}`,
      })),
    },
    {
      label: "Documents",
      count: p.documents.length,
      to: "/projects/$projectId/documents",
      items: p.documents.slice(0, 6).map((d) => ({
        id: d.id,
        primary: d.title,
        secondary: `${d.kind} · ${relTime(d.createdAt)}`,
      })),
    },
    {
      label: "Prompts",
      count: p.prompts.length,
      to: "/projects/$projectId/prompts",
      items: p.prompts.slice(0, 6).map((x) => ({
        id: x.id,
        primary: `${x.title} V${x.version}`,
        secondary: `${x.kind} · ${x.status ?? "Draft"}`,
      })),
    },
    {
      label: "Build sessions",
      count: p.buildSessions.length,
      to: "/projects/$projectId/builds",
      items: p.buildSessions.slice(0, 6).map((b) => ({
        id: b.id,
        primary: `${b.code} — ${b.promptTitle}`,
        secondary: `${b.status} · V${b.promptVersion} · ${relTime(b.updatedAt)}`,
      })),
    },
    {
      label: "Repositories",
      count: p.repositories.length,
      to: "/projects/$projectId/repositories",
      items: p.repositories.slice(0, 6).map((r) => ({
        id: r.id,
        primary: r.fullName || r.name,
        secondary: `${r.status} · branch ${r.currentBranch}`,
      })),
    },
    {
      label: "Artifacts",
      count: p.artifacts.length,
      to: "/projects/$projectId/artifacts",
      items: p.artifacts.slice(0, 6).map((a) => ({
        id: a.id,
        primary: `${a.code} — ${a.path}`,
        secondary: `${a.type} · ${a.size} bytes`,
      })),
    },
  ];

  return (
    <Shell
      title="Project Memory"
      subtitle="The project owns the memory — switching AI engines never changes it"
      actions={
        <Button size="sm" variant="outline" className="h-8" onClick={exportMemory}>
          <Download className="size-4" /> Export memory overview
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="panel px-4 py-3 text-xs text-muted-foreground">
          Memory is stored against the project, not the engine. Current engine ·{" "}
          <span className="text-foreground">{PROVIDER_LABEL[ws.settings.defaultProvider]}</span>. All
          records below stay available when you switch between OpenAI and DeepSeek.
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {sections.map((s) => (
            <Stat key={s.label} label={s.label} value={s.count} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {sections.map((s) => (
            <section key={s.label} className="panel">
              <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
                <div className="label-mono">
                  {s.label} · {s.count}
                </div>
                <Link
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  to={s.to as any}
                  params={{ projectId } as never}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  Open
                </Link>
              </div>
              <div className="divide-y divide-border">
                {s.items.length ? (
                  s.items.map((it) => (
                    <div key={it.id} className="px-4 py-2">
                      <div className="truncate text-sm">{it.primary}</div>
                      <div className="mt-0.5 truncate text-xs text-muted-foreground">
                        {it.secondary}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="px-4 py-3 text-xs text-muted-foreground">Nothing recorded yet.</div>
                )}
              </div>
            </section>
          ))}
        </div>

        <section className="panel">
          <div className="label-mono border-b border-border px-4 py-2.5">
            Engine contribution history · {p.activity.length}
          </div>
          <div className="divide-y divide-border">
            {p.activity.slice(0, 20).map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs">
                <Tag>{a.action}</Tag>
                <span className="text-foreground">{a.subjectType}</span>
                <span className="truncate text-muted-foreground">{a.subjectLabel}</span>
                <span className="ml-auto flex items-center gap-1.5">
                  {a.provider ? <Tag>{PROVIDER_LABEL[a.provider]}</Tag> : null}
                  {a.model ? <Tag>{a.model}</Tag> : null}
                  <Tag>{new Date(a.createdAt).toLocaleString()}</Tag>
                </span>
              </div>
            ))}
            {!p.activity.length ? (
              <div className="px-4 py-3 text-xs text-muted-foreground">
                No engine activity recorded yet.
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </Shell>
  );
}
