export type ProviderId = "openai" | "deepseek";

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
  | "Assumption";

export const KNOWLEDGE_TYPES: KnowledgeType[] = [
  "Decision",
  "Requirement",
  "Idea",
  "Risk",
  "Question",
  "Assumption",
];

export const KNOWLEDGE_PREFIX: Record<KnowledgeType, string> = {
  Decision: "D",
  Requirement: "R",
  Idea: "I",
  Risk: "K",
  Question: "Q",
  Assumption: "A",
};

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
  apiKey: string;
  model: string;
  baseUrl: string;
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
  savedAt?: string;
}

export const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  deepseek: "DeepSeek",
};

export const PROVIDER_MODELS: Record<ProviderId, string[]> = {
  openai: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "gpt-4.1-mini", "o4-mini"],
  deepseek: ["deepseek-chat", "deepseek-reasoner"],
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
          apiKey: "",
          model: "gpt-4o-mini",
          baseUrl: "https://api.openai.com/v1",
          status: "unknown",
        },
        deepseek: {
          apiKey: "",
          model: "deepseek-chat",
          baseUrl: "https://api.deepseek.com/v1",
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
  };
}
