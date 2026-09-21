/**
 * VaultStore: the single persistence boundary of VPIP.
 * It now reads and writes the shared cloud database (Postgres) through the
 * generated client. The rest of the app still works on one in-memory
 * `Workspace` object, so swapping this file is the only change needed to move
 * the vault somewhere else.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  emptyWorkspace,
  type Discussion,
  type GeneratedDocument,
  type GeneratedPrompt,
  type KnowledgeItem,
  type Project,
  type Snapshot,
  type Workspace,
} from "./types";

type Row = Record<string, unknown>;

function undef<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

/* ----------------------------------------------------------------- read */

export async function vaultRead<T>(): Promise<T | null> {
  const [settings, projects, discussions, knowledge, documents, prompts, snapshots] =
    await Promise.all([
      supabase.from("vpip_settings").select("*").eq("id", 1).maybeSingle(),
      supabase.from("vpip_projects").select("*").order("created_at", { ascending: false }),
      supabase.from("vpip_discussions").select("*").order("created_at", { ascending: false }),
      supabase.from("vpip_knowledge").select("*").order("created_at", { ascending: false }),
      supabase.from("vpip_documents").select("*").order("created_at", { ascending: false }),
      supabase.from("vpip_prompts").select("*").order("created_at", { ascending: false }),
      supabase.from("vpip_snapshots").select("*").order("created_at", { ascending: false }),
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
      return {
        id: r['id'] as string,
        projectId: r['project_id'] as string,
        kind: r['kind'] as GeneratedPrompt["kind"],
        title: r['title'] as string,
        version: (r['version'] as number) ?? 1,
        markdown: (r['markdown'] as string) ?? "",
        createdAt: r['created_at'] as string,
        ...(provider !== undefined ? { provider } : {}),
        ...(model !== undefined ? { model } : {}),
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
  };

  return ws as unknown as T;
}

/* ---------------------------------------------------------------- write */

async function syncTable(table: string, rows: Row[], keepIds: string[]) {
  const { data: existing } = await supabase.from(table as never).select("id");
  const existingIds = ((existing ?? []) as Row[]).map((r) => r['id'] as string);
  const removed = existingIds.filter((id) => !keepIds.includes(id));
  if (removed.length) {
    await supabase.from(table as never).delete().in("id", removed);
  }
  if (rows.length) {
    const { error } = await supabase.from(table as never).upsert(rows as never, { onConflict: "id" });
    if (error) throw error;
  }
}

export async function vaultWrite(value: unknown): Promise<void> {
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
      providers: JSON.parse(JSON.stringify(ws.settings.providers)),
      saved_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (sErr) throw sErr;

  const projectIds = ws.projects.map((p) => p.id);
  const inProject = <T extends { projectId: string }>(list: T[]) =>
    list.filter((x) => projectIds.includes(x.projectId));

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
      messages: d.messages,
      attachments: d.attachments,
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
      source_messages: k.sourceMessages,
      provider: k.provider ?? null,
      author: k.author,
      revisions: k.revisions,
      merged_from: k.mergedFrom ?? [],
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
