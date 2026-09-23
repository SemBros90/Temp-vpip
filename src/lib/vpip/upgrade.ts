import { completeChat, extractJson } from "./ai";
import type { Candidate } from "./engine";
import type {
  Artifact,
  BuildSession,
  Discussion,
  GeneratedDocument,
  GeneratedPrompt,
  KnowledgeItem,
  KnowledgeSourceKind,
  Project,
  ProviderConfig,
  ProviderId,
  RepoCommit,
  Repository,
} from "./types";

/* ============================ V-03 — phase parsing */

export interface ParsedPhase {
  phaseNo: number;
  title: string;
  markdown: string;
}

const PHASE_HEADING = /^\s{0,3}(?:#{1,6}\s*|\*\*\s*)?(?:phase|stage|step)\s*[-–—:]?\s*(\d+)\b[^\n]*$/i;

/**
 * Splits a prompt into executable phases. A prompt with no explicit phase
 * headings is a single phase — nothing is invented.
 */
export function parsePhases(markdown: string): ParsedPhase[] {
  const lines = markdown.split("\n");
  const starts: number[] = [];
  lines.forEach((line, i) => {
    if (PHASE_HEADING.test(line.replace(/\*\*/g, "").trim())) starts.push(i);
  });
  if (!starts.length) {
    return [{ phaseNo: 1, title: "Phase 1 — Full prompt", markdown: markdown.trim() }];
  }
  const phases: ParsedPhase[] = [];
  starts.forEach((start, idx) => {
    const end = starts[idx + 1] ?? lines.length;
    const rawTitle = (lines[start] ?? "").replace(/^[#*\s]+/, "").replace(/\*+$/, "").trim();
    const body = lines.slice(start, end).join("\n").trim();
    const m = rawTitle.match(/(\d+)/);
    phases.push({
      phaseNo: m ? Number(m[1]) : idx + 1,
      title: rawTitle.slice(0, 160) || `Phase ${idx + 1}`,
      markdown: body,
    });
  });
  return phases;
}

export function phaseSystemPrompt(project: Project | undefined, promptTitle: string) {
  return `You are the execution engine of the project intelligence platform VPIP.
You are executing one phase of the prompt "${promptTitle}" for project "${project?.name ?? "—"}".
Execute only this phase. Do not execute later phases.
Return Markdown only: the produced work, then a short "Phase Result" section stating what was completed and what the next phase needs.`;
}

/* ============================ V-05 — context package assembly */

export interface ContextSelection {
  decisions: KnowledgeItem[];
  requirements: KnowledgeItem[];
  documents: GeneratedDocument[];
  discussions: Discussion[];
  prompts: GeneratedPrompt[];
}

export function assembleContextPackage(
  project: Project | undefined,
  title: string,
  sel: ContextSelection,
): string {
  const out: string[] = [];
  out.push(`# Context Package — ${title}`);
  out.push("");
  out.push(`- Project: ${project?.name ?? "—"}`);
  out.push(`- Assembled: ${new Date().toISOString()}`);
  out.push(
    `- Contents: ${sel.decisions.length} decisions · ${sel.requirements.length} requirements · ${sel.documents.length} documents · ${sel.discussions.length} discussions · ${sel.prompts.length} prompts`,
  );
  out.push("");

  out.push("## 1. Decisions");
  out.push("");
  if (!sel.decisions.length) out.push("_None selected._");
  for (const d of sel.decisions) {
    out.push(`### ${d.code} — ${d.title}`);
    out.push("");
    out.push(d.description.trim());
    out.push("");
  }

  out.push("## 2. Requirements");
  out.push("");
  if (!sel.requirements.length) out.push("_None selected._");
  for (const r of sel.requirements) {
    out.push(`### ${r.code} — ${r.title}`);
    out.push("");
    out.push(r.description.trim());
    out.push("");
  }

  out.push("## 3. Documents");
  out.push("");
  if (!sel.documents.length) out.push("_None selected._");
  for (const d of sel.documents) {
    out.push(`### ${d.kind} — ${d.title}`);
    out.push("");
    out.push(d.markdown.trim());
    out.push("");
  }

  out.push("## 4. Discussions");
  out.push("");
  if (!sel.discussions.length) out.push("_None selected._");
  for (const d of sel.discussions) {
    out.push(`### ${d.title} (${d.type})`);
    out.push("");
    if (d.summary) {
      out.push(`**Summary:** ${d.summary.trim()}`);
      out.push("");
    }
    for (const m of d.messages) {
      out.push(`- **${m.role === "user" ? "You" : "Assistant"} #${m.seq}:** ${m.content.trim()}`);
    }
    out.push("");
  }

  out.push("## 5. Prompts");
  out.push("");
  if (!sel.prompts.length) out.push("_None selected._");
  for (const p of sel.prompts) {
    out.push(`### ${p.title} V${p.version} (${p.kind})`);
    out.push("");
    out.push(p.markdown.trim());
    out.push("");
  }

  return out.join("\n");
}

/* ============================ V-13 — universal knowledge extraction */

export interface ExtractionSource {
  kind: KnowledgeSourceKind;
  refId: string;
  label: string;
  text: string;
}

export function discussionSource(d: Discussion): ExtractionSource {
  return {
    kind: "Discussion",
    refId: d.id,
    label: `${d.title} (${d.type})`,
    text: d.messages.map((m) => `[${m.seq}] ${m.role === "user" ? "USER" : "AI"}: ${m.content}`).join("\n\n"),
  };
}

export function documentSource(d: GeneratedDocument): ExtractionSource {
  return { kind: "Document", refId: d.id, label: `${d.kind} — ${d.title}`, text: d.markdown };
}

export function promptSource(p: GeneratedPrompt): ExtractionSource {
  return {
    kind: "Prompt",
    refId: p.id,
    label: `${p.title} V${p.version} (${p.kind})`,
    text: p.markdown,
  };
}

export function buildSessionSource(b: BuildSession): ExtractionSource {
  const files = (b.files ?? []).map((f) => f.path).join("\n");
  const turns = (b.turns ?? []).map((t) => `${t.role.toUpperCase()}: ${t.content}`).join("\n\n");
  const reqs = (b.requirements ?? [])
    .map((r) => `${r.code} ${r.title} — ${r.status}`)
    .join("\n");
  return {
    kind: "Build Session",
    refId: b.id,
    label: `${b.code} — ${b.promptTitle} V${b.promptVersion}`,
    text: [
      `BUILD ${b.code} status ${b.status}`,
      reqs ? `REQUIREMENTS\n${reqs}` : "",
      files ? `FILES\n${files}` : "",
      turns ? `CODER CONVERSATION\n${turns}` : "",
      b.contextPackage ? `CONTEXT PACKAGE\n${b.contextPackage}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function repositorySource(r: Repository, commits: RepoCommit[]): ExtractionSource {
  const log = commits
    .filter((c) => c.repositoryId === r.id)
    .map(
      (c) =>
        `${c.sha.slice(0, 7)} [${c.branch}] ${c.message}${c.releaseTag ? ` (release ${c.releaseTag})` : ""} — files: ${c.files.join(", ")}`,
    )
    .join("\n");
  return {
    kind: "Repository",
    refId: r.id,
    label: `${r.fullName || r.name} (${r.provider})`,
    text: [
      `REPOSITORY ${r.fullName} · default ${r.defaultBranch} · status ${r.status}`,
      r.description ? `DESCRIPTION: ${r.description}` : "",
      log ? `COMMIT HISTORY\n${log}` : "COMMIT HISTORY\n(none recorded)",
    ]
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function artifactSource(a: Artifact): ExtractionSource {
  return {
    kind: "Artifact",
    refId: a.id,
    label: `${a.code} — ${a.path}`,
    text: `ARTIFACT ${a.code} (${a.type}) at ${a.path}\n\n${a.content.slice(0, 20000)}`,
  };
}

const UNIVERSAL_SYSTEM = `You are the knowledge extraction engine of a project intelligence platform.
Read the supplied project object and extract durable project knowledge.
Return ONLY a JSON array. Each element:
{"type":"Decision|Requirement|Idea|Risk|Question|Assumption|Lesson Learned|Failure Cause","title":"short title","description":"1-3 precise sentences"}
Extract only substantive, project-specific knowledge grounded in the supplied text. No filler. There is no item limit — extract as many items as the source genuinely supports; never pad, never truncate.`;

export async function extractFromSource(
  provider: ProviderId,
  cfg: ProviderConfig,
  source: ExtractionSource,
): Promise<Candidate[]> {
  const raw = await completeChat(provider, cfg, [
    { role: "system", content: UNIVERSAL_SYSTEM },
    {
      role: "user",
      content: `Source kind: ${source.kind}\nSource: ${source.label}\n\n${source.text.slice(0, 24000)}`,
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
      messages: [],
    }));
}
