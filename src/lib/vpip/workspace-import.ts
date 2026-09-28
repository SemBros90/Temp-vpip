import type { Workspace } from "./types";
import { importCollections, type ImportCollection } from "./workspace-import-schema";

export interface ImportConflict { collection: ImportCollection; id: string; label: string }
export interface ImportReport {
  added: number;
  unchanged: number;
  conflicts: ImportConflict[];
}

// Match defaults used by db.ts, only for comparison. Do not rewrite records or
// flatten nested content: an omitted optional link list equals [], not a change.
const comparisonDefaults: Partial<Record<ImportCollection, Record<string, unknown>>> = {
  discussions: { reopenContext: [] },
  knowledge: { mergedFrom: [], version: 1, sourceKind: "Discussion" },
  prompts: { status: "Draft", linkedDecisionIds: [], linkedRequirementIds: [], linkedDocumentIds: [], linkedDiscussionIds: [] },
  buildSessions: { sourceDocumentIds: [], sourceDiscussionIds: [], turns: [], files: [], actions: [], terminal: [], dbConnections: [], agentTasks: [], requirements: [] },
};

function comparable(collection: ImportCollection, row: { id: string }) {
  const present = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  return canonical({ ...comparisonDefaults[collection], ...present });
}

// Object key order is not a data difference. Arrays (including message order) are.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function importConflict(collection: ImportCollection, row: { id: string }): ImportConflict {
  const r = row as { id: string; title?: string; name?: string; code?: string };
  return { collection, id: row.id, label: r.title || r.name || r.code || row.id };
}

/** Additive merge only. Existing records, their nested data, and settings win. */
export function mergeWorkspaceImport(current: Workspace, incoming: Workspace) {
  const workspace = { ...current };
  const report: ImportReport = { added: 0, unchanged: 0, conflicts: [] };
  const newIds = {} as Record<ImportCollection, Set<string>>;
  for (const key of importCollections) {
    const existing = new Map<string, { id: string }>(current[key].map((r) => [r.id, r]));
    const additions: { id: string }[] = [];
    newIds[key] = new Set();
    for (const row of incoming[key]) {
      const previous = existing.get(row.id);
      if (previous) {
        if (comparable(key, previous) === comparable(key, row)) report.unchanged++;
        else report.conflicts.push(importConflict(key, row));
      } else {
        additions.push(row);
        newIds[key].add(row.id);
        report.added++;
      }
    }
    // The collection-specific schemas validate each row before this boundary.
    Object.assign(workspace, { [key]: [...current[key], ...additions] });
  }
  const projects = new Set(workspace.projects.map((p) => p.id));
  const repositories = new Map(workspace.repositories.map((r) => [r.id, r.projectId]));
  for (const key of importCollections) {
    for (const row of incoming[key]) {
      if (!newIds[key].has(row.id)) continue;
      if ("projectId" in row && !projects.has(row.projectId)) {
        throw new Error(`${key} record ${row.id} refers to a missing project. Nothing was imported.`);
      }
      if (key === "repoBranches" || key === "repoEnv" || key === "repoReports") {
        const r = row as { id: string; repositoryId?: string; projectId?: string };
        if (r.repositoryId && (!repositories.has(r.repositoryId) || (r.projectId && repositories.get(r.repositoryId) !== r.projectId))) {
          throw new Error(`${key} record ${row.id} refers to a missing or different project's repository. Nothing was imported.`);
        }
      }
    }
  }
  return { workspace, report, newIds };
}

export const importTables: Record<ImportCollection, string> = {
  projects: "vpip_projects", discussions: "vpip_discussions", knowledge: "vpip_knowledge",
  documents: "vpip_documents", prompts: "vpip_prompts", snapshots: "vpip_snapshots",
  buildSessions: "vpip_build_sessions", repositories: "vpip_repositories", repoBranches: "vpip_repo_branches",
  repoCommits: "vpip_repo_commits", artifacts: "vpip_artifacts", buildRecords: "vpip_build_records",
  changeRecords: "vpip_change_records", promptPhases: "vpip_prompt_phases", phaseRuns: "vpip_phase_runs",
  contextPackages: "vpip_context_packages", outcomes: "vpip_outcomes", failures: "vpip_failures",
  activity: "vpip_activity", intelligence: "vpip_intelligence", repoReports: "vpip_repo_reports", repoEnv: "vpip_repo_env",
};