import { streamChat, type ChatMessage } from "./ai";
import type {
  BuildSession,
  CodeArtifact,
  CoderActionKind,
  CoderFile,
  CoderTrace,
  CoderTurn,
  KnowledgeItem,
  Project,
  ProviderConfig,
  ProviderId,
} from "./types";

/**
 * Module 12 — AI Coder.
 * The coder is project-aware and context-aware: it reasons only from the
 * build session's frozen context package (prompt + linked decisions,
 * requirements, documents, discussions) and must cite the codes it used.
 */
export function coderSystemPrompt(
  session: BuildSession,
  project: Project | undefined,
  decisions: KnowledgeItem[],
  requirements: KnowledgeItem[],
): string {
  return `You are the AI Coder of the project intelligence platform VPIP.

You are working inside BUILD SESSION ${session.code} for project "${project?.name ?? "—"}".
Originating prompt: ${session.promptTitle} (${session.promptKind}, V${session.promptVersion}).

RULES
- Reason only from the context package below. If something is not in it, say so and ask instead of inventing it.
- Every answer must end with a "Traceability" section listing the exact decision codes (D-xxx) and requirement codes (R-xxx) your answer relies on, plus the build code ${session.code}.
- Produce implementation-level output: plans, module breakdowns, data shapes, code. Markdown only, no preamble.
- Never contradict a linked decision. If the request conflicts with one, name the decision code and stop for confirmation.

AVAILABLE DECISION CODES: ${decisions.map((d) => d.code).join(", ") || "none"}
AVAILABLE REQUIREMENT CODES: ${requirements.map((r) => r.code).join(", ") || "none"}

=== CONTEXT PACKAGE ===
${session.contextPackage}
=== END CONTEXT PACKAGE ===`;
}

export function coderTrace(
  session: BuildSession,
  decisions: KnowledgeItem[],
  requirements: KnowledgeItem[],
): CoderTrace {
  return {
    buildCode: session.code,
    promptId: session.promptId,
    promptVersion: session.promptVersion,
    decisionCodes: decisions.map((d) => d.code),
    requirementCodes: requirements.map((r) => r.code),
    documentIds: [],
    discussionIds: [],
  };
}

export async function runCoderTurn(
  provider: ProviderId,
  cfg: ProviderConfig,
  system: string,
  history: CoderTurn[],
  userContent: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    ...history.slice(-16).map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: userContent },
  ];
  return streamChat(provider, cfg, messages, onDelta, signal, { coderModule: "ai1" });
}

/* ------------------------------------------- Module 12 — modes & files */

const MODE_RULES: Record<CoderActionKind, string> = {
  "Generate Code": "Write new, complete files. Do not abbreviate with ellipses.",
  "Modify Code": "Change only what is asked. Return the full new content of every file you touch.",
  "Refactor Code":
    "Preserve behaviour exactly. Explain the structural change, then return the rewritten files.",
  "Explain Code": "Explain in prose. Do not return file blocks unless asked.",
  "Review Code":
    "Review correctness, naming, structure and dead code. List findings as severity · file · line · fix.",
  "Architecture Review":
    "Review module boundaries, data flow, coupling and layering against the linked decisions.",
  "Security Review":
    "Review input validation, secrets handling, access control, injection and data exposure.",
  "Performance Review": "Review complexity, rendering cost, queries, payload size and caching.",
  "Maintainability Review":
    "Review readability, duplication, test seams, naming and documentation debt.",
  "Error Analysis":
    "From the supplied errors, state the failing path, the root cause and the minimum fix.",
  "Log Analysis": "Read the supplied logs, group them by cause and state what each group means.",
  "Fix Errors": "Return the corrected full files plus one line per fix explaining the root cause.",
  "Apply Fix": "Return the corrected full files.",
  "Create File": "",
  "Edit File": "",
  "Rename File": "",
  "Delete File": "",
  "Create Folder": "",
  "Delete Folder": "",
  "Restore Version": "",
  "Terminal Command": "",
  "Database Connection": "",
};

/** Adds the mode, the artifact kind, the current file tree and any logs to the system prompt. */
export function coderModePrompt(opts: {
  mode: CoderActionKind;
  artifact?: CodeArtifact | undefined;
  files: CoderFile[];
  openFile?: CoderFile | undefined;
  logs?: string | undefined;
  connections?: string[] | undefined;
}): string {
  const tree = opts.files.map((f) => f.path).join("\n") || "(empty — this is the first file)";
  return `
MODE: ${opts.mode}. ${MODE_RULES[opts.mode]}
${opts.artifact ? `TARGET ARTIFACT: ${opts.artifact}.` : ""}

FILE OUTPUT FORMAT — whenever you write or change a file, emit it as a fenced block whose info string carries the path, e.g.
\`\`\`tsx path=src/components/InvoiceForm.tsx
…full file content…
\`\`\`
Emit one block per file. Never emit partial files. Paths are project-relative.

RUNNABLE OUTPUT — whenever the work is a page, component, layout or form, the session must stay previewable:
- return the complete project file set needed for the request, including every folder's files and a root \`index.html\` with a \`#root\` mount point;
- include \`src/main.tsx\` when using React, and mount the root component into \`#root\`;
- keep a default-exported React component in the entry module;
- imports may only reference other session files, \`react\` and \`react-dom\`. No other packages.
For pure logic (parsers, services, utilities) also emit \`index.html\` and a small \`src/main.tsx\` demo entry that exercises the logic so the preview shows something real.
Repository connectivity is irrelevant: always create the session files and runnable preview without GitHub.

CURRENT SESSION FILE TREE
${tree}
${opts.openFile ? `\nOPEN FILE ${opts.openFile.path}\n\`\`\`\n${opts.openFile.content}\n\`\`\`` : ""}
${opts.logs ? `\nLOGS AND ERRORS\n${opts.logs}` : ""}
${opts.connections?.length ? `\nDATABASE TARGETS (user supplied): ${opts.connections.join(", ")}. Never invent credentials; read them from configuration.` : ""}`;
}
