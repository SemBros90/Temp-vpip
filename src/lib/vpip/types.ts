export type ProviderId = "openai" | "deepseek" | "perplexity" | "Gemini" | "Claude";

export type DiscussionType =
  | "General"
  | "Requirement"
  | "Architecture"
  | "Decision"
  | "Research"
  | "Risk"
  | "Prompt"
  | "Business"
  | "Other";

export const DISCUSSION_TYPES: DiscussionType[] = [
  "General",
  "Requirement",
  "Architecture",
  "Decision",
  "Research",
  "Risk",
  "Prompt",
  "Business",
  "Other",
];

export type KnowledgeType =
  | "Decision"
  | "Requirement"
  | "Idea"
  | "Risk"
  | "Question"
  | "Assumption"
  | "Lesson Learned"
  | "Failure Cause";

export const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "Decision",
  "Requirement",
  "Idea",
  "Risk",
  "Question",
  "Assumption",
  "Lesson Learned",
  "Failure Cause",
];

export const KNOWLEDGE_PREFIX: Record<KnowledgeType, string> = {
  Decision: "D",
  Requirement: "R",
  Idea: "I",
  Risk: "K",
  Question: "Q",
  Assumption: "A",
  "Lesson Learned": "L",
  "Failure Cause": "F",
};

/** V-13 — knowledge can now be extracted from any project object. */
export type KnowledgeSourceKind =
  | "Discussion"
  | "Document"
  | "Prompt"
  | "Build Session"
  | "Repository"
  | "Artifact";

export const KNOWLEDGE_SOURCE_KINDS: KnowledgeSourceKind[] = [
  "Discussion",
  "Document",
  "Prompt",
  "Build Session",
  "Repository",
  "Artifact",
];


export type KnowledgeStatus = "candidate" | "approved" | "rejected";

export interface Revision {
  at: string;
  note: string;
  author: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  /** data URL for binary, plain text for text-like files */
  data: string;
  text?: string;
  createdAt: string;
}

export interface Message {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  provider?: ProviderId;
  model?: string;
  createdAt: string;
  attachmentIds?: string[];
}

export interface Discussion {
  id: string;
  projectId: string;
  title: string;
  type: DiscussionType;
  createdAt: string;
  updatedAt: string;
  summary?: string;
  messages: Message[];
  attachments: Attachment[];
  /** V-08 — discussion feedback loop */
  reopenedAt?: string | undefined;
  reopenContext?: string[];
}

export interface KnowledgeItem {
  id: string;
  code: string;
  projectId: string;
  type: KnowledgeType;
  status: KnowledgeStatus;
  title: string;
  description: string;
  sourceDiscussionId?: string;
  sourceDiscussionTitle?: string;
  sourceMessages: number[];
  provider?: ProviderId;
  author: string;
  createdAt: string;
  updatedAt: string;
  revisions: Revision[];
  mergedFrom?: string[];
  /** V-09 — knowledge improvement loop */
  version?: number;
  reasonForChange?: string | undefined;
  /** V-13 — universal extraction origin */
  sourceKind?: KnowledgeSourceKind;
  sourceRefId?: string | undefined;
}

export type DocumentKind =
  | "Project Summary"
  | "Decision Register"
  | "Requirement Register"
  | "Architecture Summary"
  | "Discussion Summary"
  | "Research Summary"
  | "Project Knowledge Book";

export const DOCUMENT_KINDS: DocumentKind[] = [
  "Project Summary",
  "Decision Register",
  "Requirement Register",
  "Architecture Summary",
  "Discussion Summary",
  "Research Summary",
  "Project Knowledge Book",
];

export interface GeneratedDocument {
  id: string;
  projectId: string;
  kind: DocumentKind;
  title: string;
  markdown: string;
  provider?: ProviderId;
  model?: string;
  createdAt: string;
  sourceDiscussionId?: string;
}

export type PromptKind =
  | "Lovable Prompt"
  | "Replit Prompt"
  | "Architecture Prompt"
  | "Research Prompt"
  | "Business Prompt"
  | "Custom Prompt";

export const PROMPT_KINDS: PromptKind[] = [
  "Lovable Prompt",
  "Replit Prompt",
  "Architecture Prompt",
  "Research Prompt",
  "Business Prompt",
  "Custom Prompt",
];

export type PromptStatus =
  | "Draft"
  | "Approved"
  | "Ready For Coding"
  | "Sent To Coder"
  | "Archived";

