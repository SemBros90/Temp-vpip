import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import {
  Copy,
  Download,
  ListOrdered,
  Loader2,
  Play,
  PlayCircle,
  Sparkles,
  Terminal,
  Trash2,
} from "lucide-react";
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
import { parsePhases, phaseSystemPrompt, promptSource } from "@/lib/vpip/upgrade";
import { completeChat } from "@/lib/vpip/ai";
import { download, slug } from "@/lib/vpip/files";
import {
  PROMPT_KINDS,
  PROMPT_STATUSES,
  PROVIDER_LABEL,
  type PromptKind,
  type PromptStatus,
} from "@/lib/vpip/types";
import { useAiKeys } from "@/lib/vpip/keys";
import { LinkPicker } from "@/components/vpip/LinkPicker";
import { ExtractButton } from "@/components/vpip/ExtractButton";
import { buildContextPackage } from "@/lib/vpip/context-package";
import { useNavigate } from "@tanstack/react-router";
import { Boxes, Link2, Rocket } from "lucide-react";

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
              <div className="space-y-4">
                <div className="panel p-5">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h2 className="text-base font-semibold">
                        {open.title}{" "}
                        <span className="font-mono text-sm text-muted-foreground">
                          V{open.version}
                        </span>
                      </h2>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <Tag>{open.kind}</Tag>
                        <Tag>{open.status ?? "Draft"}</Tag>
                        {open.provider ? <Tag>{open.provider}</Tag> : null}
                        <Tag>{new Date(open.createdAt).toLocaleString()}</Tag>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Select
                        value={open.status ?? "Draft"}
                        onValueChange={(v) =>
                          actions.updatePrompt(open.id, { status: v as PromptStatus })
                        }
                      >
                        <SelectTrigger className="h-8 w-[170px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROMPT_STATUSES.map((s) => (
                            <SelectItem key={s} value={s}>
                              {s}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
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
                        onClick={() =>
                          download(open.markdown, `${slug(open.title)}-v${open.version}.md`)
                        }
                      >
                        <Download className="size-4" /> Markdown
                      </Button>
                      <ExtractButton projectId={projectId} source={promptSource(open)} />
                    </div>
                  </div>
                  <Markdown source={open.markdown} />
                </div>

                <PhasePanel promptId={open.id} projectId={projectId} />
                <ContextPackagePanel promptId={open.id} projectId={projectId} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}

