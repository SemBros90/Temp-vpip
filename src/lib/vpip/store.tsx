import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { repoDiagnosticsSummary } from "./repo-analyzer";
import { toast } from "sonner";
import { saveQueueLength, vaultClear, vaultRead, vaultWrite, verifySave } from "./db";
import {
  emptyWorkspace,
  KNOWLEDGE_PREFIX,
  type AgentChange,
  type AgentTask,
  type Artifact,
  type BuildRecord,
  type BuildSession,
  type ChangeRecord,
  type CoderAction,
  type CoderFile,
  type CoderTrace,
  type CoderTurn,
  type DbConnection,
  type TerminalEntry,
  type Discussion,
  type GeneratedDocument,
  type GeneratedPrompt,
  type KnowledgeItem,
  type KnowledgeType,
  type Message,
  type Project,
  type RepoBranch,
  type RepoCommit,
  type RepoProvider,
  type Repository,
  type RepoReport,
  type ActivityRecord,
  type ContextPackageRecord,
  type FailureRecord,
  type IntelligenceRecord,
  type OutcomeRecord,
  type PhaseRun,
  type PromptPhase,
  type Settings,
  type Snapshot,
  type Workspace,
} from "./types";

export function uid() {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  ).toLowerCase();
}

export const now = () => new Date().toISOString();

export type SaveState = "idle" | "saving" | "saved" | "error";

export interface SaveMetrics {
  successes: number;
  failures: number;
  retries: number;
  lastError: string | null;
  lastDurationMs: number | null;
}

interface Ctx {
  ws: Workspace;
  loaded: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  lastLoadedAt: string | null;
  loadError: string | null;
  reload: () => Promise<void>;
  update: (fn: (ws: Workspace) => Workspace) => void;
  saveNow: () => Promise<void>;
  resetVault: () => Promise<void>;
  importWorkspace: (ws: Workspace) => void;
  /* persistence observability */
  saveState: SaveState;
  saveError: string | null;
  saveMetrics: SaveMetrics;
  pendingChanges: number;
  queueLength: number;
  tabId: string;
  otherTabs: string[];
  /** Announce a created record; a confirmation toast fires once it is in the database. */
  confirmSaved: (label: string) => void;
}

const VpipContext = createContext<Ctx | null>(null);

const TAB_ID = uid().slice(-6).toUpperCase();

export function VpipProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace>(() => emptyWorkspace());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMetrics, setSaveMetrics] = useState<SaveMetrics>({
    successes: 0,
    failures: 0,
    retries: 0,
    lastError: null,
    lastDurationMs: null,
  });
  const [pendingChanges, setPendingChanges] = useState(0);
  const [queueLength, setQueueLength] = useState(0);
  const [otherTabs, setOtherTabs] = useState<string[]>([]);
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const pendingRef = useRef(0);
  const savingRef = useRef(false);
  const failedRef = useRef(false);
  const confirmRef = useRef<string[]>([]);
  // Writes are only allowed once a complete snapshot has been read. Writing is a
  // full sync, so saving on top of a failed/incomplete load would delete rows.
  const readableRef = useRef(false);

  const load = useCallback(async () => {
    try {
      // The database may be waking up (schema cache / 5xx). Retry with backoff
      // instead of showing an empty workspace that needs manual refreshes.
      let stored: Workspace | null = null;
      for (let attempt = 0; ; attempt++) {
        try {
          stored = await vaultRead<Workspace>();
          break;
        } catch (e) {
          if (attempt >= 7) throw e;
          setLoadError(`Connecting to database… (attempt ${attempt + 2})`);
          await new Promise((r) => setTimeout(r, Math.min(1500 * 2 ** attempt, 10000)));
        }
      }
      const next = stored ? { ...emptyWorkspace(), ...stored } : emptyWorkspace();
      wsRef.current = next;
      setWs(next);
      readableRef.current = true;
      setLoadError(null);
      setLastLoadedAt(now());
      pendingRef.current = 0;
      setPendingChanges(0);
      setDirty(false);
    } catch (err) {
      readableRef.current = false;
      setLoadError(err instanceof Error ? err.message : String(err));
      console.error("Vault load failed", err);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveNow = useCallback(async () => {
    if (!readableRef.current) {
      console.warn("Vault save skipped: workspace was never loaded successfully");
      return;
    }
    const startedPending = pendingRef.current;
    const stamp = now();
    const t0 = Date.now();
    savingRef.current = true;
    setSaveState("saving");
    setQueueLength(saveQueueLength() + 1);
    const retrying = failedRef.current;
    try {
      await vaultWrite({ ...wsRef.current, savedAt: stamp });
      await verifySave(stamp);
      const duration = Date.now() - t0;
      pendingRef.current = Math.max(0, pendingRef.current - startedPending);
      setPendingChanges(pendingRef.current);
      setLastSavedAt(now());
      if (pendingRef.current === 0) setDirty(false);
      failedRef.current = false;
      setSaveError(null);
      setSaveState("saved");
      setSaveMetrics((m) => ({
        successes: m.successes + 1,
        failures: m.failures,
        retries: retrying ? m.retries + 1 : m.retries,
        lastError: m.lastError,
        lastDurationMs: duration,
      }));
      const labels = confirmRef.current;
      confirmRef.current = [];
      if (labels.length) {
        toast.dismiss("vpip-save-error");
        toast.success(
          labels.length === 1 ? `${labels[0]} saved` : `${labels.length} records saved`,
          { description: "Written to the database and verified." },
        );
      } else {
        toast.dismiss("vpip-save-error");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failedRef.current = true;
      setSaveError(message);
      setSaveState("error");
      setSaveMetrics((m) => ({
        successes: m.successes,
        failures: m.failures + 1,
        retries: retrying ? m.retries + 1 : m.retries,
        lastError: message,
        lastDurationMs: Date.now() - t0,
      }));
      toast.error("Save failed — your changes are not stored yet", {
        id: "vpip-save-error",
        description: message,
        duration: Infinity,
      });
      console.error("Vault save failed", err);
    } finally {
      savingRef.current = false;
      setQueueLength(saveQueueLength());
    }
  }, []);

  const update = useCallback((fn: (w: Workspace) => Workspace) => {
    setWs((prev) => {
      const next = fn(prev);
      wsRef.current = next;
      return next;
    });
    pendingRef.current += 1;
    setPendingChanges(pendingRef.current);
    setDirty(true);
  }, []);

  const confirmSaved = useCallback((label: string) => {
    confirmRef.current = [...confirmRef.current, label];
  }, []);

  // Real-time save (debounced) — every change reaches the vault immediately.
  useEffect(() => {
    if (!loaded || !dirty || loadError) return;
    const t = setTimeout(() => {
      void saveNow();
    }, 400);
    return () => clearTimeout(t);
  }, [ws, dirty, loaded, loadError, saveNow]);

  // Auto save interval — a periodic flush, only when there is unsaved work.
  useEffect(() => {
    if (!loaded || loadError) return;
    const ms = Math.max(5, ws.settings.autoSaveIntervalSec) * 1000;
    const i = setInterval(() => {
      if (dirty) void saveNow();
    }, ms);
    return () => clearInterval(i);
  }, [loaded, loadError, dirty, ws.settings.autoSaveIntervalSec, saveNow]);

  // Unsaved-changes / save-in-progress protection on close, refresh and navigation.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!dirty && !savingRef.current && !failedRef.current) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // Multi-tab detection — every tab announces itself so overwrites are never silent.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const ch = new BroadcastChannel("vpip-tabs");
    const seen = new Map<string, number>();
    const publish = () => {
      const cutoff = Date.now() - 9000;
      for (const [id, at] of seen) if (at < cutoff) seen.delete(id);
      setOtherTabs([...seen.keys()]);
    };
    ch.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; id?: string };
      if (!data?.id || data.id === TAB_ID) return;
      seen.set(data.id, Date.now());
      if (data.type === "hello") ch.postMessage({ type: "here", id: TAB_ID });
      publish();
    };
    ch.postMessage({ type: "hello", id: TAB_ID });
    const i = setInterval(() => {
      ch.postMessage({ type: "here", id: TAB_ID });
      publish();
    }, 3000);
    return () => {
      clearInterval(i);
      ch.close();
    };
  }, []);

  const resetVault = useCallback(async () => {
    await vaultClear();
    const fresh = emptyWorkspace();
    wsRef.current = fresh;
    setWs(fresh);
    setLastSavedAt(null);
  }, []);

  const importWorkspace = useCallback((incoming: Workspace) => {
    const merged = { ...emptyWorkspace(), ...incoming };
    wsRef.current = merged;
    setWs(merged);
    setDirty(true);
  }, []);

  const value = useMemo(
    () => ({
      ws,
      loaded,
      dirty,
      lastSavedAt,
      lastLoadedAt,
      loadError,
      reload: load,
      update,
      saveNow,
      resetVault,
      importWorkspace,
      saveState,
      saveError,
      saveMetrics,
      pendingChanges,
      queueLength,
      tabId: TAB_ID,
      otherTabs,
      confirmSaved,
    }),
    [
      ws,
      loaded,
      dirty,
      lastSavedAt,
      lastLoadedAt,
      loadError,
      load,
      update,
      saveNow,
      resetVault,
      importWorkspace,
      saveState,
      saveError,
      saveMetrics,
      pendingChanges,
      queueLength,
      otherTabs,
      confirmSaved,
    ],
  );

  return (
    <VpipContext.Provider value={value}>
      {loaded ? (
        children
      ) : (
        <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
          Loading project data…
        </div>
      )}
    </VpipContext.Provider>
  );
}