export const PROMPT_STATUSES: PromptStatus[] = [
  "Draft",
  "Approved",
  "Ready For Coding",
  "Sent To Coder",
  "Archived",
];

export interface GeneratedPrompt {
  id: string;
  projectId: string;
  kind: PromptKind;
  title: string;
  version: number;
  markdown: string;
  provider?: ProviderId;
  model?: string;
  createdAt: string;
  /** Module 11A — lifecycle + context links */
  status?: PromptStatus;
  linkedDecisionIds?: string[];
  linkedRequirementIds?: string[];
  linkedDocumentIds?: string[];
  linkedDiscussionIds?: string[];
}

export type BuildStatus =
  | "Queued"
  | "Handed Off"
  | "In Progress"
  | "Completed"
  | "Failed"
  | "Cancelled";

export const BUILD_STATUSES: BuildStatus[] = [
  "Queued",
  "Handed Off",
  "In Progress",
  "Completed",
  "Failed",
  "Cancelled",
];

export interface BuildSession {
  id: string;
  code: string;
  projectId: string;
  promptId: string;
  promptTitle: string;
  promptKind: PromptKind;
  promptVersion: number;
  provider?: ProviderId;
  model?: string;
  status: BuildStatus;
  /** frozen context package handed to the coder */
  contextPackage: string;
  /** V-04 / V-05 — full source traceability */
  contextPackageId?: string | undefined;
  sourceDocumentIds?: string[];
  sourceDiscussionIds?: string[];
  counts: {
    decisions: number;
    requirements: number;
    documents: number;
    discussions: number;
  };
  note?: string;
  createdAt: string;
  updatedAt: string;
  /** Module 12 — AI Coder workspace conversation */
  turns?: CoderTurn[];
  openedAt?: string;
  /** Module 12 — AI Coder workspace state */
  files?: CoderFile[];
  actions?: CoderAction[];
  terminal?: TerminalEntry[];
  dbConnections?: DbConnection[];
  previewEntryPath?: string | undefined;
  /** Module 14 — AI Development Agent tasks */
  agentTasks?: AgentTask[];
  /** Module 16 — build orchestration */
  requirements?: BuildRequirement[];
  buildPlan?: BuildPlan | undefined;
  validation?: ValidationReport | undefined;
  /** Module 13 — repository link */
  repositoryId?: string | undefined;
  repositoryFullName?: string | undefined;
  repositoryProvider?: RepoProvider | undefined;
  repositoryBranch?: string | undefined;
  lastCommitSha?: string | undefined;
  lastCommitAt?: string | undefined;
}

export type CoderActionKind =
  | "Generate Code"
  | "Modify Code"
  | "Refactor Code"
  | "Explain Code"
  | "Review Code"
  | "Architecture Review"
  | "Security Review"
  | "Performance Review"
  | "Maintainability Review"
  | "Error Analysis"
  | "Log Analysis"
  | "Fix Errors"
  | "Apply Fix"
  | "Create File"
  | "Edit File"
  | "Rename File"
  | "Delete File"
  | "Create Folder"
  | "Delete Folder"
  | "Restore Version"
  | "Terminal Command"
  | "Database Connection";

export const CODER_CHAT_MODES: CoderActionKind[] = [
  "Generate Code",
  "Modify Code",
  "Refactor Code",
  "Explain Code",
  "Review Code",
  "Architecture Review",
  "Security Review",
  "Performance Review",
  "Maintainability Review",
  "Error Analysis",
  "Log Analysis",
  "Fix Errors",
];

export type CodeArtifact =
  | "Page"
  | "Component"
  | "Layout"
  | "Form"
  | "API"
  | "Service"
  | "Utility"
  | "SQL"
  | "Documentation";

export const CODE_ARTIFACTS: CodeArtifact[] = [
  "Page",
  "Component",
  "Layout",
  "Form",
  "API",
  "Service",
  "Utility",
  "SQL",
  "Documentation",
];

export interface CoderFileVersion {
  id: string;
  seq: number;
  content: string;
  note: string;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
  trace?: CoderTrace | undefined;
}

export interface CoderFile {
  id: string;
  path: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  versions: CoderFileVersion[];
}

export interface CoderAction {
  id: string;
  seq: number;
  kind: CoderActionKind;
  summary: string;
  filesModified: string[];
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
  trace: CoderTrace;
}

