import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Bot,
  Check,
  FilePlus2,
  FileX2,
  Loader2,
  Package,
  Pencil,
  Play,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, Tag, relTime } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { useVpipActions } from "@/lib/vpip/store";
import { fileName, FOLDER_KEEP } from "@/lib/vpip/coder-fs";
import { parseProposedFiles } from "@/lib/vpip/coder-fs";
import {
  agentExecutePrompt,
  agentPlanPrompt,
  agentReviewPrompt,
  agentSystemPrompt,
  extractSection,
  parseAgentPlan,
  parseDeletions,
  runAgent,
  type AgentInputs,
} from "@/lib/vpip/agent";
import {
  AGENT_TASK_TYPES,
  PROVIDER_LABEL,
  type AgentPlan,
  type AgentTask,
  type AgentTaskType,
  type CoderTrace,
  type ProviderConfig,
  type ProviderId,
} from "@/lib/vpip/types";

const statusTone: Record<AgentTask["status"], string> = {
  Pending: "text-muted-foreground border-border-strong bg-muted",
  Running: "text-info border-info/40 bg-info/10",
  Waiting: "text-warning border-warning/40 bg-warning/10",
  Completed: "text-success border-success/40 bg-success/10",
  Failed: "text-destructive border-destructive/40 bg-destructive/10",
  Cancelled: "text-muted-foreground border-border-strong bg-muted",
};

