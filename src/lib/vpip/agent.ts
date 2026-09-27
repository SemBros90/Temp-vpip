import { streamChat, type ChatMessage } from "./ai";
import type {
  AgentPlan,
  AgentPlanFile,
  AgentTaskType,
  BuildSession,
  CoderFile,
  Discussion,
  GeneratedDocument,
  KnowledgeItem,
  Project,
  ProviderConfig,
  ProviderId,
  Repository,
} from "./types";
import { fileName, FOLDER_KEEP, normalizePath } from "./coder-fs";

/**
 * Module 14 — AI Development Agent.
 * The agent is not an independent coding assistant. It is a project-aware
 * execution engine: every action is derived from the build session's frozen
 * context package, the master register, the repository and the existing files.
 */

export interface AgentInputs {
  session: BuildSession;
  project: Project | undefined;
  register: KnowledgeItem[];
  decisions: KnowledgeItem[];
  requirements: KnowledgeItem[];
  documents: GeneratedDocument[];
  discussions: Discussion[];
  repository?: Repository | undefined;
  files: CoderFile[];
}

function registerBlock(items: KnowledgeItem[]) {
  if (!items.length) return "_Master register is empty._";
  return items
    .slice(0, 200)
    .map((k) => `- ${k.code} · ${k.type} · ${k.status} — ${k.title}`)
    .join("\n");
}

function repoBlock(repo: Repository | undefined) {
  if (!repo) return "_No repository is linked to this build session._";
  return [
    `- Provider: ${repo.provider}`,
    `- Repository: ${repo.fullName} (${repo.visibility})`,
    `- Default branch: ${repo.defaultBranch}`,
    `- Current branch: ${repo.currentBranch}`,
    `- Last commit: ${repo.lastCommitSha ? `${repo.lastCommitSha.slice(0, 7)} — ${repo.lastCommitMessage ?? ""}` : "none"}`,
  ].join("\n");
}

function filesBlock(files: CoderFile[]) {
  const real = files.filter((f) => fileName(f.path) !== FOLDER_KEEP);
  if (!real.length) return "_No files exist yet in this build session._";
  return real
    .map((f) => `- ${f.path} (${f.content.split("\n").length} lines)`)
    .join("\n");
}

export function agentSystemPrompt(input: AgentInputs): string {
  const s = input.session;
  return `You are the AI Development Agent of the project intelligence platform VPIP.

You are a project-aware execution engine, not an independent coding assistant.
You execute development work for BUILD SESSION ${s.code} of project "${input.project?.name ?? "—"}".
Originating prompt: ${s.promptTitle} (${s.promptKind}, V${s.promptVersion}).

PROJECT KNOWLEDGE RULE
- Every decision you make must come from the project knowledge below: master register, decisions, requirements, documents, prompts, build session context and repository context.
- Always prefer project knowledge over assumptions. If the knowledge does not cover something, say so explicitly and mark it as a risk instead of inventing it.
- Never contradict a linked decision. If the work conflicts with one, name the decision code and stop.
- Cite the decision codes (D-xxx) and requirement codes (R-xxx) behind each part of your output.

AVAILABLE DECISION CODES: ${input.decisions.map((d) => d.code).join(", ") || "none"}
AVAILABLE REQUIREMENT CODES: ${input.requirements.map((r) => r.code).join(", ") || "none"}

=== MASTER REGISTER ===
${registerBlock(input.register)}

=== REPOSITORY CONTEXT ===
${repoBlock(input.repository)}

=== EXISTING PROJECT FILES ===
${filesBlock(input.files)}

=== CONTEXT PACKAGE (prompt + linked decisions, requirements, documents, discussions) ===
${s.contextPackage}
=== END CONTEXT PACKAGE ===`;
}

const TASK_RULES: Record<AgentTaskType, string> = {
  "Feature Build": "Implement the feature end to end from the linked requirements.",
  Enhancement: "Extend existing behaviour. Keep the current structure intact.",
  Refactor: "Preserve behaviour exactly. Improve structure, naming and boundaries only.",
  "Bug Fix": "Find the root cause first, then apply the minimum correct fix.",
  Documentation: "Produce or update documentation files. Do not change behaviour.",
  Review: "Review only. Do not plan file changes unless a defect requires one.",
};

/* ------------------------------------------------------------ plan phase */

export function agentPlanPrompt(opts: {
  type: AgentTaskType;
  instruction: string;
  errors?: string | undefined;
}): string {
  return `TASK TYPE: ${opts.type}. ${TASK_RULES[opts.type]}

TASK INSTRUCTION
${opts.instruction}
${opts.errors ? `\nCURRENT BUILD AND ERROR LOGS\n${opts.errors}` : ""}

Produce an EXECUTION PLAN only. Do not write any file contents yet.

Reply with a short markdown explanation, then exactly one fenced JSON block:

\`\`\`json
{
  "create": [{ "path": "src/x.ts", "reason": "why, citing R-/D- codes" }],
  "modify": [{ "path": "src/y.ts", "reason": "why" }],
  "delete": [{ "path": "src/z.ts", "reason": "why" }],
  "dependencies": ["package-name"],
  "risks": ["risk, and which decision or requirement it touches"],
  "scope": "one line estimate of size and blast radius"
}
\`\`\`

Every path must be project-relative. Use existing paths for "modify" and "delete".`;
}

