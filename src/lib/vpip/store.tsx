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
import { vaultClear, vaultRead, vaultWrite } from "./db";
import {
  emptyWorkspace,
  KNOWLEDGE_PREFIX,
  type Discussion,
  type GeneratedDocument,
  type GeneratedPrompt,
  type KnowledgeItem,
  type KnowledgeType,
  type Message,
  type Project,
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

interface Ctx {
  ws: Workspace;
  loaded: boolean;
  dirty: boolean;
  lastSavedAt: string | null;
  update: (fn: (ws: Workspace) => Workspace) => void;
  saveNow: () => Promise<void>;
  resetVault: () => Promise<void>;
  importWorkspace: (ws: Workspace) => void;
}

const VpipContext = createContext<Ctx | null>(null);

export function VpipProvider({ children }: { children: ReactNode }) {
  const [ws, setWs] = useState<Workspace>(() => emptyWorkspace());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const wsRef = useRef(ws);
  wsRef.current = ws;

  useEffect(() => {
    let alive = true;
    vaultRead<Workspace>()
      .then((stored) => {
        if (!alive) return;
        if (stored) setWs({ ...emptyWorkspace(), ...stored });
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      alive = false;
    };
  }, []);

  const saveNow = useCallback(async () => {
    await vaultWrite({ ...wsRef.current, savedAt: now() });
    setLastSavedAt(now());
    setDirty(false);
  }, []);

  const update = useCallback((fn: (w: Workspace) => Workspace) => {
    setWs((prev) => {
      const next = fn(prev);
      wsRef.current = next;
      return next;
    });
    setDirty(true);
  }, []);

  // Real-time save (debounced) — every change reaches the vault immediately.
  useEffect(() => {
    if (!loaded || !dirty) return;
    const t = setTimeout(() => {
      void saveNow();
    }, 400);
    return () => clearTimeout(t);
  }, [ws, dirty, loaded, saveNow]);

  // Auto save interval — a periodic guaranteed flush.
  useEffect(() => {
    if (!loaded) return;
    const ms = Math.max(5, ws.settings.autoSaveIntervalSec) * 1000;
    const i = setInterval(() => {
      void saveNow();
    }, ms);
    return () => clearInterval(i);
  }, [loaded, ws.settings.autoSaveIntervalSec, saveNow]);

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
    () => ({ ws, loaded, dirty, lastSavedAt, update, saveNow, resetVault, importWorkspace }),
    [ws, loaded, dirty, lastSavedAt, update, saveNow, resetVault, importWorkspace],
  );

  return <VpipContext.Provider value={value}>{children}</VpipContext.Provider>;
}

export function useVpip() {
  const ctx = useContext(VpipContext);
  if (!ctx) throw new Error("useVpip must be used inside VpipProvider");
  return ctx;
}

/* ---------------------------------------------------------------- actions */

export function useVpipActions() {
  const { ws, update } = useVpip();

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
        const full: GeneratedPrompt = { ...p, id: uid(), version, createdAt: now() };
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
        update((w) => ({ ...w, prompts: w.prompts.filter((p) => p.id !== id) }));
      },
      addSnapshot(s: Omit<Snapshot, "id" | "createdAt">) {
        update((w) => ({
          ...w,
          snapshots: [{ ...s, id: uid(), createdAt: now() }, ...w.snapshots],
        }));
      },

      /* settings */
      setSettings(patch: Partial<Settings>) {
        update((w) => ({ ...w, settings: { ...w.settings, ...patch } }));
      },
      setProvider(id: "openai" | "deepseek", patch: Partial<Settings["providers"]["openai"]>) {
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
    [ws, update],
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
    };
  }, [ws, projectId]);
}
