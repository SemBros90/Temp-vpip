import { z } from "zod";
import { emptyWorkspace, type Workspace } from "./types";

const text = z.string();
const id = text.refine((value) => value.trim().length > 0, "ID must not be empty");
const number = z.number().finite();
const strings = z.array(text);
const object = <T extends z.ZodRawShape>(shape: T) => z.object(shape).passthrough();
const record = { id, createdAt: text };
const child = { ...record, projectId: id };
const edited = { ...child, updatedAt: text };
const ai = { provider: text.optional(), model: text.optional() };
const revision = object({ at: text, note: text, author: text });
const trace = object({ buildCode: text, promptId: text, promptVersion: number, decisionCodes: strings, requirementCodes: strings, documentIds: strings, discussionIds: strings });
const message = object({ ...record, ...ai, seq: number, role: z.enum(["user", "assistant"]), content: text, attachmentIds: strings.optional() });
const planFile = object({ path: text, reason: text });
const agentPlan = object({ create: z.array(planFile), modify: z.array(planFile), delete: z.array(planFile), dependencies: strings, risks: strings, scope: text, markdown: text });
const classification = object({ frameworks: strings, primary: text, language: text, packageManager: text, buildSystem: text, workspaceType: text, appRoot: text });
const stage = object({ status: text, detail: text, at: text.optional() });
const counts = z.record(number);

// Validate nested build content as well as the outer row: an invalid file or
// message must never be persisted and crash the other editor on its next load.
const build = object({
  ...edited, ...ai, code: text, promptId: text, promptTitle: text, promptKind: text,
  promptVersion: number, status: text, contextPackage: text,
  counts: object({ decisions: number, requirements: number, documents: number, discussions: number }),
  turns: z.array(message.extend({ trace })).optional(),
  files: z.array(object({ ...record, path: id, content: text, updatedAt: text,
    versions: z.array(object({ ...record, ...ai, seq: number, content: text, note: text, trace: trace.optional() })),
  })).optional(),
  actions: z.array(object({ ...record, ...ai, seq: number, kind: text, summary: text, filesModified: strings, trace })).optional(),
  terminal: z.array(object({ ...record, stream: text, output: text, command: text.optional(), exitCode: number.optional() })).optional(),
  dbConnections: z.array(object({ ...record, engine: text, label: text, config: z.record(text) })).optional(),
  agentTasks: z.array(object({ ...edited, ...ai, code: text, buildSessionId: id, promptId: text, promptTitle: text,
    promptVersion: number, type: text, status: text, instruction: text, plan: agentPlan.optional(), trace,
    changes: z.array(object({ ...record, ...ai, taskId: id, buildCode: text, promptId: text, path: text, action: text })),
  })).optional(),
  requirements: z.array(object({ ...record, code: text, title: text, detail: text, status: text, files: strings, buildSessionId: id, updatedAt: text })).optional(),
  buildPlan: object({ files: z.array(object({ path: text, purpose: text, requirements: strings })), dependencies: strings, buildOrder: strings,
    moduleMap: z.array(object({ path: text, imports: strings })), markdown: text, createdAt: text }).optional(),
  validation: object({ at: text, issues: z.array(object({ kind: text, severity: text, path: text.optional(), message: text })),
    dependencyStatus: text, startupStatus: text, compileStatus: text, missingDependencies: strings }).optional(),
  sourceDocumentIds: strings.optional(), sourceDiscussionIds: strings.optional(),
});

