import { completeChat, extractJson, type ChatMessage } from "./ai";
import type {
  Discussion,
  DocumentKind,
  GeneratedDocument,
  GeneratedPrompt,
  KnowledgeItem,
  KnowledgeType,
  Project,
  ProviderConfig,
  ProviderId,
  PromptKind,
} from "./types";

export interface ProjectMemory {
  project: Project;
  discussions: Discussion[];
  approved: KnowledgeItem[];
  documents: GeneratedDocument[];
  prompts: GeneratedPrompt[];
}

/* ------------------------------------------------- context retrieval */

export interface ContextHit {
  kind: "Discussion" | "Decision" | "Requirement" | "Idea" | "Risk" | "Question" | "Assumption" | "Document" | "Prompt";
  id: string;
  label: string;
  excerpt: string;
  score: number;
  discussionId?: string | undefined;
}

function tokens(q: string) {
  return [...new Set(q.toLowerCase().match(/[a-z0-9]{3,}/g) ?? [])];
}

function score(text: string, terms: string[]) {
  const hay = text.toLowerCase();
  return terms.reduce((acc, t) => acc + (hay.split(t).length - 1), 0);
}

function excerpt(text: string, terms: string[], len = 320) {
  const hay = text.toLowerCase();
  const first = terms.map((t) => hay.indexOf(t)).filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 80);
  return (start > 0 ? "…" : "") + text.slice(start, start + len).trim() + (text.length > start + len ? "…" : "");
}

