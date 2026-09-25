import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ClipboardCheck, Copy, Send, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Markdown } from "@/lib/vpip/markdown";
import { streamChat } from "@/lib/vpip/ai";
import { runtimeInfo, runtimePreviewAccess } from "@/lib/vpip/runtime/runtime.functions";
import {
  AUDIT_LABEL,
  MODE_LABEL,
  PROMPT_LABEL,
  auditUserPrompt,
  auditorChatSystemPrompt,
  auditorSystemPrompt,
  chatContext,
  crawlPreview,
  runStaticAudit,
  scoreFrom,
  splitReport,
  type AuditKind,
  type AuditMode,
  type CrawlResult,
  type PromptKind,
} from "@/lib/vpip/auditor";
import { useVpip } from "@/lib/vpip/store";
import { useAiKeys } from "@/lib/vpip/keys";
import { PROVIDER_LABEL } from "@/lib/vpip/types";
import type { CoderFile, KnowledgeItem, ProviderConfig, ProviderId } from "@/lib/vpip/types";

const db = supabase as unknown as { from: (t: string) => any };
const LOVABLE_MODEL = "openai/gpt-6-astra";

interface AuditRow {
  id: string;
  kind: string;
  mode: string;
  engine: string | null;
  model: string | null;
  score: number | null;
  report: string;
  corrective_prompt: string;
  created_at: string;
}

interface ChatRow {
  id: string;
  role: "user" | "assistant" | "report";
  content: string;
  created_at: string;
}