export type LogStream = "terminal" | "build" | "error" | "preview";

export interface TerminalEntry {
  id: string;
  stream: LogStream;
  command?: string | undefined;
  output: string;
  exitCode?: number | undefined;
  createdAt: string;
}

export type DbEngine = "SQLite" | "PostgreSQL" | "MySQL" | "Supabase";

export const DB_ENGINES: DbEngine[] = ["SQLite", "PostgreSQL", "MySQL", "Supabase"];

/** Connection fields are whatever the user supplies. Nothing is defaulted or hardcoded. */
export const DB_FIELDS: Record<DbEngine, string[]> = {
  SQLite: ["file"],
  PostgreSQL: ["host", "port", "database", "user", "password"],
  MySQL: ["host", "port", "database", "user", "password"],
  Supabase: ["url", "anonKey"],
};

export interface DbConnection {
  id: string;
  engine: DbEngine;
  label: string;
  config: Record<string, string>;
  createdAt: string;
}

/** Every coding action traces back to prompt, decisions, requirements and build. */
export interface CoderTrace {
  buildCode: string;
  promptId: string;
  promptVersion: number;
  decisionCodes: string[];
  requirementCodes: string[];
  documentIds: string[];
  discussionIds: string[];
}

export interface CoderTurn {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string;
  provider?: ProviderId;
  model?: string;
  createdAt: string;
  trace: CoderTrace;
}

/* ------------------------------ Module 14 — AI Development Agent */

export type AgentTaskType =
  | "Feature Build"
  | "Enhancement"
  | "Refactor"
  | "Bug Fix"
  | "Documentation"
  | "Review";

export const AGENT_TASK_TYPES: AgentTaskType[] = [
  "Feature Build",
  "Enhancement",
  "Refactor",
  "Bug Fix",
  "Documentation",
  "Review",
];

export type AgentTaskStatus =
  | "Pending"
  | "Running"
  | "Waiting"
  | "Completed"
  | "Failed"
  | "Cancelled";

export const AGENT_TASK_STATUSES: AgentTaskStatus[] = [
  "Pending",
  "Running",
  "Waiting",
  "Completed",
  "Failed",
  "Cancelled",
];

export type AgentFileAction =
  | "Create File"
  | "Update File"
  | "Delete File"
  | "Rename File"
  | "Create Folder"
  | "Delete Folder";

export interface AgentPlanFile {
  path: string;
  reason: string;
}

/** The execution plan the agent must show and have approved before touching files. */
export interface AgentPlan {
  create: AgentPlanFile[];
  modify: AgentPlanFile[];
  delete: AgentPlanFile[];
  dependencies: string[];
  risks: string[];
  scope: string;
  markdown: string;
}

/** Every file change made by the agent. */
export interface AgentChange {
  id: string;
  taskId: string;
  buildCode: string;
  promptId: string;
  path: string;
  action: AgentFileAction;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
}

export interface AgentTask {
  id: string;
  code: string;
  buildSessionId: string;
  projectId: string;
  promptId: string;
  promptTitle: string;
  promptVersion: number;
  type: AgentTaskType;
  status: AgentTaskStatus;
  instruction: string;
  plan?: AgentPlan | undefined;
  approvedAt?: string | undefined;
  /** agent output */
  transcript?: string | undefined;
  changeSummary?: string | undefined;
  buildSummary?: string | undefined;
  technicalNotes?: string | undefined;
  error?: string | undefined;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
  updatedAt: string;
  changes: AgentChange[];
  trace: CoderTrace;
}

/* ------------------------------------ Module 16 — Build Orchestration */

export type RequirementStatus =
  | "Not Started"
  | "In Progress"
  | "Completed"
  | "Failed"
  | "Blocked";

export const REQUIREMENT_STATUSES: RequirementStatus[] = [
  "Not Started",
  "In Progress",
  "Completed",
  "Failed",
  "Blocked",
];

/** One extracted, uniquely coded requirement of a build session. */
export interface BuildRequirement {
  id: string;
  code: string;
  title: string;
  detail: string;
  status: RequirementStatus;
  /** traceability matrix — files that satisfy this requirement */
  files: string[];
  buildSessionId: string;
  createdAt: string;
  updatedAt: string;
}

export interface BuildPlanFile {
  path: string;
  purpose: string;
  requirements: string[];
}