function ContextPackagePanel({
  promptId,
  projectId,
}: {
  promptId: string;
  projectId: string;
}) {
  const p = useProject(projectId);
  const actions = useVpipActions();
  const navigate = useNavigate();
  const { provider, cfg, author } = useEngine();
  const [showPackage, setShowPackage] = useState(false);

  const prompt = p.prompts.find((x) => x.id === promptId);
  if (!prompt) return null;

  const decisions = p.approved.filter((k) => k.type === "Decision");
  const requirements = p.approved.filter((k) => k.type === "Requirement");

  const pkg = buildContextPackage(prompt, {
    project: p.project,
    knowledge: p.knowledge,
    documents: p.documents,
    discussions: p.discussions,
  });

  const toggle = (
    field:
      | "linkedDecisionIds"
      | "linkedRequirementIds"
      | "linkedDocumentIds"
      | "linkedDiscussionIds",
  ) => (id: string, next: boolean) => {
    const current = prompt[field] ?? [];
    actions.updatePrompt(prompt.id, {
      [field]: next ? [...current, id] : current.filter((x) => x !== id),
    });
  };

  const execute = () => {
    // V-05 — every build session references a permanently stored context package.
    const record = actions.addContextPackage({
      projectId,
      title: `${prompt.title} V${prompt.version}`,
      promptId: prompt.id,
      promptTitle: prompt.title,
      promptVersion: prompt.version,
      markdown: pkg.markdown,
      counts: { ...pkg.counts, prompts: 1 },
      decisionIds: prompt.linkedDecisionIds ?? [],
      requirementIds: prompt.linkedRequirementIds ?? [],
      documentIds: prompt.linkedDocumentIds ?? [],
      discussionIds: prompt.linkedDiscussionIds ?? [],
      promptIds: [prompt.id],
      provider,
      model: cfg.model,
    });
    const session = actions.createBuildSession({
      projectId,
      promptId: prompt.id,
      promptTitle: prompt.title,
      promptKind: prompt.kind,
      promptVersion: prompt.version,
      provider,
      model: cfg.model,
      status: "Handed Off",
      contextPackage: pkg.markdown,
      contextPackageId: record.id,
      sourceDocumentIds: prompt.linkedDocumentIds ?? [],
      sourceDiscussionIds: prompt.linkedDiscussionIds ?? [],
      counts: pkg.counts,
    });
    actions.updatePrompt(prompt.id, { status: "Sent To Coder" });
    actions.logActivity({
      projectId,
      subjectType: "Build Session",
      subjectId: session.id,
      subjectLabel: `${session.code} — ${prompt.title} V${prompt.version}`,
      action: "Created",
      provider,
      model: cfg.model,
      author,
      note: `Context package ${record.code}`,
    });
    toast.success(`${session.code} created — prompt handed off`);
    void navigate({
      to: "/projects/$projectId/coder/$buildId",
      params: { projectId, buildId: session.id },
    });
  };

  const readyToSend = prompt.status === "Ready For Coding" || prompt.status === "Approved";

  return (
    <div className="panel space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Link2 className="size-4" /> Context Package Builder
          </h3>
          <div className="label-mono mt-1">
            {pkg.counts.decisions} decisions · {pkg.counts.requirements} requirements ·{" "}
            {pkg.counts.documents} documents · {pkg.counts.discussions} discussions
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => setShowPackage((s) => !s)}
          >
            <Boxes className="size-4" /> {showPackage ? "Hide" : "Preview"} package
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            onClick={() => download(pkg.markdown, `${slug(prompt.title)}-context.md`)}
          >
            <Download className="size-4" /> Package markdown
          </Button>
          <Button size="sm" className="h-8" onClick={execute} disabled={!readyToSend}>
            <Rocket className="size-4" /> Execute In Coder
          </Button>
        </div>
      </div>

      {!readyToSend ? (
        <p className="text-xs text-muted-foreground">
          Set the prompt status to Approved or Ready For Coding to enable the handoff.
        </p>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <LinkPicker
          label="Decisions"
          options={decisions.map((k) => ({ id: k.id, primary: k.title, secondary: k.code }))}
          selected={prompt.linkedDecisionIds ?? []}
          onToggle={toggle("linkedDecisionIds")}
          emptyHint="No approved decisions in the register yet."
        />
        <LinkPicker
          label="Requirements"
          options={requirements.map((k) => ({ id: k.id, primary: k.title, secondary: k.code }))}
          selected={prompt.linkedRequirementIds ?? []}
          onToggle={toggle("linkedRequirementIds")}
          emptyHint="No approved requirements in the register yet."
        />
        <LinkPicker
          label="Documents"
          options={p.documents.map((d) => ({ id: d.id, primary: d.title, secondary: d.kind }))}
          selected={prompt.linkedDocumentIds ?? []}
          onToggle={toggle("linkedDocumentIds")}
          emptyHint="No generated documents yet."
        />
        <LinkPicker
          label="Discussions"
          options={p.discussions.map((d) => ({ id: d.id, primary: d.title, secondary: d.type }))}
          selected={prompt.linkedDiscussionIds ?? []}
          onToggle={toggle("linkedDiscussionIds")}
          emptyHint="No discussions yet."
        />
      </div>

      {showPackage ? (
        <div className="border-t border-border pt-4">
          <Markdown source={pkg.markdown} />
        </div>
      ) : null}
    </div>
  );
}


/* ============================ V-03 — phased prompt execution */

function PhasePanel({ promptId, projectId }: { promptId: string; projectId: string }) {
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();
  const [busy, setBusy] = useState(false);
  const [openPhase, setOpenPhase] = useState<string | null>(null);

  const prompt = p.prompts.find((x) => x.id === promptId);
  const phases = p.promptPhases
    .filter((x) => x.promptId === promptId)
    .sort((a, b) => a.phaseNo - b.phaseNo);
  if (!prompt) return null;

  const detect = () => {
    const parsed = parsePhases(prompt.markdown);
    actions.setPromptPhases(projectId, promptId, parsed);
    toast.success(`${parsed.length} phase${parsed.length === 1 ? "" : "s"} detected.`);
  };

  const runPhase = async (phaseId: string) => {
    const phase = p.promptPhases.find((x) => x.id === phaseId);
    if (!phase) return;
    const run = actions.startPhaseRun(phase, provider, cfg.model);
    try {
      const output = await completeChat(provider, cfg, [
        { role: "system", content: phaseSystemPrompt(p.project, prompt.title) },
        { role: "user", content: phase.markdown },
      ]);
      actions.finishPhaseRun(run.id, phase.id, { status: "Completed", output });
      actions.logActivity({
        projectId,
        subjectType: "Prompt Phase",
        subjectId: phase.id,
        subjectLabel: `${prompt.title} · ${phase.title}`,
        action: "Executed",
        provider,
        model: cfg.model,
        author,
        note: "Completed",
      });
      setOpenPhase(phase.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Execution failed";
      actions.finishPhaseRun(run.id, phase.id, { status: "Failed", error: message });
      actions.logActivity({
        projectId,
        subjectType: "Prompt Phase",
        subjectId: phase.id,
        subjectLabel: `${prompt.title} · ${phase.title}`,
        action: "Executed",
        provider,
        model: cfg.model,
        author,
        note: `Failed — ${message}`,
      });
      toast.error(message);
      throw err;
    }
  };

  const runAll = async () => {
    setBusy(true);
    try {
      for (const phase of phases) {
        await runPhase(phase.id);
      }
      toast.success("All phases executed.");
    } catch {
      /* the failing phase already reported itself and execution stops here */
    } finally {
      setBusy(false);
    }
  };

  const statusTone: Record<string, string> = {
    Pending: "text-muted-foreground",
    Running: "text-warning",
    Completed: "text-success",
    Failed: "text-destructive",
  };

  return (
    <div className="panel space-y-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <ListOrdered className="size-4" /> Phased execution
          </h3>
          <div className="label-mono mt-1">
            {phases.length
              ? `${phases.filter((x) => x.status === "Completed").length}/${phases.length} completed`
              : "No phases detected yet"}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={detect}>
            <ListOrdered className="size-4" /> Detect phases
          </Button>
          <Button
            size="sm"
            className="h-8"
            onClick={() => void runAll()}
            disabled={busy || !phases.length}
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <PlayCircle className="size-4" />}
            Execute all
          </Button>
        </div>
      </div>

      {phases.length ? (
        <div className="divide-y divide-border rounded-sm border border-border">
          {phases.map((phase) => {
            const runs = p.phaseRuns.filter((r) => r.phaseId === phase.id);
            return (
              <div key={phase.id} className="px-3 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-primary">Phase {phase.phaseNo}</span>
                  <button
                    className="truncate text-sm hover:text-primary"
                    onClick={() => setOpenPhase(openPhase === phase.id ? null : phase.id)}
                  >
                    {phase.title}
                  </button>
                  <span className={`text-xs ${statusTone[phase.status] ?? ""}`}>{phase.status}</span>
                  <span className="ml-auto flex items-center gap-1.5">
                    {runs.length ? <Tag>{runs.length} runs</Tag> : null}
                    {phase.provider ? <Tag>{phase.provider}</Tag> : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={busy || phase.status === "Running"}
                      onClick={() => {
                        setBusy(true);
                        void runPhase(phase.id)
                          .catch(() => undefined)
                          .finally(() => setBusy(false));
                      }}
                    >
                      <Play className="size-3.5" /> Execute
                    </Button>
                  </span>
                </div>
                {openPhase === phase.id ? (
                  <div className="mt-2 space-y-2">
                    <div className="rounded-sm border border-border bg-surface-2 p-3">
                      <div className="label-mono mb-1">Phase instruction</div>
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground">
                        {phase.markdown}
                      </pre>
                    </div>
                    {phase.error ? (
                      <div className="rounded-sm border border-destructive/40 p-3 text-xs text-destructive">
                        {phase.error}
                      </div>
                    ) : null}
                    {phase.output ? (
                      <div className="rounded-sm border border-border bg-surface-2 p-3">
                        <div className="label-mono mb-1">Output</div>
                        <Markdown source={phase.output} />
                      </div>
                    ) : null}
                    {runs.length ? (
                      <div className="flex flex-wrap gap-1.5">
                        {runs.map((r) => (
                          <Tag key={r.id}>
                            attempt {r.attempt} · {r.status} ·{" "}
                            {new Date(r.startedAt).toLocaleTimeString()}
                          </Tag>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Detect phases to split this prompt into Phase 1, Phase 2, Phase N and execute them one by
          one. Every attempt is stored with its status and output.
        </p>
      )}
    </div>
  );
}