export const importSchemas = {
  projects: object({ ...record, name: text, description: text, archived: z.boolean(), updatedAt: text }),
  discussions: object({ ...edited, title: text, type: text, summary: text.optional(), messages: z.array(message),
    attachments: z.array(object({ ...record, name: text, mime: text, size: number.nonnegative(), data: text, text: text.optional() })),
    reopenedAt: text.optional(), reopenContext: strings.optional() }),
  knowledge: object({ ...edited, ...ai, code: text, type: text, status: z.enum(["candidate", "approved", "rejected"]), title: text,
    description: text, sourceMessages: z.array(number), author: text, revisions: z.array(revision), mergedFrom: strings.optional(), version: number.optional() }),
  documents: object({ ...child, ...ai, kind: text, title: text, markdown: text }),
  prompts: object({ ...child, ...ai, kind: text, title: text, version: number, markdown: text,
    linkedDecisionIds: strings.optional(), linkedRequirementIds: strings.optional(), linkedDocumentIds: strings.optional(), linkedDiscussionIds: strings.optional() }),
  snapshots: object({ ...child, kind: text, title: text, refId: text, markdown: text }),
  buildSessions: build,
  repositories: object({ ...edited, provider: text, owner: text, name: text, fullName: text, description: text, visibility: text,
    defaultBranch: text, currentBranch: text, htmlUrl: text, token: text, status: text, classification: classification.optional() }),
  repoBranches: object({ ...record, repositoryId: id, name: text, sha: text, baseBranch: text.optional() }),
  repoCommits: object({ ...child, repositoryId: id, sha: text, message: text, branch: text, files: strings, author: text,
    decisionCodes: strings, requirementCodes: strings, provider: text }),
  artifacts: object({ ...edited, ...ai, code: text, type: text, name: text, path: text, content: text, size: number.nonnegative(), decisionCodes: strings, requirementCodes: strings }),
  buildRecords: object({ ...edited, ...ai, code: text, buildSessionId: text, buildCode: text, promptId: text, promptTitle: text,
    promptVersion: number, status: text, startedAt: text, logs: strings, artifactIds: strings, decisionCodes: strings, requirementCodes: strings }),
  changeRecords: object({ ...child, ...ai, action: text, path: text }),
  promptPhases: object({ ...edited, ...ai, promptId: text, phaseNo: number.int().positive(), title: text, markdown: text, status: text }),
  phaseRuns: object({ ...child, ...ai, phaseId: text, promptId: text, attempt: number.int().positive(), status: text, startedAt: text }),
  contextPackages: object({ ...edited, ...ai, code: text, title: text, markdown: text, counts, decisionIds: strings,
    requirementIds: strings, documentIds: strings, discussionIds: strings, promptIds: strings }),
  outcomes: object({ ...edited, ...ai, code: text, subjectType: text, subjectId: text, subjectLabel: text, result: text,
    notes: text, lessons: text, recommendations: text, author: text }),
  failures: object({ ...edited, ...ai, code: text, subjectType: text, subjectId: text, subjectLabel: text, title: text,
    rootCause: text, resolution: text, lessons: text, status: text, buildIds: strings, promptIds: strings, requirementCodes: strings, decisionCodes: strings, author: text }),
  activity: object({ ...child, ...ai, subjectType: text, subjectId: text, subjectLabel: text, action: text, author: text, note: text }),
  intelligence: object({ ...edited, ...ai, code: text, patternType: text, title: text, description: text, tags: strings, author: text }),
  repoReports: object({ ...child, branch: text, repositoryId: id.optional(), classification,
    dependencies: z.array(object({ name: text, required: text, dev: z.boolean(), status: text, installed: text.optional(), usedBy: strings.optional() })),
    imports: z.array(object({ kind: text, spec: text, referencedBy: text, expectedPath: text })),
    aliases: z.array(object({ alias: text, target: text, source: text })),
    environment: z.array(object({ key: text, sources: strings, configured: z.boolean() })),
    unsupported: z.array(object({ reason: text, evidence: text, blocking: z.boolean() })),
    previewDiagnostics: object({ buildStatus: text, repairs: strings, runtimeErrors: strings }),
    health: object({ overall: number, dependencies: number, imports: number, assets: number, environment: number, previewReadiness: number }),
    stages: object({ dependencies: stage, imports: stage, compile: stage, runtime: stage, preview: stage }).optional() }),
  repoEnv: object({ id, projectId: id, repositoryId: id, key: text, value: text, updatedAt: text }),
};

export type ImportCollection = keyof typeof importSchemas;
export const importCollections = Object.keys(importSchemas) as ImportCollection[];

/** Version 1 stays portable; missing older optional collections mean no additions. */
export function validateWorkspaceImport(input: unknown): Workspace {
  const collections = Object.fromEntries(importCollections.map((key) => [key, z.array(importSchemas[key]).optional()]));
  const result = z.object({ ...collections, version: z.literal(1).optional(), projects: z.array(importSchemas.projects),
    settings: z.record(z.unknown()).optional(), savedAt: text.optional(),
  }).strict().safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`Invalid workspace.json: ${issue?.path.join(".") || "workspace"} — ${issue?.message ?? "unsupported format"}. Nothing was imported.`);
  }
  const incoming = { ...emptyWorkspace(), ...result.data } as Workspace;
  for (const key of importCollections) {
    const seen = new Set<string>();
    for (const row of incoming[key]) {
      if (seen.has(row.id)) throw new Error(`Duplicate ID in ${key}: ${row.id}. Nothing was imported.`);
      seen.add(row.id);
    }
  }
  return incoming;
}