import { createFileRoute, Link } from "@tanstack/react-router";
import { Download } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, TypeTag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/vpip/store";
import { download, slug } from "@/lib/vpip/files";
import { KNOWLEDGE_TYPES } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/register")({
  head: () => ({
    meta: [
      { title: "Master Register — VPIP" },
      {
        name: "description",
        content: "The project's single source of truth: approved decisions, requirements, ideas, risks, questions, prompts and documents.",
      },
      { property: "og:title", content: "Master Register — VPIP" },
      { property: "og:description", content: "Every approved item carries full traceability." },
    ],
  }),
  component: RegisterPage,
});

function RegisterPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);

  const exportRegister = () => {
    const lines = [`# Master Register — ${p.project?.name ?? ""}`, ""];
    for (const type of KNOWLEDGE_TYPES) {
      const items = p.approved.filter((k) => k.type === type);
      lines.push(`## ${type}s (${items.length})`, "");
      if (!items.length) lines.push("_none_", "");
      for (const k of items) {
        lines.push(
          `### ${k.code} — ${k.title}`,
          "",
          k.description,
          "",
          `Source: ${k.sourceDiscussionTitle ?? "manual"} · messages ${k.sourceMessages.join(", ") || "—"} · provider ${k.provider ?? "—"} · author ${k.author} · ${new Date(k.createdAt).toLocaleDateString()}`,
          "",
        );
      }
    }
    lines.push(`## Prompts (${p.prompts.length})`, "");
    p.prompts.forEach((x) => lines.push(`- ${x.title} V${x.version} (${x.kind})`));
    lines.push("", `## Documents (${p.documents.length})`, "");
    p.documents.forEach((x) => lines.push(`- ${x.title} (${x.kind})`));
    download(lines.join("\n"), `${slug(p.project?.name ?? "project")}-master-register.md`);
  };

  return (
    <Shell
      title="Master Register"
      subtitle={`Single source of truth · ${p.approved.length} approved items`}
      actions={
        <Button size="sm" variant="outline" className="h-8" onClick={exportRegister}>
          <Download className="size-4" /> Export register
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        {p.approved.length === 0 && p.prompts.length === 0 && p.documents.length === 0 ? (
          <EmptyState
            title="Register is empty"
            description="Approve candidates in the Knowledge Inbox and generate documents and prompts — they all register here."
          />
        ) : null}

        {KNOWLEDGE_TYPES.map((type) => {
          const items = p.approved.filter((k) => k.type === type);
          if (!items.length) return null;
          return (
            <section key={type}>
              <div className="label-mono mb-2">
                {type}s · {items.length}
              </div>
              <div className="panel divide-y divide-border">
                {items.map((k) => (
                  <div key={k.id} className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-semibold text-primary">{k.code}</span>
                      <TypeTag type={k.type} />
                      <span className="text-sm font-medium">{k.title}</span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                      {k.description}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {k.sourceDiscussionId ? (
                        <Link
                          to="/projects/$projectId/discussions/$discussionId"
                          params={{ projectId, discussionId: k.sourceDiscussionId }}
                        >
                          <Tag className="hover:text-primary">{k.sourceDiscussionTitle}</Tag>
                        </Link>
                      ) : null}
                      {k.sourceMessages.length ? <Tag>msg {k.sourceMessages.join(", ")}</Tag> : null}
                      {k.provider ? <Tag>{k.provider}</Tag> : null}
                      <Tag>{k.author}</Tag>
                      <Tag>{new Date(k.createdAt).toLocaleDateString()}</Tag>
                      <Tag>{k.revisions.length} revisions</Tag>
                      {k.mergedFrom?.length ? <Tag>merged {k.mergedFrom.join(", ")}</Tag> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {p.prompts.length ? (
          <section>
            <div className="label-mono mb-2">Prompts · {p.prompts.length}</div>
            <div className="panel divide-y divide-border">
              {p.prompts.map((x) => (
                <Link
                  key={x.id}
                  to="/projects/$projectId/prompts"
                  params={{ projectId }}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:text-primary"
                >
                  <span>
                    {x.title} <span className="font-mono text-xs text-muted-foreground">V{x.version}</span>
                  </span>
                  <Tag>{x.kind}</Tag>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {p.documents.length ? (
          <section>
            <div className="label-mono mb-2">Documents · {p.documents.length}</div>
            <div className="panel divide-y divide-border">
              {p.documents.map((x) => (
                <Link
                  key={x.id}
                  to="/projects/$projectId/documents"
                  params={{ projectId }}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:text-primary"
                >
                  <span>{x.title}</span>
                  <Tag>{x.kind}</Tag>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