export function retrieveContext(mem: ProjectMemory, query: string, limit = 12): ContextHit[] {
  const terms = tokens(query);
  if (!terms.length) return [];
  const hits: ContextHit[] = [];

  for (const d of mem.discussions) {
    for (const m of d.messages) {
      const s = score(`${d.title} ${m.content}`, terms);
      if (s > 0) {
        hits.push({
          kind: "Discussion",
          id: `${d.id}:${m.id}`,
          label: `${d.title} · message ${m.seq}`,
          excerpt: excerpt(m.content, terms),
          score: s,
          discussionId: d.id,
        });
      }
    }
  }
  for (const k of mem.approved) {
    const s = score(`${k.title} ${k.description}`, terms);
    if (s > 0) {
      hits.push({
        kind: k.type,
        id: k.id,
        label: `${k.code} · ${k.title}`,
        excerpt: excerpt(k.description, terms),
        score: s + 2,
        discussionId: k.sourceDiscussionId,
      });
    }
  }
  for (const doc of mem.documents) {
    const s = score(`${doc.title} ${doc.markdown}`, terms);
    if (s > 0) {
      hits.push({ kind: "Document", id: doc.id, label: doc.title, excerpt: excerpt(doc.markdown, terms), score: s });
    }
  }
  for (const p of mem.prompts) {
    const s = score(`${p.title} ${p.markdown}`, terms);
    if (s > 0) {
      hits.push({ kind: "Prompt", id: p.id, label: `${p.title} V${p.version}`, excerpt: excerpt(p.markdown, terms), score: s });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function buildContextPackage(mem: ProjectMemory, hits: ContextHit[]) {
  const lines = [
    `# Project memory package — ${mem.project.name}`,
    mem.project.description ? `Project brief: ${mem.project.description}` : "",
    "",
    "## Retrieved sources",
  ];
  hits.forEach((h, i) => {
    lines.push(`\n[${i + 1}] (${h.kind}) ${h.label}\n${h.excerpt}`);
  });
  if (!hits.length) lines.push("\n(no matching project memory found)");
  return lines.filter(Boolean).join("\n");
}

/* ------------------------------------------------- project memory digest */

export function memoryDigest(mem: ProjectMemory, maxChars = 6000) {
  const byType = (t: KnowledgeType) =>
    mem.approved
      .filter((k) => k.type === t)
      .map((k) => `- ${k.code} ${k.title}: ${k.description}`)
      .join("\n");
  const text = [
    `PROJECT: ${mem.project.name}`,
    mem.project.description && `BRIEF: ${mem.project.description}`,
    `\nDECISIONS:\n${byType("Decision") || "- none"}`,
    `\nREQUIREMENTS:\n${byType("Requirement") || "- none"}`,
    `\nRISKS:\n${byType("Risk") || "- none"}`,
    `\nOPEN QUESTIONS:\n${byType("Question") || "- none"}`,
    `\nIDEAS:\n${byType("Idea") || "- none"}`,
    `\nASSUMPTIONS:\n${byType("Assumption") || "- none"}`,
    `\nDISCUSSIONS: ${mem.discussions.map((d) => `${d.title} (${d.type})`).join(", ") || "none"}`,
    `\nDOCUMENTS: ${mem.documents.map((d) => d.title).join(", ") || "none"}`,
  ]
    .filter(Boolean)
    .join("\n");
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…(truncated)` : text;
}

export function discussionTranscript(d: Discussion, maxChars = 12000) {
  const text = d.messages
    .map((m) => `[${m.seq}] ${m.role === "user" ? "USER" : "AI"}: ${m.content}`)
    .join("\n\n");
  return text.length > maxChars ? text.slice(-maxChars) : text;
}

/* ------------------------------------------------- extraction */

export interface Candidate {
  type: KnowledgeType;
  title: string;
  description: string;
  messages: number[];
}

const EXTRACTION_SYSTEM = `You are the knowledge extraction engine of a project intelligence platform.
Read the discussion transcript and extract durable project knowledge.
Return ONLY a JSON array. Each element:
{"type":"Decision|Requirement|Idea|Risk|Question|Assumption","title":"short title","description":"1-3 precise sentences","messages":[message numbers you used]}
Extract only substantive, project-specific knowledge. No filler. Max 15 items.`;

export async function extractKnowledge(
  provider: ProviderId,
  cfg: ProviderConfig,
  discussion: Discussion,
): Promise<Candidate[]> {
  const raw = await completeChat(provider, cfg, [
    { role: "system", content: EXTRACTION_SYSTEM },
    {
      role: "user",
      content: `Discussion: ${discussion.title} (type: ${discussion.type})\n\n${discussionTranscript(discussion)}`,
    },
  ]);
  const parsed = extractJson<Candidate[]>(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((c) => c && c.title && c.type)
    .map((c) => ({
      type: c.type,
      title: String(c.title).slice(0, 160),
      description: String(c.description ?? ""),
      messages: Array.isArray(c.messages) ? c.messages.map(Number).filter(Number.isFinite) : [],
    }));
}

/* ------------------------------------------------- generators */

const DOC_BRIEFS: Record<DocumentKind, string> = {
  "Project Summary": "A structured project summary: purpose, current state, key decisions, requirements, risks, open questions, next steps.",
  "Decision Register": "A formal decision register table plus one section per decision: context, decision, rationale, consequences, source.",
  "Requirement Register": "A formal requirement register: ID, requirement, type (functional/non-functional), priority, rationale, source.",
  "Architecture Summary": "An architecture summary: components, data flow, interfaces, technology choices, constraints, and the decisions behind them.",
  "Discussion Summary": "A faithful summary of the selected discussion: topics, conclusions, action items, unresolved points.",
  "Research Summary": "A research summary: questions investigated, findings, evidence, gaps, recommended next investigations.",
  "Project Knowledge Book": "A complete knowledge book: overview, architecture, decisions, requirements, ideas, risks, questions, documents index, glossary.",
};

export async function generateDocument(
  provider: ProviderId,
  cfg: ProviderConfig,
  kind: DocumentKind,
  mem: ProjectMemory,
  discussion?: Discussion,
): Promise<string> {
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: `You write precise engineering documents for a project intelligence platform. Output Markdown only, no preamble. Use only the supplied project memory; never invent facts. Where a fact comes from a knowledge item, cite its code (e.g. D-001).`,
    },
    {
      role: "user",
      content: `Produce: ${kind}\nBrief: ${DOC_BRIEFS[kind]}\n\nPROJECT MEMORY:\n${memoryDigest(mem)}${
        discussion ? `\n\nFOCUS DISCUSSION — ${discussion.title}:\n${discussionTranscript(discussion)}` : ""
      }`,
    },
  ];
  return completeChat(provider, cfg, messages);
}

const PROMPT_BRIEFS: Record<PromptKind, string> = {
  "Lovable Prompt": "A complete build prompt for the Lovable AI web app builder: purpose, stack, modules, data model, UI structure, success criteria.",
  "Replit Prompt": "A complete build prompt for Replit Agent: runtime, project layout, dependencies, features, milestones.",
  "Architecture Prompt": "A prompt that makes an AI produce a rigorous architecture proposal for this project, with constraints and evaluation criteria.",
  "Research Prompt": "A prompt that directs an AI to research the project's open questions with sources and comparative analysis.",
  "Business Prompt": "A prompt that makes an AI produce business model, market and monetisation analysis for this project.",
  "Custom Prompt": "Follow the user's custom instruction exactly.",
};

export async function generatePrompt(
  provider: ProviderId,
  cfg: ProviderConfig,
  kind: PromptKind,
  mem: ProjectMemory,
  instruction?: string,
): Promise<string> {
  return completeChat(provider, cfg, [
    {
      role: "system",
      content:
        "You are a prompt engineer. Output only the finished prompt in Markdown, ready to paste into the target tool. No commentary.",
    },
    {
      role: "user",
      content: `Prompt type: ${kind}\nBrief: ${PROMPT_BRIEFS[kind]}${
        instruction ? `\nUser instruction: ${instruction}` : ""
      }\n\nPROJECT MEMORY:\n${memoryDigest(mem)}`,
    },
  ]);
}

export async function summariseDiscussion(
  provider: ProviderId,
  cfg: ProviderConfig,
  d: Discussion,
): Promise<string> {
  return completeChat(provider, cfg, [
    { role: "system", content: "Summarise the discussion in Markdown: key points, conclusions, open items. Be concise and factual." },
    { role: "user", content: `${d.title} (${d.type})\n\n${discussionTranscript(d)}` },
  ]);
}

export function discussionSystemPrompt(mem: ProjectMemory, d: Discussion) {
  return `You are the reasoning engine of the project intelligence platform VPIP.
The PROJECT owns the memory; you are an interchangeable engine. Always ground answers in the project memory below and say when something is not in it.

${memoryDigest(mem)}

CURRENT DISCUSSION: ${d.title} (type: ${d.type})`;
}