export interface BuildPlan {
  files: BuildPlanFile[];
  dependencies: string[];
  buildOrder: string[];
  moduleMap: { path: string; imports: string[] }[];
  markdown: string;
  createdAt: string;
}

export type ValidationKind = "Dependency" | "Startup" | "Import" | "Export" | "Syntax";

export type ValidationStatus = "Pass" | "Fail" | "Unknown";

export interface ValidationIssue {
  kind: ValidationKind;
  severity: "error" | "warning";
  path?: string;
  message: string;
}

export interface ValidationReport {
  at: string;
  issues: ValidationIssue[];
  dependencyStatus: ValidationStatus;
  startupStatus: ValidationStatus;
  compileStatus: ValidationStatus;
  missingDependencies: string[];
}

export interface BuildHealth {
  requirementsTotal: number;
  requirementsComplete: number;
  requirementsFailed: number;
  requirementsBlocked: number;
  filesPlanned: number;
  filesCreated: number;
  dependenciesMissing: number;
  compileStatus: ValidationStatus;
  startupStatus: ValidationStatus;
  dependencyStatus: ValidationStatus;
  errorCount: number;
  completion: number;
  buildComplete: boolean;
}


/* ------------------------------------------- Module 13 — Repositories */

export type RepoProvider = "GitHub" | "GitLab" | "Bitbucket" | "Git";

export type RepoVisibility = "public" | "private";

export type RepoConnectionStatus = "Connected" | "Not Validated" | "Invalid" | "Disconnected";

