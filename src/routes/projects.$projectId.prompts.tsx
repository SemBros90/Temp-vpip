import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Copy, Download, Loader2, Sparkles, Terminal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, EnginePicker, relTime, Tag, useEngine } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { generatePrompt, type ProjectMemory } from "@/lib/vpip/engine";
import { download, slug } from "@/lib/vpip/files";
import { PROMPT_KINDS, PROVIDER_LABEL, type PromptKind } from "@/lib/vpip/types";
import { useAiKeys } from "@/lib/vpip/keys";

export const Route = createFileRoute("/projects/$projectId/prompts")({
  head: () => ({
    meta: [
      { title: "Prompts — VPIP" },
      {
        name: "description",
        content: "Generate Lovable, Replit, architecture, research and business prompts from the project's own knowledge, versioned as project assets.",
      },
      { property: "og:title", content: "Prompts — VPIP" },
      { property: "og:description", content: "Prompts are versioned project assets, not throwaway text." },
    ],
  }),
  component: PromptsPage,
});

function PromptsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg } = useEngine();
  const { keys } = useAiKeys();
  const [kind, setKind] = useState<PromptKind>("Lovable Prompt");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const generate = async () => {
    if (!keys[provider]) {
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
      const markdown = await generatePrompt(provider, cfg, kind, mem, instruction.trim() || undefined);
      const created = actions.addPrompt({
        projectId,
        kind,
        title: `${kind} — ${p.project?.name ?? ""}`,
        markdown,
        provider,
        model: cfg.model,
      });
      setOpenId(created.id);
      toast.success(`Saved as ${kind} V${created.version}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setBusy(false);
    }
  };

  const open = p.prompts.find((d) => d.id === openId) ?? p.prompts[0];

  return (
    <Shell
      title="Prompts"
      subtitle={`${p.prompts.length} versioned prompt assets`}
      actions={<EnginePicker compact />}
    >
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        <div className="panel space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <div className="label-mono mb-1">Prompt kind</div>
              <Select value={kind} onValueChange={(v) => setKind(v as PromptKind)}>
                <SelectTrigger className="h-9 w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROMPT_KINDS.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button className="h-9" onClick={() => void generate()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              Generate prompt
            </Button>
          </div>
          <div>
            <div className="label-mono mb-1">Extra instruction (optional)</div>
            <Textarea
              rows={2}
              className="resize-none bg-surface-2"
              placeholder="e.g. target a desktop-first UI and include the DFM rule set"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
          </div>
        </div>

        {p.prompts.length === 0 ? (
          <EmptyState
            title="No prompts yet"
            description="Generate a Lovable, Replit, architecture, research or business prompt built from this project's knowledge."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
            <div className="panel divide-y divide-border self-start">
              {p.prompts.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setOpenId(d.id)}
                  className={`group flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                    open?.id === d.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Terminal className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">
                      {d.kind} <span className="font-mono text-xs">V{d.version}</span>
                    </span>
                    <span className="label-mono">{relTime(d.createdAt)}</span>
                  </span>
                  <Trash2
                    className="mt-0.5 size-3.5 opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.deletePrompt(d.id);
                    }}
                  />
                </button>
              ))}
            </div>

            {open ? (
              <div className="panel p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">
                      {open.title} <span className="font-mono text-sm text-muted-foreground">V{open.version}</span>
                    </h2>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Tag>{open.kind}</Tag>
                      {open.provider ? <Tag>{open.provider}</Tag> : null}
                      <Tag>{new Date(open.createdAt).toLocaleString()}</Tag>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => {
                        void navigator.clipboard.writeText(open.markdown);
                        toast.success("Prompt copied");
                      }}
                    >
                      <Copy className="size-4" /> Copy
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => download(open.markdown, `${slug(open.title)}-v${open.version}.md`)}
                    >
                      <Download className="size-4" /> Markdown
                    </Button>
                  </div>
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
