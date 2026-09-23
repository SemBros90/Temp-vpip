import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Download, FileText, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, EnginePicker, relTime, Tag, useEngine } from "@/components/vpip/common";
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
import { generateDocument, type ProjectMemory } from "@/lib/vpip/engine";
import { download, slug } from "@/lib/vpip/files";
import { DOCUMENT_KINDS, PROVIDER_LABEL, type DocumentKind } from "@/lib/vpip/types";
import { useAiKeys } from "@/lib/vpip/keys";

export const Route = createFileRoute("/projects/$projectId/documents")({
  head: () => ({
    meta: [
      { title: "Documents — VPIP" },
      {
        name: "description",
        content: "Generate project summaries, decision and requirement registers, architecture summaries and the full knowledge book from your project memory.",
      },
      { property: "og:title", content: "Documents — VPIP" },
      { property: "og:description", content: "Every generated document is stored as an immutable snapshot." },
    ],
  }),
  component: DocumentsPage,
});

function DocumentsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg } = useEngine();
  const { keys } = useAiKeys();
  const [kind, setKind] = useState<DocumentKind>("Project Summary");
  const [discussionId, setDiscussionId] = useState<string>("none");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const generate = async () => {
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    setBusy(true);
    try {
      const mem: ProjectMemory = {
        project: p.project!,
        discussions: p.discussions,
        approved: p.approved,
        documents: p.documents,
        prompts: p.prompts,
      };
      const focus = p.discussions.find((d) => d.id === discussionId);
      const markdown = await generateDocument(provider, cfg, kind, mem, focus);
      const doc = actions.addDocument({
        projectId,
        kind,
        title: `${kind} — ${p.project?.name ?? ""}`,
        markdown,
        provider,
        model: cfg.model,
        ...(focus ? { sourceDiscussionId: focus.id } : {}),
      });
      setOpenId(doc.id);
      toast.success("Document generated and snapshotted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const open = p.documents.find((d) => d.id === openId) ?? p.documents[0];

  return (
    <Shell
      title="Documents"
      subtitle={`${p.documents.length} generated · stored permanently in the project`}
      actions={<EnginePicker compact />}
    >
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <div className="panel flex flex-wrap items-end gap-2 p-4">
          <div>
            <div className="label-mono mb-1">Document kind</div>
            <Select value={kind} onValueChange={(v) => setKind(v as DocumentKind)}>
              <SelectTrigger className="h-9 w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOCUMENT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="label-mono mb-1">Focus discussion (optional)</div>
            <Select value={discussionId} onValueChange={setDiscussionId}>
              <SelectTrigger className="h-9 w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Whole project memory</SelectItem>
                {p.discussions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button className="h-9" onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Generate
          </Button>
        </div>

        {p.documents.length === 0 ? (
          <EmptyState
            title="No documents yet"
            description="Pick a kind and generate. Documents are written from approved knowledge and discussion history."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="panel divide-y divide-border self-start">
              {p.documents.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setOpenId(d.id)}
                  className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                    open?.id === d.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <FileText className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{d.kind}</span>
                    <span className="label-mono">{relTime(d.createdAt)}</span>
                  </span>
                  <Trash2
                    className="mt-0.5 size-3.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.deleteDocument(d.id);
                    }}
                  />
                </button>
              ))}
            </div>

            {open ? (
              <div className="panel p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{open.title}</h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Tag>{open.kind}</Tag>
                      {open.provider ? <Tag>{open.provider}</Tag> : null}
                      <Tag>{new Date(open.createdAt).toLocaleString()}</Tag>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => download(open.markdown, `${slug(open.title)}.md`)}
                  >
                    <Download className="size-4" /> Markdown
                  </Button>
                </div>
                <Markdown source={open.markdown} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}
