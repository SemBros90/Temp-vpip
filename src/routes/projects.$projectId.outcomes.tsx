import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CircleCheck, Plus, Trash2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, useEngine } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import {
  FAILURE_SUBJECTS,
  OUTCOME_RESULTS,
  OUTCOME_SUBJECTS,
  type FailureSubject,
  type OutcomeResult,
  type OutcomeSubject,
} from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/outcomes")({
  head: () => ({
    meta: [
      { title: "Outcomes & Failures — VPIP" },
      {
        name: "description",
        content:
          "Record the result of every build, agent run and prompt execution, and analyse failures with root cause, resolution and lessons learned.",
      },
      { property: "og:title", content: "Outcomes & Failures — VPIP" },
      {
        property: "og:description",
        content: "Outcome learning and failure analysis, linked back to builds, prompts and requirements.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OutcomesPage,
});

function OutcomesPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();

  const subjectOptions = [
    ...p.buildSessions.map((b) => ({
      value: `Build::${b.id}`,
      label: `${b.code} — ${b.promptTitle}`,
    })),
    ...p.prompts.map((x) => ({
      value: `Prompt Execution::${x.id}`,
      label: `${x.title} V${x.version}`,
    })),
  ];

  /* ---- outcome form */
  const [oSubjectType, setOSubjectType] = useState<OutcomeSubject>("Build");
  const [oSubject, setOSubject] = useState("");
  const [oResult, setOResult] = useState<OutcomeResult>("Success");
  const [oNotes, setONotes] = useState("");
  const [oLessons, setOLessons] = useState("");
  const [oRecs, setORecs] = useState("");

  const saveOutcome = () => {
    const picked = subjectOptions.find((s) => s.value === oSubject);
    if (!picked && !oNotes.trim()) {
      toast.error("Pick a subject or describe the outcome.");
      return;
    }
    const [kind, id] = (oSubject || "").split("::");
    const rec = actions.addOutcome({
      projectId,
      subjectType: (kind as OutcomeSubject) || oSubjectType,
      subjectId: id ?? "",
      subjectLabel: picked?.label ?? oSubjectType,
      result: oResult,
      notes: oNotes.trim(),
      lessons: oLessons.trim(),
      recommendations: oRecs.trim(),
      provider,
      model: cfg.model,
      author,
    });
    if (oLessons.trim()) {
      actions.addKnowledge([{
        projectId,
        type: "Lesson Learned",
        status: "candidate",
        title: `Lesson from ${rec.subjectLabel}`.slice(0, 160),
        description: oLessons.trim(),
        sourceKind: "Build Session",
        sourceRefId: rec.subjectId,
        sourceMessages: [],
        provider,
        author,
      }]);
    }
    actions.logActivity({
      projectId,
      subjectType: "Outcome",
      subjectId: rec.id,
      subjectLabel: `${rec.code} — ${rec.subjectLabel}`,
      action: "Recorded",
      provider,
      model: cfg.model,
      author,
      note: rec.result,
    });
    setONotes("");
    setOLessons("");
    setORecs("");
    toast.success(`${rec.code} recorded${oLessons.trim() ? " · lesson sent to Knowledge Inbox" : ""}.`);
  };

  /* ---- failure form */
  const [fSubjectType, setFSubjectType] = useState<FailureSubject>("Build");
  const [fSubject, setFSubject] = useState("");
  const [fTitle, setFTitle] = useState("");
  const [fRoot, setFRoot] = useState("");
  const [fRes, setFRes] = useState("");
  const [fLessons, setFLessons] = useState("");
  const [fCodes, setFCodes] = useState("");

  const saveFailure = () => {
    if (!fTitle.trim() || !fRoot.trim()) {
      toast.error("A failure needs a title and a root cause.");
      return;
    }
    const picked = subjectOptions.find((s) => s.value === fSubject);
    const [, id] = (fSubject || "").split("::");
    const codes = fCodes
      .split(",")
      .map((c) => c.trim().toUpperCase())
      .filter(Boolean);
    const rec = actions.addFailure({
      projectId,
      subjectType: fSubjectType,
      subjectId: id ?? "",
      subjectLabel: picked?.label ?? fSubjectType,
      title: fTitle.trim(),
      rootCause: fRoot.trim(),
      resolution: fRes.trim(),
      lessons: fLessons.trim(),
      status: fRes.trim() ? "Resolved" : "Open",
      buildIds: fSubjectType === "Build" && id ? [id] : [],
      promptIds: fSubjectType === "Prompt" && id ? [id] : [],
      requirementCodes: codes.filter((c) => c.startsWith("R-")),
      decisionCodes: codes.filter((c) => c.startsWith("D-")),
      provider,
      model: cfg.model,
      author,
    });
    actions.addKnowledge([{
      projectId,
      type: "Failure Cause",
      status: "candidate",
      title: rec.title.slice(0, 160),
      description: `${rec.rootCause}${rec.resolution ? `\n\nResolution: ${rec.resolution}` : ""}`,
      sourceKind: "Build Session",
      sourceRefId: rec.subjectId,
      sourceMessages: [],
      provider,
      author,
    }]);
    actions.logActivity({
      projectId,
      subjectType: "Failure",
      subjectId: rec.id,
      subjectLabel: `${rec.code} — ${rec.title}`,
      action: "Recorded",
      provider,
      model: cfg.model,
      author,
      note: rec.status,
    });
    setFTitle("");
    setFRoot("");
    setFRes("");
    setFLessons("");
    setFCodes("");
    toast.success(`${rec.code} recorded · failure cause sent to Knowledge Inbox.`);
  };

  return (
    <Shell
      title="Outcomes & Failures"
      subtitle={`${p.outcomes.length} outcomes · ${p.failures.length} failures`}
    >
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="grid gap-4 lg:grid-cols-2">
          {/* -------- outcome */}
          <section className="panel">
            <div className="label-mono flex items-center gap-2 border-b border-border px-4 py-2.5">
              <CircleCheck className="size-3.5" /> Record outcome
            </div>
            <div className="space-y-2.5 p-4">
              <div className="grid grid-cols-2 gap-2">
                <Select value={oSubjectType} onValueChange={(v) => setOSubjectType(v as OutcomeSubject)}>
                  <SelectTrigger className="h-8 bg-surface-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={oResult} onValueChange={(v) => setOResult(v as OutcomeResult)}>
                  <SelectTrigger className="h-8 bg-surface-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {OUTCOME_RESULTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Select value={oSubject} onValueChange={setOSubject}>
                <SelectTrigger className="h-8 bg-surface-2 text-xs">
                  <SelectValue placeholder="Subject (build or prompt)" />
                </SelectTrigger>
                <SelectContent>
                  {subjectOptions.length ? (
                    subjectOptions.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        {s.label}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="none" disabled>
                      No builds or prompts yet
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Textarea
                value={oNotes}
                onChange={(e) => setONotes(e.target.value)}
                placeholder="What happened"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Textarea
                value={oLessons}
                onChange={(e) => setOLessons(e.target.value)}
                placeholder="Lessons learned (becomes a Knowledge Inbox candidate)"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Textarea
                value={oRecs}
                onChange={(e) => setORecs(e.target.value)}
                placeholder="Recommendations for next time"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Button size="sm" className="h-8 w-full" onClick={saveOutcome}>
                <Plus className="size-4" /> Record outcome
              </Button>
            </div>
          </section>

          {/* -------- failure */}
          <section className="panel">
            <div className="label-mono flex items-center gap-2 border-b border-border px-4 py-2.5">
              <TriangleAlert className="size-3.5" /> Log failure
            </div>
            <div className="space-y-2.5 p-4">
              <div className="grid grid-cols-2 gap-2">
                <Select value={fSubjectType} onValueChange={(v) => setFSubjectType(v as FailureSubject)}>
                  <SelectTrigger className="h-8 bg-surface-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAILURE_SUBJECTS.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={fSubject} onValueChange={setFSubject}>
                  <SelectTrigger className="h-8 bg-surface-2 text-xs">
                    <SelectValue placeholder="Subject" />
                  </SelectTrigger>
                  <SelectContent>
                    {subjectOptions.length ? (
                      subjectOptions.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))
                    ) : (
                      <SelectItem value="none" disabled>
                        No builds or prompts yet
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <Input
                value={fTitle}
                onChange={(e) => setFTitle(e.target.value)}
                placeholder="Failure title"
                className="h-8 bg-surface-2 text-sm"
              />
              <Textarea
                value={fRoot}
                onChange={(e) => setFRoot(e.target.value)}
                placeholder="Root cause"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Textarea
                value={fRes}
                onChange={(e) => setFRes(e.target.value)}
                placeholder="Resolution (leave empty to keep it Open)"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Textarea
                value={fLessons}
                onChange={(e) => setFLessons(e.target.value)}
                placeholder="Lessons learned"
                className="min-h-[60px] bg-surface-2 text-sm"
              />
              <Input
                value={fCodes}
                onChange={(e) => setFCodes(e.target.value)}
                placeholder="Linked codes, comma separated (e.g. R-004, D-002)"
                className="h-8 bg-surface-2 text-sm"
              />
              <Button size="sm" variant="outline" className="h-8 w-full" onClick={saveFailure}>
                <Plus className="size-4" /> Log failure
              </Button>
            </div>
          </section>
        </div>

        <section>
          <div className="label-mono mb-2">Outcome register · {p.outcomes.length}</div>
          {p.outcomes.length ? (
            <div className="panel divide-y divide-border">
              {p.outcomes.map((o) => (
                <div key={o.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-primary">{o.code}</span>
                    <Tag>{o.subjectType}</Tag>
                    <span className="text-sm font-medium">{o.subjectLabel}</span>
                    <span
                      className={
                        o.result === "Success"
                          ? "text-xs text-success"
                          : o.result === "Failure"
                            ? "text-xs text-destructive"
                            : "text-xs text-warning"
                      }
                    >
                      {o.result}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="ml-auto size-7 text-destructive"
                      onClick={() => actions.deleteOutcome(o.id)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  {o.notes ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">{o.notes}</p>
                  ) : null}
                  {o.lessons ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs">
                      <span className="label-mono">Lessons</span> {o.lessons}
                    </p>
                  ) : null}
                  {o.recommendations ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs">
                      <span className="label-mono">Recommendations</span> {o.recommendations}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {o.provider ? <Tag>{o.provider}</Tag> : null}
                    {o.model ? <Tag>{o.model}</Tag> : null}
                    <Tag>{o.author}</Tag>
                    <Tag>{new Date(o.createdAt).toLocaleString()}</Tag>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No outcomes recorded"
              description="After a build, agent run or prompt execution, record whether it succeeded and what was learned."
            />
          )}
        </section>

        <section>
          <div className="label-mono mb-2">Failure register · {p.failures.length}</div>
          {p.failures.length ? (
            <div className="panel divide-y divide-border">
              {p.failures.map((f) => (
                <div key={f.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-destructive">{f.code}</span>
                    <Tag>{f.subjectType}</Tag>
                    <span className="text-sm font-medium">{f.title}</span>
                    <Tag>{f.status}</Tag>
                    <span className="ml-auto flex items-center gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() =>
                          actions.updateFailure(f.id, {
                            status: f.status === "Open" ? "Resolved" : "Open",
                          })
                        }
                      >
                        Mark {f.status === "Open" ? "resolved" : "open"}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 text-destructive"
                        onClick={() => actions.deleteFailure(f.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </span>
                  </div>
                  <p className="mt-1.5 whitespace-pre-wrap text-xs text-muted-foreground">
                    <span className="label-mono">Root cause</span> {f.rootCause}
                  </p>
                  {f.resolution ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs">
                      <span className="label-mono">Resolution</span> {f.resolution}
                    </p>
                  ) : null}
                  {f.lessons ? (
                    <p className="mt-1.5 whitespace-pre-wrap text-xs">
                      <span className="label-mono">Lessons</span> {f.lessons}
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {f.subjectLabel ? <Tag>{f.subjectLabel}</Tag> : null}
                    {f.requirementCodes.map((c) => (
                      <Tag key={c}>{c}</Tag>
                    ))}
                    {f.decisionCodes.map((c) => (
                      <Tag key={c}>{c}</Tag>
                    ))}
                    {f.provider ? <Tag>{f.provider}</Tag> : null}
                    <Tag>{new Date(f.createdAt).toLocaleString()}</Tag>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No failures logged"
              description="Capture build, agent, prompt and requirement-gap failures with their root cause and resolution."
            />
          )}
        </section>
      </div>
    </Shell>
  );
}