export function AgentPanel({
  inputs,
  trace,
  provider,
  cfg,
  hasKey,
  errorText,
  onSelectFile,
}: {
  inputs: AgentInputs;
  trace: CoderTrace;
  provider: ProviderId;
  cfg: ProviderConfig;
  hasKey: boolean;
  errorText: string;
  onSelectFile: (path: string) => void;
}) {
  const actions = useVpipActions();
  const session = inputs.session;
  const tasks = useMemo(() => session.agentTasks ?? [], [session.agentTasks]);

  const [type, setType] = useState<AgentTaskType>("Feature Build");
  const [instruction, setInstruction] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [stream, setStream] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const active = tasks.find((t) => t.id === activeId) ?? tasks.at(-1) ?? null;
  const realFiles = inputs.files.filter((f) => fileName(f.path) !== FOLDER_KEEP);

  const system = agentSystemPrompt(inputs);

  const call = async (user: string) => {
    setStream("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      return await runAgent(
        provider,
        cfg,
        system,
        user,
        (chunk) => setStream((s) => (s ?? "") + chunk),
        controller.signal,
      );
    } finally {
      setStream(null);
      abortRef.current = null;
    }
  };

  /* ---------------------------------------------- 1–6. plan and approval */

  const startAgent = async () => {
    const text = instruction.trim();
    if (!text || busy) return;
    if (!hasKey) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    const task = actions.createAgentTask(session.id, {
      buildSessionId: session.id,
      projectId: session.projectId,
      promptId: session.promptId,
      promptTitle: session.promptTitle,
      promptVersion: session.promptVersion,
      type,
      status: "Running",
      instruction: text,
      provider,
      model: cfg.model,
      trace,
    });
    setActiveId(task.id);
    setInstruction("");
    setBusy(true);
    try {
      const answer =
        type === "Review"
          ? await call(agentReviewPrompt({ kind: "Code Review", instruction: text, files: realFiles }))
          : await call(agentPlanPrompt({ type, instruction: text, errors: errorText || undefined }));

      if (type === "Review") {
        actions.updateAgentTask(session.id, task.id, {
          status: "Completed",
          transcript: answer,
          changeSummary: extractSection(answer, "Change Summary"),
          buildSummary: extractSection(answer, "Build Summary"),
          technicalNotes: extractSection(answer, "Technical Notes"),
        });
        actions.logCoderAction(session.id, {
          kind: "Review Code",
          summary: `${task.code} — ${text.slice(0, 140)}`,
          filesModified: [],
          provider,
          model: cfg.model,
          trace,
        });
        return;
      }

      const plan = parseAgentPlan(answer);
      actions.updateAgentTask(session.id, task.id, {
        status: plan ? "Waiting" : "Failed",
        transcript: answer,
        plan: plan ?? undefined,
        error: plan ? undefined : "The agent did not return a readable execution plan.",
      });
      if (!plan) toast.error("The agent did not return a readable plan. Try again.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The agent failed";
      actions.updateAgentTask(session.id, task.id, { status: "Failed", error: msg });
      actions.appendLog(session.id, { stream: "error", output: msg, exitCode: 1 });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  /* -------------------------------------------- 7–9. approved execution */

  const execute = async (task: AgentTask, plan: AgentPlan) => {
    if (busy) return;
    setBusy(true);
    actions.approveAgentTask(session.id, task.id);
    try {
      const answer = await call(
        agentExecutePrompt({ type: task.type, instruction: task.instruction, plan, files: inputs.files }),
      );
      const allowed = new Set([...plan.create, ...plan.modify].map((f) => f.path));
      const proposed = parseProposedFiles(answer).filter((f) => allowed.has(f.path));
      const deletions = parseDeletions(answer).filter((p) =>
        plan.delete.some((d) => d.path === p),
      );

      for (const file of proposed) {
        const existed = inputs.files.some((f) => f.path === file.path);
        actions.writeCoderFile(session.id, file.path, file.content, {
          note: `${task.code} · ${task.type}`,
          trace,
          provider,
          model: cfg.model,
        });
        actions.recordAgentChange(session.id, task.id, {
          buildCode: session.code,
          promptId: session.promptId,
          path: file.path,
          action: existed ? "Update File" : "Create File",
          provider,
          model: cfg.model,
        });
      }
      for (const path of deletions) {
        actions.deleteCoderPath(session.id, path);
        actions.recordAgentChange(session.id, task.id, {
          buildCode: session.code,
          promptId: session.promptId,
          path,
          action: "Delete File",
          provider,
          model: cfg.model,
        });
      }

      const changeSummary = extractSection(answer, "Change Summary");
      const buildSummary = extractSection(answer, "Build Summary");
      const technicalNotes = extractSection(answer, "Technical Notes");

      actions.updateAgentTask(session.id, task.id, {
        status: "Completed",
        transcript: answer,
        changeSummary,
        buildSummary,
        technicalNotes,
      });
      actions.logCoderAction(session.id, {
        kind: task.type === "Bug Fix" ? "Apply Fix" : "Generate Code",
        summary: `${task.code} · ${task.type} — ${task.instruction.slice(0, 140)}`,
        filesModified: [...proposed.map((f) => f.path), ...deletions],
        provider,
        model: cfg.model,
        trace,
      });
      actions.appendLog(session.id, {
        stream: "build",
        command: `agent ${task.code}`,
        output: `${proposed.length} file(s) written, ${deletions.length} deleted`,
        exitCode: 0,
      });

      // documentation is stored as a project asset inside the session files
      const doc = [
        `# ${task.code} — ${task.type}`,
        "",
        `- Build session: ${session.code}`,
        `- Prompt: ${session.promptTitle} V${session.promptVersion}`,
        `- Decisions: ${trace.decisionCodes.join(", ") || "none"}`,
        `- Requirements: ${trace.requirementCodes.join(", ") || "none"}`,
        `- Engine: ${PROVIDER_LABEL[provider]} · ${cfg.model}`,
        "",
        "## Change Summary",
        changeSummary || "_none_",
        "",
        "## Build Summary",
        buildSummary || "_none_",
        "",
        "## Technical Notes",
        technicalNotes || "_none_",
      ].join("\n");
      actions.writeCoderFile(session.id, `docs/${task.code.toLowerCase()}.md`, doc, {
        note: `${task.code} documentation`,
        trace,
        provider,
        model: cfg.model,
      });

      if (session.status === "Handed Off" || session.status === "Queued") {
        actions.updateBuildSession(session.id, { status: "In Progress" });
      }
      toast.success(`${task.code} executed — ${proposed.length} file(s) written`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "The agent failed";
      actions.updateAgentTask(session.id, task.id, { status: "Failed", error: msg });
      actions.appendLog(session.id, { stream: "error", output: msg, exitCode: 1 });
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  };

  const reject = (task: AgentTask) => {
    actions.updateAgentTask(session.id, task.id, { status: "Cancelled" });
    toast.info(`${task.code} cancelled — nothing was changed`);
  };

  return (
    <div className="flex min-h-0 flex-1 gap-0">
      {/* task list */}
      <div className="flex w-[240px] shrink-0 flex-col border-r border-border">
        <div className="label-mono border-b border-border px-3 py-2">Agent tasks</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {tasks.length === 0 ? (
            <p className="px-2 py-3 text-xs text-muted-foreground">No tasks yet.</p>
          ) : null}
          {[...tasks].reverse().map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveId(t.id)}
              className={`mb-1 w-full rounded-sm px-2 py-2 text-left hover:bg-surface-2 ${
                active?.id === t.id ? "bg-surface-2" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-[11px]">{t.code}</span>
                <span
                  className={`rounded-sm border px-1 py-0.5 font-mono text-[9px] uppercase ${statusTone[t.status]}`}
                >
                  {t.status}
                </span>
              </div>
              <div className="truncate text-xs">{t.type}</div>
              <div className="label-mono truncate">{relTime(t.updatedAt)}</div>
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mx-auto max-w-3xl space-y-5">
            {!active && stream === null ? (
              <EmptyState
                title="The development agent is loaded"
                description="It reads this build session's context package, the master register, the linked decisions, requirements, documents and discussions, the repository and the existing files. Describe the work and start it — it plans first and changes nothing until you approve."
              />
            ) : null}

            {active ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Tag>{active.code}</Tag>
                  <Tag>{active.type}</Tag>
                  <span
                    className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase ${statusTone[active.status]}`}
                  >
                    {active.status}
                  </span>
                  <Tag>build {session.code}</Tag>
                  <Tag>
                    prompt V{active.promptVersion}
                  </Tag>
                  {active.trace.decisionCodes.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                  {active.trace.requirementCodes.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                  <Button
                    size="sm"
                    variant="ghost"
                    className="ml-auto h-7 gap-1 text-xs"
                    onClick={() => {
                      actions.deleteAgentTask(session.id, active.id);
                      setActiveId(null);
                    }}
                  >
                    <Trash2 className="size-3.5" /> Remove
                  </Button>
                </div>

                <div className="panel px-4 py-3 text-sm">{active.instruction}</div>

                {active.error ? (
                  <div className="panel flex items-start gap-2 border-destructive/40 px-4 py-3 text-xs text-destructive">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {active.error}
                  </div>
                ) : null}

                {active.plan ? (
                  <PlanCard
                    plan={active.plan}
                    approved={Boolean(active.approvedAt)}
                    busy={busy}
                    onApprove={() => void execute(active, active.plan as AgentPlan)}
                    onReject={() => reject(active)}
                    canApprove={active.status === "Waiting"}
                  />
                ) : null}

                {active.changes.length ? (
                  <div className="panel px-4 py-3">
                    <div className="label-mono mb-2">Files changed</div>
                    <ul className="space-y-1">
                      {active.changes.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 text-xs">
                          <Tag>{c.action}</Tag>
                          <button
                            type="button"
                            className="font-mono underline-offset-2 hover:underline"
                            onClick={() => onSelectFile(c.path)}
                          >
                            {c.path}
                          </button>
                          <span className="label-mono ml-auto">{relTime(c.createdAt)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {active.transcript ? <Markdown source={active.transcript} /> : null}
              </div>
            ) : null}

            {stream !== null ? (
              <div className="space-y-2">
                <div className="label-mono flex items-center gap-1.5">
                  <Bot className="size-3.5" /> Development agent · {PROVIDER_LABEL[provider]}
                </div>
                {stream ? (
                  <Markdown source={stream} />
                ) : (
                  <div className="label-mono flex items-center gap-1.5">
                    <Loader2 className="size-3.5 animate-spin" /> Reading project knowledge…
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        {/* composer */}
        <div className="shrink-0 border-t border-border bg-surface px-6 py-3">
          <div className="mx-auto max-w-3xl space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={type} onValueChange={(v) => setType(v as AgentTaskType)}>
                <SelectTrigger className="h-8 w-[170px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AGENT_TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Tag>{realFiles.length} files in session</Tag>
              <Tag>{inputs.repository ? inputs.repository.fullName : "no repository"}</Tag>
              {busy ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto h-8 gap-1 text-xs"
                  onClick={() => abortRef.current?.abort()}
                >
                  <Ban className="size-3.5" /> Stop
                </Button>
              ) : null}
            </div>
            <Textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              rows={3}
              placeholder="Describe the development task — implement a requirement, fix a bug, refactor a feature, update documentation…"
              className="resize-none text-sm"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="label-mono flex items-center gap-1.5">
                <ShieldCheck className="size-3.5" /> Plans first · nothing changes without your approval
              </span>
              <Button size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={() => void startAgent()}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                Start agent
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  approved,
  busy,
  canApprove,
  onApprove,
  onReject,
}: {
  plan: AgentPlan;
  approved: boolean;
  busy: boolean;
  canApprove: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  return (
    <div className="panel space-y-3 px-4 py-3">
      <div className="label-mono">Execution plan</div>
      <PlanList icon={<FilePlus2 className="size-3.5" />} title="Files to create" items={plan.create} />
      <PlanList icon={<Pencil className="size-3.5" />} title="Files to modify" items={plan.modify} />
      <PlanList icon={<FileX2 className="size-3.5" />} title="Files to delete" items={plan.delete} />
      <div className="space-y-1">
        <div className="label-mono flex items-center gap-1.5">
          <Package className="size-3.5" /> Dependencies required
        </div>
        <p className="text-xs text-muted-foreground">
          {plan.dependencies.join(", ") || "none"}
        </p>
      </div>
      <div className="space-y-1">
        <div className="label-mono flex items-center gap-1.5">
          <AlertTriangle className="size-3.5" /> Risks
        </div>
        {plan.risks.length ? (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {plan.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">none stated</p>
        )}
      </div>
      <div className="space-y-1">
        <div className="label-mono">Estimated scope</div>
        <p className="text-xs text-muted-foreground">{plan.scope || "not stated"}</p>
      </div>
      {canApprove ? (
        <div className="flex items-center gap-2 border-t border-border pt-3">
          <Button size="sm" className="h-8 gap-1 text-xs" disabled={busy} onClick={onApprove}>
            <Check className="size-3.5" /> Approve and execute
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1 text-xs" onClick={onReject}>
            <Ban className="size-3.5" /> Reject plan
          </Button>
        </div>
      ) : (
        <p className="label-mono border-t border-border pt-3">
          {approved ? "Approved by you" : "Awaiting a new plan"}
        </p>
      )}
    </div>
  );
}

function PlanList({
  icon,
  title,
  items,
}: {
  icon: React.ReactNode;
  title: string;
  items: AgentPlan["create"];
}) {
  return (
    <div className="space-y-1">
      <div className="label-mono flex items-center gap-1.5">
        {icon} {title}
      </div>
      {items.length ? (
        <ul className="space-y-0.5">
          {items.map((f) => (
            <li key={f.path} className="text-xs">
              <span className="font-mono">{f.path}</span>
              {f.reason ? <span className="text-muted-foreground"> — {f.reason}</span> : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">none</p>
      )}
    </div>
  );
}
