import type {
  Discussion,
  GeneratedDocument,
  GeneratedPrompt,
  KnowledgeItem,
  Project,
} from "./types";

export interface ContextPackage {
  markdown: string;
  decisions: KnowledgeItem[];
  requirements: KnowledgeItem[];
  documents: GeneratedDocument[];
  discussions: Discussion[];
  counts: {
    decisions: number;
    requirements: number;
    documents: number;
    discussions: number;
  };
}

export interface ContextSources {
  project: Project | undefined;
  knowledge: KnowledgeItem[];
  documents: GeneratedDocument[];
  discussions: Discussion[];
}

/**
 * Module 11A — Context Package Builder.
 * Assembles the prompt plus everything it is linked to into a single
 * hand-off payload for a future AI Coder. Read-only: no code generation.
 */
export function buildContextPackage(
  prompt: GeneratedPrompt,
  src: ContextSources,
): ContextPackage {
  const byId = (ids: string[] | undefined, pool: KnowledgeItem[]) =>
    (ids ?? []).map((id) => pool.find((k) => k.id === id)).filter(Boolean) as KnowledgeItem[];

  const decisions = byId(prompt.linkedDecisionIds, src.knowledge);
  const requirements = byId(prompt.linkedRequirementIds, src.knowledge);
  const documents = (prompt.linkedDocumentIds ?? [])
    .map((id) => src.documents.find((d) => d.id === id))
    .filter(Boolean) as GeneratedDocument[];
  const discussions = (prompt.linkedDiscussionIds ?? [])
    .map((id) => src.discussions.find((d) => d.id === id))
    .filter(Boolean) as Discussion[];

  const lines: string[] = [];
  lines.push(`# Context Package — ${prompt.title} V${prompt.version}`);
  lines.push("");
  lines.push(`- Project: ${src.project?.name ?? "—"}`);
  lines.push(`- Prompt kind: ${prompt.kind}`);
  lines.push(`- Prompt status: ${prompt.status ?? "Draft"}`);
  lines.push(`- Built at: ${new Date().toISOString()}`);
  lines.push("");
  lines.push("## 1. Prompt");
  lines.push("");
  lines.push(prompt.markdown.trim());
  lines.push("");

  lines.push("## 2. Linked Decisions");
  lines.push("");
  if (decisions.length === 0) lines.push("_None linked._");
  for (const d of decisions) {
    lines.push(`### ${d.code} — ${d.title}`);
    lines.push("");
    lines.push(d.description.trim());
    lines.push("");
  }

  lines.push("## 3. Linked Requirements");
  lines.push("");
  if (requirements.length === 0) lines.push("_None linked._");
  for (const r of requirements) {
    lines.push(`### ${r.code} — ${r.title}`);
    lines.push("");
    lines.push(r.description.trim());
    lines.push("");
  }

  lines.push("## 4. Linked Documents");
  lines.push("");
  if (documents.length === 0) lines.push("_None linked._");
  for (const doc of documents) {
    lines.push(`### ${doc.kind} — ${doc.title}`);
    lines.push("");
    lines.push(doc.markdown.trim());
    lines.push("");
  }

  lines.push("## 5. Linked Discussions");
  lines.push("");
  if (discussions.length === 0) lines.push("_None linked._");
  for (const disc of discussions) {
    lines.push(`### ${disc.title} (${disc.type})`);
    lines.push("");
    if (disc.summary) {
      lines.push(`**Summary:** ${disc.summary.trim()}`);
      lines.push("");
    }
    for (const m of disc.messages) {
      lines.push(`- **${m.role === "user" ? "You" : "Assistant"} #${m.seq}:** ${m.content.trim()}`);
    }
    lines.push("");
  }

  return {
    markdown: lines.join("\n"),
    decisions,
    requirements,
    documents,
    discussions,
    counts: {
      decisions: decisions.length,
      requirements: requirements.length,
      documents: documents.length,
      discussions: discussions.length,
    },
  };
}
