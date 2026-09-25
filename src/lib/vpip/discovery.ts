import { completeChat, extractJson } from "./ai";
import type { ProviderConfig, ProviderId } from "./types";

/** Phase D-01 — Discovery Engine: AI-guided project interview. */

export const DISCOVERY_CATEGORIES = [
  "Project Definition",
  "Users & Roles",
  "Business Model",
  "Features",
  "Workflow",
  "Integrations",
  "Technology",
] as const;
export type DiscoveryCategory = (typeof DISCOVERY_CATEGORIES)[number];

export type QType = "single" | "multiple" | "yesno" | "dropdown" | "text";
export const QTYPE_LABEL: Record<QType, string> = {
  single: "QT-01 Single choice",
  multiple: "QT-02 Multiple choice",
  yesno: "QT-03 Yes / No",
  dropdown: "QT-04 Dropdown",
  text: "QT-05 Limited free text",
};

export type KnowledgeStatus = "confirmed" | "assumption" | "unknown";

export interface DQuestion {
  id: string;
  session_id: string;
  round: number;
  qtype: QType;
  text: string;
  choices: string[];
  category: string;
  priority: number;
  status: string;
  created_at: string;
}
export interface DAnswer {
  id: string;
  session_id: string;
  question_id: string;
  kind: "answer" | "not_sure" | "skip";
  value: string[];
  other: string | null;
  is_active: boolean;
  superseded_by: string | null;
  created_at: string;
}
export interface DKnowledge {
  id: string;
  session_id: string;
  category: string;
  status: KnowledgeStatus;
  statement: string;
  source: string;
  created_at: string;
  updated_at: string;
}
export interface DSession {
  id: string;
  project_id: string;
  idea: string;
  status: "active" | "next_phase" | "finished";
  maturity: number;
  readiness: Record<string, number>;
  recommendation: string;
  round: number;
  created_at: string;
  updated_at: string;
}
export interface DOutput {
  id: string;
  session_id: string;
  version: number;
  kind: string;
  markdown: string;
  created_at: string;
}

export const MATURITY = ["Idea", "Concept Defined", "Business Defined", "Functional Defined", "Build Ready"];

export type ReadyColor = "red" | "orange" | "yellow" | "green";
export function readyColor(pct: number): ReadyColor {
  if (pct < 25) return "red";
  if (pct < 50) return "orange";
  if (pct < 75) return "yellow";
  return "green";
}
export const COLOR_CLASS: Record<ReadyColor, string> = {
  red: "bg-destructive text-destructive-foreground",
  orange: "bg-orange-500 text-white",
  yellow: "bg-yellow-400 text-black",
  green: "bg-emerald-600 text-white",
};

export function overallReadiness(r: Record<string, number>) {
  const vals = DISCOVERY_CATEGORIES.map((c) => clampPct(r[c] ?? 0));
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}
function clampPct(n: unknown) {
  const v = Number(n);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : 0;
}

/** Maturity computed by the app from category completeness (not by the AI). */
export function computeMaturity(r: Record<string, number>): number {
  const ok = (c: DiscoveryCategory, t = 60) => (r[c] ?? 0) >= t;
  const overall = overallReadiness(r);
  if (overall >= 75 && DISCOVERY_CATEGORIES.every((c) => (r[c] ?? 0) >= 50)) return 4;
  if (ok("Project Definition") && ok("Users & Roles") && ok("Business Model") && ok("Features") && ok("Workflow")) return 3;
  if (ok("Project Definition") && ok("Users & Roles") && ok("Business Model")) return 2;
  if (ok("Project Definition", 40)) return 1;
  return 0;
}

/* ------------------------------------------------------------ AI round */

export interface RoundResult {
  questions: { qtype: QType; text: string; choices: string[]; category: string; priority: number }[];
  knowledge: { category: string; status: KnowledgeStatus; statement: string }[];
  readiness: Record<string, number>;
  recommendation: string;
  sufficient: boolean;
}

const ROUND_SYSTEM = `You are the Discovery Engine of VPIP, running a structured AI PROJECT INTERVIEW (not a chat).
The user may be non-technical. Never assume technical knowledge. Never use fixed templates or fixed questionnaires: derive every question from the current project knowledge.
Ask the HIGHEST-VALUE UNANSWERED questions first (1 to 3, never more). Recalculate priority each round. Never repeat an already answered question.
Question types: "multiple" (DEFAULT — use whenever answers are not mutually exclusive), "single", "yesno", "dropdown" (many options, one pick), "text" (only when truly required).
Every non-text question MUST include 3-8 suggested answer choices written in plain language. Do NOT include "Other", "Not sure" or "Skip" — the app adds them.
Categories: ${DISCOVERY_CATEGORIES.join(", ")}.
Knowledge: return the FULL current knowledge list. "confirmed" = explicitly stated/approved by the user ONLY. "assumption" = your inference, never presented as fact. "unknown" = important gap not reasonably inferable. Keep already-confirmed items confirmed.
Readiness: for each category give completeness 0-100 based on confirmed knowledge (assumptions count at most half).
Reply ONLY with JSON:
{"questions":[{"qtype":"multiple","text":"...","choices":["..."],"category":"Features","priority":95}],
 "knowledge":[{"category":"...","status":"confirmed|assumption|unknown","statement":"..."}],
 "readiness":{"Project Definition":0,...},
 "sufficient":false,
 "recommendation":"one or two advisory sentences"}`;

