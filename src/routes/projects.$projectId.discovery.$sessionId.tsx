import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EnginePicker, Tag, useEngine } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/lib/vpip/markdown";
import { useAiKeys } from "@/lib/vpip/keys";
import { PROVIDER_LABEL } from "@/lib/vpip/types";
import { audit, deleteWhere, did, insertRows, loadSession, updateRow } from "@/lib/vpip/discovery-db";
import {
  COLOR_CLASS,
  DISCOVERY_CATEGORIES,
  MATURITY,
  QTYPE_LABEL,
  answerText,
  computeMaturity,
  generateDiscoveryOutputs,
  overallReadiness,
  readyColor,
  runDiscoveryRound,
  transcriptOf,
  type DAnswer,
  type DKnowledge,
  type DOutput,
  type DQuestion,
  type DSession,
} from "@/lib/vpip/discovery";

export const Route = createFileRoute("/projects/$projectId/discovery/$sessionId")({
  head: () => ({
    meta: [
      { title: "Discovery Interview — VPIP" },
      { name: "description", content: "Answer AI-generated questions, review knowledge and track project readiness." },
      { property: "og:title", content: "Discovery Interview — VPIP" },
      { property: "og:description", content: "Structured AI project interview session." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Interview,
});

interface State {
  session: DSession;
  questions: DQuestion[];
  answers: DAnswer[];
  knowledge: DKnowledge[];
  outputs: DOutput[];
}

function Interview() {
  const { projectId, sessionId } = Route.useParams();
  const { provider, cfg } = useEngine();
  const { keys } = useAiKeys();
  const [st, setSt] = useState<State | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tab, setTab] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSt(await loadSession(sessionId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load discovery.");
    }
  }, [sessionId]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const hasKey = () => {
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return false;
    }
    return true;
  };

  const activeAnswers = useMemo(() => st?.answers.filter((a) => a.is_active) ?? [], [st]);
  const open = useMemo(
    () => (st?.questions ?? []).filter((q) => q.status === "open" && !activeAnswers.some((a) => a.question_id === q.id)),
    [st, activeAnswers],
  );

  const nextRound = async () => {
    if (!st || !hasKey()) return;
    setBusy("Generating the next most valuable questions…");
    try {
      const s = st.session;
      const r = await runDiscoveryRound(provider, cfg, {
        idea: s.idea,
        transcript: transcriptOf(st.questions, st.answers),
        knowledge: st.knowledge,
      });
      const round = s.round + 1;
      // retire stale open questions
      for (const q of open) await updateRow("vpip_discovery_questions", q.id, { status: "superseded" });
      const qs = r.questions.map((q) => ({ id: did(), session_id: s.id, round, qtype: q.qtype, text: q.text, choices: q.choices, category: q.category, priority: q.priority }));
      if (qs.length) await insertRows("vpip_discovery_questions", qs);
      for (const q of qs) await audit(projectId, s.id, "Question Generated", { question: q.text, type: QTYPE_LABEL[q.qtype], category: q.category, priority: q.priority });
      // knowledge: keep user decisions (source=user), replace AI-derived items
      const userKept = st.knowledge.filter((k) => k.source === "user");
      const keptText = new Set(userKept.map((k) => k.statement.toLowerCase()));
      const rejected = new Set(st.knowledge.filter((k) => k.source === "rejected").map((k) => k.statement.toLowerCase()));
      await deleteWhere("vpip_discovery_knowledge", "session_id", s.id);
      const fresh = r.knowledge
        .filter((k) => !keptText.has(k.statement.toLowerCase()) && !rejected.has(k.statement.toLowerCase()))
        .map((k) => ({ id: did(), session_id: s.id, category: k.category, status: k.status, statement: k.statement, source: "ai" }));
      const keep = st.knowledge.filter((k) => k.source !== "ai").map(({ created_at: _c, updated_at: _u, ...k }) => k);
      if (keep.length || fresh.length) await insertRows("vpip_discovery_knowledge", [...keep, ...fresh]);
      const prevOld = st.knowledge.map((k) => k.statement.toLowerCase());
      for (const k of fresh.filter((k) => k.status === "assumption" && !prevOld.includes(k.statement.toLowerCase())))
        await audit(projectId, s.id, "Assumption Created", { statement: k.statement, category: k.category });
      const before = overallReadiness(s.readiness ?? {});
      const after = overallReadiness(r.readiness);
      const maturity = computeMaturity(r.readiness);
      await updateRow("vpip_discovery_sessions", s.id, {
        readiness: r.readiness,
        maturity,
        round,
        recommendation: r.sufficient ? `Project definition is sufficient. You may continue discovery, or move to the next phase. ${r.recommendation}` : r.recommendation,
        updated_at: new Date().toISOString(),
      });
      if (before !== after) await audit(projectId, s.id, "Readiness Change", { from: before, to: after });
      if (maturity !== s.maturity) await audit(projectId, s.id, "Maturity Change", { from: `L${s.maturity} ${MATURITY[s.maturity]}`, to: `L${maturity} ${MATURITY[maturity]}` });
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Discovery round failed.");
    } finally {
      setBusy(null);
    }
  };

  // Auto-start the first round only once, for a brand-new session.
  useEffect(() => {
    if (st && st.session.round === 0 && st.questions.length === 0 && !busy && st.session.status === "active") void nextRound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.session.id, st?.session.round]);

  const submitAnswer = async (q: DQuestion, kind: DAnswer["kind"], value: string[], other: string) => {
    if (!st) return;
    const prev = st.answers.find((a) => a.question_id === q.id && a.is_active);
    const id = did();
    await insertRows("vpip_discovery_answers", { id, session_id: st.session.id, question_id: q.id, kind, value, other: other.trim() || null });
    if (prev) {
      await updateRow("vpip_discovery_answers", prev.id, { is_active: false, superseded_by: id });
      await audit(projectId, st.session.id, "Answer Modified", { question: q.text, from: answerText(prev), to: answerText({ ...prev, kind, value, other }) });
    } else {
      await audit(projectId, st.session.id, "Answer Selected", { question: q.text, type: QTYPE_LABEL[q.qtype], answer: answerText({ id, kind, value, other } as DAnswer) });
    }
    setEditing(null);
    await reload();
  };

  const decideAssumption = async (k: DKnowledge, approve: boolean) => {
    if (!st) return;
    await updateRow("vpip_discovery_knowledge", k.id, approve ? { status: "confirmed", source: "user" } : { status: "unknown", source: "rejected" });
    await audit(projectId, st.session.id, approve ? "Assumption Approved" : "Assumption Rejected", { statement: k.statement, category: k.category });
    await reload();
  };

  const moveNext = async () => {
    if (!st || !hasKey()) return;
    setBusy("Generating discovery outputs from current knowledge…");
    try {
      const out = await generateDiscoveryOutputs(provider, cfg, {
        idea: st.session.idea,
        transcript: transcriptOf(st.questions, st.answers),
        knowledge: st.knowledge,
      });
      const version = (st.outputs[0]?.version ?? 0) + 1;
      await insertRows("vpip_discovery_outputs", Object.entries(out).map(([kind, markdown]) => ({ id: did(), session_id: st.session.id, version, kind, markdown })));
      await updateRow("vpip_discovery_sessions", st.session.id, { status: "next_phase", updated_at: new Date().toISOString() });
      await audit(projectId, st.session.id, "Move To Next Phase", { version, readiness: overallReadiness(st.session.readiness) });
      setTab("Project Definition");
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Output generation failed.");
    } finally {
      setBusy(null);
    }
  };

  const finish = async () => {
    if (!st) return;
    await updateRow("vpip_discovery_sessions", st.session.id, { status: "finished", updated_at: new Date().toISOString() });
    await audit(projectId, st.session.id, "Finish Discovery", { readiness: overallReadiness(st.session.readiness) });
    await reload();
  };

  const reopen = async () => {
    if (!st) return;
    await updateRow("vpip_discovery_sessions", st.session.id, { status: "active", updated_at: new Date().toISOString() });
    await audit(projectId, st.session.id, "Return To Discovery", {});
    await reload();
  };

  if (!st) return <Shell title="Discovery">Loading…</Shell>;
  const s = st.session;
  const pct = overallReadiness(s.readiness ?? {});
  const color = COLOR_CLASS[readyColor(pct)];
  const active = s.status === "active";
  const answered = st.questions.filter((q) => st.answers.some((a) => a.question_id === q.id && a.is_active));
  const latestVersion = st.outputs[0]?.version;
  const outputs = st.outputs.filter((o) => o.version === latestVersion);

  return (
    <Shell
      title="Discovery Interview"
      subtitle={s.idea}
      actions={
        <div className="flex items-center gap-2">
          <EnginePicker />
          <Button variant="outline" asChild>
            <Link to="/projects/$projectId/discovery" params={{ projectId }}>All sessions</Link>
          </Button>
        </div>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5 min-w-0">
          {/* header: maturity + readiness */}
          <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
            <span className={`rounded px-2 py-1 text-sm font-semibold ${color}`}>Readiness {pct}%</span>
            <Tag>Maturity L{s.maturity} · {MATURITY[s.maturity]}</Tag>
            <Tag>Round {s.round}</Tag>
            <Tag>{s.status.replace("_", " ")}</Tag>
          </div>

          {s.recommendation && (
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
              <div className="font-medium mb-1">AI recommendation (advisory)</div>
              {s.recommendation}
            </div>
          )}

          {/* controls */}
          <div className="flex flex-wrap gap-2">
            {active ? (
              <>
                <Button onClick={nextRound} disabled={!!busy} variant="outline">Continue discovery</Button>
                <Button onClick={moveNext} disabled={!!busy} className={color}>Move to next phase</Button>
                <Button onClick={finish} disabled={!!busy} variant="outline">Finish discovery</Button>
              </>
            ) : (
              <>
                <Button onClick={reopen} disabled={!!busy}>Return to discovery</Button>
                <Button onClick={moveNext} disabled={!!busy} variant="outline">Regenerate outputs</Button>
              </>
            )}
          </div>
          {busy && <p className="text-sm text-muted-foreground animate-pulse">{busy}</p>}

          {/* open questions */}
          {active && open.length > 0 && (
            <div className="space-y-3">
              <div className="font-medium">Questions this round ({open.length})</div>
              {open.map((q) => (
                <QuestionCard key={q.id} q={q} onSubmit={submitAnswer} />
              ))}
            </div>
          )}
          {active && !busy && open.length === 0 && s.round > 0 && (
            <p className="text-sm text-muted-foreground">All questions in this round answered. Continue discovery, or move on whenever you like.</p>
          )}

          {/* outputs */}
          {outputs.length > 0 && (
            <div className="rounded-lg border">
              <div className="flex flex-wrap gap-1 border-b p-2">
                <span className="px-2 py-1 text-sm font-medium">Outputs v{latestVersion}</span>
                {outputs.map((o) => (
                  <Button key={o.id} size="sm" variant={(tab ?? outputs[0]?.kind) === o.kind ? "default" : "ghost"} onClick={() => setTab(o.kind)}>
                    {o.kind}
                  </Button>
                ))}
              </div>
              <div className="p-4 prose prose-sm max-w-none dark:prose-invert">
                <Markdown>{outputs.find((o) => o.kind === (tab ?? outputs[0]?.kind))?.markdown ?? ""}</Markdown>
              </div>
            </div>
          )}

          {/* history + edit */}
          <div className="space-y-2">
            <div className="font-medium">Previous answers ({answered.length})</div>
            {answered.map((q) => {
              const a = st.answers.find((x) => x.question_id === q.id && x.is_active)!;
              const old = st.answers.filter((x) => x.question_id === q.id && !x.is_active);
              return (
                <div key={q.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="text-muted-foreground text-xs">{q.category} · {QTYPE_LABEL[q.qtype]}</div>
                      <div className="font-medium">{q.text}</div>
                      <div>{answerText(a)}</div>
                      {old.map((o) => (
                        <div key={o.id} className="text-xs text-muted-foreground line-through">inactive: {answerText(o)}</div>
                      ))}
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(editing === q.id ? null : q.id)}>Edit</Button>
                  </div>
                  {editing === q.id && (
                    <div className="mt-2">
                      <QuestionCard q={q} initial={a} onSubmit={submitAnswer} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* right: readiness + knowledge */}
        <div className="space-y-5">
          <div className="rounded-lg border p-3 space-y-2">
            <div className="font-medium">Readiness dashboard</div>
            {DISCOVERY_CATEGORIES.map((c) => {
              const v = s.readiness?.[c] ?? 0;
              return (
                <div key={c}>
                  <div className="flex justify-between text-xs"><span>{c}</span><span>{v}%</span></div>
                  <div className="h-2 rounded bg-muted overflow-hidden">
                    <div className={`h-full ${COLOR_CLASS[readyColor(v)]}`} style={{ width: `${v}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
          <KnowledgeColumn title="Confirmed" items={st.knowledge.filter((k) => k.status === "confirmed")} />
          <KnowledgeColumn
            title="Assumptions"
            items={st.knowledge.filter((k) => k.status === "assumption")}
            actions={(k) => (
              <div className="flex gap-1 mt-1">
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => decideAssumption(k, true)}>Approve</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => decideAssumption(k, false)}>Reject</Button>
              </div>
            )}
          />
          <KnowledgeColumn title="Unknown" items={st.knowledge.filter((k) => k.status === "unknown")} />
        </div>
      </div>
    </Shell>
  );
}

function KnowledgeColumn({ title, items, actions }: { title: string; items: DKnowledge[]; actions?: (k: DKnowledge) => React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="font-medium mb-2">{title} ({items.length})</div>
      {items.length === 0 && <p className="text-xs text-muted-foreground">Nothing yet.</p>}
      <ul className="space-y-2">
        {items.map((k) => (
          <li key={k.id} className="text-sm">
            <span className="text-xs text-muted-foreground">{k.category} · </span>
            {k.statement}
            {actions?.(k)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function QuestionCard({
  q,
  initial,
  onSubmit,
}: {
  q: DQuestion;
  initial?: DAnswer;
  onSubmit: (q: DQuestion, kind: DAnswer["kind"], value: string[], other: string) => Promise<void>;
}) {
  const [sel, setSel] = useState<string[]>(initial?.kind === "answer" ? initial.value : []);
  const [other, setOther] = useState(initial?.other ?? "");
  const [text, setText] = useState(q.qtype === "text" && initial ? initial.value[0] ?? "" : "");
  const [saving, setSaving] = useState(false);
  const multi = q.qtype === "multiple";

  const go = async (kind: DAnswer["kind"]) => {
    setSaving(true);
    try {
      const value = kind !== "answer" ? [] : q.qtype === "text" ? [text.trim().slice(0, 500)].filter(Boolean) : sel;
      if (kind === "answer" && value.length === 0 && !other.trim()) {
        toast.error("Pick an answer, fill Other, or choose Not sure / Skip.");
        return;
      }
      await onSubmit(q, kind, value, kind === "answer" ? other : "");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save answer.");
    } finally {
      setSaving(false);
    }
  };

  const toggle = (c: string) => setSel((s) => (multi ? (s.includes(c) ? s.filter((x) => x !== c) : [...s, c]) : [c]));

  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="text-xs text-muted-foreground">{q.category} · {QTYPE_LABEL[q.qtype]}{multi ? " · pick all that apply" : ""}</div>
      <div className="font-medium">{q.text}</div>
      {q.qtype === "text" ? (
        <Input value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Short answer (max 500 characters)" />
      ) : q.qtype === "dropdown" ? (
        <select className="w-full rounded-md border bg-background p-2 text-sm" value={sel[0] ?? ""} onChange={(e) => setSel(e.target.value ? [e.target.value] : [])}>
          <option value="">Choose…</option>
          {q.choices.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      ) : (
        <div className="flex flex-wrap gap-2">
          {q.choices.map((c) => (
            <Button key={c} type="button" size="sm" variant={sel.includes(c) ? "default" : "outline"} onClick={() => toggle(c)}>{c}</Button>
          ))}
        </div>
      )}
      <Input value={other} onChange={(e) => setOther(e.target.value)} placeholder="Other: ____________" />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => go("answer")} disabled={saving}>Save answer</Button>
        <Button size="sm" variant="outline" onClick={() => go("not_sure")} disabled={saving}>Not sure</Button>
        <Button size="sm" variant="ghost" onClick={() => go("skip")} disabled={saving}>Skip question</Button>
      </div>
    </div>
  );
}
