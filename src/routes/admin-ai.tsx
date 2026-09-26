import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { AdminRecovery } from "@/components/vpip/AdminRecovery";
import { Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Markdown } from "@/lib/vpip/markdown";
import { supabase } from "@/integrations/supabase/client";
import { streamChat } from "@/lib/vpip/ai";
import { useVpip } from "@/lib/vpip/store";
import { PROVIDER_LABEL, type ProviderConfig, type ProviderId } from "@/lib/vpip/types";
import {
  adminSystemPrompt,
  buildContext,
  BUILD_CONFIG_RE,
  compareBranches,
  loadRepo,
  readFile,
  REPORT_KINDS,
  reportInstruction,
  type AdminRepoData,
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
type Tab = "repository" | "recovery" | "inputs" | "chat" | "reports";
type Engine = "lovable" | ProviderId;

interface Msg { id?: string; role: "user" | "assistant"; content: string; created_at?: string }
interface Report { id: string; kind: string; title: string; content: string; status: string; engine: string | null; created_at: string }

function AdminAiPage() {
  const { ws } = useVpip();
  const [tab, setTab] = useState<Tab>("repository");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [token, setToken] = useState("");
  const [engine, setEngine] = useState<Engine>("lovable");
  const [data, setData] = useState<AdminRepoData | null>(null);
  const [loadingRepo, setLoadingRepo] = useState(false);
  const [repoError, setRepoError] = useState("");
  const [filter, setFilter] = useState("");
  const [openFile, setOpenFile] = useState<{ path: string; content: string } | null>(null);
  const [pinned, setPinned] = useState<Array<{ path: string; content: string }>>([]);
  const [configFiles, setConfigFiles] = useState<Array<{ path: string; content: string }>>([]);
  const [snapshots, setSnapshots] = useState<Array<{ label: string; created_at: string; project: string; files: Array<{ path: string; content?: string }> }>>([]);
  const [shaCmp, setShaCmp] = useState({ base: "", head: "", out: "" });
  const autoTried = useRef(false);
  const [cmp, setCmp] = useState<{ base: string; head: string; out: string }>({ base: "", head: "", out: "" });

  const [ai1, setAi1] = useState<Array<{ created_at: string; report: string; project_id: string }>>([]);
  const [ai2, setAi2] = useState<Array<{ created_at: string; kind: string; score: number | null; report: string; project_id: string }>>([]);
  const [feedback, setFeedback] = useState<Array<{ id: string; kind: string; content: string; created_at: string }>>([]);
  const [fbKind, setFbKind] = useState("Feedback");
  const [fbText, setFbText] = useState("");

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [stream, setStream] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [openReport, setOpenReport] = useState<Report | null>(null);

  const loadAll = useCallback(async () => {
    const [s, m, r, f, a1, a2, sn] = await Promise.all([
      db.from("vpip_admin_ai_settings").select("*").eq("id", "default").maybeSingle(),
      db.from("vpip_admin_ai_messages").select("*").order("created_at", { ascending: true }).limit(200),
      db.from("vpip_admin_ai_reports").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("vpip_admin_ai_feedback").select("*").order("created_at", { ascending: false }).limit(100),
      db.from("vpip_ai1_reports").select("created_at,report,project_id").order("created_at", { ascending: false }).limit(15),
      db.from("vpip_ai2_audits").select("created_at,kind,score,report,project_id").order("created_at", { ascending: false }).limit(15),
      db.from("vpip_repo_snapshots").select("label,created_at,project_id,files").order("created_at", { ascending: false }).limit(3),
    ]);
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

  async function saveSettings(next?: Partial<{ repo: string; branch: string; engine: Engine }>) {
    const { error } = await db.from("vpip_admin_ai_settings").upsert({
      id: "default",
      repo_full_name: (next?.repo ?? repo).trim(),
      branch: next?.branch ?? branch,
      token,
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
      await saveSettings({ repo: name, branch: b });
    } catch (e) {
      setData(null);
      setRepoError(e instanceof Error ? e.message : "Could not reach GitHub.");
    } finally {
      setLoadingRepo(false);
    }
  }

  async function open(path: string) {
    try {
      setOpenFile({ path, content: await readFile(token, repo, branch, path) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read file.");
    }
  }

  function resolve(): { provider: ProviderId; cfg: ProviderConfig } {
    const base = ws.settings.providers[ws.settings.defaultProvider];
    if (engine === "lovable") return { provider: "lovable" as ProviderId, cfg: { ...base, model: LOVABLE_MODEL, apiKey: "" } };
    return { provider: engine, cfg: ws.settings.providers[engine] ?? base };
  }
  const engineLabel = engine === "lovable" ? "Lovable AI" : (PROVIDER_LABEL[engine] ?? engine);

  const context = useMemo(
    () => buildContext({ repo, branch, data, error: repoError, configFiles, snapshots, tree: data?.tree ?? [], pinned, ai1, ai2, feedback }),
    [repo, branch, data, repoError, configFiles, snapshots, pinned, ai1, ai2, feedback],
  );

  async function run(userText: string, history: Msg[], kind?: ReportKind, extra?: { instruction: string; context: string }) {
    const { provider, cfg } = resolve();
    const ctrl = new AbortController();
    abort.current = ctrl;
    setStream("");
    try {
      return await streamChat(
        provider,
        cfg,
        [{ role: "system", content: adminSystemPrompt(extra ? `${context}\n\n# Recovery evidence\n${extra.context}` : context) }, ...history.map((m) => ({ role: m.role, content: m.content })), { role: "user", content: extra ? extra.instruction : kind ? reportInstruction(kind) : userText }],
        (d) => setStream((s) => (s ?? "") + d),
        ctrl.signal,
      );
    } finally {
      setStream(null);
      abort.current = null;
    }
  }

  async function send() {
    const text = input.trim();
    if (!text || stream !== null) return;
    setInput("");
    const history = msgs.slice(-20);
    setMsgs((m) => [...m, { role: "user", content: text }]);
    await db.from("vpip_admin_ai_messages").insert({ role: "user", content: text });
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
      }
      const full = await run(prompt, history);
      setMsgs((m) => [...m, { role: "assistant", content: full }]);
      await db.from("vpip_admin_ai_messages").insert({ role: "assistant", content: full, engine: engineLabel, model: resolve().cfg.model });
    } catch (e) {
      if ((e as Error).name !== "AbortError") toast.error(e instanceof Error ? e.message : "Admin AI failed.");
    }
  }

  async function generate(kind: ReportKind) {
    if (stream !== null) return;
    setTab("reports");
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
    setTab("reports");
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
  const projName = (id: string) => ws.projects.find((p) => p.id === id)?.name ?? "project";

  return (
    <Shell
      title="Admin AI"
      subtitle="Improves VPIP itself — advisory only. Nothing is committed, merged or deployed without your approval."
      scroll={false}
      actions={
        <div className="flex items-center gap-2">
          <select
            className="rounded border border-border bg-background px-2 py-1 text-xs"
            value={engine}
            onChange={(e) => {
              const v = e.target.value as Engine;
              setEngine(v);
              void saveSettings({ engine: v });
            }}
          >
            <option value="lovable">Lovable AI · {LOVABLE_MODEL}</option>
            {(Object.keys(ws.settings.providers) as ProviderId[]).map((id) => (
              <option key={id} value={id}>
                {PROVIDER_LABEL[id] ?? id} · {ws.settings.providers[id]?.model}
              </option>
            ))}
          </select>
          {stream !== null ? (
            <Button size="sm" variant="outline" onClick={() => abort.current?.abort()}>Stop</Button>
          ) : null}
        </div>
      }
    >
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex shrink-0 gap-1 border-b border-border px-6 pt-2">
          {(["repository", "recovery", "inputs", "chat", "reports"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-t px-3 py-1.5 text-xs font-medium capitalize ${tab === t ? "bg-surface text-foreground border border-b-0 border-border" : "text-muted-foreground hover:text-foreground"}`}
            >
              {t === "recovery" ? "Snapshots & Recovery" : t === "inputs" ? "Inputs & Feedback" : t === "reports" ? "Improvement Reports" : t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {tab === "repository" ? (
            <div className="space-y-4">
              <div className="grid gap-2 rounded-md border border-border bg-surface p-4 md:grid-cols-[1fr_1fr_auto]">
                <Input placeholder="VPIP repository, e.g. SemBros90/vpip" value={repo} onChange={(e) => setRepo(e.target.value)} />
                <Input type="password" placeholder="GitHub token (read access; optional for public repos)" value={token} onChange={(e) => setToken(e.target.value)} />
                <Button onClick={() => void connect()} disabled={loadingRepo}>{loadingRepo ? "Connecting…" : data ? "Reload" : "Connect"}</Button>
                {repoError ? <div className="text-xs text-destructive md:col-span-3">{repoError}</div> : null}
                <div className="label-mono md:col-span-3">Read-only access: tree, files, branches, commits, pull requests, issues. Admin AI never writes to GitHub.</div>
              </div>

              <div className="grid gap-2 rounded-md border border-border bg-surface p-4 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div className="sm:col-span-3 lg:col-span-6 text-sm font-semibold">Repository Status</div>
                <Stat k="Repository Connected" v={loadingRepo ? "Checking…" : data ? "Yes" : "No"} />
                <Stat k="Repository Name" v={data ? repo : "—"} />
                <Stat k="Branch" v={data ? branch : "—"} />
                <Stat k="Commit" v={data?.headSha ? data.headSha.slice(0, 7) : "—"} />
                <Stat k="Total Files" v={data ? `${data.fileCount}${data.truncated ? "+" : ""}` : "—"} />
                <Stat k="Last Sync Time" v={data ? new Date(data.syncedAt).toLocaleString() : "Never"} />
                {data ? <div className="label-mono sm:col-span-3 lg:col-span-6">Admin AI reads: file list, {configFiles.length} build/config files ({configFiles.map((f) => f.path).join(", ") || "none found"}), branches, commits, {snapshots.length} latest snapshots, and any file you name in chat.</div> : null}
              </div>

              {data ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="label-mono">Branch</span>
                    <select className="rounded border border-border bg-background px-2 py-1" value={branch} onChange={(e) => void connect(e.target.value)}>
                      {data.branches.map((b) => <option key={b}>{b}</option>)}
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
                            {pinned.some((p) => p.path === f.path) ? "● " : ""}{f.path}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="min-w-0 rounded-md border border-border bg-surface">
                      {openFile ? (
                        <>
                          <div className="flex items-center justify-between border-b border-border px-3 py-2">
                            <span className="truncate font-mono text-xs">{openFile.path}</span>
                            <Button size="sm" variant="outline" onClick={() => setPinned((p) => (p.some((x) => x.path === openFile.path) ? p.filter((x) => x.path !== openFile.path) : [...p, openFile]))}>
                              {pinned.some((p) => p.path === openFile.path) ? "Unpin" : "Pin for Admin AI"}
                            </Button>
                          </div>
                          <pre className="max-h-[480px] overflow-auto p-3 text-[11px] leading-relaxed">{openFile.content}</pre>
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

                  <div className="rounded-md border border-border bg-surface p-4">
                    <div className="mb-2 text-sm font-semibold">Compare branches</div>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {(["base", "head"] as const).map((k) => (
                        <select key={k} className="rounded border border-border bg-background px-2 py-1" value={cmp[k]} onChange={(e) => setCmp((c) => ({ ...c, [k]: e.target.value }))}>
                          <option value="">{k}…</option>
                          {data.branches.map((b) => <option key={b}>{b}</option>)}
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
                </>
              ) : null}
            </div>
          ) : null}

          {tab === "recovery" ? <AdminRecovery runAi={runRecovery} streaming={stream !== null} /> : null}

          {tab === "inputs" ? (
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-2">
                <div className="text-sm font-semibold">From AI 1 — build reports ({ai1.length})</div>
                {ai1.length ? ai1.map((r, i) => (
                  <details key={i} className="rounded border border-border bg-surface p-2 text-xs">
                    <summary className="cursor-pointer">{projName(r.project_id)} · {new Date(r.created_at).toLocaleString()}</summary>
                    <Markdown source={r.report} className="mt-2" />
                  </details>
                )) : <div className="text-xs text-muted-foreground">No AI 1 reports yet.</div>}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">From AI 2 — audits ({ai2.length})</div>
                {ai2.length ? ai2.map((r, i) => (
                  <details key={i} className="rounded border border-border bg-surface p-2 text-xs">
                    <summary className="cursor-pointer">{projName(r.project_id)} · {r.kind} · score {r.score ?? "—"}</summary>
                    <Markdown source={r.report} className="mt-2" />
                  </details>
                )) : <div className="text-xs text-muted-foreground">No AI 2 audits yet.</div>}
              </div>
              <div className="space-y-2">
                <div className="text-sm font-semibold">From you — feedback</div>
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
            </div>
          ) : null}

          {tab === "chat" ? (
            <div className="mx-auto flex h-full max-w-3xl flex-col">
              <div className="flex-1 space-y-3">
                {msgs.length === 0 && stream === null ? (
                  <div className="text-sm text-muted-foreground">Ask Admin AI about VPIP — e.g. "Why do AI 1 builds keep failing on routes?" It sees the connected repository, pinned files, AI 1/AI 2 reports and your feedback.</div>
                ) : null}
                {msgs.map((m, i) => (
                  <div key={m.id ?? i} className={m.role === "user" ? "ml-auto max-w-[80%] rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" : "text-sm"}>
                    {m.role === "user" ? m.content : <Markdown source={m.content} />}
                  </div>
                ))}
                {stream !== null ? <div className="text-sm"><Markdown source={stream || "Thinking…"} /></div> : null}
              </div>
              <div className="sticky bottom-0 mt-4 flex gap-2 bg-background pt-2">
                <Textarea rows={2} value={input} placeholder="Message Admin AI" onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send();
                  }
                }} />
                <Button onClick={() => void send()} disabled={stream !== null || !input.trim()}>Send</Button>
              </div>
            </div>
          ) : null}

          {tab === "reports" ? (
            <div className="space-y-4">
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
                        </div>
                      </div>
                      <Markdown source={openReport.content} />
                      <div className="label-mono mt-4">Approving only records your decision. Admin AI does not apply, commit or deploy anything.</div>
                    </>
                  ) : <div className="text-sm text-muted-foreground">Generate or pick a report.</div>}
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </Shell>
  );
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
