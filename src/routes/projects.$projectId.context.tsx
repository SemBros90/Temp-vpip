import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Layers, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, relTime, useEngine } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Markdown } from "@/lib/vpip/markdown";
import { download, slug } from "@/lib/vpip/files";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { assembleContextPackage } from "@/lib/vpip/upgrade";

export const Route = createFileRoute("/projects/$projectId/context")({
  head: () => ({
    meta: [
      { title: "Context Package Builder — VPIP" },
      {
        name: "description",
        content:
          "Assemble decisions, requirements, documents, discussions and prompts into a permanent, reusable implementation context package.",
      },
      { property: "og:title", content: "Context Package Builder — VPIP" },
      {
        property: "og:description",
        content: "Every build session references a stored context package.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContextPage,
});

function ContextPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();

  const decisions = p.approved.filter((k) => k.type === "Decision");
  const requirements = p.approved.filter((k) => k.type === "Requirement");

  const [title, setTitle] = useState("");
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => setSel((s) => ({ ...s, [id]: !s[id] }));
  const picked = (ids: string[]) => ids.filter((id) => sel[id]);

  const selection = useMemo(
    () => ({
      decisions: decisions.filter((k) => sel[k.id]),
      requirements: requirements.filter((k) => sel[k.id]),
      documents: p.documents.filter((d) => sel[d.id]),
      discussions: p.discussions.filter((d) => sel[d.id]),
      prompts: p.prompts.filter((x) => sel[x.id]),
    }),
    [decisions, requirements, p.documents, p.discussions, p.prompts, sel],
  );

  const total =
    selection.decisions.length +
    selection.requirements.length +
    selection.documents.length +
    selection.discussions.length +
    selection.prompts.length;

  const build = () => {
    if (!total) {
      toast.error("Select at least one item to include.");
      return;
    }
    const name = title.trim() || `Context ${new Date().toLocaleString()}`;
    const markdown = assembleContextPackage(p.project, name, selection);
    const rec = actions.addContextPackage({
      projectId,
      title: name,
      markdown,
      counts: {
        decisions: selection.decisions.length,
        requirements: selection.requirements.length,
        documents: selection.documents.length,
        discussions: selection.discussions.length,
        prompts: selection.prompts.length,
      },
      decisionIds: picked(decisions.map((k) => k.id)),
      requirementIds: picked(requirements.map((k) => k.id)),
      documentIds: picked(p.documents.map((d) => d.id)),
      discussionIds: picked(p.discussions.map((d) => d.id)),
      promptIds: picked(p.prompts.map((x) => x.id)),
      provider,
      model: cfg.model,
    });
    actions.addSnapshot({
      projectId,
      kind: "Context Package",
      title: `${rec.code} — ${name}`,
      refId: rec.id,
      markdown,
    });
    actions.logActivity({
      projectId,
      subjectType: "Context Package",
      subjectId: rec.id,
      subjectLabel: `${rec.code} — ${name}`,
      action: "Created",
      provider,
      model: cfg.model,
      author,
      note: `${total} linked items`,
    });
    setOpenId(rec.id);
    setSel({});
    setTitle("");
    toast.success(`${rec.code} stored permanently.`);
  };

  const open = p.contextPackages.find((c) => c.id === openId);

  const Group = ({
    label,
    items,
  }: {
    label: string;
    items: Array<{ id: string; primary: string; secondary: string }>;
  }) => (
    <section className="panel">
      <div className="label-mono border-b border-border px-4 py-2.5">
        {label} · {items.length}
      </div>
      <div className="max-h-56 divide-y divide-border overflow-y-auto">
        {items.length ? (
          items.map((it) => (
            <label key={it.id} className="flex cursor-pointer items-start gap-2.5 px-4 py-2">
              <Checkbox checked={!!sel[it.id]} onCheckedChange={() => toggle(it.id)} className="mt-0.5" />
              <span className="min-w-0">
                <span className="block truncate text-sm">{it.primary}</span>
                <span className="block truncate text-xs text-muted-foreground">{it.secondary}</span>
              </span>
            </label>
          ))
        ) : (
          <div className="px-4 py-3 text-xs text-muted-foreground">Nothing available yet.</div>
        )}
      </div>
    </section>
  );

  return (
    <Shell
      title="Context Package Builder"
      subtitle={`${p.contextPackages.length} stored packages · reusable implementation context`}
      actions={
        <Button size="sm" className="h-8" onClick={build}>
          <Layers className="size-4" /> Build package ({total})
        </Button>
      }
    >
      <div className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <div className="panel flex flex-wrap items-center gap-2 px-4 py-3">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Package title (e.g. Coder handoff — invoicing module)"
            className="h-8 max-w-md bg-surface-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            Collected automatically into one permanent markdown package with full traceability.
          </span>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Group
            label="Decisions"
            items={decisions.map((k) => ({
              id: k.id,
              primary: `${k.code} — ${k.title}`,
              secondary: k.description.slice(0, 120),
            }))}
          />
          <Group
            label="Requirements"
            items={requirements.map((k) => ({
              id: k.id,
              primary: `${k.code} — ${k.title}`,
              secondary: k.description.slice(0, 120),
            }))}
          />
          <Group
            label="Documents"
            items={p.documents.map((d) => ({
              id: d.id,
              primary: d.title,
              secondary: `${d.kind} · ${relTime(d.createdAt)}`,
            }))}
          />
          <Group
            label="Discussions"
            items={p.discussions.map((d) => ({
              id: d.id,
              primary: d.title,
              secondary: `${d.type} · ${d.messages.length} messages`,
            }))}
          />
          <Group
            label="Prompts"
            items={p.prompts.map((x) => ({
              id: x.id,
              primary: `${x.title} V${x.version}`,
              secondary: `${x.kind} · ${x.status ?? "Draft"}`,
            }))}
          />
        </div>

        <section>
          <div className="label-mono mb-2">Stored context packages · {p.contextPackages.length}</div>
          {p.contextPackages.length ? (
            <div className="panel divide-y divide-border">
              {p.contextPackages.map((c) => (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{c.code}</span>
                    <button
                      className="text-sm font-medium hover:text-primary"
                      onClick={() => setOpenId(openId === c.id ? null : c.id)}
                    >
                      {c.title}
                    </button>
                    <span className="ml-auto flex items-center gap-1.5">
                      {Object.entries(c.counts).map(([k, v]) => (
                        <Tag key={k}>
                          {k} {v}
                        </Tag>
                      ))}
                      {c.provider ? <Tag>{c.provider}</Tag> : null}
                      <Tag>{new Date(c.createdAt).toLocaleDateString()}</Tag>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        onClick={() =>
                          download(c.markdown, `${slug(c.title)}-${c.code.toLowerCase()}.md`)
                        }
                      >
                        <Download className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => {
                          actions.deleteContextPackage(c.id);
                          toast.success(`${c.code} removed.`);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </span>
                  </div>
                  {open?.id === c.id ? (
                    <div className="prose-vpip mt-3 max-h-[420px] overflow-y-auto rounded-sm border border-border bg-surface-2 p-4">
                      <Markdown source={c.markdown} />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No context packages yet"
              description="Select the decisions, requirements, documents, discussions and prompts an implementation needs, then build a package. Build sessions reference it permanently."
            />
          )}
        </section>
      </div>
    </Shell>
  );
}