export function useVpip() {
  const ctx = useContext(VpipContext);
  if (!ctx) throw new Error("useVpip must be used inside VpipProvider");
  return ctx;
}

/* ---------------------------------------------------------------- actions */

export function useVpipActions() {
  const { ws, update, confirmSaved } = useVpip();

  const touchProject = (w: Workspace, projectId: string): Workspace => ({
    ...w,
    projects: w.projects.map((p) =>
      p.id === projectId ? { ...p, updatedAt: now() } : p,
    ),
  });

  return useMemo(
    () => ({
      /* projects */
      createProject(name: string, description: string): Project {
        const project: Project = {
          id: uid(),
          name,
          description,
          archived: false,
          createdAt: now(),
          updatedAt: now(),
        };
        confirmSaved("Project");
        update((w) => ({ ...w, projects: [project, ...w.projects] }));
        return project;
      },
      updateProject(id: string, patch: Partial<Project>) {
        update((w) => ({
          ...w,
          projects: w.projects.map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: now() } : p,
          ),
        }));
      },
      deleteProject(id: string) {
        update((w) => ({
          ...w,
          projects: w.projects.filter((p) => p.id !== id),
          discussions: w.discussions.filter((d) => d.projectId !== id),
          knowledge: w.knowledge.filter((k) => k.projectId !== id),
          documents: w.documents.filter((d) => d.projectId !== id),
          prompts: w.prompts.filter((p) => p.projectId !== id),
          snapshots: w.snapshots.filter((s) => s.projectId !== id),
          buildSessions: (w.buildSessions ?? []).filter((b) => b.projectId !== id),
          repositories: (w.repositories ?? []).filter((r) => r.projectId !== id),
          repoBranches: (w.repoBranches ?? []).filter((b) =>
            (w.repositories ?? []).some((r) => r.id === b.repositoryId && r.projectId !== id),
          ),
          repoCommits: (w.repoCommits ?? []).filter((c) => c.projectId !== id),
          artifacts: (w.artifacts ?? []).filter((a) => a.projectId !== id),
          buildRecords: (w.buildRecords ?? []).filter((r) => r.projectId !== id),
          changeRecords: (w.changeRecords ?? []).filter((c) => c.projectId !== id),
          promptPhases: (w.promptPhases ?? []).filter((x) => x.projectId !== id),
          phaseRuns: (w.phaseRuns ?? []).filter((x) => x.projectId !== id),
          contextPackages: (w.contextPackages ?? []).filter((x) => x.projectId !== id),
          outcomes: (w.outcomes ?? []).filter((x) => x.projectId !== id),
          failures: (w.failures ?? []).filter((x) => x.projectId !== id),
          activity: (w.activity ?? []).filter((x) => x.projectId !== id),
          intelligence: (w.intelligence ?? []).filter((x) => x.projectId !== id),
          repoReports: (w.repoReports ?? []).filter((x) => x.projectId !== id),
          repoEnv: (w.repoEnv ?? []).filter((x) => x.projectId !== id),
        }));
      },

      /* discussions */
      createDiscussion(d: Omit<Discussion, "id" | "createdAt" | "updatedAt" | "messages" | "attachments">): Discussion {
        const discussion: Discussion = {
          ...d,
          id: uid(),
          createdAt: now(),
          updatedAt: now(),
          messages: [],
          attachments: [],
        };
        confirmSaved("Discussion");
        update((w) => touchProject({ ...w, discussions: [discussion, ...w.discussions] }, d.projectId));
        return discussion;
      },
      updateDiscussion(id: string, patch: Partial<Discussion>) {
        update((w) => ({
          ...w,
          discussions: w.discussions.map((d) =>
            d.id === id ? { ...d, ...patch, updatedAt: now() } : d,
          ),
        }));
      },
      deleteDiscussion(id: string) {
        update((w) => ({ ...w, discussions: w.discussions.filter((d) => d.id !== id) }));
      },
      appendMessage(discussionId: string, msg: Omit<Message, "id" | "seq" | "createdAt">): Message {
        const existing = ws.discussions.find((d) => d.id === discussionId);
        const seq = (existing?.messages.at(-1)?.seq ?? 0) + 1;
        const message: Message = { ...msg, id: uid(), seq, createdAt: now() };
        update((w) => ({
          ...w,
          discussions: w.discussions.map((d) =>
            d.id === discussionId
              ? { ...d, messages: [...d.messages, message], updatedAt: now() }
              : d,
          ),
        }));
        return message;
      },
      patchMessage(discussionId: string, messageId: string, content: string) {
        update((w) => ({
          ...w,
          discussions: w.discussions.map((d) =>
            d.id === discussionId
              ? {
                  ...d,
                  updatedAt: now(),
                  messages: d.messages.map((m) =>
                    m.id === messageId ? { ...m, content } : m,
                  ),
                }
              : d,
          ),
        }));
      },

      /* knowledge */
      addKnowledge(
        items: Array<
          Omit<KnowledgeItem, "id" | "code" | "createdAt" | "updatedAt" | "revisions">
        >,
      ) {
        for (const item of items) confirmSaved(item.type);
        update((w) => {
          const created: KnowledgeItem[] = [];
          for (const item of items) {
            const code = nextCode(
              [...w.knowledge, ...created],
              item.projectId,
              item.type,
            );
            created.push({
              ...item,
              id: uid(),
              code,
              createdAt: now(),
              updatedAt: now(),
              revisions: [{ at: now(), note: "Created", author: item.author }],
            });
          }
          return { ...w, knowledge: [...created, ...w.knowledge] };
        });
      },
      updateKnowledge(id: string, patch: Partial<KnowledgeItem>, note: string) {
        update((w) => ({
          ...w,
          knowledge: w.knowledge.map((k) =>
            k.id === id
              ? {
                  ...k,
                  ...patch,
                  updatedAt: now(),
                  version: (k.version ?? 1) + 1,
                  reasonForChange: note,
                  revisions: [
                    ...k.revisions,
                    { at: now(), note, author: w.settings.author },
                  ],
                }
              : k,
          ),
        }));
      },
      mergeKnowledge(ids: string[], note: string) {
        update((w) => {
          const items = w.knowledge.filter((k) => ids.includes(k.id));
          if (items.length < 2) return w;
          const [primary, ...rest] = items as [KnowledgeItem, ...KnowledgeItem[]];
          const merged: KnowledgeItem = {
            ...primary,
            description: items.map((i) => i.description).join("\n\n"),
            sourceMessages: [...new Set(items.flatMap((i) => i.sourceMessages))],
            mergedFrom: [...(primary.mergedFrom ?? []), ...rest.map((r) => r.code)],
            updatedAt: now(),
            revisions: [
              ...primary.revisions,
              { at: now(), note, author: w.settings.author },
            ],
          };
          return {
            ...w,
            knowledge: w.knowledge
              .filter((k) => !rest.some((r) => r.id === k.id))
              .map((k) => (k.id === primary.id ? merged : k)),
          };
        });
      },
      deleteKnowledge(id: string) {
        update((w) => ({ ...w, knowledge: w.knowledge.filter((k) => k.id !== id) }));
      },

      /* documents / prompts / snapshots */
      addDocument(doc: Omit<GeneratedDocument, "id" | "createdAt">): GeneratedDocument {
        const full: GeneratedDocument = { ...doc, id: uid(), createdAt: now() };
        const snap: Snapshot = {
          id: uid(),
          projectId: doc.projectId,
          kind: `Document · ${doc.kind}`,
          title: doc.title,
          refId: full.id,
          markdown: doc.markdown,
          createdAt: now(),
        };
        confirmSaved("Document");
        update((w) =>
          touchProject(
            { ...w, documents: [full, ...w.documents], snapshots: [snap, ...w.snapshots] },
            doc.projectId,
          ),
        );
        return full;
      },
      deleteDocument(id: string) {
        update((w) => ({ ...w, documents: w.documents.filter((d) => d.id !== id) }));
      },
      addPrompt(p: Omit<GeneratedPrompt, "id" | "createdAt" | "version">): GeneratedPrompt {
        const version =
          ws.prompts.filter((x) => x.projectId === p.projectId && x.kind === p.kind).length + 1;
        const full: GeneratedPrompt = {
          status: "Draft",
          linkedDecisionIds: [],
          linkedRequirementIds: [],
          linkedDocumentIds: [],
          linkedDiscussionIds: [],
          ...p,
          id: uid(),
          version,
          createdAt: now(),
        };
        const snap: Snapshot = {
          id: uid(),
          projectId: p.projectId,
          kind: `Prompt · ${p.kind}`,
          title: `${p.title} V${version}`,
          refId: full.id,
          markdown: p.markdown,
          createdAt: now(),
        };
        update((w) =>
          touchProject(
            { ...w, prompts: [full, ...w.prompts], snapshots: [snap, ...w.snapshots] },
            p.projectId,
          ),
        );
        return full;
      },
      deletePrompt(id: string) {
        update((w) => ({
          ...w,
          prompts: w.prompts.filter((p) => p.id !== id),
          buildSessions: (w.buildSessions ?? []).filter((b) => b.promptId !== id),
        }));
      },
      updatePrompt(id: string, patch: Partial<GeneratedPrompt>) {
        update((w) => ({
          ...w,
          prompts: w.prompts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        }));
      },

      /* build sessions — Module 11A handoff */
      createBuildSession(
        s: Omit<BuildSession, "id" | "code" | "createdAt" | "updatedAt">,
      ): BuildSession {
        const existing = (ws.buildSessions ?? []).filter((b) => b.projectId === s.projectId);
        const maxNum = existing.reduce((m, b) => {
          const n = Number(b.code.split("-")[1] ?? 0);
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const session: BuildSession = {
          ...s,
          id: uid(),
          code: `BUILD-${String(maxNum + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        confirmSaved("Build session");
        update((w) =>
          touchProject(
            { ...w, buildSessions: [session, ...(w.buildSessions ?? [])] },
            s.projectId,
          ),
        );
        return session;
      },
      appendCoderTurn(
        buildId: string,
        turn: Omit<CoderTurn, "id" | "seq" | "createdAt">,
      ): CoderTurn {
        const session = (ws.buildSessions ?? []).find((b) => b.id === buildId);
        const seq = (session?.turns?.at(-1)?.seq ?? 0) + 1;
        const full: CoderTurn = { ...turn, id: uid(), seq, createdAt: now() };
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? { ...b, turns: [...(b.turns ?? []), full], updatedAt: now() }
              : b,
          ),
        }));
        return full;
      },
      patchCoderTurn(buildId: string, turnId: string, content: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  turns: (b.turns ?? []).map((t) =>
                    t.id === turnId ? { ...t, content } : t,
                  ),
                }
              : b,
          ),
        }));
      },
      markBuildOpened(buildId: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId ? { ...b, openedAt: now() } : b,
          ),
        }));
      },
      updateBuildSession(id: string, patch: Partial<BuildSession>) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === id ? { ...b, ...patch, updatedAt: now() } : b,
          ),
        }));
      },
      /* ------------------------ Module 16 — build orchestration */
      patchBuildRequirement(
        buildId: string,
        requirementId: string,
        patch: Partial<import("./types").BuildRequirement>,
      ) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  requirements: (b.requirements ?? []).map((r) =>
                    r.id === requirementId ? { ...r, ...patch, updatedAt: now() } : r,
                  ),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      deleteBuildSession(id: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).filter((b) => b.id !== id),
        }));
      },
      /* ------------------------------ Module 12 — AI Coder workspace */
      writeCoderFile(
        buildId: string,
        path: string,
        content: string,
        meta: {
          note: string;
          trace: CoderTrace;
          provider?: import("./types").ProviderId;
          model?: string;
        },
      ) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) => {
            if (b.id !== buildId) return b;
            const files = b.files ?? [];
            const existing = files.find((f) => f.path === path);
            const version = {
              id: uid(),
              seq: (existing?.versions.at(-1)?.seq ?? 0) + 1,
              content,
              note: meta.note,
              provider: meta.provider,
              model: meta.model,
              createdAt: now(),
              trace: meta.trace,
            };
            const next: CoderFile = existing
              ? { ...existing, content, updatedAt: now(), versions: [...existing.versions, version] }
              : {
                  id: uid(),
                  path,
                  content,
                  createdAt: now(),
                  updatedAt: now(),
                  versions: [version],
                };
            return {
              ...b,
              files: existing ? files.map((f) => (f.path === path ? next : f)) : [...files, next],
              previewEntryPath: b.previewEntryPath ?? (path.endsWith(".html") ? path : undefined),
              updatedAt: now(),
            };
          }),
        }));
      },
      renameCoderPath(buildId: string, fromPath: string, toPath: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  files: (b.files ?? []).map((f) =>
                    f.path === fromPath || f.path.startsWith(`${fromPath}/`)
                      ? { ...f, path: toPath + f.path.slice(fromPath.length), updatedAt: now() }
                      : f,
                  ),
                  previewEntryPath:
                    b.previewEntryPath === fromPath ? toPath : b.previewEntryPath,
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      deleteCoderPath(buildId: string, path: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  files: (b.files ?? []).filter(
                    (f) => f.path !== path && !f.path.startsWith(`${path}/`),
                  ),
                  previewEntryPath:
                    b.previewEntryPath && b.previewEntryPath.startsWith(path)
                      ? undefined
                      : b.previewEntryPath,
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      restoreCoderVersion(buildId: string, path: string, versionId: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) => {
            if (b.id !== buildId) return b;
            return {
              ...b,
              files: (b.files ?? []).map((f) => {
                if (f.path !== path) return f;
                const v = f.versions.find((x) => x.id === versionId);
                if (!v) return f;
                return {
                  ...f,
                  content: v.content,
                  updatedAt: now(),
                  versions: [
                    ...f.versions,
                    {
                      ...v,
                      id: uid(),
                      seq: (f.versions.at(-1)?.seq ?? 0) + 1,
                      note: `Restored V${v.seq}`,
                      createdAt: now(),
                    },
                  ],
                };
              }),
              updatedAt: now(),
            };
          }),
        }));
      },
      logCoderAction(
        buildId: string,
        action: Omit<CoderAction, "id" | "seq" | "createdAt">,
      ): CoderAction {
        const session = (ws.buildSessions ?? []).find((b) => b.id === buildId);
        const full: CoderAction = {
          ...action,
          id: uid(),
          seq: (session?.actions?.at(-1)?.seq ?? 0) + 1,
          createdAt: now(),
        };
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? { ...b, actions: [...(b.actions ?? []), full], updatedAt: now() }
              : b,
          ),
        }));
        return full;
      },
      appendLog(buildId: string, entry: Omit<TerminalEntry, "id" | "createdAt">) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  terminal: [
                    ...(b.terminal ?? []),
                    { ...entry, id: uid(), createdAt: now() },
                  ].slice(-400),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      clearLogs(buildId: string, stream: TerminalEntry["stream"]) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? { ...b, terminal: (b.terminal ?? []).filter((t) => t.stream !== stream) }
              : b,
          ),
        }));
      },
      addDbConnection(buildId: string, conn: Omit<DbConnection, "id" | "createdAt">) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  dbConnections: [
                    ...(b.dbConnections ?? []),
                    { ...conn, id: uid(), createdAt: now() },
                  ],
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      removeDbConnection(buildId: string, connId: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  dbConnections: (b.dbConnections ?? []).filter((c) => c.id !== connId),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      setPreviewEntry(buildId: string, path: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId ? { ...b, previewEntryPath: path } : b,
          ),
        }));
      },
      /* --------------------------- Module 14 — AI Development Agent */
      createAgentTask(
        buildId: string,
        task: Omit<AgentTask, "id" | "code" | "createdAt" | "updatedAt" | "changes">,
      ): AgentTask {
        const session = (ws.buildSessions ?? []).find((b) => b.id === buildId);
        const seq = (session?.agentTasks?.length ?? 0) + 1;
        const full: AgentTask = {
          ...task,
          id: uid(),
          code: `TASK-${String(seq).padStart(3, "0")}`,
          changes: [],
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? { ...b, agentTasks: [...(b.agentTasks ?? []), full], updatedAt: now() }
              : b,
          ),
        }));
        return full;
      },
      updateAgentTask(buildId: string, taskId: string, patch: Partial<AgentTask>) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  agentTasks: (b.agentTasks ?? []).map((t) =>
                    t.id === taskId ? { ...t, ...patch, updatedAt: now() } : t,
                  ),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      /** No execution before approval — this is the only gate that opens it. */
      approveAgentTask(buildId: string, taskId: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  agentTasks: (b.agentTasks ?? []).map((t) =>
                    t.id === taskId
                      ? { ...t, approvedAt: now(), status: "Running", updatedAt: now() }
                      : t,
                  ),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      recordAgentChange(
        buildId: string,
        taskId: string,
        change: Omit<AgentChange, "id" | "createdAt" | "taskId">,
      ) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? {
                  ...b,
                  agentTasks: (b.agentTasks ?? []).map((t) =>
                    t.id === taskId
                      ? {
                          ...t,
                          changes: [
                            ...t.changes,
                            { ...change, taskId, id: uid(), createdAt: now() },
                          ],
                          updatedAt: now(),
                        }
                      : t,
                  ),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
      },
      deleteAgentTask(buildId: string, taskId: string) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId
              ? { ...b, agentTasks: (b.agentTasks ?? []).filter((t) => t.id !== taskId) }
              : b,
          ),
        }));
      },
      /* ------------------------------ Module 13 — Repository Management */
      addRepository(
        repo: Omit<Repository, "id" | "createdAt" | "updatedAt">,
      ): Repository {
        const full: Repository = { ...repo, id: uid(), createdAt: now(), updatedAt: now() };
        update((w) =>
          touchProject(
            { ...w, repositories: [full, ...(w.repositories ?? [])] },
            repo.projectId,
          ),
        );
        return full;
      },
      updateRepository(id: string, patch: Partial<Repository>) {
        update((w) => ({
          ...w,
          repositories: (w.repositories ?? []).map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: now() } : r,
          ),
        }));
      },
      /** Saves a compatibility report, replacing earlier ones for the same repository and branch. */
      saveRepoReport(report: Omit<RepoReport, "id" | "createdAt">): RepoReport {
        const full: RepoReport = { ...report, id: uid(), createdAt: now() };
        update((w) => ({
          ...w,
          repoReports: [
            full,
            ...(w.repoReports ?? []).filter(
              (x) => !(x.projectId === report.projectId && x.repositoryId === report.repositoryId && x.branch === report.branch),
            ),
          ],
          repositories: (w.repositories ?? []).map((r) =>
            r.id === report.repositoryId ? { ...r, classification: report.classification, updatedAt: now() } : r,
          ),
        }));
        return full;
      },
      updateRepoReport(id: string, patch: Partial<RepoReport>) {
        update((w) => ({
          ...w,
          repoReports: (w.repoReports ?? []).map((x) => (x.id === id ? { ...x, ...patch } : x)),
        }));
      },
      setRepoEnv(projectId: string, repositoryId: string, key: string, value: string) {
        update((w) => {
          const list = w.repoEnv ?? [];
          const hit = list.find((x) => x.repositoryId === repositoryId && x.key === key);
          const next = hit
            ? list.map((x) => (x === hit ? { ...x, value, updatedAt: now() } : x))
            : [...list, { id: uid(), projectId, repositoryId, key, value, updatedAt: now() }];
          return { ...w, repoEnv: next };
        });
      },
      /** Disconnect — drops the stored credentials and the project link. */
      removeRepository(id: string) {
        update((w) => ({
          ...w,
          repositories: (w.repositories ?? []).filter((r) => r.id !== id),
          repoBranches: (w.repoBranches ?? []).filter((b) => b.repositoryId !== id),
          repoCommits: (w.repoCommits ?? []).filter((c) => c.repositoryId !== id),
          repoReports: (w.repoReports ?? []).filter((x) => x.repositoryId !== id),
          repoEnv: (w.repoEnv ?? []).filter((x) => x.repositoryId !== id),
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.repositoryId === id
              ? {
                  ...b,
                  repositoryId: undefined,
                  repositoryFullName: undefined,
                  repositoryProvider: undefined,
                  repositoryBranch: undefined,
                }
              : b,
          ),
        }));
      },
      /** Replace the known branch list for a repository (fetch / refresh). */
      syncRepoBranches(
        repositoryId: string,
        branches: Array<{ name: string; sha: string }>,
      ) {
        update((w) => {
          const existing = (w.repoBranches ?? []).filter((b) => b.repositoryId === repositoryId);
          const next: RepoBranch[] = branches.map((b) => {
            const prior = existing.find((x) => x.name === b.name);
            return {
              id: prior?.id ?? uid(),
              repositoryId,
              name: b.name,
              sha: b.sha,
              baseBranch: prior?.baseBranch,
              createdAt: prior?.createdAt ?? now(),
            };
          });
          return {
            ...w,
            repoBranches: [
              ...(w.repoBranches ?? []).filter((b) => b.repositoryId !== repositoryId),
              ...next,
            ],
          };
        });
      },
      addRepoBranch(branch: Omit<RepoBranch, "id" | "createdAt">) {
        update((w) => ({
          ...w,
          repoBranches: [
            ...(w.repoBranches ?? []),
            { ...branch, id: uid(), createdAt: now() },
          ],
        }));
      },
      /** V-10 — repository intelligence: name a commit as a release. */
      updateRepoCommit(id: string, patch: Partial<RepoCommit>) {
        update((w) => ({
          ...w,
          repoCommits: (w.repoCommits ?? []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }));
      },
      addRepoCommit(commit: Omit<RepoCommit, "id" | "createdAt">): RepoCommit {
        const full: RepoCommit = { ...commit, id: uid(), createdAt: now() };
        update((w) => ({
          ...w,
          repoCommits: [full, ...(w.repoCommits ?? [])],
          repositories: (w.repositories ?? []).map((r) =>
            r.id === commit.repositoryId
              ? {
                  ...r,
                  lastCommitSha: commit.sha,
                  lastCommitMessage: commit.message,
                  lastCommitAt: now(),
                  currentBranch: commit.branch,
                  updatedAt: now(),
                }
              : r,
          ),
          buildSessions: (w.buildSessions ?? []).map((b) =>
            commit.buildSessionId && b.id === commit.buildSessionId
              ? {
                  ...b,
                  repositoryId: commit.repositoryId,
                  repositoryProvider: commit.provider,
                  repositoryBranch: commit.branch,
                  lastCommitSha: commit.sha,
                  lastCommitAt: now(),
                  updatedAt: now(),
                }
              : b,
          ),
        }));
        return full;
      },
      /** Build Session integration — record repository, branch and provider. */
      linkBuildRepository(
        buildId: string,
        link: {
          repositoryId: string;
          repositoryFullName: string;
          repositoryProvider: RepoProvider;
          repositoryBranch: string;
        },
      ) {
        update((w) => ({
          ...w,
          buildSessions: (w.buildSessions ?? []).map((b) =>
            b.id === buildId ? { ...b, ...link, updatedAt: now() } : b,
          ),
        }));
      },
      /* ------------------- Module 15 — Artifact and Build Management */
      addArtifact(a: Omit<Artifact, "id" | "code" | "createdAt" | "updatedAt">): Artifact {
        const used = (ws.artifacts ?? []).filter((x) => x.projectId === a.projectId).reduce(
          (m, x) => {
            const n = Number(x.code.split("-")[1] ?? 0);
            return Number.isFinite(n) && n > m ? n : m;
          },
          0,
        );
        const full: Artifact = {
          ...a,
          id: uid(),
          code: `ART-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, artifacts: [full, ...(w.artifacts ?? [])] }));
        return full;
      },
      updateArtifact(id: string, patch: Partial<Artifact>) {
        update((w) => ({
          ...w,
          artifacts: (w.artifacts ?? []).map((a) =>
            a.id === id ? { ...a, ...patch, updatedAt: now() } : a,
          ),
        }));
      },
      deleteArtifact(id: string) {
        update((w) => ({
          ...w,
          artifacts: (w.artifacts ?? []).filter((a) => a.id !== id),
          buildRecords: (w.buildRecords ?? []).map((r) =>
            r.artifactIds.includes(id)
              ? { ...r, artifactIds: r.artifactIds.filter((x) => x !== id) }
              : r,
          ),
        }));
      },
      startBuildRecord(
        r: Omit<BuildRecord, "id" | "code" | "createdAt" | "updatedAt">,
      ): BuildRecord {
        const used = (ws.buildRecords ?? [])
          .filter((x) => x.projectId === r.projectId)
          .reduce((m, x) => {
            const n = Number(x.code.split("-")[1] ?? 0);
            return Number.isFinite(n) && n > m ? n : m;
          }, 0);
        const full: BuildRecord = {
          ...r,
          id: uid(),
          code: `RUN-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, buildRecords: [full, ...(w.buildRecords ?? [])] }));
        return full;
      },
      updateBuildRecord(id: string, patch: Partial<BuildRecord>) {
        update((w) => ({
          ...w,
          buildRecords: (w.buildRecords ?? []).map((r) =>
            r.id === id ? { ...r, ...patch, updatedAt: now() } : r,
          ),
        }));
      },
      appendBuildRecordLog(id: string, line: string) {
        update((w) => ({
          ...w,
          buildRecords: (w.buildRecords ?? []).map((r) =>
            r.id === id
              ? { ...r, logs: [...r.logs, line].slice(-400), updatedAt: now() }
              : r,
          ),
        }));
      },
      attachArtifactsToBuildRecord(id: string, artifactIds: string[]) {
        update((w) => ({
          ...w,
          buildRecords: (w.buildRecords ?? []).map((r) =>
            r.id === id
              ? {
                  ...r,
                  artifactIds: [...new Set([...r.artifactIds, ...artifactIds])],
                  updatedAt: now(),
                }
              : r,
          ),
        }));
      },
      deleteBuildRecord(id: string) {
        update((w) => ({
          ...w,
          buildRecords: (w.buildRecords ?? []).filter((r) => r.id !== id),
        }));
      },
      /**
       * One capture run: opens a build record, stores every output as an
       * artifact (updating an existing one at the same path), writes the
       * change history and closes the record.
       */
      captureBuild(input: {
        record: Omit<BuildRecord, "id" | "code" | "createdAt" | "updatedAt">;
        items: Array<Omit<Artifact, "id" | "code" | "createdAt" | "updatedAt">>;
        summary: string;
        output: string;
      }) {
        update((w) => {
          const projectId = input.record.projectId;
          const artifacts = w.artifacts ?? [];
          const runSeq =
            (w.buildRecords ?? [])
              .filter((r) => r.projectId === projectId)
              .reduce((m, r) => {
                const n = Number(r.code.split("-")[1] ?? 0);
                return Number.isFinite(n) && n > m ? n : m;
              }, 0) + 1;
          const runCode = `RUN-${String(runSeq).padStart(3, "0")}`;
          const recordId = uid();

          let artSeq = artifacts
            .filter((a) => a.projectId === projectId)
            .reduce((m, a) => {
              const n = Number(a.code.split("-")[1] ?? 0);
              return Number.isFinite(n) && n > m ? n : m;
            }, 0);

          const nextArtifacts = [...artifacts];
          const changes: ChangeRecord[] = [];
          const ids: string[] = [];

          for (const item of input.items) {
            const idx = nextArtifacts.findIndex(
              (a) =>
                a.projectId === projectId &&
                a.path === item.path &&
                a.buildSessionId === item.buildSessionId,
            );
            if (idx >= 0) {
              const prior = nextArtifacts[idx]!;
              const updated: Artifact = {
                ...prior,
                ...item,
                buildRecordId: recordId,
                buildRunCode: runCode,
                id: prior.id,
                code: prior.code,
                createdAt: prior.createdAt,
                updatedAt: now(),
              };
              nextArtifacts[idx] = updated;
              ids.push(prior.id);
              if (prior.content !== item.content) {
                changes.push({
                  id: uid(),
                  projectId,
                  action: "Modified",
                  path: item.path,
                  buildSessionId: item.buildSessionId,
                  buildCode: item.buildCode,
                  buildRecordId: recordId,
                  buildRunCode: runCode,
                  taskId: item.taskId,
                  taskCode: item.taskCode,
                  promptId: item.promptId,
                  provider: item.provider,
                  model: item.model,
                  createdAt: now(),
                });
              }
            } else {
              artSeq += 1;
              const created: Artifact = {
                ...item,
                buildRecordId: recordId,
                buildRunCode: runCode,
                id: uid(),
                code: `ART-${String(artSeq).padStart(3, "0")}`,
                createdAt: now(),
                updatedAt: now(),
              };
              nextArtifacts.unshift(created);
              ids.push(created.id);
              changes.push({
                id: uid(),
                projectId,
                action: "Created",
                path: item.path,
                buildSessionId: item.buildSessionId,
                buildCode: item.buildCode,
                buildRecordId: recordId,
                buildRunCode: runCode,
                taskId: item.taskId,
                taskCode: item.taskCode,
                promptId: item.promptId,
                provider: item.provider,
                model: item.model,
                createdAt: now(),
              });
            }
          }

          // Outputs previously captured for this session that are gone now.
          const livePaths = new Set(input.items.map((i) => i.path));
          for (const prior of artifacts) {
            if (
              prior.projectId === projectId &&
              prior.buildSessionId === input.record.buildSessionId &&
              !livePaths.has(prior.path) &&
              !changes.some((c) => c.path === prior.path && c.action === "Deleted")
            ) {
              changes.push({
                id: uid(),
                projectId,
                action: "Deleted",
                path: prior.path,
                buildSessionId: prior.buildSessionId,
                buildCode: prior.buildCode,
                buildRecordId: recordId,
                buildRunCode: runCode,
                promptId: prior.promptId,
                createdAt: now(),
              });
            }
          }

          const record: BuildRecord = {
            ...input.record,
            id: recordId,
            code: runCode,
            status: "Completed",
            endedAt: now(),
            summary: input.summary,
            output: input.output,
            artifactIds: ids,
            logs: [
              ...input.record.logs,
              `${runCode} captured ${ids.length} artifacts`,
              `${changes.length} change records written`,
            ],
            createdAt: now(),
            updatedAt: now(),
          };

          return {
            ...w,
            artifacts: nextArtifacts,
            buildRecords: [record, ...(w.buildRecords ?? [])],
            changeRecords: [...changes, ...(w.changeRecords ?? [])],
          };
        });
      },
      recordChange(c: Omit<ChangeRecord, "id" | "createdAt">): ChangeRecord {
        const full: ChangeRecord = { ...c, id: uid(), createdAt: now() };
        update((w) => ({ ...w, changeRecords: [full, ...(w.changeRecords ?? [])] }));
        return full;
      },
      addSnapshot(s: Omit<Snapshot, "id" | "createdAt">) {
        update((w) => ({
          ...w,
          snapshots: [{ ...s, id: uid(), createdAt: now() }, ...w.snapshots],
        }));
      },

      /* ==================== V-03 — phased prompt execution */
      setPromptPhases(
        projectId: string,
        promptId: string,
        phases: Array<{ phaseNo: number; title: string; markdown: string }>,
      ): PromptPhase[] {
        const created: PromptPhase[] = phases.map((p) => ({
          id: uid(),
          projectId,
          promptId,
          phaseNo: p.phaseNo,
          title: p.title,
          markdown: p.markdown,
          status: "Pending",
          createdAt: now(),
          updatedAt: now(),
        }));
        update((w) => ({
          ...w,
          promptPhases: [
            ...(w.promptPhases ?? []).filter((x) => x.promptId !== promptId),
            ...created,
          ],
        }));
        return created;
      },
      updatePromptPhase(id: string, patch: Partial<PromptPhase>) {
        update((w) => ({
          ...w,
          promptPhases: (w.promptPhases ?? []).map((p) =>
            p.id === id ? { ...p, ...patch, updatedAt: now() } : p,
          ),
        }));
      },
      deletePromptPhases(promptId: string) {
        update((w) => ({
          ...w,
          promptPhases: (w.promptPhases ?? []).filter((p) => p.promptId !== promptId),
          phaseRuns: (w.phaseRuns ?? []).filter((r) => r.promptId !== promptId),
        }));
      },
      startPhaseRun(phase: PromptPhase, provider?: PhaseRun["provider"], model?: string): PhaseRun {
        const attempt =
          (ws.phaseRuns ?? []).filter((r) => r.phaseId === phase.id).length + 1;
        const run: PhaseRun = {
          id: uid(),
          projectId: phase.projectId,
          phaseId: phase.id,
          promptId: phase.promptId,
          attempt,
          status: "Running",
          provider,
          model,
          startedAt: now(),
          createdAt: now(),
        };
        update((w) => ({
          ...w,
          phaseRuns: [run, ...(w.phaseRuns ?? [])],
          promptPhases: (w.promptPhases ?? []).map((p) =>
            p.id === phase.id
              ? { ...p, status: "Running", startedAt: now(), provider, model, updatedAt: now() }
              : p,
          ),
        }));
        return run;
      },
      finishPhaseRun(
        runId: string,
        phaseId: string,
        result: { status: PhaseRun["status"]; output?: string; error?: string },
      ) {
        update((w) => ({
          ...w,
          phaseRuns: (w.phaseRuns ?? []).map((r) =>
            r.id === runId
              ? {
                  ...r,
                  status: result.status,
                  endedAt: now(),
                  output: result.output,
                  error: result.error,
                }
              : r,
          ),
          promptPhases: (w.promptPhases ?? []).map((p) =>
            p.id === phaseId
              ? {
                  ...p,
                  status: result.status,
                  endedAt: now(),
                  output: result.output,
                  error: result.error,
                  updatedAt: now(),
                }
              : p,
          ),
        }));
      },

      /* ==================== V-05 — context packages */
      addContextPackage(
        c: Omit<ContextPackageRecord, "id" | "code" | "createdAt" | "updatedAt">,
      ): ContextPackageRecord {
        const used = (ws.contextPackages ?? [])
          .filter((x) => x.projectId === c.projectId)
          .reduce((m, x) => {
            const n = Number(x.code.split("-")[1] ?? 0);
            return Number.isFinite(n) && n > m ? n : m;
          }, 0);
        const full: ContextPackageRecord = {
          ...c,
          id: uid(),
          code: `CTX-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, contextPackages: [full, ...(w.contextPackages ?? [])] }));
        return full;
      },
      deleteContextPackage(id: string) {
        update((w) => ({
          ...w,
          contextPackages: (w.contextPackages ?? []).filter((c) => c.id !== id),
        }));
      },

      /* ==================== V-06 — outcome learning */
      addOutcome(o: Omit<OutcomeRecord, "id" | "code" | "createdAt" | "updatedAt">): OutcomeRecord {
        const used = (ws.outcomes ?? [])
          .filter((x) => x.projectId === o.projectId)
          .reduce((m, x) => {
            const n = Number(x.code.split("-")[1] ?? 0);
            return Number.isFinite(n) && n > m ? n : m;
          }, 0);
        const full: OutcomeRecord = {
          ...o,
          id: uid(),
          code: `OUT-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, outcomes: [full, ...(w.outcomes ?? [])] }));
        return full;
      },
      updateOutcome(id: string, patch: Partial<OutcomeRecord>) {
        update((w) => ({
          ...w,
          outcomes: (w.outcomes ?? []).map((o) =>
            o.id === id ? { ...o, ...patch, updatedAt: now() } : o,
          ),
        }));
      },
      deleteOutcome(id: string) {
        update((w) => ({ ...w, outcomes: (w.outcomes ?? []).filter((o) => o.id !== id) }));
      },

      /* ==================== V-07 — failure analysis */
      addFailure(f: Omit<FailureRecord, "id" | "code" | "createdAt" | "updatedAt">): FailureRecord {
        const used = (ws.failures ?? [])
          .filter((x) => x.projectId === f.projectId)
          .reduce((m, x) => {
            const n = Number(x.code.split("-")[1] ?? 0);
            return Number.isFinite(n) && n > m ? n : m;
          }, 0);
        const full: FailureRecord = {
          ...f,
          id: uid(),
          code: `FAIL-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, failures: [full, ...(w.failures ?? [])] }));
        return full;
      },
      updateFailure(id: string, patch: Partial<FailureRecord>) {
        update((w) => ({
          ...w,
          failures: (w.failures ?? []).map((f) =>
            f.id === id ? { ...f, ...patch, updatedAt: now() } : f,
          ),
        }));
      },
      deleteFailure(id: string) {
        update((w) => ({ ...w, failures: (w.failures ?? []).filter((f) => f.id !== id) }));
      },

      /* ==================== V-11 — multi-AI collaboration ledger */
      logActivity(a: Omit<ActivityRecord, "id" | "createdAt">): ActivityRecord {
        const full: ActivityRecord = { ...a, id: uid(), createdAt: now() };
        update((w) => ({ ...w, activity: [full, ...(w.activity ?? [])].slice(0, 2000) }));
        return full;
      },

      /* ==================== V-15 — organizational knowledge */
      addIntelligence(
        i: Omit<IntelligenceRecord, "id" | "code" | "createdAt" | "updatedAt">,
      ): IntelligenceRecord {
        const used = (ws.intelligence ?? []).reduce((m, x) => {
          const n = Number(x.code.split("-")[1] ?? 0);
          return Number.isFinite(n) && n > m ? n : m;
        }, 0);
        const full: IntelligenceRecord = {
          ...i,
          id: uid(),
          code: `PAT-${String(used + 1).padStart(3, "0")}`,
          createdAt: now(),
          updatedAt: now(),
        };
        update((w) => ({ ...w, intelligence: [full, ...(w.intelligence ?? [])] }));
        return full;
      },
      updateIntelligence(id: string, patch: Partial<IntelligenceRecord>) {
        update((w) => ({
          ...w,
          intelligence: (w.intelligence ?? []).map((x) =>
            x.id === id ? { ...x, ...patch, updatedAt: now() } : x,
          ),
        }));
      },
      deleteIntelligence(id: string) {
        update((w) => ({
          ...w,
          intelligence: (w.intelligence ?? []).filter((x) => x.id !== id),
        }));
      },

      /* settings */
      setSettings(patch: Partial<Settings>) {
        update((w) => ({ ...w, settings: { ...w.settings, ...patch } }));
      },
      setProvider(
        id: Settings["defaultProvider"],
        patch: Partial<Settings["providers"]["openai"]>,
      ) {
        update((w) => ({
          ...w,
          settings: {
            ...w.settings,
            providers: {
              ...w.settings.providers,
              [id]: { ...w.settings.providers[id], ...patch },
            },
          },
        }));
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ws, update, confirmSaved],
  );
}

