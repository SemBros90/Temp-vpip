/**
 * VaultStore: the single persistence boundary of VPIP.
 * It reads and writes the shared cloud database (Postgres) through the
 * generated client. The rest of the app still works on one in-memory
 * `Workspace` object, so swapping this file is the only change needed to move
 * the vault somewhere else.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  emptyWorkspace,
  type AgentTask,
  type BuildRequirement,
  type Artifact,
  type BuildRecord,
  type BuildSession,
  type ChangeRecord,
  type CoderAction,
  type CoderFile,
  type CoderTurn,
  type DbConnection,
  type Discussion,
  type GeneratedDocument,
  type GeneratedPrompt,
  type KnowledgeItem,
  type Project,
  type RepoBranch,
  type RepoCommit,
  type Repository,
  type ActivityRecord,
  type ContextPackageRecord,
  type FailureRecord,
  type IntelligenceRecord,
  type OutcomeRecord,
  type PhaseRun,
  type PromptPhase,
  type Snapshot,
  type TerminalEntry,
  type Workspace,
} from "./types";

type Row = Record<string, unknown>;

function undef<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

function arr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/* ----------------------------------------------------------------- read */

const PAGE = 1000;

/**
 * Reads a whole table, page by page. A partial read is never acceptable here:
 * the workspace snapshot it feeds is written back as a full sync, so any row
 * missing from the read would be deleted on the next save. Errors therefore
 * propagate instead of degrading into an empty list.
 */