const TYPES: QType[] = ["single", "multiple", "yesno", "dropdown", "text"];

export async function runDiscoveryRound(
  provider: ProviderId,
  cfg: ProviderConfig,
  input: { idea: string; transcript: string; knowledge: DKnowledge[] },
): Promise<RoundResult> {
  const know = input.knowledge
    .map((k) => `- [${k.status}] (${k.category}) ${k.statement}`)
    .join("\n");
  const raw = await completeChat(provider, cfg, [
    { role: "system", content: ROUND_SYSTEM },
    {
      role: "user",
      content: `PROJECT STATEMENT: ${input.idea}\n\nCURRENT KNOWLEDGE:\n${know || "(none yet)"}\n\nANSWERS SO FAR (active only):\n${input.transcript || "(none yet)"}`,
    },
  ]);
  const p = extractJson<Partial<RoundResult>>(raw);
  if (!p || typeof p !== "object") throw new Error("The AI did not return a valid discovery round. Try again.");
  const questions = (Array.isArray(p.questions) ? p.questions : [])
    .filter((q) => q && typeof q.text === "string" && q.text.trim())
    .map((q) => {
      const qtype: QType = TYPES.includes(q.qtype as QType) ? (q.qtype as QType) : "multiple";
      let choices = Array.isArray(q.choices) ? q.choices.map(String).filter(Boolean) : [];
      choices = choices.filter((c) => !/^(other|not sure|skip)/i.test(c.trim()));
      if (qtype === "yesno") choices = ["Yes", "No"];
      return {
        qtype: qtype !== "text" && choices.length === 0 ? "text" : qtype,
        text: q.text.trim(),
        choices,
        category: String(q.category ?? "Project Definition"),
        priority: Number(q.priority) || 0,
      };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);
  const knowledge = (Array.isArray(p.knowledge) ? p.knowledge : [])
    .filter((k) => k && typeof k.statement === "string" && k.statement.trim())
    .map((k) => ({
      category: String(k.category ?? "Project Definition"),
      status: (["confirmed", "assumption", "unknown"].includes(k.status as string) ? k.status : "assumption") as KnowledgeStatus,
      statement: k.statement.trim(),
    }));
  const readiness: Record<string, number> = {};
  for (const c of DISCOVERY_CATEGORIES) readiness[c] = clampPct((p.readiness as Record<string, number> | undefined)?.[c]);
  return {
    questions,
    knowledge,
    readiness,
    sufficient: Boolean(p.sufficient),
    recommendation: typeof p.recommendation === "string" ? p.recommendation : "",
  };
}

export const OUTPUT_KINDS = [
  "Project Definition",
  "Requirements",
  "Assumptions",
  "Risks",
  "Decisions",
  "Modules",
  "Roadmap",
  "Build Plan",
] as const;

export async function generateDiscoveryOutputs(
  provider: ProviderId,
  cfg: ProviderConfig,
  input: { idea: string; transcript: string; knowledge: DKnowledge[] },
): Promise<Record<string, string>> {
  const know = input.knowledge.map((k) => `- [${k.status.toUpperCase()}] (${k.category}) ${k.statement}`).join("\n");
  const raw = await completeChat(provider, cfg, [
    {
      role: "system",
      content: `You turn project discovery knowledge into planning outputs. Never block on missing information: mark anything not confirmed as "(Assumption)" and gaps as "(Unknown)". Never present assumptions as confirmed facts.
Reply ONLY with a JSON object whose keys are exactly: ${OUTPUT_KINDS.map((k) => `"${k}"`).join(", ")}; each value is Markdown.`,
    },
    { role: "user", content: `PROJECT STATEMENT: ${input.idea}\n\nKNOWLEDGE:\n${know || "(none)"}\n\nANSWERS:\n${input.transcript || "(none)"}` },
  ]);
  const p = extractJson<Record<string, unknown>>(raw);
  if (!p) throw new Error("The AI did not return the discovery outputs. Try again.");
  const out: Record<string, string> = {};
  for (const k of OUTPUT_KINDS) out[k] = typeof p[k] === "string" ? (p[k] as string) : "_(Unknown — not generated)_";
  return out;
}

export function answerText(a: DAnswer) {
  if (a.kind === "not_sure") return "Not sure";
  if (a.kind === "skip") return "Skipped";
  return [...a.value, ...(a.other ? [`Other: ${a.other}`] : [])].join(", ");
}

export function transcriptOf(questions: DQuestion[], answers: DAnswer[]) {
  return questions
    .map((q) => {
      const a = answers.find((x) => x.question_id === q.id && x.is_active);
      return a ? `Q (${q.category}): ${q.text}\nA: ${answerText(a)}` : null;
    })
    .filter(Boolean)
    .join("\n\n");
}
