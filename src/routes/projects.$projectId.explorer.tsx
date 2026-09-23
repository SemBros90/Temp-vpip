import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, TypeTag } from "@/components/vpip/common";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { KNOWLEDGE_TYPES } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/explorer")({
  head: () => ({
    meta: [
      { title: "Knowledge Explorer — VPIP" },
      {
        name: "description",
        content: "Search, filter and sort every knowledge object, document and prompt in the project, and jump to its source discussion.",
      },
      { property: "og:title", content: "Knowledge Explorer — VPIP" },
      { property: "og:description", content: "Trace any decision back to the message that produced it." },
    ],
  }),
  component: ExplorerPage,
});

type View = "all" | "Documents" | "Prompts" | (typeof KNOWLEDGE_TYPES)[number];

export function ExplorerPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<View>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title">("newest");

  const items = useMemo(() => {
    const q = query.toLowerCase().trim();
    let list = p.knowledge.filter((k) => k.status !== "rejected");
    if (view !== "all" && view !== "Documents" && view !== "Prompts") {
      list = list.filter((k) => k.type === view);
    }
    if (q) {
      list = list.filter(
        (k) =>
          k.title.toLowerCase().includes(q) ||
          k.description.toLowerCase().includes(q) ||
          k.code.toLowerCase().includes(q),
      );
    }
    return [...list].sort((a, b) =>
      sort === "title"
        ? a.title.localeCompare(b.title)
        : sort === "oldest"
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
    );
  }, [p.knowledge, query, view, sort]);

  const showDocs = view === "all" || view === "Documents";
  const showPrompts = view === "all" || view === "Prompts";
  const q = query.toLowerCase().trim();
  const docs = showDocs
    ? p.documents.filter((d) => !q || d.title.toLowerCase().includes(q) || d.markdown.toLowerCase().includes(q))
    : [];
  const prompts = showPrompts
    ? p.prompts.filter((d) => !q || d.title.toLowerCase().includes(q) || d.markdown.toLowerCase().includes(q))
    : [];

  return (
    <Shell title="Knowledge Explorer" subtitle={p.project?.name}>
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              placeholder="Search all project knowledge…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={view} onValueChange={(v) => setView(v as View)}>
            <SelectTrigger className="h-9 w-[170px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All knowledge</SelectItem>
              {KNOWLEDGE_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}s
                </SelectItem>
              ))}
              <SelectItem value="Documents">Documents</SelectItem>
              <SelectItem value="Prompts">Prompts</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as typeof sort)}>
            <SelectTrigger className="h-9 w-[130px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest</SelectItem>
              <SelectItem value="oldest">Oldest</SelectItem>
              <SelectItem value="title">Title</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {items.length === 0 && docs.length === 0 && prompts.length === 0 ? (
          <EmptyState title="Nothing found" description="Try a different term, or extract knowledge from a discussion first." />
        ) : null}

        {items.length ? (
          <div className="panel divide-y divide-border">
            {items.map((k) => (
              <div key={k.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{k.code}</span>
                  <TypeTag type={k.type} />
                  <span className="text-sm font-medium">{k.title}</span>
                  {k.status === "candidate" ? <Tag>candidate</Tag> : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{k.description}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {k.sourceDiscussionId ? (
                    <Link
                      to="/projects/$projectId/discussions/$discussionId"
                      params={{ projectId, discussionId: k.sourceDiscussionId }}
                    >
                      <Tag className="hover:text-primary">open source discussion</Tag>
                    </Link>
                  ) : null}
                  {k.sourceMessages.length ? <Tag>msg {k.sourceMessages.join(", ")}</Tag> : null}
                  {k.provider ? <Tag>{k.provider}</Tag> : null}
                  <Tag>V{k.version ?? 1}</Tag>
                  {k.sourceKind && k.sourceKind !== "Discussion" ? <Tag>{k.sourceKind}</Tag> : null}
                  <Tag>{new Date(k.createdAt).toLocaleDateString()}</Tag>
                  <Tag
                    className="cursor-pointer hover:text-primary"
                    onClick={() => setHistoryFor(historyFor === k.id ? null : k.id)}
                  >
                    {k.revisions.length} revisions
                  </Tag>
                  {k.status === "candidate" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[11px]"
                      onClick={() => actions.updateKnowledge(k.id, { status: "approved" }, "Approved")}
                    >
                      Approve
                    </Button>
                  ) : null}
                </div>
                {historyFor === k.id ? (
                  <div className="mt-2 rounded-sm border border-border bg-surface-2 p-3">
                    <div className="label-mono mb-1.5">Revision history</div>
                    {k.reasonForChange ? (
                      <div className="mb-1.5 text-xs">
                        <span className="label-mono">Latest reason</span> {k.reasonForChange}
                      </div>
                    ) : null}
                    <ol className="space-y-1 text-xs text-muted-foreground">
                      {k.revisions.map((r, i) => (
                        <li key={`${r.at}-${i}`}>
                          V{i + 1} · {new Date(r.at).toLocaleString()} · {r.note} · {r.author}
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        {docs.length ? (
          <section>
            <div className="label-mono mb-2">Documents</div>
            <div className="panel divide-y divide-border">
              {docs.map((d) => (
                <Link
                  key={d.id}
                  to="/projects/$projectId/documents"
                  params={{ projectId }}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:text-primary"
                >
                  <span>{d.title}</span>
                  <Tag>{d.kind}</Tag>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {prompts.length ? (
          <section>
            <div className="label-mono mb-2">Prompts</div>
            <div className="panel divide-y divide-border">
              {prompts.map((d) => (
                <Link
                  key={d.id}
                  to="/projects/$projectId/prompts"
                  params={{ projectId }}
                  className="flex items-center justify-between px-4 py-2.5 text-sm hover:text-primary"
                >
                  <span>
                    {d.title} <span className="font-mono text-xs text-muted-foreground">V{d.version}</span>
                  </span>
                  <Tag>{d.kind}</Tag>
                </Link>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </Shell>
  );
}
