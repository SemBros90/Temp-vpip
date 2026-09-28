import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Paperclip, X } from "lucide-react";
import { Paperclip, X } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { AdminRecovery } from "@/components/vpip/AdminRecovery";
import { AdminCodeSearch } from "@/components/vpip/AdminCodeSearch";
import { AdminImplement } from "@/components/vpip/AdminImplement";
import { AdminGithubHistory } from "@/components/vpip/AdminGithubHistory";
import { AdminActionLog } from "@/components/vpip/AdminActionLog";
import { AdminAiAccessibility } from "@/components/vpip/AdminAiAccessibility";
import { AdminKnowledgeBase } from "@/components/vpip/AdminKnowledgeBase";
import { AdminRootCause } from "@/components/vpip/AdminRootCause";
import { AdminAiControl } from "@/components/vpip/AdminAiControl";
import { assertAdminAiAccess, getControlState, type AdminModuleKey } from "@/lib/vpip/admin-ai-control";
import { getAdminAiConfiguration } from "@/lib/admin-ai-service";
import { logAdminAction, listAdminActions } from "@/lib/vpip/admin-log";
import { Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/lib/vpip/markdown";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/vpip/ai";
import { AdminHomeHealth } from "@/components/vpip/AdminHomeHealth";
import { AdminControlStatus } from "@/components/vpip/AdminControlStatus";
import { AdminRepoInsights } from "@/components/vpip/AdminRepoInsights";
import { classifyFile } from "@/lib/vpip/repo-map";
import { useVpip } from "@/lib/vpip/store";
import { PROVIDER_LABEL, type ProviderConfig, type ProviderId } from "@/lib/vpip/types";
import {
  adminSystemPrompt,
  buildContext,
  BUILD_CONFIG_RE,
  compareBranches,
  loadRepo,
  readFile,
  listTags,
  listReleases,
  getCommit,
  getPull,
  filesDiffMarkdown,
  repositoryVisibilityAudit,

  readRepositoryFile,

  REPORT_KINDS,
  reportInstruction,
  type AdminRepoData,
  type RepositoryFileRead,
  type ReportKind,
} from "@/lib/vpip/admin-ai";

export const Route = createFileRoute("/admin-ai")({
  head: () => ({
    meta: [
      { title: "Admin AI — VPIP Platform Improvement" },
      { name: "description", content: "Admin AI reviews VPIP's own repository, AI 1 build reports and AI 2 audits to recommend platform improvements." },
      { property: "og:title", content: "Admin AI — VPIP Platform Improvement" },
      { property: "og:description", content: "Oversight AI that proposes VPIP improvements for human approval." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AdminAiPage,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any };
const LOVABLE_MODEL = "openai/gpt-6-astra";
type Tab = "control" | "home" | "chat" | "explorer" | "search" | "dependency" | "github" | "snapshots" | "actionLog" | "ai1" | "ai2" | "knowledge" | "rootCause" | "runtime" | "proposals" | "accessibility";
const SECTIONS: Array<[Tab, string]> = [["control", "Admin AI Control"], ["home", "Home"], ["chat", "Chat"], ["explorer", "Repository Explorer"], ["search", "Search Center"], ["dependency", "Dependency Analyzer"], ["github", "GitHub Center"], ["snapshots", "Snapshot Center"], ["actionLog", "Action Log"], ["ai1", "AI1 Center"], ["ai2", "AI2 Center"], ["knowledge", "Knowledge Base"], ["rootCause", "Root Cause Engine"], ["runtime", "Runtime Center"], ["proposals", "Change Proposal Center"], ["accessibility", "Accessibility Center"]];
type Engine = "lovable" | ProviderId;

interface ChatImageAttachment { id: string; name: string; mediaType: string; dataUrl: string }
interface Msg { id?: string; role: "user" | "assistant"; content: string; created_at?: string; attachments?: ChatImageAttachment[] }
interface Report { id: string; kind: string; title: string; content: string; status: string; engine: string | null; created_at: string }
interface FileAuditItem { label: string; status: "PASS" | "FAIL"; result?: RepositoryFileRead; error?: string }

function AdminAiPage() {
  const { ws } = useVpip();
  const [tab, setTab] = useState<Tab>("control");
  const [chatEnabled, setChatEnabled] = useState(false);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [engine, setEngine] = useState<Engine>("lovable");
  const [data, setData] = useState<AdminRepoData | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [filter, setFilter] = useState("");
  const [openFile, setOpenFile] = useState<RepositoryFileRead | null>(null);
  const [pinned, setPinned] = useState<Array<{ path: string; content: string }>>([]);
  const [configFiles, setConfigFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [snapshots, setSnapshots] = useState<Array<{ label: string; created_at: string; project: string; files: Array<{ path: string; content?: string }> }>>([]);
  const [shaCmp, setShaCmp] = useState({ base: "", head: "", out: "" });
  const autoTried = useRef(false);
  const [cmp, setCmp] = useState<{ base: string; head: string; out: string }>({ base: "", head: "", out: "" });
  const [fileAudit, setFileAudit] = useState<FileAuditItem[]>([]);
  const [auditingFiles, setAuditingFiles] = useState(false);

  const [ai1, setAi1] = useState<Array<{ created_at: string; report: string; project_id: string }>>([]);
  const [ai2, setAi2] = useState<Array<{ created_at: string; kind: string; score: number | null; report: string; project_id: string }>>([]);
  const [feedback, setFeedback] = useState<Array<{ id: string; kind: string; content: string; created_at: string }>>([]);
  const [fbKind, setFbKind] = useState("Feedback");
  const [fbText, setFbText] = useState("");

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const attachmentInput = useRef<HTMLInputElement | null>(null);
  const chatScroll = useRef<HTMLDivElement | null>(null);
  const [showGoToBottom, setShowGoToBottom] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [openReport, setOpenReport] = useState<Report | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown[]>>({});

  const scrollToChatBottom = useCallback(() => {
    chatScroll.current?.scrollTo({ top: chatScroll.current.scrollHeight, behavior: "smooth" });
    setShowGoToBottom(false);
  }, []);

  const loadAll = useCallback(async () => {
    const [s, m, r, f, a1, a2, sn] = await Promise.all([
      db.from("vpip_admin_ai_settings").select("*").eq("id", "default").maybeSingle(),
      db.from("vpip_admin_ai_messages").select("*").order("created_at", { ascending: true }).limit(200),
      db.from("vpip_admin_ai_reports").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("vpip_admin_ai_feedback").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("vpip_ai1_reports").select("created_at,report,project_id").order("created_at", { ascending: false }).limit(15),
      db.from("vpip_ai2_audits").select("created_at,kind,score,report,project_id,corrective_prompt,findings").order("created_at", { ascending: false }).limit(15),
      db.from("vpip_repo_snapshots").select("label,created_at,project_id,files").order("created_at", { ascending: false }).limit(3),
    ]);
    // Existing VPIP stores that were implemented but not wired into Admin AI.
    const q = (t: string, cols: string, order = "created_at", n = 15) => db.from(t).select(cols).order(order, { ascending: false }).limit(n);
    const [ai2m, builds, rt, fails, repair, act, prompts, outs, intel, val, repoRep] = await Promise.all([
      q("vpip_ai2_messages", "created_at,role,content,project_id", "created_at", 20),
      q("vpip_build_records", "created_at,build_code,status,summary,provider,model,project_id,logs"),
      q("vpip_runtime_audit", "created_at,action,status,error,project_id", "created_at", 30),
      q("vpip_failures", "created_at,code,title,root_cause,resolution,status,project_id"),
      q("vpip_repair_audit", "created_at,action,risk,note,project_id"),
      q("vpip_activity", "created_at,subject_label,action,note,project_id", "created_at", 20),
      q("vpip_prompts", "created_at,title,kind,version,status,markdown,project_id", "created_at", 10),
      q("vpip_outcomes", "created_at,code,subject_label,result,lessons,project_id", "created_at", 10),
      q("vpip_intelligence", "created_at,code,pattern_type,title,description", "created_at", 10),
      q("vpip_validation_runs", "created_at,metrics", "created_at", 5),
      q("vpip_repo_reports", "created_at,branch,health,unsupported,project_id", "created_at", 5),
    ]);
    setEvidence({
      "AI 2 chat messages": ai2m.data ?? [],
      "AI 2 corrective prompts": ((a2.data ?? []) as Array<{ created_at: string; corrective_prompt?: string; project_id: string }>).filter((x) => x.corrective_prompt?.trim()).map((x) => ({ created_at: x.created_at, project_id: x.project_id, corrective_prompt: x.corrective_prompt })),
      "AI 1 prompts": prompts.data ?? [],
      "Build results": ((builds.data ?? []) as Array<Record<string, unknown>>).map((b) => ({ ...b, logs: Array.isArray(b["logs"]) ? (b["logs"] as unknown[]).slice(-5) : [] })),
      "Runtime & error events": rt.data ?? [],
      "Failure records": fails.data ?? [],
      "Safe Repair audit": repair.data ?? [],
      "Activity log": act.data ?? [],
      "Outcomes & lessons": outs.data ?? [],
      "Cross-project intelligence": intel.data ?? [],
      "Validation runs": val.data ?? [],
      "Repository import reports": repoRep.data ?? [],
    });
    setSnapshots(((sn.data ?? []) as Array<{ label: string; created_at: string; project_id: string; files: unknown }>).map((x) => ({
      label: x.label,
      created_at: x.created_at,
      project: x.project_id,
      files: Array.isArray(x.files) ? (x.files as Array<{ path: string; content?: string }>) : [],
    })));
    if (s.data) {
      setRepo(s.data.repo_full_name);
      setBranch(s.data.branch);
      setToken(s.data.token);
      setEngine(s.data.engine as Engine);
      if (s.data.repo_full_name && !autoTried.current) {
        autoTried.current = true;
        void connect(s.data.branch || undefined, s.data.repo_full_name, s.data.token);
      }
    }
    setMsgs(m.data ?? []);
    setReports(r.data ?? []);
    setFeedback(f.data ?? []);
    setAi1(a1.data ?? []);
    setAi2(a2.data ?? []);
  }, []);
  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function saveSettings(next?: Partial<{ repo: string; branch: string; engine: Engine; token: string }>) {
    const { error } = await db.from("vpip_admin_ai_settings").upsert({
      id: "default",
      repo_full_name: (next?.repo ?? repo).trim(),
      branch: next?.branch ?? branch,
      token: next?.token ?? token,
      engine: next?.engine ?? engine,
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message);
  }

  async function connect(ref?: string, repoArg?: string, tokenArg?: string) {
    const tk = tokenArg ?? token;
    const name = (repoArg ?? repo).trim().replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    if (!/^[^/\s]+\/[^/\s]+$/.test(name)) return setRepoError("Enter the repository as owner/name, e.g. SemBros90/vpip.");
    setLoadingRepo(true);
    setRepoError("");
    try {
      const d = await loadRepo(tk, name, ref ?? branch);
      const b = ref ?? (branch || d.defaultBranch);
      const cfgPaths = d.tree.filter((t) => t.type === "blob" && BUILD_CONFIG_RE.test(t.path)).map((t) => t.path);
      const cfg = await Promise.all(cfgPaths.map(async (p) => ({ path: p, content: await readFile(tk, name, b, p).catch((e) => `[read failed: ${e instanceof Error ? e.message : e}]`) })));
      setConfigFiles(cfg);
      setData(d);
      setBranch(b);
      setRepo(name);
      await saveSettings({ repo: name, branch: b, token: tk });
    } catch (e) {
      setData(null);
      setRepoError(e instanceof Error ? e.message : "Could not reach GitHub.");
    } finally {
      setLoadingRepo(false);
    }
  }

  async function open(path: string) {
    try {
      setOpenFile(await readRepositoryFile(token, repo, branch, path));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file.");
    }
  }

  async function runFileAccessAudit() {
    if (!data) return;
    const select = (label: string, match: (path: string) => boolean) => ({ label, path: data.tree.find((entry) => entry.type === "blob" && match(entry.path))?.path });
    const targets = [
      select("package.json", (path) => path === "package.json"),
      select("README.md", (path) => /^README\.md$/i.test(path)),
      select("React component", (path) => /(^|\/)components\/.+\.tsx$/i.test(path)),
      select("VPIP file", (path) => /(^|\/)vpip\/.+\.(ts|tsx)$/i.test(path)),
      select("Migration file", (path) => /(^|\/)(migrations?)\/.+\.(sql|ts)$/i.test(path)),
    ];
    setAuditingFiles(true);
    try {
      const results = await Promise.all(targets.map(async ({ label, path }) => {
        if (!path) return { label, status: "FAIL" as const, error: "No matching repository file was found in the live tree." };
        try {
          const result = await readRepositoryFile(token, repo, branch, path);
          return { label, status: result.kind === "text" ? "PASS" as const : "FAIL" as const, result, error: result.kind === "binary" ? "The selected audit file is binary; text-line evidence is unavailable." : undefined };
        } catch (error) {
          return { label, status: "FAIL" as const, error: error instanceof Error ? error.message : String(error) };
        }
      }));
      setFileAudit(results as FileAuditItem[]);
    } finally {
      setAuditingFiles(false);
    }
  }

  function resolve(selected: Engine = engine): { provider: ProviderId; cfg: ProviderConfig } {
    const base = ws.settings.providers[ws.settings.defaultProvider];
    if (selected === "lovable") return { provider: "lovable" as ProviderId, cfg: { ...base, model: LOVABLE_MODEL, apiKey: "" } };
    return { provider: selected, cfg: ws.settings.providers[selected] ?? base };
  }
  const engineLabel = engine === "lovable" ? "Lovable AI" : (PROVIDER_LABEL[engine] ?? engine);

  const context = useMemo(
    () => {
      const base = buildContext({ repo, branch, data, error: repoError, configFiles, snapshots, tree: data?.tree ?? [], pinned, ai1, ai2, feedback });
      const ev = Object.entries(evidence).map(([k, rows]) => `## ${k} (latest ${rows.length})\n${rows.length ? rows.map((r) => `- ${JSON.stringify(r).slice(0, 700)}`).join("\n") : "none recorded"}`).join("\n\n");
      return `${base}\n\n# Connected VPIP evidence stores\n${ev}`;
    },
    [repo, branch, data, repoError, configFiles, snapshots, pinned, ai1, ai2, feedback, evidence],
  );

  useEffect(() => {
    const refreshAccess = async () => {
      try {
        const state = await getControlState();
        const module = state.modules.find((entry) => entry.module_key === tab);
        setChatEnabled(Boolean(state.control.enabled && !state.control.emergency_off && module?.enabled));
      } catch { setChatEnabled(false); }
    };
    void refreshAccess();
    const timer = window.setInterval(() => void refreshAccess(), 5000);
    return () => window.clearInterval(timer);
  }, [tab]);

  async function run(userText: string, history: Msg[], kind?: ReportKind, extra?: { instruction: string; context: string }, imageAttachments: ChatImageAttachment[] = []) {
    // This check is the client-side gate; the route metadata below creates a durable
    // request record. No Admin screen calls a provider until Control authorizes it.
    const access = await assertAdminAiAccess(tab as AdminModuleKey);
    if (access.provider !== "lovable" && !(access.provider in ws.settings.providers)) throw new Error(`${access.provider} is selected in Admin AI Control but no VPIP provider adapter is configured yet.`);
    const resolved = resolve(access.provider as Engine);
    const provider = resolved.provider;
    const cfg = { ...resolved.cfg, model: access.model || resolved.cfg.model };
    const configuration = await getAdminAiConfiguration();
    const configurationContext = `# Canonical Admin AI database configuration\nProvider: ${configuration.settings?.provider ?? "not configured"}\nModel: ${configuration.settings?.model ?? "not configured"}\nConnection status: ${configuration.settings?.connection_status ?? "not configured"}\nActive modules: ${configuration.modules.filter((module) => module.ai_enabled).map((module) => module.module_name).join(", ") || "none"}\nModule permissions:\n${configuration.modules.map((module) => `- ${module.module_name}: ${module.permission_level} (${module.connection_status})`).join("\n") || "no module records"}`;
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStream("");
    try {
      const answer = await streamChat(
        provider,
        cfg,
        [{ role: "system", content: adminSystemPrompt(`${extra ? `${context}\n\n# Recovery evidence\n${extra.context}` : context}\n\n${configurationContext}`) }, ...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: extra ? extra.instruction : kind ? reportInstruction(kind) : userText, ...(imageAttachments.length ? { attachments: imageAttachments.map(({ mediaType, dataUrl }) => ({ mediaType, dataUrl })) } : {}) }],
        (d) => setStream((s) => (s ?? "") + d),
        ctrl.signal,
        { originModule: tab, actor: "Platform owner" },
      );
      return answer;
    } finally {
      setStream(null);
      abort.current = null;
    }
  }

  async function addImages(files: File[]) {
    const candidates = files.filter((file) => /^image\/(png|jpe?g|gif|webp)$/.test(file.type));
    if (candidates.length !== files.length) toast.error("Admin AI Chat supports PNG, JPEG, GIF, and WebP images.");
    const available = 3 - attachments.length;
    if (available <= 0) return toast.error("You can attach up to 3 images per message.");
    const accepted = candidates.slice(0, available).filter((file) => file.size <= 4 * 1024 * 1024);
    if (accepted.length !== candidates.slice(0, available).length) toast.error("Each image must be 4 MB or smaller.");
    const read = (file: File) => new Promise<ChatImageAttachment>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: `${file.name}-${file.lastModified}-${crypto.randomUUID()}`, name: file.name, mediaType: file.type, dataUrl: String(reader.result) });
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    try {
      const images = await Promise.all(accepted.map(read));
      setAttachments((current) => [...current, ...images].slice(0, 3));
    } catch {
      toast.error("One or more images could not be attached.");
    }
  }

  async function send() {
    const text = input.trim();
    if ((!text && attachments.length === 0) || stream !== null || !chatEnabled) return;
    const sentAttachments = attachments;
    setInput("");
    setAttachments([]);
    const history = msgs.slice(-20);
    setMsgs((m) => [...m, { role: "user", content: text, attachments: sentAttachments, created_at: new Date().toISOString() }]);
    await db.from("vpip_admin_ai_messages").insert({ role: "user", content: text || `[${sentAttachments.length} image attachment${sentAttachments.length === 1 ? "" : "s"}]` });
    try {
      // Read any repository files the user names so the answer uses real contents.
      let prompt = text;
      if (data) {
        const known = new Set(configFiles.map((f) => f.path));
        const named = data.tree.filter((t) => t.type === "blob" && !known.has(t.path) && text.includes(t.path)).slice(0, 5);
        for (const f of named) {
          const c = await readFile(token, repo, branch, f.path).catch((e) => `[read failed: ${e instanceof Error ? e.message : e}]`);
          prompt += `\n\n### File read live from repository: ${f.path}\n\`\`\`\n${c.slice(0, 15000)}\n\`\`\``;
        }
        // Live tool results so Admin AI answers from real reads, not assumptions.
        const safe = async (label: string, fn: () => Promise<string>) => { try { return `### ${label}\n${await fn()}`; } catch (e) { return `### ${label}\nFAILED: ${e instanceof Error ? e.message : e}`; } };
        const parts = await Promise.all([
          safe("Tags (GET /tags)", async () => { const t = await listTags(token, repo); return t.length ? t.map((x) => `- ${x.name} ${x.sha.slice(0, 7)}`).join("\n") : "API returned [] — the repository has 0 tags."; }),
          safe("Releases (GET /releases)", async () => { const r = await listReleases(token, repo); return r.length ? r.map((x) => `- ${x.name} (${x.tag}) ${x.published}`).join("\n") : "API returned [] — the repository has 0 releases."; }),
          safe("Pull requests (GET /pulls?state=all)", async () => data.pulls.length ? data.pulls.map((p) => `- #${p.number} [${p.state}] ${p.title}`).join("\n") : "API returned [] — the repository has 0 pull requests, so no PR diff can be shown."),
          safe(`Latest commit diff (GET /commits/${data.headSha.slice(0, 7)})`, async () => { const c = await getCommit(token, repo, data.headSha); return `${c.message.split("\n")[0]} · ${c.author} · +${c.stats?.additions ?? 0} −${c.stats?.deletions ?? 0}\n${filesDiffMarkdown(c.files, 6000)}`; }),
          ...[...new Set(text.match(/\b[0-9a-f]{7,40}\b/g) ?? [])].filter((s) => s !== data.headSha).slice(0, 2).map((sha) => safe(`Commit diff ${sha}`, async () => { const c = await getCommit(token, repo, sha); return `${c.message.split("\n")[0]}\n${filesDiffMarkdown(c.files, 6000)}`; })),
          ...[...new Set((text.match(/#(\d+)/g) ?? []).map((x) => Number(x.slice(1))))].slice(0, 2).map((n) => safe(`PR #${n} diff`, async () => { const p = await getPull(token, repo, n); return `${p.title} [${p.state}] ${p.head} → ${p.base}\n${filesDiffMarkdown(p.files, 6000)}`; })),
          safe("Admin AI action log (latest 20, append-only table vpip_admin_ai_actions)", async () => { const a = await listAdminActions(20); return a.length ? a.map((x) => `- ${x.created_at} ${x.action} [${x.status}]${x.pr_number ? ` PR #${x.pr_number}` : ""}${x.branch ? ` ${x.branch}` : ""}`).join("\n") : "0 entries."; }),
          safe("Filename search for words in the question", async () => {
            const words = [...new Set(text.toLowerCase().match(/[a-z][\w.-]{3,}/g) ?? [])].slice(0, 8);
            const hits = data.tree.filter((t) => t.type === "blob" && words.some((w) => t.path.toLowerCase().includes(w))).slice(0, 40);
            return hits.length ? hits.map((h) => `- ${h.path}`).join("\n") : "no file names matched";
          }),
        ]);
        prompt += `\n\n## Live tool results (executed just now)\n${parts.join("\n\n")}\n\nNote: full-text / symbol / import search runs in Repository tab → Code Search (reads every source file). Answer only from these results.`;
      }
      const full = await run(prompt, history, undefined, undefined, sentAttachments);
      setMsgs((m) => [...m, { role: "assistant", content: full, created_at: new Date().toISOString() }]);
      await db.from("vpip_admin_ai_messages").insert({ role: "assistant", content: full, engine: engineLabel, model: resolve().cfg.model });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(e instanceof Error ? e.message : "Admin AI failed.");
    }
  }

  async function generate(kind: ReportKind) {
    if (stream !== null) return;
    setTab("proposals");
    try {
      const full = await run("", [], kind);
      if (!full.trim()) return;
      const { data: row, error } = await db
        .from("vpip_admin_ai_reports")
        .insert({ kind, title: REPORT_KINDS[kind], content: full, engine: engineLabel, model: resolve().cfg.model })
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      setReports((r) => [row, ...r]);
      setOpenReport(row);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(e instanceof Error ? e.message : "Report failed.");
    }
  }

  async function runRecovery(instruction: string, ctx: string, title: string) {
    setTab("proposals");
    try {
      const full = await run("", [], undefined, { instruction, context: ctx });
      if (!full.trim()) return;
      const { data: row, error } = await db.from("vpip_admin_ai_reports").insert({ kind: "recovery", title, content: full, engine: engineLabel, model: resolve().cfg.model }).select("*").single();
      if (error) throw new Error(error.message);
      setReports((r) => [row, ...r]);
      setOpenReport(row);
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(e instanceof Error ? e.message : "Recovery analysis failed.");
    }
  }

  async function setStatus(r: Report, status: string) {
    await db.from("vpip_admin_ai_reports").update({ status }).eq("id", r.id);
    void logAdminAction({ action: `report_status:${status}`, report_id: r.id, detail: { kind: r.kind, title: r.title, from: r.status } });
    const upd = { ...r, status };
    setReports((all) => all.map((x) => (x.id === r.id ? upd : x)));
    setOpenReport(upd);
  }

  async function addFeedback() {
    if (!fbText.trim()) return;
    const { data: row } = await db.from("vpip_admin_ai_feedback").insert({ kind: fbKind, content: fbText.trim() }).select("*").single();
    if (row) setFeedback((f) => [row, ...f]);
    setFbText("");
  }

  const files = (data?.tree ?? []).filter((t) => t.type === "blob" && t.path.toLowerCase().includes(filter.toLowerCase())).slice(0, 400);
  const phaseOneAudit = useMemo(() => repositoryVisibilityAudit(data), [data]);
  const projName = (id: string) => ws.projects.find((p) => p.id === id)?.name ?? "project";

  return (
    <Shell
      title="Admin AI"
      subtitle="Improves VPIP itself. Changes only after your approval — on a separate branch with a pull request, never main."
      scroll={false}
      actions={stream !== null ? (
            <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>Stop</Button>
          ) : null}
    >
        <div className="flex h-full min-h-0">
        <nav className="w-52 shrink-0 space-y-0.5 overflow-y-auto border-r border-border p-2">
          <div className="label-mono px-2 py-1">Admin AI</div>
          {SECTIONS.map(([t, label]) => (
            <button key={t} onClick={() => setTab(t)} className={`block w-full rounded px-2 py-1.5 text-left text-xs font-medium ${tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}>{label}</button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
{tab === "control" ? <AdminAiControl /> : null}
{tab === "home" ? (<div className="space-y-4">
              <AdminControlStatus />
              <AdminHomeHealth />
              <div className="grid gap-2 rounded-md border border-border bg-surface p-4 md:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="VPIP repository, e.g. SemBros90/vpip" value={repo} onChange={(e) => setRepo(e.target.value)} />
                <Input type="password" placeholder="GitHub token (read access; optional for public repos)" value={token} onChange={(e) => setToken(e.target.value)} onBlur={() => void saveSettings({ token })} />
                <Button onClick={() => void connect()} disabled={loadingRepo}>{loadingRepo ? "Connecting…" : data ? "Reload" : "Connect"}</Button>
                {repoError ? <div className="text-xs text-destructive md:col-span-3">{repoError}</div> : null}
                <div className="label-mono md:col-span-3">Read-only access: tree, files, branches, commits, pull requests, issues. Admin AI never writes to GitHub on its own.</div>
              </div>

              <div className="grid gap-2 rounded-md border border-border bg-surface p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div className="sm:col-span-3 lg:col-span-6 text-sm font-semibold">Repository Status</div>
                <Stat k="Repository Connected" v={loadingRepo ? "Checking…" : data ? "Yes" : "No"} />
                <Stat k="Repository Name" v={data?.metadata.name ?? "—"} />
                <Stat k="Repository Owner" v={data?.metadata.owner ?? "—"} />
                <Stat k="Default Branch" v={data?.defaultBranch ?? "—"} />
                <Stat k="Branch" v={data ? branch : "—"} />
                <Stat k="Commit" v={data?.headSha ? data.headSha.slice(0, 7) : "—"} />
                <Stat k="Total Files" v={data ? `${data.fileCount}${data.truncated ? "+" : ""}` : "—"} />
                <Stat k="Total Folders" v={data ? `${data.folderCount}${data.truncated ? "+" : ""}` : "—"} />
                <Stat k="Sync Status" v={data?.syncStatus ?? "Not connected"} />
                <Stat k="Last Sync Time" v={data ? new Date(data.syncedAt).toLocaleString() : "Never"} />
                {data ? <div className="label-mono sm:col-span-3 lg:col-span-6">Admin AI reads: file list, {configFiles.length} build/config files ({configFiles.map((f) => f.path).join(", ") || "none found"}), branches, commits, {snapshots.length} latest snapshots, and any file you name in chat.</div> : null}
              </div>
</div>) : null}

{tab === "chat" ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col rounded-md border border-border bg-surface p-4">
              <div className="text-sm font-semibold">Admin AI Chat</div>
<div ref={chatScroll} className="flex-1 space-y-3 overflow-y-auto py-2" onScroll={(event) => { const element = event.currentTarget; setShowGoToBottom(element.scrollHeight - element.scrollTop - element.clientHeight > 80); }}>
                {msgs.length === 0 && stream === null ? (
                  <div className="text-sm text-muted-foreground">Ask Admin AI about VPIP — e.g. "Why do AI 1 builds keep failing on routes?" It sees the connected repository, pinned files, AI 1/AI 2 reports and your feedback.</div>
                ) : null}
                {msgs.map((m, i) => (
                  <div key={m.id ?? i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "text-sm"}>
                    {m.role === "user" ? <><div>{m.content}</div>{m.attachments?.length ? <div className="mt-2 flex flex-wrap gap-2">{m.attachments.map((attachment) => <img key={attachment.id} src={attachment.dataUrl} alt={attachment.name} className="max-h-40 rounded border border-primary-foreground/20" />)}</div> : null}</> : <Markdown source={m.content} />}
                    {m.created_at ? <div className={`mt-1 text-[10px] ${m.role === "user" ? "text-primary-foreground/70" : "text-muted-foreground"}`}>{new Date(m.created_at).toLocaleString()}</div> : null}
                  </div>
                ))}
                {stream !== null ? <div className="text-sm"><Markdown source={stream || "Thinking…"} /></div> : null}
              </div>
              {showGoToBottom ? <Button type="button" size="sm" variant="secondary" className="mx-auto mt-2 gap-1" onClick={scrollToChatBottom}><ArrowDown className="size-3.5" />Go to bottom</Button> : null}
              {!chatEnabled ? <div className="mt-4 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-muted-foreground">Admin AI Control has this module disconnected or Emergency AI OFF is active. Chat is read-only until it is connected in Admin AI Control.</div> : null}
              <div className="sticky bottom-0 mt-4 bg-background pt-2">
                {attachments.length ? <div className="mb-2 flex flex-wrap gap-2">{attachments.map((attachment) => <div key={attachment.id} className="relative"><img src={attachment.dataUrl} alt={attachment.name} className="h-16 w-16 rounded border border-border object-cover" /><button type="button" aria-label={`Remove ${attachment.name}`} className="absolute -right-1 -top-1 rounded-full bg-background p-0.5 shadow" onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}><X className="size-3" /></button></div>)}</div> : null}
                <input ref={attachmentInput} type="file" accept="image/*" multiple className="hidden" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.currentTarget.value = ""; void addImages(files); }} />
                <div className="flex gap-2">
                <Button type="button" variant="outline" size="icon" disabled={!chatEnabled || stream !== null} aria-label="Attach images" title="Attach images" onClick={() => attachmentInput.current?.click()}><Paperclip className="size-4" /></Button>
                <Textarea rows={2} value={input} disabled={!chatEnabled} placeholder={chatEnabled ? "Message Admin AI — paste an image or attach up to 3 images" : "Admin AI Control has blocked chat"} onPaste={(event) => { const images = Array.from(event.clipboardData.items).filter((item) => item.type.startsWith("image/")).map((item) => item.getAsFile()).filter((file): file is File => file !== null); if (images.length) { event.preventDefault(); void addImages(images); } }} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }} />
                <Button onClick={() => void send()} disabled={!chatEnabled || stream !== null || (!input.trim() && attachments.length === 0)}>Send</Button>
                </div>
              </div>
            </div>
) : null}

{tab === "explorer" ? (<div className="space-y-4">{data ? (<>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="label-mono">Branch</span>
                    <select className="rounded border border-border bg-background px-2 py-1" value={branch} onChange={(e) => void connect(e.target.value)}>
                      {data.branches.map((b) => <option key={b.name}>{b.name}</option>)}
                    </select>
                    <Tag>{data.tree.filter((t) => t.type === "blob").length} files{data.truncated ? " (truncated)" : ""}</Tag>
                    <Tag>{pinned.length} files pinned for Admin AI</Tag>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
                    <div className="rounded-md border border-border bg-surface">
                      <div className="border-b border-border p-2"><Input placeholder="Search files" value={filter} onChange={(e) => setFilter(e.target.value)} /></div>
                      <div className="max-h-[520px] overflow-y-auto p-1 font-mono text-[11px]">
                        {files.map((f) => (
                          <button key={f.path} onClick={() => void open(f.path)} className={`block w-full truncate rounded px-2 py-0.5 text-left hover:bg-muted ${openFile?.path === f.path ? "bg-muted" : ""}`}>
                            <span className="mr-1 inline-block w-[74px] text-[9px] uppercase text-muted-foreground">{classifyFile(f.path)}</span>{pinned.some((p) => p.path === f.path) ? "● " : ""}{f.path}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-md border border-border bg-surface">
                      {openFile ? (
                        <>
                          <div className="flex items-center justify-between border-b border-border px-3 py-2">
                            <span className="truncate font-mono text-xs">{openFile.path}</span>
                            <Button size="sm" variant="outline" disabled={openFile.kind === "binary"} onClick={() => { const c = openFile.content; if (c === null) return; setPinned((p) => (p.some((x) => x.path === openFile.path) ? p.filter((x) => x.path !== openFile.path) : [...p, { path: openFile.path, content: c }])); }}>
                              {pinned.some((p) => p.path === openFile.path) ? "Unpin" : "Pin for Admin AI"}
                            </Button>
                          </div>
                          <div className="border-b border-border px-3 py-1 font-mono text-[10px] text-muted-foreground">{openFile.kind} · {openFile.size.toLocaleString()} bytes · {openFile.sha.slice(0, 12)} · {openFile.source}</div>
                          {openFile.kind === "binary" ? <div className="p-3 text-xs text-muted-foreground">Binary file detected. VPIP retrieved its path, size, SHA, and type without attempting to render binary content.</div> : <pre className="max-h-[480px] overflow-auto p-3 text-[11px] leading-relaxed">{openFile.content}</pre>}
                        </>
                      ) : (
                        <div className="p-6 text-sm text-muted-foreground">Pick a file to read it. Pinned files are given to Admin AI in full.</div>
                      )}
                    </div>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-3">
                    <ListCard title="Recent commits" rows={data.commits.map((c) => `${c.sha.slice(0, 7)} · ${c.message.split("\n")[0]} — ${c.author}`)} />
                    <ListCard title="Pull requests" rows={data.pulls.map((p) => `#${p.number} [${p.state}] ${p.title} — ${p.user}`)} />
                    <ListCard title="Issues" rows={data.issues.map((i) => `#${i.number} [${i.state}] ${i.title} — ${i.user}`)} />
                  </div>
                  <AdminRepoInsights token={token} repo={repo} branch={branch} tree={data.tree} selected={openFile?.path ?? null} onOpen={(p) => void open(p)} />
                  <div className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-1 text-sm font-semibold">Phase 1 — Repository Visibility Audit</div>
                    <p className="mb-3 text-xs text-muted-foreground">Evidence is generated only from the live GitHub responses from the most recent connection. A truncated tree fails exact file and folder verification.</p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-left text-xs">
                        <thead className="border-b border-border text-muted-foreground"><tr><th className="p-2">Capability</th><th className="p-2">Status</th><th className="p-2">Evidence</th><th className="p-2">Source</th></tr></thead>
                        <tbody>{phaseOneAudit.map((item) => <tr key={item.capability} className="border-b border-border/60 align-top"><td className="p-2 font-medium">{item.capability}</td><td className={`p-2 font-semibold ${item.status === "PASS" ? "text-primary" : "text-destructive"}`}>{item.status}</td><td className="p-2">{item.evidence}</td><td className="p-2 font-mono text-[10px]">{item.source}</td></tr>)}</tbody>
                      </table>
                    </div>
                  </div>

                  <div className="rounded-md border border-border bg-surface p-4">

                    <div className="flex flex-wrap items-center gap-2">
                      <div>
                        <div className="text-sm font-semibold">Phase 2 — File Access Audit</div>
                        <p className="text-xs text-muted-foreground">Reads each required file directly from the connected repository. No manually supplied content is used.</p>
                      </div>
                      <Button className="ml-auto" size="sm" variant="outline" disabled={auditingFiles} onClick={() => void runFileAccessAudit()}>{auditingFiles ? "Reading files…" : "Run live file audit"}</Button>
                    </div>
                    {fileAudit.length ? <div className="mt-3 space-y-3">{fileAudit.map((item) => <FileAuditCard key={item.label} item={item} />)}</div> : <div className="mt-3 text-xs text-muted-foreground">Run the audit to produce live PASS/FAIL evidence for the five required repository files.</div>}
                  </div>
</>) : <NoRepo onGo={() => setTab("home")} />}</div>) : null}

{tab === "search" ? (<div className="space-y-4"><p className="text-xs text-muted-foreground">Text, reference, import/export, symbol, route and file-name search across the connected repository.</p>{data ? (<>
                  <AdminCodeSearch token={token} repo={repo} branch={branch} tree={data.tree} onOpen={(p) => void open(p)} onAsk={(md) => setInput(`${md}\n\nUsing this impact analysis, explain what breaks if this file is modified and the risk.`)} />
</>) : <NoRepo onGo={() => setTab("home")} />}</div>) : null}

{tab === "dependency" ? (<div className="space-y-4"><p className="text-xs text-muted-foreground">Pick a file and run dependency impact to see dependents, routes, APIs, database objects and risk.</p>{data ? (<>
                  <AdminCodeSearch token={token} repo={repo} branch={branch} tree={data.tree} onOpen={(p) => void open(p)} onAsk={(md) => setInput(`${md}\n\nUsing this impact analysis, explain what breaks if this file is modified and the risk.`)} />
</>) : <NoRepo onGo={() => setTab("home")} />}</div>) : null}

{tab === "github" ? (<div className="space-y-4">{data ? (<>
                  <AdminGithubHistory token={token} repo={repo} branch={branch} onAsk={(md) => { setInput(md); setTab("home"); }} />
                  <div className="rounded-md border border-border bg-surface p-4">

                    <div className="mb-2 text-sm font-semibold">Compare branches</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(["base", "head"] as const).map((k) => (
                        <select key={k} className="rounded border border-border bg-background px-2 py-1" value={cmp[k]} onChange={(e) => setCmp((c) => ({ ...c, [k]: e.target.value }))}>
                          <option value="">{k}…</option>
                          {data.branches.map((b) => <option key={b.name}>{b.name}</option>)}
                        </select>
                      ))}
                      <Button size="sm" variant="outline" disabled={!cmp.base || !cmp.head} onClick={async () => {
                        try {
                          const r = await compareBranches(token, repo, cmp.base, cmp.head);
                          setCmp((c) => ({ ...c, out: `${r.status}: ${r.ahead_by} ahead, ${r.behind_by} behind\n${(r.files ?? []).map((f) => `${f.status} ${f.filename} +${f.additions}/-${f.deletions}`).join("\n")}` }));
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Compare failed.");
                        }
                      }}>Compare</Button>
                    </div>
                    {cmp.out ? <pre className="mt-2 max-h-60 overflow-auto text-[11px]">{cmp.out}</pre> : null}
                  </div>

                  <div className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-2 text-sm font-semibold">Changed files between commits</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      <Input className="w-48" placeholder="Base commit SHA" value={shaCmp.base} onChange={(e) => setShaCmp((c) => ({ ...c, base: e.target.value.trim() }))} />
                      <Input className="w-48" placeholder="Head commit SHA" value={shaCmp.head} onChange={(e) => setShaCmp((c) => ({ ...c, head: e.target.value.trim() }))} />
                      <Button size="sm" variant="outline" disabled={!shaCmp.base || !shaCmp.head} onClick={async () => {
                        try {
                          const r = await compareBranches(token, repo, shaCmp.base, shaCmp.head);
                          setShaCmp((c) => ({ ...c, out: `${(r.files ?? []).length} files changed\n${(r.files ?? []).map((f) => `${f.status} ${f.filename} +${f.additions}/-${f.deletions}`).join("\n")}` }));
                        } catch (e) {
                          toast.error(e instanceof Error ? e.message : "Compare failed.");
                        }
                      }}>Compare</Button>
                    </div>
                    {shaCmp.out ? <pre className="mt-2 max-h-60 overflow-auto text-[11px]">{shaCmp.out}</pre> : null}
                  </div>
</>) : <NoRepo onGo={() => setTab("home")} />}</div>) : null}

          {tab === "snapshots" ? <AdminRecovery runAi={runRecovery} streaming={stream !== null} /> : null}

          {tab === "actionLog" ? <AdminActionLog /> : null}

{tab === "ai1" ? (<div className="space-y-4">              <div className="space-y-2">
                <div className="text-sm font-semibold">From AI 1 — build reports ({ai1.length})</div>
                {ai1.length ? ai1.map((r, i) => (
                  <details key={i} className="rounded border border-border bg-surface p-2 text-xs">
                    <summary className="cursor-pointer">{projName(r.project_id)} · {new Date(r.created_at).toLocaleString()}</summary>
                    <Markdown source={r.report} className="mt-2" />
                  </details>
                )) : <div className="text-xs text-muted-foreground">No AI 1 reports yet.</div>}
              </div><EvidenceGroup evidence={evidence} keys={["AI 1 prompts", "Build results"]} /></div>) : null}

{tab === "ai2" ? (<div className="space-y-4">              <div className="space-y-2">
                <div className="text-sm font-semibold">From AI 2 — audits ({ai2.length})</div>
                {ai2.length ? ai2.map((r, i) => (
                  <details key={i} className="rounded border border-border bg-surface p-2 text-xs">
                    <summary className="cursor-pointer">{projName(r.project_id)} · {r.kind} · score {r.score ?? "—"}</summary>
                    <Markdown source={r.report} className="mt-2" />
                  </details>
                )) : <div className="text-xs text-muted-foreground">No AI 2 audits yet.</div>}
              </div><EvidenceGroup evidence={evidence} keys={["AI 2 chat messages", "AI 2 corrective prompts"]} /></div>) : null}

{tab === "knowledge" ? (<div className="space-y-4"><AdminKnowledgeBase /><EvidenceGroup evidence={evidence} keys={["Outcomes & lessons", "Cross-project intelligence", "Activity log"]} /></div>) : null}

          {tab === "rootCause" ? <AdminRootCause commits={data?.commits ?? []} branches={data?.branches ?? []} /> : null}

{tab === "runtime" ? (<div className="space-y-4"><div className="text-sm font-semibold">Runtime Center</div><p className="text-xs text-muted-foreground">Runtime events, errors, failures, validation runs and repair/import reports read by Admin AI.</p><EvidenceGroup evidence={evidence} keys={["Runtime & error events", "Failure records", "Validation runs", "Safe Repair audit", "Repository import reports"]} /></div>) : null}

          {tab === "proposals" ? (
            <div className="space-y-4">
<div className="max-w-xl space-y-2">                <div className="text-sm font-semibold">From you — feedback</div>
                <div className="space-y-2 rounded border border-border bg-surface p-2">
                  <select className="w-full rounded border border-border bg-background px-2 py-1 text-xs" value={fbKind} onChange={(e) => setFbKind(e.target.value)}>
                    {["Feedback", "Complaint", "Feature Request"].map((k) => <option key={k}>{k}</option>)}
                  </select>
                  <Textarea rows={3} placeholder="What should VPIP do better?" value={fbText} onChange={(e) => setFbText(e.target.value)} />
                  <Button size="sm" onClick={() => void addFeedback()}>Add</Button>
                </div>
                {feedback.map((f) => (
                  <div key={f.id} className="rounded border border-border bg-surface p-2 text-xs">
                    <Tag>{f.kind}</Tag> <span className="ml-1">{f.content}</span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(REPORT_KINDS) as ReportKind[]).map((k) => (
                  <Button key={k} size="sm" variant="outline" disabled={stream !== null} onClick={() => void generate(k)}>Generate {REPORT_KINDS[k]}</Button>
                ))}
              </div>
              <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
                <div className="space-y-1">
                  {reports.map((r) => (
                    <button key={r.id} onClick={() => setOpenReport(r)} className={`block w-full rounded border border-border p-2 text-left text-xs hover:bg-muted ${openReport?.id === r.id ? "bg-muted" : "bg-surface"}`}>
                      <div className="font-medium">{r.title}</div>
                      <div className="text-muted-foreground">{new Date(r.created_at).toLocaleString()} · {r.status}</div>
                    </button>
                  ))}
                  {!reports.length ? <div className="text-xs text-muted-foreground">No reports yet.</div> : null}
                </div>
                <div className="min-w-0 rounded-md border border-border bg-surface p-4">
                  {stream !== null ? <Markdown source={stream || "Generating…"} /> : openReport ? (
                    <>
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <Tag>{openReport.status}</Tag>
                        <span className="label-mono">{openReport.engine}</span>
                        <div className="ml-auto flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => void navigator.clipboard.writeText(openReport.content).then(() => toast.success("Copied"))}>Copy</Button>
                          <Button size="sm" variant="outline" onClick={() => void setStatus(openReport, "Approved")}>Approve</Button>
                          <Button size="sm" variant="outline" onClick={() => void setStatus(openReport, "Rejected")}>Reject</Button>
                          {openReport.kind === "proposal" ? (
                            <>
                              <Button size="sm" variant="outline" onClick={() => void setStatus(openReport, "Revision requested")}>Revise</Button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <Markdown source={openReport.content} />
                      <AdminImplement
                        report={openReport}
                        token={token}
                        repo={repo}
                        base={branch || data?.defaultBranch || ""}
                        tree={(data?.tree ?? []).filter((t) => t.type === "blob").map((t) => t.path)}
                        runAi={(instruction) => run("", [], undefined, { instruction, context: "" })}
                        onReport={(row) => setReports((r) => [row, ...r])}
                        onStatus={setStatus}
                      />
                      <div className="label-mono mt-4">Approved changes are applied only after you confirm: snapshot first, then a separate branch and pull request — never straight to main, never merged automatically.</div>
                    </>
                  ) : <div className="text-sm text-muted-foreground">Generate or pick a report.</div>}
                </div>
              </div>
            </div>
          ) : null}

          {tab === "accessibility" ? <AdminAiAccessibility /> : null}
        </div>
      </div>
    </Shell>
  );
}

function NoRepo({ onGo }: { onGo: () => void }) {
  return <div className="rounded-md border border-border bg-surface p-6 text-sm text-muted-foreground">Connect the repository on Home first. <button className="underline" onClick={onGo}>Go to Home</button></div>;
}

function EvidenceGroup({ evidence, keys }: { evidence: Record<string, unknown[]>; keys: string[] }) {
  return <div className="grid gap-2 md:grid-cols-2">{keys.map((k) => { const rows = evidence[k] ?? []; return <details key={k} className="rounded border border-border bg-surface p-2 text-xs"><summary className="cursor-pointer">{k} ({rows.length})</summary><pre className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap text-[11px]">{rows.length ? rows.map((r) => JSON.stringify(r, null, 1).slice(0, 600)).join("\n\n") : "None recorded yet."}</pre></details>; })}</div>;
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="label-mono">{k}</div>
      <div className="truncate font-medium">{v}</div>
    </div>
  );
}

function ListCard({ title, rows }: { title: string; rows: string[] }) {
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 text-sm font-semibold">{title}</div>
      <div className="max-h-60 space-y-1 overflow-y-auto text-[11px]">
        {rows.length ? rows.map((r, i) => <div key={i} className="truncate">{r}</div>) : <div className="text-muted-foreground">None</div>}
      </div>
    </div>
  );
}

function FileAuditCard({ item }: { item: FileAuditItem }) {
  const lines = item.result?.content?.split("\n") ?? [];
  const first = lines.slice(0, 20).join("\n");
  const last = lines.slice(-20).join("\n");
  return (
    <details className="rounded border border-border p-3 text-xs" open>
      <summary className="cursor-pointer font-medium"><span className={item.status === "PASS" ? "text-primary" : "text-destructive"}>{item.status}</span> · {item.label}</summary>
      {item.result ? (
        <div className="mt-2 space-y-2">
          <div><span className="label-mono">File path</span> <span className="font-mono">{item.result.path}</span></div>
          <div><span className="label-mono">File size</span> {item.result.size.toLocaleString()} bytes · <span className="label-mono">Kind</span> {item.result.kind}</div>
          <div><span className="label-mono">Source used</span> <span className="font-mono text-[10px]">{item.result.source}</span></div>
          {item.result.kind === "text" ? <>
            <div><div className="label-mono">First 20 lines</div><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">{first}</pre></div>
            <div><div className="label-mono">Last 20 lines</div><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-[10px]">{last}</pre></div>
          </> : null}
          {item.error ? <div className="text-destructive">{item.error}</div> : null}
        </div>
      ) : <div className="mt-2 text-destructive">{item.error}</div>}
    </details>
  );
}