function nextCode(all: KnowledgeItem[], projectId: string, type: KnowledgeType) {
  const prefix = KNOWLEDGE_PREFIX[type];
  const used = all.filter((k) => k.projectId === projectId && k.type === type).length;
  return `${prefix}-${String(used + 1).padStart(3, "0")}`;
}

/* ------------------------------------------------------------- selectors */

export function useProject(projectId: string) {
  const { ws } = useVpip();
  return useMemo(() => {
    const project = ws.projects.find((p) => p.id === projectId);
    const discussions = ws.discussions.filter((d) => d.projectId === projectId);
    const knowledge = ws.knowledge.filter((k) => k.projectId === projectId);
    return {
      project,
      discussions,
      knowledge,
      approved: knowledge.filter((k) => k.status === "approved"),
      candidates: knowledge.filter((k) => k.status === "candidate"),
      documents: ws.documents.filter((d) => d.projectId === projectId),
      prompts: ws.prompts.filter((p) => p.projectId === projectId),
      snapshots: ws.snapshots.filter((s) => s.projectId === projectId),
      buildSessions: (ws.buildSessions ?? []).filter((b) => b.projectId === projectId),
      repositories: (ws.repositories ?? []).filter((r) => r.projectId === projectId),
      repoCommits: (ws.repoCommits ?? []).filter((c) => c.projectId === projectId),
      repoBranches: ws.repoBranches ?? [],
      artifacts: (ws.artifacts ?? []).filter((a) => a.projectId === projectId),
      buildRecords: (ws.buildRecords ?? []).filter((r) => r.projectId === projectId),
      changeRecords: (ws.changeRecords ?? []).filter((c) => c.projectId === projectId),
      promptPhases: (ws.promptPhases ?? []).filter((p) => p.projectId === projectId),
      phaseRuns: (ws.phaseRuns ?? []).filter((r) => r.projectId === projectId),
      contextPackages: (ws.contextPackages ?? []).filter((c) => c.projectId === projectId),
      outcomes: (ws.outcomes ?? []).filter((o) => o.projectId === projectId),
      failures: (ws.failures ?? []).filter((f) => f.projectId === projectId),
      activity: (ws.activity ?? []).filter((a) => a.projectId === projectId),
      intelligence: (ws.intelligence ?? []).filter((i) => i.projectId === projectId),
      repoReports: (ws.repoReports ?? []).filter((r) => r.projectId === projectId),
      repoDiagnostics: (ws.repoReports ?? [])
        .filter((r) => r.projectId === projectId)
        .filter((r, i, all) => all.findIndex((x) => (x.repositoryId ?? x.buildSessionId) === (r.repositoryId ?? r.buildSessionId)) === i)
        .map((r) => repoDiagnosticsSummary(r, 25))
        .join("\n\n"),
    };
  }, [ws, projectId]);
}