const JSON_BLOCK = /```(?:json)?\s*\n([\s\S]*?)```/g;

function planFiles(raw: unknown): AgentPlanFile[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => {
      if (typeof x === "string") return { path: normalizePath(x), reason: "" };
      const o = x as { path?: unknown; reason?: unknown };
      return {
        path: normalizePath(typeof o.path === "string" ? o.path : ""),
        reason: typeof o.reason === "string" ? o.reason : "",
      };
    })
    .filter((f) => f.path.length > 0);
}

function stringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean);
}

/** Parses the agent's plan answer into a structured, approvable plan. */
export function parseAgentPlan(markdown: string): AgentPlan | null {
  let parsed: Record<string, unknown> | null = null;
  JSON_BLOCK.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JSON_BLOCK.exec(markdown))) {
    try {
      const value = JSON.parse((m[1] ?? "").trim()) as Record<string, unknown>;
      if (value && typeof value === "object") parsed = value;
    } catch {
      /* keep looking */
    }
  }
  if (!parsed) return null;
  return {
    create: planFiles(parsed["create"]),
    modify: planFiles(parsed["modify"]),
    delete: planFiles(parsed["delete"]),
    dependencies: stringList(parsed["dependencies"]),
    risks: stringList(parsed["risks"]),
    scope: typeof parsed["scope"] === "string" ? parsed["scope"] : "",
    markdown: markdown.replace(JSON_BLOCK, "").trim(),
  };
}

export function planIsEmpty(plan: AgentPlan) {
  return plan.create.length === 0 && plan.modify.length === 0 && plan.delete.length === 0;
}

/* ------------------------------------------------------- execution phase */

export function agentExecutePrompt(opts: {
  type: AgentTaskType;
  instruction: string;
  plan: AgentPlan;
  files: CoderFile[];
}): string {
  const touched = [...opts.plan.create, ...opts.plan.modify].map((f) => f.path);
  const bodies = opts.files
    .filter((f) => touched.includes(f.path) && fileName(f.path) !== FOLDER_KEEP)
    .map((f) => `--- ${f.path}\n${f.content}`)
    .join("\n\n");

  return `TASK TYPE: ${opts.type}. ${TASK_RULES[opts.type]}

TASK INSTRUCTION
${opts.instruction}

THE USER HAS APPROVED THIS PLAN. Execute exactly it — no extra files, no extra deletions.
Create: ${opts.plan.create.map((f) => f.path).join(", ") || "none"}
Modify: ${opts.plan.modify.map((f) => f.path).join(", ") || "none"}
Delete: ${opts.plan.delete.map((f) => f.path).join(", ") || "none"}
Dependencies: ${opts.plan.dependencies.join(", ") || "none"}
${bodies ? `\nCURRENT CONTENT OF THE FILES IN SCOPE\n${bodies}` : ""}

OUTPUT FORMAT
1. For every created or modified file emit one fenced block whose info string carries the path, full content only, never partial:
\`\`\`tsx path=src/components/Thing.tsx
…full file…
\`\`\`
2. For every deletion emit a line: DELETE: path
3. Then these three sections, in this order:
## Change Summary
## Build Summary
## Technical Notes

Each section must cite the decision and requirement codes it relies on.`;
}

export function agentReviewPrompt(opts: {
  kind: string;
  instruction: string;
  files: CoderFile[];
}): string {
  const bodies = opts.files
    .filter((f) => fileName(f.path) !== FOLDER_KEEP)
    .slice(0, 40)
    .map((f) => `--- ${f.path}\n${f.content}`)
    .join("\n\n");
  return `REVIEW TYPE: ${opts.kind}.

FOCUS
${opts.instruction || "Review the whole build session."}

SESSION FILES
${bodies || "_No files yet._"}

List findings as: severity · file · line · finding · fix. Then add:
## Change Summary
## Build Summary
## Technical Notes
Reviews change nothing on disk. Cite the decision and requirement codes each finding relates to.`;
}

/** DELETE: path directives emitted by the execution phase. */
export function parseDeletions(markdown: string): string[] {
  const out: string[] = [];
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s*DELETE:\s*([^\s`]+)\s*$/i);
    const raw = m?.[1];
    if (raw) {
      const path = normalizePath(raw);
      if (path) out.push(path);
    }
  }
  return [...new Set(out)];
}

export function extractSection(markdown: string, heading: string): string {
  const re = new RegExp(`^#{1,4}\\s*${heading}\\s*$`, "im");
  const match = re.exec(markdown);
  if (!match) return "";
  const rest = markdown.slice(match.index + match[0].length);
  const next = rest.search(/^#{1,4}\s+\S/m);
  return (next === -1 ? rest : rest.slice(0, next)).trim();
}

/* ------------------------------------------------------------- the call */

export async function runAgent(
  provider: ProviderId,
  cfg: ProviderConfig,
  system: string,
  user: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
  return streamChat(provider, cfg, messages, onDelta, signal, { coderModule: "ai1" });
}