async function selectAll(
  table: string,
  orderCol: string,
  ascending = false,
): Promise<{ data: Row[] }> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table as never)
      .select("*")
      .order(orderCol, { ascending })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to read ${table}: ${error.message}`);
    const page = (data ?? []) as Row[];
    out.push(...page);
    if (page.length < PAGE) break;
  }
  return { data: out };
}

export async function vaultRead<T>(): Promise<T | null> {
  const settingsRes = await supabase
    .from("vpip_settings")
    .select("*")
    .eq("id", 1)
    .maybeSingle();
  if (settingsRes.error) throw new Error(`Failed to read vpip_settings: ${settingsRes.error.message}`);
  const settings = settingsRes;

  const [
    projects,
    discussions,
    knowledge,
    documents,
    prompts,
    snapshots,
    buildSessions,
    repositories,
    repoBranches,
    repoCommits,
    artifacts,
    buildRecords,
    changeRecords,
    promptPhases,
    phaseRuns,
    contextPackages,
    outcomes,
    failures,
    activity,
    intelligence,
  ] = await Promise.all([
    selectAll("vpip_projects", "created_at"),
    selectAll("vpip_discussions", "created_at"),
    selectAll("vpip_knowledge", "created_at"),
    selectAll("vpip_documents", "created_at"),
    selectAll("vpip_prompts", "created_at"),
    selectAll("vpip_snapshots", "created_at"),
    selectAll("vpip_build_sessions", "created_at"),
    selectAll("vpip_repositories", "created_at"),
    selectAll("vpip_repo_branches", "created_at"),
    selectAll("vpip_repo_commits", "created_at"),
    selectAll("vpip_artifacts", "created_at"),
    selectAll("vpip_build_records", "created_at"),
    selectAll("vpip_change_records", "created_at"),
    selectAll("vpip_prompt_phases", "phase_no", true),
    selectAll("vpip_phase_runs", "created_at"),
    selectAll("vpip_context_packages", "created_at"),
    selectAll("vpip_outcomes", "created_at"),
    selectAll("vpip_failures", "created_at"),
    selectAll("vpip_activity", "created_at"),
    selectAll("vpip_intelligence", "created_at"),
  ]);

  const base = emptyWorkspace();
  const s = settings.data as Row | null;

  const ws: Workspace = {
    ...base,
    settings: s
      ? {
          author: (s['author'] as string) ?? base.settings.author,
          defaultProvider: (s['default_provider'] as Workspace["settings"]["defaultProvider"]) ??
            base.settings.defaultProvider,
          autoSaveIntervalSec:
            (s['auto_save_interval_sec'] as number) ?? base.settings.autoSaveIntervalSec,
          projectRootLabel: (s['project_root_label'] as string) ?? base.settings.projectRootLabel,
          backupFolderLabel: (s['backup_folder_label'] as string) ?? base.settings.backupFolderLabel,
          providers: {
            ...base.settings.providers,
            ...((s['providers'] as Workspace["settings"]["providers"]) ?? {}),
          },
        }
      : base.settings,
    projects: ((projects.data ?? []) as Row[]).map(
      (r): Project => ({
        id: r['id'] as string,
        name: r['name'] as string,
        description: (r['description'] as string) ?? "",
        archived: Boolean(r['archived']),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    discussions: ((discussions.data ?? []) as Row[]).map((r): Discussion => {
      const summary = undef(r['summary'] as string | null);
      return {
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        title: r['title'] as string,
        type: r['type'] as Discussion["type"],
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
        messages: (r['messages'] as Discussion["messages"]) ?? [],
        attachments: (r['attachments'] as Discussion["attachments"]) ?? [],
        reopenedAt: undef(r['reopened_at'] as string | null),
        reopenContext: arr<string>(r['reopen_context']),
        ...(summary !== undefined ? { summary } : {}),
      };
    }),
    knowledge: ((knowledge.data ?? []) as Row[]).map((r): KnowledgeItem => {
      const srcId = undef(r['source_discussion_id'] as string | null);
      const srcTitle = undef(r['source_discussion_title'] as string | null);
      const provider = undef(r['provider'] as KnowledgeItem["provider"] | null);
      const mergedFrom = (r['merged_from'] as string[]) ?? [];
      return {
        id: r['id'] as string,
        code: r['code'] as string,
        projectId: r['project_id'] as string,
        type: r['type'] as KnowledgeItem["type"],
        status: r['status'] as KnowledgeItem["status"],
        title: r['title'] as string,
        description: (r['description'] as string) ?? "",
        sourceMessages: (r['source_messages'] as number[]) ?? [],
        author: (r['author'] as string) ?? "You",
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
        revisions: (r['revisions'] as KnowledgeItem["revisions"]) ?? [],
        version: (r['version'] as number) ?? 1,
        reasonForChange: undef(r['reason_for_change'] as string | null),
        sourceKind: (r['source_kind'] as KnowledgeItem["sourceKind"]) ?? "Discussion",
        sourceRefId: undef(r['source_ref_id'] as string | null),
        ...(srcId !== undefined ? { sourceDiscussionId: srcId } : {}),
        ...(srcTitle !== undefined ? { sourceDiscussionTitle: srcTitle } : {}),
        ...(provider !== undefined ? { provider } : {}),
        ...(mergedFrom.length ? { mergedFrom } : {}),
      };
    }),
    documents: ((documents.data ?? []) as Row[]).map((r): GeneratedDocument => {
      const provider = undef(r['provider'] as GeneratedDocument["provider"] | null);
      const model = undef(r['model'] as string | null);
      const srcId = undef(r['source_discussion_id'] as string | null);
      return {
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        kind: r['kind'] as GeneratedDocument["kind"],
        title: r['title'] as string,
        markdown: (r['markdown'] as string) ?? "",
        createdAt: r['created_at'] as string,
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(srcId !== undefined ? { sourceDiscussionId: srcId } : {}),
      };
    }),
    prompts: ((prompts.data ?? []) as Row[]).map((r): GeneratedPrompt => {
      const provider = undef(r['provider'] as GeneratedPrompt["provider"] | null);
      const model = undef(r['model'] as string | null);
      const status = undef(r['status'] as GeneratedPrompt["status"] | null);
      return {
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        kind: r['kind'] as GeneratedPrompt["kind"],
        title: r['title'] as string,
        version: (r['version'] as number) ?? 1,
        markdown: (r['markdown'] as string) ?? "",
        createdAt: r['created_at'] as string,
        linkedDecisionIds: arr<string>(r['linked_decision_ids']),
        linkedRequirementIds: arr<string>(r['linked_requirement_ids']),
        linkedDocumentIds: arr<string>(r['linked_document_ids']),
        linkedDiscussionIds: arr<string>(r['linked_discussion_ids']),
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(status !== undefined ? { status } : {}),
      };
    }),
    snapshots: ((snapshots.data ?? []) as Row[]).map(
      (r): Snapshot => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        kind: r['kind'] as string,
        title: r['title'] as string,
        refId: r['ref_id'] as string,
        markdown: (r['markdown'] as string) ?? "",
        createdAt: r['created_at'] as string,
      }),
    ),
    buildSessions: ((buildSessions.data ?? []) as Row[]).map((r): BuildSession => {
      const provider = undef(r['provider'] as BuildSession["provider"] | null);
      const model = undef(r['model'] as string | null);
      const note = undef(r['note'] as string | null);
      const openedAt = undef(r['opened_at'] as string | null);
      const counts = (r['counts'] as BuildSession["counts"]) ?? {
        decisions: 0,
        requirements: 0,
        documents: 0,
        discussions: 0,
      };
      return {
        id: r['id'] as string,
        code: r['code'] as string,
        projectId: r['project_id'] as string,
        promptId: r['prompt_id'] as string,
        promptTitle: str(r['prompt_title']),
        promptKind: r['prompt_kind'] as BuildSession["promptKind"],
        promptVersion: (r['prompt_version'] as number) ?? 1,
        status: r['status'] as BuildSession["status"],
        contextPackage: str(r['context_package']),
        contextPackageId: undef(r['context_package_id'] as string | null),
        sourceDocumentIds: arr<string>(r['source_document_ids']),
        sourceDiscussionIds: arr<string>(r['source_discussion_ids']),
        counts,
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
        turns: arr<CoderTurn>(r['turns']),
        files: arr<CoderFile>(r['files']),
        actions: arr<CoderAction>(r['actions']),
        terminal: arr<TerminalEntry>(r['terminal']),
        dbConnections: arr<DbConnection>(r['db_connections']),
        agentTasks: arr<AgentTask>(r['agent_tasks']),
        requirements: arr<BuildRequirement>(r['requirements']),
        buildPlan: (r['build_plan'] as BuildSession["buildPlan"]) ?? undefined,
        validation: (r['validation'] as BuildSession["validation"]) ?? undefined,
        previewEntryPath: undef(r['preview_entry_path'] as string | null),
        repositoryId: undef(r['repository_id'] as string | null),
        repositoryFullName: undef(r['repository_full_name'] as string | null),
        repositoryProvider: undef(r['repository_provider'] as BuildSession["repositoryProvider"] | null),
        repositoryBranch: undef(r['repository_branch'] as string | null),
        lastCommitSha: undef(r['last_commit_sha'] as string | null),
        lastCommitAt: undef(r['last_commit_at'] as string | null),
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
        ...(note !== undefined ? { note } : {}),
        ...(openedAt !== undefined ? { openedAt } : {}),
      };
    }),
    repositories: ((repositories.data ?? []) as Row[]).map(
      (r): Repository => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        provider: r['provider'] as Repository["provider"],
        owner: str(r['owner']),
        name: str(r['name']),
        fullName: str(r['full_name']),
        description: str(r['description']),
        visibility: r['visibility'] as Repository["visibility"],
        defaultBranch: str(r['default_branch'], "main"),
        currentBranch: str(r['current_branch'], "main"),
        htmlUrl: str(r['html_url']),
        token: str(r['token']),
        status: r['status'] as Repository["status"],
        statusMessage: undef(r['status_message'] as string | null),
        validatedAt: undef(r['validated_at'] as string | null),
        lastCommitSha: undef(r['last_commit_sha'] as string | null),
        lastCommitMessage: undef(r['last_commit_message'] as string | null),
        lastCommitAt: undef(r['last_commit_at'] as string | null),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    repoBranches: ((repoBranches.data ?? []) as Row[]).map(
      (r): RepoBranch => ({
        id: r['id'] as string,
        repositoryId: r['repository_id'] as string,
        name: str(r['name']),
        sha: str(r['sha']),
        baseBranch: undef(r['base_branch'] as string | null),
        createdAt: r['created_at'] as string,
      }),
    ),
    repoCommits: ((repoCommits.data ?? []) as Row[]).map(
      (r): RepoCommit => ({
        id: r['id'] as string,
        repositoryId: r['repository_id'] as string,
        projectId: r['project_id'] as string,
        sha: str(r['sha']),
        message: str(r['message']),
        branch: str(r['branch']),
        files: arr<string>(r['files']),
        htmlUrl: undef(r['html_url'] as string | null),
        author: str(r['author']),
        buildSessionId: undef(r['build_session_id'] as string | null),
        buildCode: undef(r['build_code'] as string | null),
        promptId: undef(r['prompt_id'] as string | null),
        promptTitle: undef(r['prompt_title'] as string | null),
        promptVersion: undef(r['prompt_version'] as number | null),
        decisionCodes: arr<string>(r['decision_codes']),
        requirementCodes: arr<string>(r['requirement_codes']),
        provider: r['provider'] as RepoCommit["provider"],
        releaseTag: undef(r['release_tag'] as string | null),
        releaseName: undef(r['release_name'] as string | null),
        createdAt: r['created_at'] as string,
      }),
    ),
    artifacts: ((artifacts.data ?? []) as Row[]).map(
      (r): Artifact => ({
        id: r['id'] as string,
        code: r['code'] as string,
        projectId: r['project_id'] as string,
        type: r['type'] as Artifact["type"],
        name: str(r['name']),
        path: str(r['path']),
        content: str(r['content']),
        size: (r['size'] as number) ?? 0,
        buildSessionId: undef(r['build_session_id'] as string | null),
        buildCode: undef(r['build_code'] as string | null),
        buildRecordId: undef(r['build_record_id'] as string | null),
        buildRunCode: undef(r['build_run_code'] as string | null),
        taskId: undef(r['task_id'] as string | null),
        taskCode: undef(r['task_code'] as string | null),
        promptId: undef(r['prompt_id'] as string | null),
        promptTitle: undef(r['prompt_title'] as string | null),
        promptVersion: undef(r['prompt_version'] as number | null),
        decisionCodes: arr<string>(r['decision_codes']),
        requirementCodes: arr<string>(r['requirement_codes']),
        repositoryFullName: undef(r['repository_full_name'] as string | null),
        branch: undef(r['branch'] as string | null),
        commitSha: undef(r['commit_sha'] as string | null),
        provider: undef(r['provider'] as Artifact["provider"] | null),
        model: undef(r['model'] as string | null),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    buildRecords: ((buildRecords.data ?? []) as Row[]).map(
      (r): BuildRecord => ({
        id: r['id'] as string,
        code: r['code'] as string,
        projectId: r['project_id'] as string,
        buildSessionId: str(r['build_session_id']),
        buildCode: str(r['build_code']),
        repositoryId: undef(r['repository_id'] as string | null),
        repositoryFullName: undef(r['repository_full_name'] as string | null),
        branch: undef(r['branch'] as string | null),
        commitSha: undef(r['commit_sha'] as string | null),
        promptId: str(r['prompt_id']),
        promptTitle: str(r['prompt_title']),
        promptVersion: (r['prompt_version'] as number) ?? 1,
        provider: undef(r['provider'] as BuildRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        status: r['status'] as BuildRecord["status"],
        startedAt: r['started_at'] as string,
        endedAt: undef(r['ended_at'] as string | null),
        summary: undef(r['summary'] as string | null),
        output: undef(r['output'] as string | null),
        logs: arr<string>(r['logs']),
        artifactIds: arr<string>(r['artifact_ids']),
        decisionCodes: arr<string>(r['decision_codes']),
        requirementCodes: arr<string>(r['requirement_codes']),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    changeRecords: ((changeRecords.data ?? []) as Row[]).map(
      (r): ChangeRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        action: r['action'] as ChangeRecord["action"],
        path: str(r['path']),
        fromPath: undef(r['from_path'] as string | null),
        buildSessionId: undef(r['build_session_id'] as string | null),
        buildCode: undef(r['build_code'] as string | null),
        buildRecordId: undef(r['build_record_id'] as string | null),
        buildRunCode: undef(r['build_run_code'] as string | null),
        taskId: undef(r['task_id'] as string | null),
        taskCode: undef(r['task_code'] as string | null),
        promptId: undef(r['prompt_id'] as string | null),
        provider: undef(r['provider'] as ChangeRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        createdAt: r['created_at'] as string,
      }),
    ),
    promptPhases: ((promptPhases.data ?? []) as Row[]).map(
      (r): PromptPhase => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        promptId: r['prompt_id'] as string,
        phaseNo: (r['phase_no'] as number) ?? 1,
        title: str(r['title']),
        markdown: str(r['markdown']),
        status: r['status'] as PromptPhase["status"],
        startedAt: undef(r['started_at'] as string | null),
        endedAt: undef(r['ended_at'] as string | null),
        output: undef(r['output'] as string | null),
        error: undef(r['error'] as string | null),
        provider: undef(r['provider'] as PromptPhase["provider"] | null),
        model: undef(r['model'] as string | null),
        buildSessionId: undef(r['build_session_id'] as string | null),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    phaseRuns: ((phaseRuns.data ?? []) as Row[]).map(
      (r): PhaseRun => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        phaseId: r['phase_id'] as string,
        promptId: str(r['prompt_id']),
        attempt: (r['attempt'] as number) ?? 1,
        status: r['status'] as PhaseRun["status"],
        provider: undef(r['provider'] as PhaseRun["provider"] | null),
        model: undef(r['model'] as string | null),
        startedAt: r['started_at'] as string,
        endedAt: undef(r['ended_at'] as string | null),
        output: undef(r['output'] as string | null),
        error: undef(r['error'] as string | null),
        createdAt: r['created_at'] as string,
      }),
    ),
    contextPackages: ((contextPackages.data ?? []) as Row[]).map(
      (r): ContextPackageRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        code: str(r['code']),
        title: str(r['title']),
        promptId: undef(r['prompt_id'] as string | null),
        promptTitle: undef(r['prompt_title'] as string | null),
        promptVersion: undef(r['prompt_version'] as number | null),
        markdown: str(r['markdown']),
        counts: (r['counts'] as Record<string, number>) ?? {},
        decisionIds: arr<string>(r['decision_ids']),
        requirementIds: arr<string>(r['requirement_ids']),
        documentIds: arr<string>(r['document_ids']),
        discussionIds: arr<string>(r['discussion_ids']),
        promptIds: arr<string>(r['prompt_ids']),
        provider: undef(r['provider'] as ContextPackageRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    outcomes: ((outcomes.data ?? []) as Row[]).map(
      (r): OutcomeRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        code: str(r['code']),
        subjectType: r['subject_type'] as OutcomeRecord["subjectType"],
        subjectId: str(r['subject_id']),
        subjectLabel: str(r['subject_label']),
        result: r['result'] as OutcomeRecord["result"],
        notes: str(r['notes']),
        lessons: str(r['lessons']),
        recommendations: str(r['recommendations']),
        provider: undef(r['provider'] as OutcomeRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        author: str(r['author'], "You"),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    failures: ((failures.data ?? []) as Row[]).map(
      (r): FailureRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        code: str(r['code']),
        subjectType: r['subject_type'] as FailureRecord["subjectType"],
        subjectId: str(r['subject_id']),
        subjectLabel: str(r['subject_label']),
        title: str(r['title']),
        rootCause: str(r['root_cause']),
        resolution: str(r['resolution']),
        lessons: str(r['lessons']),
        status: r['status'] as FailureRecord["status"],
        buildIds: arr<string>(r['build_ids']),
        promptIds: arr<string>(r['prompt_ids']),
        requirementCodes: arr<string>(r['requirement_codes']),
        decisionCodes: arr<string>(r['decision_codes']),
        provider: undef(r['provider'] as FailureRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        author: str(r['author'], "You"),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
    activity: ((activity.data ?? []) as Row[]).map(
      (r): ActivityRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        subjectType: str(r['subject_type']),
        subjectId: str(r['subject_id']),
        subjectLabel: str(r['subject_label']),
        action: r['action'] as ActivityRecord["action"],
        provider: undef(r['provider'] as ActivityRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        author: str(r['author'], "You"),
        note: str(r['note']),
        createdAt: r['created_at'] as string,
      }),
    ),
    intelligence: ((intelligence.data ?? []) as Row[]).map(
      (r): IntelligenceRecord => ({
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        code: str(r['code']),
        patternType: r['pattern_type'] as IntelligenceRecord["patternType"],
        title: str(r['title']),
        description: str(r['description']),
        tags: arr<string>(r['tags']),
        sourceProjectId: undef(r['source_project_id'] as string | null),
        sourceProjectName: undef(r['source_project_name'] as string | null),
        sourceKind: undef(r['source_kind'] as string | null),
        sourceId: undef(r['source_id'] as string | null),
        provider: undef(r['provider'] as IntelligenceRecord["provider"] | null),
        model: undef(r['model'] as string | null),
        author: str(r['author'], "You"),
        createdAt: r['created_at'] as string,
        updatedAt: r['updated_at'] as string,
      }),
    ),
  };

  return ws as unknown as T;
}

/* ---------------------------------------------------------------- write */

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

async function syncTable(table: string, rows: Row[], keepIds: string[]) {
  // Paginated + error-propagating: an incomplete id list would make the delete
  // set wrong, and a silent failure here used to remove live rows.
  const existingIds: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table as never)
      .select("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`Failed to list ${table} ids: ${error.message}`);
    const page = (data ?? []) as Row[];
    existingIds.push(...page.map((r) => r['id'] as string));
    if (page.length < PAGE) break;
  }
  const keep = new Set(keepIds);
  const removed = existingIds.filter((id) => !keep.has(id));
  if (removed.length) {
    for (let i = 0; i < removed.length; i += 200) {
      const { error } = await supabase
        .from(table as never)
        .delete()
        .in("id", removed.slice(i, i + 200));
      if (error) throw new Error(`Failed to delete from ${table}: ${error.message}`);
    }
  }
  if (rows.length) {
    const { error } = await supabase.from(table as never).upsert(rows as never, { onConflict: "id" });
    if (error) throw error;
  }
}

// Writes are serialised: concurrent flushes (debounced save + auto-save interval)
// could interleave a parent delete with a child upsert and trip a foreign key.
let writeChain: Promise<void> = Promise.resolve();

export function vaultWrite(value: unknown): Promise<void> {
  const run = writeChain.then(
    () => writeWorkspace(value),
    () => writeWorkspace(value),
  );
  writeChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function writeWorkspace(value: unknown): Promise<void> {
  const ws = value as Workspace;
  if (!ws || !Array.isArray(ws.projects)) return;

  const { error: sErr } = await supabase.from("vpip_settings").upsert(
    {
      id: 1,
      author: ws.settings.author,
      default_provider: ws.settings.defaultProvider,
      auto_save_interval_sec: ws.settings.autoSaveIntervalSec,
      project_root_label: ws.settings.projectRootLabel,
      backup_folder_label: ws.settings.backupFolderLabel,
      providers: json(ws.settings.providers),
      saved_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

  const projectIds = ws.projects.map((p) => p.id);
  const inProject = <T extends { projectId: string }>(list: T[] | undefined) =>
    (list ?? []).filter((x) => projectIds.includes(x.projectId));

  await syncTable(
    "vpip_projects",
    ws.projects.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      archived: p.archived,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    })),
    projectIds,
  );

  const discussions = inProject(ws.discussions);
  await syncTable(
    "vpip_discussions",
    discussions.map((d) => ({
      id: d.id,
      project_id: d.projectId,
      title: d.title,
      type: d.type,
      summary: d.summary ?? null,
      messages: json(d.messages),
      attachments: json(d.attachments),
      reopened_at: d.reopenedAt ?? null,
      reopen_context: json(d.reopenContext ?? []),
      created_at: d.createdAt,
      updated_at: d.updatedAt,
    })),
    discussions.map((d) => d.id),
  );

  const knowledge = inProject(ws.knowledge);
  await syncTable(
    "vpip_knowledge",
    knowledge.map((k) => ({
      id: k.id,
      project_id: k.projectId,
      code: k.code,
      type: k.type,
      status: k.status,
      title: k.title,
      description: k.description,
      source_discussion_id: k.sourceDiscussionId ?? null,
      source_discussion_title: k.sourceDiscussionTitle ?? null,
      source_messages: json(k.sourceMessages),
      provider: k.provider ?? null,
      author: k.author,
      revisions: json(k.revisions),
      merged_from: json(k.mergedFrom ?? []),
      version: k.version ?? 1,
      reason_for_change: k.reasonForChange ?? null,
      source_kind: k.sourceKind ?? "Discussion",
      source_ref_id: k.sourceRefId ?? null,
      created_at: k.createdAt,
      updated_at: k.updatedAt,
    })),
    knowledge.map((k) => k.id),
  );

  const documents = inProject(ws.documents);
  await syncTable(
    "vpip_documents",
    documents.map((d) => ({
      id: d.id,
      project_id: d.projectId,
      kind: d.kind,
      title: d.title,
      markdown: d.markdown,
      provider: d.provider ?? null,
      model: d.model ?? null,
      source_discussion_id: d.sourceDiscussionId ?? null,
      created_at: d.createdAt,
    })),
    documents.map((d) => d.id),
  );

  const prompts = inProject(ws.prompts);
  await syncTable(
    "vpip_prompts",
    prompts.map((p) => ({
      id: p.id,
      project_id: p.projectId,
      kind: p.kind,
      title: p.title,
      version: p.version,
      markdown: p.markdown,
      provider: p.provider ?? null,
      model: p.model ?? null,
      status: p.status ?? "Draft",
      linked_decision_ids: json(p.linkedDecisionIds ?? []),
      linked_requirement_ids: json(p.linkedRequirementIds ?? []),
      linked_document_ids: json(p.linkedDocumentIds ?? []),
      linked_discussion_ids: json(p.linkedDiscussionIds ?? []),
      created_at: p.createdAt,
    })),
    prompts.map((p) => p.id),
  );

  const snapshots = inProject(ws.snapshots);
  await syncTable(
    "vpip_snapshots",
    snapshots.map((s) => ({
      id: s.id,
      project_id: s.projectId,
      kind: s.kind,
      title: s.title,
      ref_id: s.refId,
      markdown: s.markdown,
      created_at: s.createdAt,
    })),
    snapshots.map((s) => s.id),
  );

  /* ---------------- Modules 11A–15: build, agent, repository, artifacts */

  const buildSessions = inProject(ws.buildSessions);
  await syncTable(
    "vpip_build_sessions",
    buildSessions.map((b) => ({
      id: b.id,
      code: b.code,
      project_id: b.projectId,
      prompt_id: b.promptId,
      prompt_title: b.promptTitle,
      prompt_kind: b.promptKind,
      prompt_version: b.promptVersion,
      provider: b.provider ?? null,
      model: b.model ?? null,
      status: b.status,
      context_package: b.contextPackage,
      context_package_id: b.contextPackageId ?? null,
      source_document_ids: json(b.sourceDocumentIds ?? []),
      source_discussion_ids: json(b.sourceDiscussionIds ?? []),
      counts: json(b.counts),
      note: b.note ?? null,
      turns: json(b.turns ?? []),
      files: json(b.files ?? []),
      actions: json(b.actions ?? []),
      terminal: json(b.terminal ?? []),
      db_connections: json(b.dbConnections ?? []),
      agent_tasks: json(b.agentTasks ?? []),
      requirements: json(b.requirements ?? []),
      build_plan: b.buildPlan ? json(b.buildPlan) : null,
      validation: b.validation ? json(b.validation) : null,
      preview_entry_path: b.previewEntryPath ?? null,
      repository_id: b.repositoryId ?? null,
      repository_full_name: b.repositoryFullName ?? null,
      repository_provider: b.repositoryProvider ?? null,
      repository_branch: b.repositoryBranch ?? null,
      last_commit_sha: b.lastCommitSha ?? null,
      last_commit_at: b.lastCommitAt ?? null,
      opened_at: b.openedAt ?? null,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
    buildSessions.map((b) => b.id),
  );

  const repositories = inProject(ws.repositories);
  await syncTable(
    "vpip_repositories",
    repositories.map((r) => ({
      id: r.id,
      project_id: r.projectId,
      provider: r.provider,
      owner: r.owner,
      name: r.name,
      full_name: r.fullName,
      description: r.description,
      visibility: r.visibility,
      default_branch: r.defaultBranch,
      current_branch: r.currentBranch,
      html_url: r.htmlUrl,
      token: r.token,
      status: r.status,
      status_message: r.statusMessage ?? null,
      validated_at: r.validatedAt ?? null,
      last_commit_sha: r.lastCommitSha ?? null,
      last_commit_message: r.lastCommitMessage ?? null,
      last_commit_at: r.lastCommitAt ?? null,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
    repositories.map((r) => r.id),
  );

  const repoIds = repositories.map((r) => r.id);
  const repoBranches = (ws.repoBranches ?? []).filter((b) => repoIds.includes(b.repositoryId));
  await syncTable(
    "vpip_repo_branches",
    repoBranches.map((b) => ({
      id: b.id,
      repository_id: b.repositoryId,
      name: b.name,
      sha: b.sha,
      base_branch: b.baseBranch ?? null,
      created_at: b.createdAt,
    })),
    repoBranches.map((b) => b.id),
  );

  const repoCommits = inProject(ws.repoCommits);
  await syncTable(
    "vpip_repo_commits",
    repoCommits.map((c) => ({
      id: c.id,
      repository_id: c.repositoryId,
      project_id: c.projectId,
      sha: c.sha,
      message: c.message,
      branch: c.branch,
      files: json(c.files),
      html_url: c.htmlUrl ?? null,
      author: c.author,
      build_session_id: c.buildSessionId ?? null,
      build_code: c.buildCode ?? null,
      prompt_id: c.promptId ?? null,
      prompt_title: c.promptTitle ?? null,
      prompt_version: c.promptVersion ?? null,
      decision_codes: json(c.decisionCodes),
      requirement_codes: json(c.requirementCodes),
      provider: c.provider,
      release_tag: c.releaseTag ?? null,
      release_name: c.releaseName ?? null,
      created_at: c.createdAt,
    })),
    repoCommits.map((c) => c.id),
  );

  const artifacts = inProject(ws.artifacts);
  await syncTable(
    "vpip_artifacts",
    artifacts.map((a) => ({
      id: a.id,
      code: a.code,
      project_id: a.projectId,
      type: a.type,
      name: a.name,
      path: a.path,
      content: a.content,
      size: a.size,
      build_session_id: a.buildSessionId ?? null,
      build_code: a.buildCode ?? null,
      build_record_id: a.buildRecordId ?? null,
      build_run_code: a.buildRunCode ?? null,
      task_id: a.taskId ?? null,
      task_code: a.taskCode ?? null,
      prompt_id: a.promptId ?? null,
      prompt_title: a.promptTitle ?? null,
      prompt_version: a.promptVersion ?? null,
      decision_codes: json(a.decisionCodes),
      requirement_codes: json(a.requirementCodes),
      repository_full_name: a.repositoryFullName ?? null,
      branch: a.branch ?? null,
      commit_sha: a.commitSha ?? null,
      provider: a.provider ?? null,
      model: a.model ?? null,
      created_at: a.createdAt,
      updated_at: a.updatedAt,
    })),
    artifacts.map((a) => a.id),
  );

  const buildRecords = inProject(ws.buildRecords);
  await syncTable(
    "vpip_build_records",
    buildRecords.map((b) => ({
      id: b.id,
      code: b.code,
      project_id: b.projectId,
      build_session_id: b.buildSessionId,
      build_code: b.buildCode,
      repository_id: b.repositoryId ?? null,
      repository_full_name: b.repositoryFullName ?? null,
      branch: b.branch ?? null,
      commit_sha: b.commitSha ?? null,
      prompt_id: b.promptId,
      prompt_title: b.promptTitle,
      prompt_version: b.promptVersion,
      provider: b.provider ?? null,
      model: b.model ?? null,
      status: b.status,
      started_at: b.startedAt,
      ended_at: b.endedAt ?? null,
      summary: b.summary ?? null,
      output: b.output ?? null,
      logs: json(b.logs),
      artifact_ids: json(b.artifactIds),
      decision_codes: json(b.decisionCodes),
      requirement_codes: json(b.requirementCodes),
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    })),
    buildRecords.map((b) => b.id),
  );

  const changeRecords = inProject(ws.changeRecords);
  await syncTable(
    "vpip_change_records",
    changeRecords.map((c) => ({
      id: c.id,
      project_id: c.projectId,
      action: c.action,
      path: c.path,
      from_path: c.fromPath ?? null,
      build_session_id: c.buildSessionId ?? null,
      build_code: c.buildCode ?? null,
      build_record_id: c.buildRecordId ?? null,
      build_run_code: c.buildRunCode ?? null,
      task_id: c.taskId ?? null,
      task_code: c.taskCode ?? null,
      prompt_id: c.promptId ?? null,
      provider: c.provider ?? null,
      model: c.model ?? null,
      created_at: c.createdAt,
    })),
    changeRecords.map((c) => c.id),
  );

  /* ---------------- Upgrade pack V-02 … V-15 */

  const promptPhases = inProject(ws.promptPhases);
  await syncTable(
    "vpip_prompt_phases",
    promptPhases.map((p) => ({
      id: p.id,
      project_id: p.projectId,
      prompt_id: p.promptId,
      phase_no: p.phaseNo,
      title: p.title,
      markdown: p.markdown,
      status: p.status,
      started_at: p.startedAt ?? null,
      ended_at: p.endedAt ?? null,
      output: p.output ?? null,
      error: p.error ?? null,
      provider: p.provider ?? null,
      model: p.model ?? null,
      build_session_id: p.buildSessionId ?? null,
      created_at: p.createdAt,
      updated_at: p.updatedAt,
    })),
    promptPhases.map((p) => p.id),
  );

  const phaseRuns = inProject(ws.phaseRuns);
  await syncTable(
    "vpip_phase_runs",
    phaseRuns.map((r) => ({
      id: r.id,
      project_id: r.projectId,
      phase_id: r.phaseId,
      prompt_id: r.promptId,
      attempt: r.attempt,
      status: r.status,
      provider: r.provider ?? null,
      model: r.model ?? null,
      started_at: r.startedAt,
      ended_at: r.endedAt ?? null,
      output: r.output ?? null,
      error: r.error ?? null,
      created_at: r.createdAt,
    })),
    phaseRuns.map((r) => r.id),
  );

  const contextPackages = inProject(ws.contextPackages);
  await syncTable(
    "vpip_context_packages",
    contextPackages.map((c) => ({
      id: c.id,
      project_id: c.projectId,
      code: c.code,
      title: c.title,
      prompt_id: c.promptId ?? null,
      prompt_title: c.promptTitle ?? null,
      prompt_version: c.promptVersion ?? null,
      markdown: c.markdown,
      counts: json(c.counts),
      decision_ids: json(c.decisionIds),
      requirement_ids: json(c.requirementIds),
      document_ids: json(c.documentIds),
      discussion_ids: json(c.discussionIds),
      prompt_ids: json(c.promptIds),
      provider: c.provider ?? null,
      model: c.model ?? null,
      created_at: c.createdAt,
      updated_at: c.updatedAt,
    })),
    contextPackages.map((c) => c.id),
  );

  const outcomes = inProject(ws.outcomes);
  await syncTable(
    "vpip_outcomes",
    outcomes.map((o) => ({
      id: o.id,
      project_id: o.projectId,
      code: o.code,
      subject_type: o.subjectType,
      subject_id: o.subjectId,
      subject_label: o.subjectLabel,
      result: o.result,
      notes: o.notes,
      lessons: o.lessons,
      recommendations: o.recommendations,
      provider: o.provider ?? null,
      model: o.model ?? null,
      author: o.author,
      created_at: o.createdAt,
      updated_at: o.updatedAt,
    })),
    outcomes.map((o) => o.id),
  );

  const failures = inProject(ws.failures);
  await syncTable(
    "vpip_failures",
    failures.map((f) => ({
      id: f.id,
      project_id: f.projectId,
      code: f.code,
      subject_type: f.subjectType,
      subject_id: f.subjectId,
      subject_label: f.subjectLabel,
      title: f.title,
      root_cause: f.rootCause,
      resolution: f.resolution,
      lessons: f.lessons,
      status: f.status,
      build_ids: json(f.buildIds),
      prompt_ids: json(f.promptIds),
      requirement_codes: json(f.requirementCodes),
      decision_codes: json(f.decisionCodes),
      provider: f.provider ?? null,
      model: f.model ?? null,
      author: f.author,
      created_at: f.createdAt,
      updated_at: f.updatedAt,
    })),
    failures.map((f) => f.id),
  );

  const activity = inProject(ws.activity);
  await syncTable(
    "vpip_activity",
    activity.map((a) => ({
      id: a.id,
      project_id: a.projectId,
      subject_type: a.subjectType,
      subject_id: a.subjectId,
      subject_label: a.subjectLabel,
      action: a.action,
      provider: a.provider ?? null,
      model: a.model ?? null,
      author: a.author,
      note: a.note,
      created_at: a.createdAt,
    })),
    activity.map((a) => a.id),
  );

  const intelligence = inProject(ws.intelligence);
  await syncTable(
    "vpip_intelligence",
    intelligence.map((i) => ({
      id: i.id,
      project_id: i.projectId,
      code: i.code,
      pattern_type: i.patternType,
      title: i.title,
      description: i.description,
      tags: json(i.tags),
      source_project_id: i.sourceProjectId ?? null,
      source_project_name: i.sourceProjectName ?? null,
      source_kind: i.sourceKind ?? null,
      source_id: i.sourceId ?? null,
      provider: i.provider ?? null,
      model: i.model ?? null,
      author: i.author,
      created_at: i.createdAt,
      updated_at: i.updatedAt,
    })),
    intelligence.map((i) => i.id),
  );
}

/* --------------------------------------------------------------- utility */

export async function vaultSize(): Promise<number> {
  const ws = await vaultRead<Workspace>();
  return ws ? new Blob([JSON.stringify(ws)]).size : 0;
}

export async function vaultClear(): Promise<void> {
  // Projects cascade to every child table.
  await supabase.from("vpip_projects").delete().neq("id", "");
}
