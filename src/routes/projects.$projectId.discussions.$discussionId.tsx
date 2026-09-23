import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, Paperclip, Save, Send, Sparkles, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EnginePicker, Tag, TypeTag, useEngine } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useProject, useVpip, useVpipActions } from "@/lib/vpip/store";
import { streamChat, type ChatMessage } from "@/lib/vpip/ai";
import {
  discussionSystemPrompt,
  extractKnowledge,
  summariseDiscussion,
  type ProjectMemory,
} from "@/lib/vpip/engine";
import { discussionToMarkdown, download, slug } from "@/lib/vpip/files";
import { PROVIDER_LABEL, type Attachment } from "@/lib/vpip/types";
import { useAiKeys } from "@/lib/vpip/keys";

export const Route = createFileRoute("/projects/$projectId/discussions/$discussionId")({
  validateSearch: (search: Record<string, unknown>): { focus?: string } =>
    typeof search['focus'] === "string" && search['focus'] ? { focus: search['focus'] } : {},
  head: () => ({
    meta: [
      { title: "Discussion — VPIP" },
      {
        name: "description",
        content: "Discuss with OpenAI or DeepSeek. Every message, attachment, timestamp and engine is saved permanently.",
      },
      { property: "og:title", content: "Discussion — VPIP" },
      { property: "og:description", content: "Grounded in the project's own memory." },
    ],
  }),
  component: DiscussionPage,
});