export interface Repository {
  id: string;
  projectId: string;
  provider: RepoProvider;
  owner: string;
  name: string;
  fullName: string;
  description: string;
  visibility: RepoVisibility;
  defaultBranch: string;
  currentBranch: string;
  htmlUrl: string;
  /** User supplied access token. Never hardcoded, never defaulted. */
  token: string;
  status: RepoConnectionStatus;
  statusMessage?: string | undefined;
  validatedAt?: string | undefined;
  lastCommitSha?: string | undefined;
  lastCommitMessage?: string | undefined;
  lastCommitAt?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface RepoBranch {
  id: string;
  repositoryId: string;
  name: string;
  sha: string;
  baseBranch?: string | undefined;
  createdAt: string;
}

export interface RepoCommit {
  id: string;
  repositoryId: string;
  projectId: string;
  sha: string;
  message: string;
  branch: string;
  files: string[];
  htmlUrl?: string | undefined;
  author: string;
  /** traceability — Requirement → Decision → Prompt → Build → Commit → Repository */
  buildSessionId?: string | undefined;
  buildCode?: string | undefined;
  promptId?: string | undefined;
  promptTitle?: string | undefined;
  promptVersion?: number | undefined;
  decisionCodes: string[];
  requirementCodes: string[];
  provider: RepoProvider;
  /** V-10 — repository intelligence */
  releaseTag?: string | undefined;
  releaseName?: string | undefined;
  createdAt: string;
}

/* ------------------------- Module 15 — Artifact and Build Management */

export type ArtifactType =
  | "Source Files"
  | "Generated Files"
  | "Documentation"
  | "SQL Scripts"
  | "Configuration Files"
  | "Build Outputs"
  | "Logs"
  | "Reports";

export const ARTIFACT_TYPES: ArtifactType[] = [
  "Source Files",
  "Generated Files",
  "Documentation",
  "SQL Scripts",
  "Configuration Files",
  "Build Outputs",
  "Logs",
  "Reports",
];

/** Permanent record of a development output. Always traceable. */
export interface Artifact {
  id: string;
  code: string;
  projectId: string;
  type: ArtifactType;
  name: string;
  path: string;
  content: string;
  size: number;
  /** traceability */
  buildSessionId?: string | undefined;
  buildCode?: string | undefined;
  buildRecordId?: string | undefined;
  buildRunCode?: string | undefined;
  taskId?: string | undefined;
  taskCode?: string | undefined;
  promptId?: string | undefined;
  promptTitle?: string | undefined;
  promptVersion?: number | undefined;
  decisionCodes: string[];
  requirementCodes: string[];
  repositoryFullName?: string | undefined;
  branch?: string | undefined;
  commitSha?: string | undefined;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export type BuildRecordStatus = "Queued" | "Running" | "Completed" | "Failed" | "Cancelled";

export const BUILD_RECORD_STATUSES: BuildRecordStatus[] = [
  "Queued",
  "Running",
  "Completed",
  "Failed",
  "Cancelled",
];

export interface BuildRecord {
  id: string;
  code: string;
  projectId: string;
  buildSessionId: string;
  buildCode: string;
  repositoryId?: string | undefined;
  repositoryFullName?: string | undefined;
  branch?: string | undefined;
  commitSha?: string | undefined;
  promptId: string;
  promptTitle: string;
  promptVersion: number;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  status: BuildRecordStatus;
  startedAt: string;
  endedAt?: string | undefined;
  summary?: string | undefined;
  output?: string | undefined;
  logs: string[];
  artifactIds: string[];
  decisionCodes: string[];
  requirementCodes: string[];
  createdAt: string;
  updatedAt: string;
}

export type ChangeAction = "Created" | "Modified" | "Deleted" | "Renamed";

export const CHANGE_ACTIONS: ChangeAction[] = ["Created", "Modified", "Deleted", "Renamed"];

export interface ChangeRecord {
  id: string;
  projectId: string;
  action: ChangeAction;
  path: string;
  fromPath?: string | undefined;
  buildSessionId?: string | undefined;
  buildCode?: string | undefined;
  buildRecordId?: string | undefined;
  buildRunCode?: string | undefined;
  taskId?: string | undefined;
  taskCode?: string | undefined;
  promptId?: string | undefined;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
}

/* ============================ V-03 — phased prompt execution */

export type PhaseStatus = "Pending" | "Running" | "Completed" | "Failed";

export const PHASE_STATUSES: PhaseStatus[] = ["Pending", "Running", "Completed", "Failed"];

export interface PromptPhase {
  id: string;
  projectId: string;
  promptId: string;
  phaseNo: number;
  title: string;
  markdown: string;
  status: PhaseStatus;
  startedAt?: string | undefined;
  endedAt?: string | undefined;
  output?: string | undefined;
  error?: string | undefined;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  buildSessionId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface PhaseRun {
  id: string;
  projectId: string;
  phaseId: string;
  promptId: string;
  attempt: number;
  status: PhaseStatus;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  startedAt: string;
  endedAt?: string | undefined;
  output?: string | undefined;
  error?: string | undefined;
  createdAt: string;
}

/* ============================ V-05 — context packages */

export interface ContextPackageRecord {
  id: string;
  projectId: string;
  code: string;
  title: string;
  promptId?: string | undefined;
  promptTitle?: string | undefined;
  promptVersion?: number | undefined;
  markdown: string;
  counts: Record<string, number>;
  decisionIds: string[];
  requirementIds: string[];
  documentIds: string[];
  discussionIds: string[];
  promptIds: string[];
  provider?: ProviderId | undefined;
  model?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/* ============================ V-06 — outcome learning */

export type OutcomeSubject = "Build" | "Agent Run" | "Prompt Execution";

export const OUTCOME_SUBJECTS: OutcomeSubject[] = ["Build", "Agent Run", "Prompt Execution"];

export type OutcomeResult = "Success" | "Partial Success" | "Failure";

export const OUTCOME_RESULTS: OutcomeResult[] = ["Success", "Partial Success", "Failure"];

export interface OutcomeRecord {
  id: string;
  projectId: string;
  code: string;
  subjectType: OutcomeSubject;
  subjectId: string;
  subjectLabel: string;
  result: OutcomeResult;
  notes: string;
  lessons: string;
  recommendations: string;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/* ============================ V-07 — failure analysis */

export type FailureSubject = "Build" | "Agent" | "Prompt" | "Requirement Gap";

export const FAILURE_SUBJECTS: FailureSubject[] = ["Build", "Agent", "Prompt", "Requirement Gap"];

export type FailureStatus = "Open" | "Resolved";

export interface FailureRecord {
  id: string;
  projectId: string;
  code: string;
  subjectType: FailureSubject;
  subjectId: string;
  subjectLabel: string;
  title: string;
  rootCause: string;
  resolution: string;
  lessons: string;
  status: FailureStatus;
  buildIds: string[];
  promptIds: string[];
  requirementCodes: string[];
  decisionCodes: string[];
  provider?: ProviderId | undefined;
  model?: string | undefined;
  author: string;
  createdAt: string;
  updatedAt: string;
}

/* ============================ V-11 — multi-AI collaboration ledger */

export type CollabAction =
  | "Created"
  | "Reviewed"
  | "Implemented"
  | "Validated"
  | "Executed"
  | "Extracted"
  | "Recorded";

export const COLLAB_ACTIONS: CollabAction[] = [
  "Created",
  "Reviewed",
  "Implemented",
  "Validated",
  "Executed",
  "Extracted",
  "Recorded",
];

export interface ActivityRecord {
  id: string;
  projectId: string;
  subjectType: string;
  subjectId: string;
  subjectLabel: string;
  action: CollabAction;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  author: string;
  note: string;
  createdAt: string;
}

/* ============================ V-15 — organizational knowledge */

export type PatternType =
  | "Success Pattern"
  | "Failure Pattern"
  | "Reusable Decision"
  | "Reusable Requirement"
  | "Reusable Prompt Structure";

export const PATTERN_TYPES: PatternType[] = [
  "Success Pattern",
  "Failure Pattern",
  "Reusable Decision",
  "Reusable Requirement",
  "Reusable Prompt Structure",
];

export interface IntelligenceRecord {
  id: string;
  projectId: string;
  code: string;
  patternType: PatternType;
  title: string;
  description: string;
  tags: string[];
  sourceProjectId?: string | undefined;
  sourceProjectName?: string | undefined;
  sourceKind?: string | undefined;
  sourceId?: string | undefined;
  provider?: ProviderId | undefined;
  model?: string | undefined;
  author: string;
  createdAt: string;
  updatedAt: string;
}

export interface Snapshot {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  refId: string;
  markdown: string;
  createdAt: string;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderConfig {
  /** Stored in the project database at the user's request. */
  apiKey?: string;
  model: string;
  status: "unknown" | "ok" | "error";
  statusMessage?: string;
  testedAt?: string;
}

export interface Settings {
  author: string;
  defaultProvider: ProviderId;
  autoSaveIntervalSec: number;
  projectRootLabel: string;
  backupFolderLabel: string;
  providers: Record<ProviderId, ProviderConfig>;
}

export interface Workspace {
  version: number;
  settings: Settings;
  projects: Project[];
  discussions: Discussion[];
  knowledge: KnowledgeItem[];
  documents: GeneratedDocument[];
  prompts: GeneratedPrompt[];
  snapshots: Snapshot[];
  buildSessions: BuildSession[];
  /** Module 13 */
  repositories: Repository[];
  repoBranches: RepoBranch[];
  repoCommits: RepoCommit[];
  /** Module 15 */
  artifacts: Artifact[];
  buildRecords: BuildRecord[];
  changeRecords: ChangeRecord[];
  /** Upgrade pack V-02 … V-15 */
  promptPhases: PromptPhase[];
  phaseRuns: PhaseRun[];
  contextPackages: ContextPackageRecord[];
  outcomes: OutcomeRecord[];
  failures: FailureRecord[];
  activity: ActivityRecord[];
  intelligence: IntelligenceRecord[];
  savedAt?: string;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
  perplexity: "Perplexity",
  Gemini: "Gemini",
  Claude: "Claude",
};

export const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-pro"],
  perplexity: [
    "perplexity/sonar",
    "perplexity/deepseek-v4-pro-0813",
    "perplexity/kimi-k3",
    "perplexity/glm-5.3",
  ],
  Gemini: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
  Claude: ["claude-sonnet-4-5", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"],
};

export function emptyWorkspace(): Workspace {
  return {
    version: 1,
    settings: {
      author: "You",
      defaultProvider: "openai",
      autoSaveIntervalSec: 30,
      projectRootLabel: "Projects",
      backupFolderLabel: "Backups",
      providers: {
        openai: {
          model: "gpt-4o-mini",
          status: "unknown",
        },
        deepseek: {
          model: "deepseek-chat",
          status: "unknown",
        },
        perplexity: {
          model: "perplexity/sonar",
          status: "unknown",
        },
        Gemini: {
          model: "gemini-2.5-flash",
          status: "unknown",
        },
        Claude: {
          model: "claude-sonnet-4-5",
          status: "unknown",
        },
      },
    },
    projects: [],
    discussions: [],
    knowledge: [],
    documents: [],
    prompts: [],
    snapshots: [],
    buildSessions: [],
    repositories: [],
    repoBranches: [],
    repoCommits: [],
    artifacts: [],
    buildRecords: [],
    changeRecords: [],
    promptPhases: [],
    phaseRuns: [],
    contextPackages: [],
    outcomes: [],
    failures: [],
    activity: [],
    intelligence: [],
  };
}
