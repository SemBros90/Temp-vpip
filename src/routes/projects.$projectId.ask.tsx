import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { BrainCircuit, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EnginePicker, Tag, useEngine } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProject } from "@/lib/vpip/store";
import { streamChat } from "@/lib/vpip/ai";
import { useAiKeys } from "@/lib/vpip/keys";
import { PROVIDER_LABEL } from "@/lib/vpip/types";
import {
  buildContextPackage,
  memoryDigest,
  retrieveContext,
  type ContextHit,
  type ProjectMemory,
} from "@/lib/vpip/engine";

export const Route = createFileRoute("/projects/$projectId/ask")({
  head: () => ({
    meta: [
      { title: "Ask Project Memory — VPIP" },
      {
        name: "description",
        content: "Ask what the project decided. VPIP searches discussions, decisions, requirements, documents and prompts, then answers with references.",
      },
      { property: "og:title", content: "Ask Project Memory — VPIP" },
      { property: "og:description", content: "Answers grounded in your project's own history." },
    ],
  }),
  component: AskPage,
});

function AskPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const { provider, cfg } = useEngine();
  const { keys } = useAiKeys();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [hits, setHits] = useState<ContextHit[]>([]);
  const [busy, setBusy] = useState(false);

  const ask = async () => {
    const q = question.trim();
    if (!q || busy) return;
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    const memory: ProjectMemory = {
      project: p.project!,
      discussions: p.discussions,
      approved: p.approved,
      repoDiagnostics: p.repoDiagnostics,
      documents: p.documents,
      prompts: p.prompts,
    };
    const found = retrieveContext(memory, q);
    setHits(found);
    setAnswer("");
    setBusy(true);
    try {
      let acc = "";
      await streamChat(
        provider,
        cfg,
        [
          {
            role: "system",
            content: `You answer strictly from the supplied project memory of "${p.project?.name}". Cite sources inline as [1], [2] matching the numbered sources. If the memory does not contain the answer, say so plainly and suggest which discussion to start.`,
          },
          {
            role: "user",
            content: `${memoryDigest(memory, 3000)}\n\n${buildContextPackage(memory, found)}\n\nQUESTION: ${q}`,
          },
        ],
        (d) => {
          acc += d;
          setAnswer(acc);
        },
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Ask Project Memory"
      subtitle="Searches discussions, decisions, requirements, documents and prompts before answering"
      actions={<EnginePicker compact />}
    >
      <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <div className="panel p-4">
          <Textarea
            rows={3}
            className="resize-none bg-surface-2"
            placeholder="What did we decide about Raspberry Pi automation?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void ask();
            }}
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="label-mono">Ctrl/Cmd + Enter to ask</span>
            <Button size="sm" className="h-8" onClick={() => void ask()} disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <BrainCircuit className="size-4" />}
              Retrieve & answer
            </Button>
          </div>
        </div>

        {hits.length ? (
          <div className="panel p-4">
            <div className="label-mono mb-2">Context package · {hits.length} sources</div>
            <ol className="space-y-2">
              {hits.map((h, i) => (
                <li key={h.id} className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-primary">[{i + 1}]</span>
                    <Tag>{h.kind}</Tag>
                    {h.discussionId ? (
                      <Link
                        to="/projects/$projectId/discussions/$discussionId"
                        params={{ projectId, discussionId: h.discussionId }}
                        className="truncate hover:text-primary"
                      >
                        {h.label}
                      </Link>
                    ) : (
                      <span className="truncate">{h.label}</span>
                    )}
                  </div>
                  <p className="mt-0.5 pl-7 leading-relaxed text-muted-foreground">{h.excerpt}</p>
                </li>
              ))}
            </ol>
          </div>
        ) : null}

        {answer ? (
          <div className="panel p-4">
            <div className="label-mono mb-2">Answer · {provider}</div>
            <Markdown source={answer} className="text-sm" />
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