function DiscussionPage() {
  const { projectId, discussionId } = Route.useParams();
  const { focus } = Route.useSearch();
  const { saveNow } = useVpip();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();
  const { keys } = useAiKeys();
  const discussion = p.discussions.find((d) => d.id === discussionId);
  const marker = focus ? p.knowledge.find((k) => k.id === focus) : undefined;

  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState<string | null>(null);
  const [pending, setPending] = useState<Attachment[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [discussion?.messages.length, busy]);

  if (!discussion) {
    return (
      <Shell title="Discussion not found">
        <div className="p-6 text-sm text-muted-foreground">
          <Link
            to="/projects/$projectId/discussions"
            params={{ projectId }}
            className="text-primary underline"
          >
            Back to discussions
          </Link>
        </div>
      </Shell>
    );
  }

  const memory: ProjectMemory = {
    project: p.project!,
    discussions: p.discussions,
    approved: p.approved,
    documents: p.documents,
    prompts: p.prompts,
  };

  const onFiles = async (files: FileList | null) => {
    if (!files) return;
    const added: Attachment[] = [];
    for (const file of Array.from(files)) {
      const isText = file.type.startsWith("text") || /\.(md|txt|json|csv|ts|js|py)$/i.test(file.name);
      const data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        if (isText) reader.readAsText(file);
        else reader.readAsDataURL(file);
      });
      added.push({
        id: Math.random().toString(36).slice(2),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
        data,
        ...(isText ? { text: data.slice(0, 20000) } : {}),
        createdAt: new Date().toISOString(),
      });
    }
    setPending((prev) => [...prev, ...added]);
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && pending.length === 0) || busy) return;
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }

    const attachmentNote = pending.length
      ? `\n\n[Attached: ${pending.map((a) => a.name).join(", ")}]${pending
          .filter((a) => a.text)
          .map((a) => `\n\n--- ${a.name} ---\n${a.text}`)
          .join("")}`
      : "";

    if (pending.length) {
      actions.updateDiscussion(discussion.id, {
        attachments: [...discussion.attachments, ...pending],
      });
    }

    actions.appendMessage(discussion.id, {
      role: "user",
      content: text + attachmentNote,
      ...(pending.length ? { attachmentIds: pending.map((a) => a.id) } : {}),
    });
    setInput("");
    setPending([]);
    setBusy(true);

    const history: ChatMessage[] = [
      { role: "system", content: discussionSystemPrompt(memory, discussion) },
      ...(marker
        ? [
            {
              role: "system" as const,
              content: `This discussion is focused on knowledge item ${marker.code} (${marker.type}, status: ${marker.status}).\nTitle: ${marker.title}\nDescription: ${marker.description}\nKeep your answers anchored to this item.`,
            },
          ]
        : []),
      ...discussion.messages.map((m) => ({ role: m.role, content: m.content }) as ChatMessage),
      { role: "user", content: text + attachmentNote },
    ];

    const placeholder = actions.appendMessage(discussion.id, {
      role: "assistant",
      content: "",
      provider,
      model: cfg.model,
    });

    let acc = "";
    try {
      await streamChat(provider, cfg, history, (delta) => {
        acc += delta;
        actions.patchMessage(discussion.id, placeholder.id, acc);
      });
      if (!acc) actions.patchMessage(discussion.id, placeholder.id, "_(empty response)_");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Request failed";
      actions.patchMessage(discussion.id, placeholder.id, `**Engine error:** ${msg}`);
      toast.error(msg);
    } finally {
      setBusy(false);
      void saveNow();
    }
  };

  const runExtraction = async () => {
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    setWorking("extract");
    try {
      const candidates = await extractKnowledge(provider, cfg, discussion);
      if (!candidates.length) {
        toast.message("No new knowledge found in this discussion.");
        return;
      }
      actions.addKnowledge(
        candidates.map((c) => ({
          projectId,
          type: c.type,
          status: "candidate" as const,
          title: c.title,
          description: c.description,
          sourceDiscussionId: discussion.id,
          sourceDiscussionTitle: discussion.title,
          sourceMessages: c.messages,
          provider,
          author,
        })),
      );
      toast.success(`${candidates.length} candidates sent to Knowledge Inbox`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setWorking(null);
    }
  };

  const runSummary = async () => {
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    setWorking("summary");
    try {
      const summary = await summariseDiscussion(provider, cfg, discussion);
      actions.updateDiscussion(discussion.id, { summary });
      toast.success("Summary saved to the discussion");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Summary failed");
    } finally {
      setWorking(null);
    }
  };

  return (
    <Shell
      scroll={false}
      title={discussion.title}
      subtitle={
        <span className="flex items-center gap-1.5">
          <Tag>{discussion.type}</Tag>
          <Tag>{discussion.messages.length} messages</Tag>
          <span>{p.project?.name}</span>
        </span>
      }
      actions={
        <>
          <EnginePicker compact />
          <Button variant="outline" size="sm" className="h-8" onClick={runSummary} disabled={!!working}>
            {working === "summary" ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
            Summarise
          </Button>
          <Button size="sm" className="h-8" onClick={runExtraction} disabled={!!working}>
            {working === "extract" ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Extract knowledge
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            title="Reopen this discussion to review decisions, requirements, prompts and builds"
            onClick={reopen}
          >
            <RotateCcw className="size-4" /> Reopen
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            title="Export discussion as Markdown"
            onClick={() =>
              download(discussionToMarkdown(discussion), `${slug(discussion.title)}.md`)
            }
          >
            <Download className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            title="Manual save"
            onClick={() => saveNow().then(() => toast.success("Saved to vault"))}
          >
            <Save className="size-4" />
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 px-6 py-6">
            {marker ? (
              <div className="panel sticky top-0 z-10 border-warning/40 bg-warning/5 p-4 backdrop-blur">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="label-mono text-warning">Discussing</span>
                  <TypeTag type={marker.type} />
                  <Tag>{marker.code}</Tag>
                  <Tag>{marker.status}</Tag>
                  <span className="text-sm font-medium">{marker.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {marker.description}
                </p>
                <div className="mt-2">
                  <Link
                    to="/projects/$projectId/inbox"
                    params={{ projectId }}
                    className="label-mono hover:text-primary"
                  >
                    ← back to Knowledge Inbox
                  </Link>
                </div>
              </div>
            ) : null}

            {discussion.summary ? (
              <div className="panel border-primary/30 bg-primary/5 p-4">
                <div className="label-mono mb-1 text-primary">Discussion summary</div>
                <Markdown source={discussion.summary} className="text-sm" />
              </div>
            ) : null}

            {discussion.messages.length === 0 ? (
              <div className="panel p-6 text-center text-xs text-muted-foreground">
                This discussion is empty. Anything you write here is saved permanently with its
                timestamp and the engine that answered.
              </div>
            ) : null}

            {discussion.messages.map((m) => (
              <div key={m.id} className="flex gap-3">
                <div className="label-mono w-10 shrink-0 pt-1 text-right">{m.seq}</div>
                <div
                  className={
                    m.role === "user"
                      ? "panel min-w-0 flex-1 border-border-strong bg-surface-2 p-4"
                      : "panel min-w-0 flex-1 p-4"
                  }
                >
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className="label-mono">{m.role === "user" ? "You" : "AI"}</span>
                    {m.provider ? <Tag>{`${m.provider} · ${m.model ?? ""}`}</Tag> : null}
                    <span className="label-mono">{new Date(m.createdAt).toLocaleString()}</span>
                  </div>
                  {m.content ? (
                    <Markdown source={m.content} className="text-sm" />
                  ) : (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        </div>

        <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
          <div className="mx-auto max-w-4xl">
            {pending.length ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {pending.map((a) => (
                  <span
                    key={a.id}
                    className="flex items-center gap-1 rounded-sm border border-border bg-surface-2 px-2 py-0.5 font-mono text-[11px]"
                  >
                    {a.name}
                    <button onClick={() => setPending((prev) => prev.filter((x) => x.id !== a.id))}>
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                className="hidden"
                onChange={(e) => void onFiles(e.target.files)}
              />
              <Button
                variant="outline"
                size="icon"
                className="size-9 shrink-0"
                title="Attach files, PDFs or images"
                onClick={() => fileRef.current?.click()}
              >
                <Paperclip className="size-4" />
              </Button>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={`Ask ${provider} about this project… (Enter to send, Shift+Enter for a new line)`}
                rows={2}
                className="min-h-[44px] resize-none bg-surface-2"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <Button className="h-9 shrink-0" onClick={() => void send()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