export function AuditorPanel(props: {
  projectId: string;
  buildId: string;
  buildCode: string;
  originalPrompt: string;
  requirements: KnowledgeItem[];
  files: CoderFile[];
  buildLogs: string;
  coderBusy: boolean;
  provider: ProviderId;
  cfg: ProviderConfig;
  inboxReport?: { id: string; report: string } | null;
  onUsePrompt: (text: string) => void;
}) {
  const info = useServerFn(runtimeInfo);
  const access = useServerFn(runtimePreviewAccess);
  const { ws } = useVpip();
  const { keys } = useAiKeys();
  const [engine, setEngine] = useState<"lovable" | ProviderId>("lovable");
  const [mode, setMode] = useState<AuditMode>("audit_prompt");
  const [promptKind, setPromptKind] = useState<PromptKind>("corrective");
  const [liveCrawl, setLiveCrawl] = useState(true);
  const [continuous, setContinuous] = useState(false);
  const [running, setRunning] = useState<AuditKind | null>(null);
  const [stream, setStream] = useState("");
  const [crawl, setCrawl] = useState<CrawlResult[] | null>(null);
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const audit = useMemo(() => runStaticAudit(props.files), [props.files]);
  const [tab, setTab] = useState<"chat" | "audits">("chat");
  const [chat, setChat] = useState<ChatRow[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatStream, setChatStream] = useState<string | null>(null);
  const chatAbort = useRef<AbortController | null>(null);
  const lastReport = useRef<string | undefined>(undefined);

  function resolveEngine(): { provider: ProviderId; cfg: ProviderConfig } {
    if (engine === "lovable") return { provider: "lovable" as ProviderId, cfg: { ...props.cfg, model: LOVABLE_MODEL, apiKey: "" } };
    return { provider: engine, cfg: ws.settings.providers[engine] ?? props.cfg };
  }

  useEffect(() => {
    setChat([]);
    lastReport.current = undefined;
    db.from("vpip_ai2_messages").select("id,role,content,created_at").eq("build_session_id", props.buildId).order("created_at", { ascending: true }).limit(200)
      .then(({ data, error }: { data: ChatRow[] | null; error: { message: string } | null }) => {
        if (error) toast.error(`AI 2 chat history: ${error.message}`);
        const rows = data ?? [];
        setChat(rows);
        lastReport.current = [...rows].reverse().find((r) => r.role === "report")?.content;
      });
  }, [props.buildId]);

  async function addMsg(role: ChatRow["role"], content: string, meta?: { engine: string; model: string }) {
    const { data, error } = await db.from("vpip_ai2_messages")
      .insert({ project_id: props.projectId, build_session_id: props.buildId, role, content, engine: meta?.engine ?? null, model: meta?.model ?? null })
      .select("id,role,content,created_at").single();
    if (error) toast.error(`AI 2 message not saved: ${error.message}`);
    const row: ChatRow = data ?? { id: `${Date.now()}-${Math.random()}`, role, content, created_at: new Date().toISOString() };
    setChat((c) => [...c, row]);
    return row;
  }

  // AI 1 report handed over via "Send report to AI 2".
  const seenInbox = useRef<string | null>(null);
  useEffect(() => {
    const r = props.inboxReport;
    if (!r || seenInbox.current === r.id) return;
    seenInbox.current = r.id;
    lastReport.current = r.report;
    setTab("chat");
    void addMsg("report", r.report);
    toast.success("AI 1 report is now available to AI 2.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.inboxReport]);

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || chatStream !== null) return;
    setChatInput("");
    const prior = chat;
    await addMsg("user", text);
    const { provider, cfg } = resolveEngine();
    const ctrl = new AbortController();
    chatAbort.current = ctrl;
    setChatStream("");
    try {
      const ctx = chatContext({ buildCode: props.buildCode, files: props.files, audit, buildLogs: props.buildLogs, requirements: props.requirements, originalPrompt: props.originalPrompt });
      const history = prior.slice(-20).map((m) =>
        m.role === "report"
          ? { role: "user" as const, content: `AI 1 BUILD COMPLETION REPORT (claims to verify):\n${m.content}` }
          : { role: m.role as "user" | "assistant", content: m.content },
      );
      const full = await streamChat(provider, cfg, [{ role: "system", content: auditorChatSystemPrompt(ctx) }, ...history, { role: "user", content: text }], (d) => setChatStream((s) => (s ?? "") + d), ctrl.signal);
      if (!full.trim()) throw new Error("The AI returned an empty answer.");
      await addMsg("assistant", full, { engine: engine === "lovable" ? "Lovable AI" : provider, model: cfg.model });
    } catch (e) {
      if ((e as Error)?.name !== "AbortError") toast.error(`AI 2 failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setChatStream(null);
      chatAbort.current = null;
    }
  }

  const loadHistory = useCallback(async () => {
    const { data, error } = await db
      .from("vpip_ai2_audits")
      .select("id,kind,mode,engine,model,score,report,corrective_prompt,created_at")
      .eq("build_session_id", props.buildId)
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) toast.error(`Audit history: ${error.message}`);
    else setHistory(data ?? []);
  }, [props.buildId]);

  useEffect(() => {
    void loadHistory();
    db.from("vpip_ai2_settings").select("*").eq("build_session_id", props.buildId).maybeSingle()
      .then(({ data }: { data: { continuous: boolean; mode: AuditMode } | null }) => {
        setContinuous(Boolean(data?.continuous));
        if (data?.mode) setMode(data.mode);
      });
  }, [props.buildId, loadHistory]);

  async function saveSettings(next: { continuous?: boolean; mode?: AuditMode }) {
    const { error } = await db.from("vpip_ai2_settings").upsert({
      build_session_id: props.buildId,
      project_id: props.projectId,
      continuous: next.continuous ?? continuous,
      mode: next.mode ?? mode,
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error(`Could not save auditor setting: ${error.message}`);
  }

  async function doCrawl(signal: AbortSignal): Promise<CrawlResult[] | null> {
    try {
      const r = await info({ data: { projectId: props.projectId, buildId: props.buildId } });
      const row = r.row as { id: string; status: string; phase: string } | null;
      if (!row || row.status !== "running" || row.phase !== "preview_ready") return null;
      const a = await access({ data: { rowId: row.id } });
      return await crawlPreview(a.path, audit.routes, signal);
    } catch {
      return null;
    }
  }

  const run = useCallback(
    async (kind: AuditKind) => {
      if (running) return;
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setRunning(kind);
      setStream("");
      setOpenId(null);
      try {
        let c: CrawlResult[] | null = null;
        if (liveCrawl && (kind === "preview" || kind === "everything" || kind === "routes")) {
          c = await doCrawl(ctrl.signal);
          setCrawl(c);
        }
        const useLovable = engine === "lovable";
        const { provider, cfg } = resolveEngine();
        const user = auditUserPrompt({
          kind,
          mode,
          promptKind,
          buildCode: props.buildCode,
          originalPrompt: props.originalPrompt,
          requirements: props.requirements,
          files: props.files,
          audit,
          buildLogs: props.buildLogs,
          crawl: c,
          ai1Report: lastReport.current,
        });
        const full = await streamChat(
          provider,
          cfg,
          [
            { role: "system", content: auditorSystemPrompt() },
            { role: "user", content: user },
          ],
          (d) => setStream((s) => s + d),
          ctrl.signal,
        );
        if (!full.trim()) throw new Error("The AI returned an empty answer.");
        const { report, prompt } = splitReport(full);
        const { data, error } = await db
          .from("vpip_ai2_audits")
          .insert({
            project_id: props.projectId,
            build_session_id: props.buildId,
            kind,
            mode,
            engine: useLovable ? "Lovable AI" : provider,
            model: cfg.model,
            score: scoreFrom(full, audit.score),
            findings: audit.findings,
            report,
            corrective_prompt: prompt,
            snapshot: { files: audit.files, routes: audit.routes, crawl: c },
          })
          .select("id")
          .single();
        if (error) toast.error(`Audit done but not saved: ${error.message}`);
        await loadHistory();
        if (data?.id) setOpenId(data.id);
        setStream("");
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") toast.error(`Audit failed: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        setRunning(null);
        abortRef.current = null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [running, liveCrawl, engine, mode, promptKind, props, audit, loadHistory],
  );

  // Continuous Auditor: when AI 1 finishes a generation, audit automatically (only if switched on).
  const prevBusy = useRef(props.coderBusy);
  useEffect(() => {
    if (prevBusy.current && !props.coderBusy && continuous && !running) void run("everything");
    prevBusy.current = props.coderBusy;
  }, [props.coderBusy, continuous, running, run]);

  const open = history.find((h) => h.id === openId) ?? null;
  const sev = audit.findings.reduce((a, f) => ({ ...a, [f.severity]: (a[f.severity] ?? 0) + 1 }), {} as Record<string, number>);

  return (
    <div className="flex size-full min-h-0 flex-col bg-surface">
      <div className="flex border-b border-border text-xs">
        {(["chat", "audits"] as const).map((t) => (
          <button key={t} className={`flex-1 px-3 py-1.5 ${tab === t ? "border-b-2 border-primary font-semibold text-primary" : "text-muted-foreground"}`} onClick={() => setTab(t)}>
            {t === "chat" ? "AI 2 Chat" : "Audits"}
          </button>
        ))}
      </div>
      {tab === "chat" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 text-xs">
            <select className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1" value={engine} onChange={(e) => setEngine(e.target.value as "lovable" | ProviderId)}>
              <option value="lovable">Lovable AI · {LOVABLE_MODEL}</option>
              {(Object.keys(ws.settings.providers) as ProviderId[]).map((id) => (
                <option key={id} value={id}>{PROVIDER_LABEL[id] ?? id} · {ws.settings.providers[id]?.model}</option>
              ))}
            </select>
            <span className="label-mono">read-only</span>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3 text-sm">
            {chat.length === 0 && !chatStream ? (
              <p className="text-xs text-muted-foreground">Ask AI 2 anything: audit the repository, audit the preview or build logs, compare the repository with the prompt, explain missing files, or generate a repair or completion prompt. AI 2 never changes files.</p>
            ) : null}
            {chat.map((m) => (
              <div key={m.id} className={m.role === "user" ? "ml-8 rounded-lg bg-primary px-3 py-2 text-primary-foreground" : m.role === "report" ? "panel border-primary/40 p-2" : ""}>
                {m.role === "report" ? <div className="label-mono mb-1">AI 1 report received</div> : null}
                {m.role === "user" ? <div className="whitespace-pre-wrap">{m.content}</div> : <Markdown source={m.content} />}
                {m.role === "assistant" && splitReport(m.content).prompt ? (
                  <div className="mt-1 flex gap-1">
                    <Button size="sm" variant="ghost" className="h-6 px-1.5 text-[11px]" onClick={() => { void navigator.clipboard.writeText(splitReport(m.content).prompt); toast.success("Copied"); }}><Copy className="size-3" /> Copy prompt</Button>
                    <Button size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => props.onUsePrompt(splitReport(m.content).prompt)}><Send className="size-3" /> Send to AI 1</Button>
                  </div>
                ) : null}
              </div>
            ))}
            {chatStream !== null ? <div>{chatStream ? <Markdown source={chatStream} /> : <p className="text-xs text-muted-foreground">AI 2 is thinking…</p>}</div> : null}
          </div>
          <form className="flex gap-1.5 border-t border-border p-2" onSubmit={(e) => { e.preventDefault(); void sendChat(); }}>
            <textarea className="min-h-16 flex-1 resize-none rounded border border-border bg-background px-2 py-1 text-sm" placeholder="Ask AI 2…" value={chatInput} onChange={(e) => setChatInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendChat(); } }} />
            {chatStream !== null ? (
              <Button type="button" size="icon" variant="destructive" onClick={() => chatAbort.current?.abort()}><Square className="size-4" /></Button>
            ) : (
              <Button type="submit" size="icon" disabled={!chatInput.trim()}><Send className="size-4" /></Button>
            )}
          </form>
        </div>
      ) : (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="size-4 text-primary" />
          <span className="text-sm font-semibold">AI 2 — Auditor</span>
          <span className="label-mono ml-auto">read-only</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
          <select className="rounded border border-border bg-background px-1.5 py-1" value={engine} onChange={(e) => setEngine(e.target.value as "lovable" | ProviderId)}>
            <option value="lovable">Lovable AI · {LOVABLE_MODEL}</option>
            {(Object.keys(ws.settings.providers) as ProviderId[]).map((id) => {
              const c = ws.settings.providers[id];
              const ok = Boolean((keys as Record<string, unknown>)[id] || c?.apiKey?.trim());
              return (
                <option key={id} value={id}>
                  {PROVIDER_LABEL[id] ?? id} · {c?.model}{ok ? "" : " (no key)"}
                </option>
              );
            })}
          </select>
          <select className="rounded border border-border bg-background px-1.5 py-1" value={mode} onChange={(e) => { const m = e.target.value as AuditMode; setMode(m); void saveSettings({ mode: m }); }}>
            {Object.entries(MODE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className="col-span-2 rounded border border-border bg-background px-1.5 py-1" value={promptKind} onChange={(e) => setPromptKind(e.target.value as PromptKind)} disabled={mode === "audit"}>
            {Object.entries(PROMPT_LABEL).map(([k, v]) => <option key={k} value={k}>Generate: {v}</option>)}
          </select>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1.5"><Switch checked={liveCrawl} onCheckedChange={setLiveCrawl} /> Live crawl</label>
          <label className="flex items-center gap-1.5"><Switch checked={continuous} onCheckedChange={(v) => { setContinuous(v); void saveSettings({ continuous: v }); }} /> Continuous</label>
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {(Object.keys(AUDIT_LABEL) as AuditKind[]).map((k) => (
            <Button key={k} size="sm" variant={k === "everything" ? "default" : "outline"} className="h-7 px-2 text-[11px]" disabled={Boolean(running)} onClick={() => void run(k)}>
              {AUDIT_LABEL[k].replace("Audit ", "")}
            </Button>
          ))}
          {running ? (
            <Button size="sm" variant="destructive" className="h-7 px-2 text-[11px]" onClick={() => abortRef.current?.abort()}>
              <Square className="size-3" /> Stop
            </Button>
          ) : null}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 text-sm">
        <div className="panel mb-3 p-2 text-xs">
          <div className="font-medium">Static analysis · score {audit.score}/100</div>
          <div className="mt-1 text-muted-foreground">
            {audit.files} files · {audit.routes.length} routes · {audit.deadLinks.length} dead links · {audit.orphanRoutes.length} orphan routes · {audit.placeholders.length} placeholders · {audit.brokenImports.length} broken imports · {audit.missingPackages.length} undeclared packages
          </div>
          <div className="mt-1 text-muted-foreground">
            Blockers {sev["blocker"] ?? 0} · Major {sev["major"] ?? 0} · Minor {sev["minor"] ?? 0}
          </div>
          {crawl ? (
            <div className="mt-2 space-y-0.5">
              <div className="font-medium">Live crawl</div>
              {crawl.map((c) => (
                <div key={c.route} className={c.verdict === "ok" ? "" : "text-destructive"}>
                  {c.route} — HTTP {c.status} · {c.verdict}
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {running ? (
          <div className="panel p-2">
            <div className="label-mono mb-1">{AUDIT_LABEL[running]} — working…</div>
            {stream ? <Markdown source={stream} /> : <p className="text-xs text-muted-foreground">Waiting for the auditor…</p>}
          </div>
        ) : open ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium">{AUDIT_LABEL[open.kind as AuditKind] ?? open.kind}</span>
              <span className="label-mono">score {open.score ?? "—"} · {open.engine}</span>
              <button className="ml-auto text-xs text-muted-foreground underline" onClick={() => setOpenId(null)}>Back to history</button>
            </div>
            <div className="panel p-2"><Markdown source={open.report} /></div>
            {open.corrective_prompt ? (
              <div className="panel border-primary/40 p-2">
                <div className="mb-1 flex items-center gap-1">
                  <span className="text-xs font-semibold">Corrective prompt for AI 1</span>
                  <Button size="sm" variant="ghost" className="ml-auto h-6 px-1.5 text-[11px]" onClick={() => { void navigator.clipboard.writeText(open.corrective_prompt); toast.success("Copied"); }}>
                    <Copy className="size-3" /> Copy
                  </Button>
                  <Button size="sm" className="h-6 px-1.5 text-[11px]" onClick={() => props.onUsePrompt(open.corrective_prompt)}>
                    <Send className="size-3" /> Send to AI 1
                  </Button>
                </div>
                <Markdown source={open.corrective_prompt} />
              </div>
            ) : null}
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="label-mono">Audit history</div>
            {history.length === 0 ? (
              <p className="text-xs text-muted-foreground">No audits yet. Pick an audit above. AI 2 never changes files — Send to AI 1 only fills the Coder's prompt box for you to review.</p>
            ) : (
              history.map((h) => (
                <button key={h.id} className="panel block w-full p-2 text-left text-xs hover:border-primary" onClick={() => setOpenId(h.id)}>
                  <div className="font-medium">{AUDIT_LABEL[h.kind as AuditKind] ?? h.kind} · score {h.score ?? "—"}</div>
                  <div className="text-muted-foreground">{new Date(h.created_at).toLocaleString()} · {h.engine} · {MODE_LABEL[h.mode as AuditMode] ?? h.mode}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
      )}
    </div>
  );
}
