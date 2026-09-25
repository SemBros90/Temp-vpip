import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ShieldCheck, Play, RotateCw, Ban } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, relTime } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { useEngine } from "@/components/vpip/common";
import { completeChat } from "@/lib/vpip/ai";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  FRAMEWORK_REGISTRY, HOST_REGISTRY, WIZARD_QUESTIONS, NOT_DECIDED, resolveConfig, runAssurance, checkCompleteness, computeMissingFiles,
  type AssuranceReport, type AuditEntry, type BuildConfig, type RepairMode, type Assumption,
} from "@/lib/vpip/build-assurance";

export const Route = createFileRoute("/projects/$projectId/assurance")({
  head: () => ({
    meta: [
      { title: "Build Assurance — VPIP" },
      { name: "description", content: "Build configuration wizard, assumption register, pre-compile gates and Build Success Certificate for generated projects." },
      { property: "og:title", content: "Build Assurance — VPIP" },
      { property: "og:description", content: "A generated project only counts once it technically runs." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssurancePage,
});

interface Row {
  config: BuildConfig;
  assumptions: Assumption[];
  repair_mode: RepairMode;
  last_report: AssuranceReport | null;
  audit: AuditEntry[];
}
const empty: Row = { config: {}, assumptions: [], repair_mode: "approval", last_report: null, audit: [] };
const db = supabase as unknown as { from: (t: string) => any };

function AssurancePage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const generated = p.buildSessions.filter((b) => !b.repositoryId);
  const [buildId, setBuildId] = useState<string | undefined>(generated[0]?.id);
  const build = generated.find((b) => b.id === buildId);
  const [row, setRow] = useState<Row>(empty);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!buildId) return;
    setLoading(true);
    db.from("vpip_build_assurance").select("*").eq("build_session_id", buildId).maybeSingle()
      .then(({ data, error }: any) => {
        if (error) toast.error(`Could not load: ${error.message}`);
        setRow(data ? { ...empty, ...data } : empty);
        setLoading(false);
      });
  }, [buildId]);

  async function save(next: Row) {
    setRow(next);
    const { error } = await db.from("vpip_build_assurance").upsert({
      build_session_id: buildId, project_id: projectId, ...next, updated_at: new Date().toISOString(),
    });
    if (error) toast.error(`Save failed: ${error.message}`);
  }

  const resolved = useMemo(() => resolveConfig(row.config), [row.config]);
  const actions = useVpipActions();
  const { provider, cfg } = useEngine();
  const [recovering, setRecovering] = useState<string | null>(null);
  const planned = build?.buildPlan?.files.map((f) => f.path) ?? [];
  const gate = useMemo(
    () => checkCompleteness((build?.files ?? []).map((f) => ({ path: f.path, content: f.content })), planned),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [build?.files, build?.buildPlan],
  );
  const missing = useMemo(
    () => computeMissingFiles((build?.files ?? []).map((f) => ({ path: f.path, content: f.content })), planned),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [build?.files, build?.buildPlan],
  );

  async function runtimeEvidence() {
    if (!buildId) return undefined;
    const { data } = await db.from("vpip_runtime_sandboxes").select("status,phase,destroyed_at,updated_at")
      .eq("build_id", buildId).is("destroyed_at", null).order("updated_at", { ascending: false }).limit(1);
    const r = data?.[0] as { status: string; phase: string } | undefined;
    if (!r) return undefined;
    const running = ["running", "preview_ready"].includes(r.phase);
    return { installed: running || r.phase === "installed", running, previewReady: r.phase === "preview_ready", fatalErrors: r.phase === "runtime_failed" ? 1 : 0 };
  }

  async function validate(base: Row = row, extra: AuditEntry[] = []) {
    if (!build) return;
    const report = runAssurance({
      files: (build.files ?? []).map((f) => ({ path: f.path, content: f.content })),
      plannedFiles: planned,
      hostingId: resolved.effective.hosting,
      requirements: (build.requirements ?? []).map((r) => ({ code: r.code, title: r.title, status: r.status, files: r.files })),
      runtime: await runtimeEvidence(),
    });
    const fa = report.frameworkFiles;
    const faRows = fa?.rows ?? [];
    const entries: AuditEntry[] = [
      { at: report.at, stage: "Framework Required File Audit", result: fa?.complete ? "PASS" : "FAIL", errors: faRows.filter((r) => r.status !== "VALID").length + (fa?.framework ? 0 : 1),
        repairs: `Framework: ${fa?.framework ?? "none"} · Method: ${fa?.method ?? fa?.source ?? "—"} · Expected: ${faRows.map((r) => r.required).join(", ") || "—"} · Found: ${faRows.filter((r) => r.exists).map((r) => r.found ?? r.required).join(", ") || "none"} · Missing: ${faRows.filter((r) => !r.exists).map((r) => r.required).join(", ") || "none"} · Invalid: ${faRows.filter((r) => r.status === "INVALID").map((r) => r.found ?? r.required).join(", ") || "none"}` },
      { at: report.at, stage: "Planned / Created / Missing / Extra files", result: report.completeness?.complete ? "PASS" : "FAIL", errors: report.completeness?.missing.length ?? 0, repairs: `${report.completeness?.planned.length ?? 0} / ${report.completeness?.created.length ?? 0} / ${report.completeness?.missing.length ?? 0} / ${report.completeness?.extra.length ?? 0}` },
      ...report.stages.map((s) => ({ at: report.at, stage: s.label, result: s.result, errors: s.errors.length, repairs: "—" })),
    ];
    await save({ ...base, last_report: report, audit: [...extra, ...entries, ...base.audit].slice(0, 500) });
    toast[report.compileAllowed ? "success" : "error"](
      !report.completeness?.complete ? "GENERATION INCOMPLETE — build blocked" : report.compileAllowed ? "Pre-compile gates passed" : "BUILD BLOCKED — compile not allowed",
    );
  }

  /**
   * Missing File Elimination Loop — structural, no approval needed.
   * Expected = Framework ∪ Planned ∪ Import targets ∪ Route targets. Generate every missing file,
   * re-scan, repeat until Missing File Count = 0 or MAX cycles. Business logic is never repaired here.
   */
  async function recover() {
    if (!build) return;
    const MAX = 5;
    const have = new Map((build.files ?? []).map((f) => [f.path.replace(/^\/+/, ""), f.content]));
    const scan = () => computeMissingFiles([...have].map(([path, content]) => ({ path, content })), planned).missing;
    const plan = build.buildPlan;
    const log: AuditEntry[] = [];
    const now = () => new Date().toISOString();
    let cycle = 0;
    let left = scan();
    try {
      while (left.length && cycle < MAX) {
        cycle++;
        log.unshift({ at: now(), stage: `Missing File Elimination · cycle ${cycle}`, result: "FAIL", errors: left.length, repairs: `Detected: ${left.map((m) => m.path).join(", ")}` });
        const created: string[] = [];
        for (const mf of left) {
          setRecovering(`Cycle ${cycle}/${MAX} · ${mf.path}`);
          const pf = plan?.files.find((f) => f.path.replace(/^\/+/, "") === mf.path);
          const tree = [...have.keys()].sort().join("\n");
          const refs = mf.referencedBy.map((r) => `--- ${r}\n${(have.get(r) ?? "").slice(0, 4000)}`).join("\n\n");
          try {
            const raw = await completeChat(provider, cfg, [
              { role: "system", content: "You create exactly ONE missing file so an existing project is structurally complete. Match every name the referencing files import from it (default and named exports). Keep it minimal and valid; do not invent business features. Output only the complete file content — no explanations, no markdown fences, no ellipses." },
              { role: "user", content: `File to create: ${mf.path}\nWhy expected: ${mf.sources.join(", ")}${pf ? `\nPlanned purpose: ${pf.purpose}` : ""}\n\nExisting project files:\n${tree}\n\nFiles that reference it:\n${refs || "(none)"}${plan ? `\n\nBuild plan:\n${plan.markdown.slice(0, 5000)}` : ""}` },
            ]);
            const content = raw.replace(/^\s*```[\w-]*\n/, "").replace(/\n```\s*$/, "");
            if (content.trim()) {
              actions.writeCoderFile(build.id, mf.path, content, { note: "Build Assurance · Missing File Elimination", trace: { buildCode: build.code, promptId: build.promptId, promptVersion: build.promptVersion, decisionCodes: [], requirementCodes: pf?.requirements ?? [], documentIds: [], discussionIds: [] }, provider, model: cfg.model });
              have.set(mf.path, content);
              created.push(mf.path);
            }
          } catch (e) {
            log.unshift({ at: now(), stage: `Missing File Elimination · cycle ${cycle}`, result: "FAIL", errors: 1, repairs: `${mf.path} — ${(e as Error).message}` });
          }
        }
        left = scan();
        log.unshift({ at: now(), stage: `Missing File Elimination · cycle ${cycle} result`, result: left.length ? "FAIL" : "PASS", errors: left.length, repairs: `Created: ${created.join(", ") || "none"} · Remaining missing: ${left.length}` });
      }
      log.unshift({ at: now(), stage: "Missing File Elimination summary", result: left.length ? "FAIL" : "PASS", errors: left.length, repairs: left.length ? `Max cycles (${MAX}) reached — ${left.length} still missing: ${left.map((m) => m.path).join(", ")}` : `Missing File Count = 0 after ${cycle} cycle(s)` });
      toast[left.length ? "error" : "success"](left.length ? `${left.length} files still missing after ${cycle} cycles` : "Missing File Count = 0 — re-run Build Assurance");
      await save({ ...row, audit: [...log, ...row.audit].slice(0, 500) });
    } finally {
      setRecovering(null);
    }
  }

  return (
    <Shell title="Build Assurance" subtitle="Generated projects only — a build counts only when it runs">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {generated.length === 0 ? (
          <EmptyState title="No generated builds" description="Build Assurance applies to builds VPIP generates. Imported repositories use the Runtime Validation Center." />
        ) : (
          <>
            <div className="flex items-center gap-2">
              <Select value={buildId ?? ""} onValueChange={setBuildId}>
                <SelectTrigger className="w-[360px]"><SelectValue placeholder="Pick a build" /></SelectTrigger>
                <SelectContent>
                  {generated.map((b) => <SelectItem key={b.id} value={b.id}>{b.code} · {b.promptTitle}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button onClick={() => void validate()} disabled={loading || !build || !!recovering}><Play className="mr-1 size-4" />Run Build Assurance</Button>
            </div>
            {build && (
              <div className={cn("panel space-y-2 px-4 py-3 text-sm", (!gate.complete || missing.missing.length > 0) && "border-destructive")}>
                <div className="flex items-center gap-2 font-medium">
                  {missing.missing.length === 0 ? <ShieldCheck className="size-4 text-success" /> : <Ban className="size-4 text-destructive" />}
                  Phase 0 · Missing File Elimination —{" "}
                  <span className={cn("font-mono", missing.missing.length === 0 ? "text-success" : "text-destructive")}>
                    Missing File Count {missing.missing.length}{missing.missing.length ? " · BUILD BLOCKED" : " · CLEAR"}
                  </span>
                </div>
                <div className="font-mono text-xs">Expected {missing.expected.length} (framework + planned + imports + routes) · Planned {gate.planned.length} · Created {gate.created.length} · Extra {gate.extra.length}{planned.length === 0 ? " · no build plan" : ""}</div>
                {missing.missing.length > 0 && (
                  <>
                    <p className="text-xs text-muted-foreground">Validation, Compile, Runtime, Browser Preview, Repair and Deployment are blocked until Missing File Count = 0. Missing files are structural, so they are created without approval.</p>
                    <ul className="max-h-40 overflow-y-auto font-mono text-xs text-destructive">{missing.missing.map((m) => <li key={m.path}>- {m.path} <span className="text-muted-foreground">({m.sources.join(", ")})</span></li>)}</ul>
                    <Button size="sm" variant="outline" onClick={() => void recover()} disabled={!!recovering}>
                      <RotateCw className={cn("mr-1 size-4", recovering && "animate-spin")} />
                      {recovering ?? "Eliminate missing files (auto loop, max 5 cycles)"}
                    </Button>
                  </>
                )}
                {gate.extra.length > 0 && (
                  <details className="text-xs"><summary className="cursor-pointer text-muted-foreground">Extra files (not in plan): {gate.extra.length}</summary>
                    <ul className="font-mono">{gate.extra.map((m) => <li key={m}>{m}</li>)}</ul></details>
                )}
              </div>
            )}
            <Tabs defaultValue="wizard">
              <TabsList>
                <TabsTrigger value="wizard">Build configuration</TabsTrigger>
                <TabsTrigger value="assumptions">Assumptions ({resolved.assumptions.length})</TabsTrigger>
                <TabsTrigger value="certificate">Certificate</TabsTrigger>
                <TabsTrigger value="repair">Repair mode</TabsTrigger>
                <TabsTrigger value="audit">Audit log</TabsTrigger>
                <TabsTrigger value="registry">Registries</TabsTrigger>
              </TabsList>

              <TabsContent value="wizard" className="grid gap-3 sm:grid-cols-2">
                {WIZARD_QUESTIONS.map((q) => (
                  <div key={q.key} className="panel space-y-1 px-3 py-2">
                    <div className="label-mono">{q.label}</div>
                    <Select value={row.config[q.key] ?? NOT_DECIDED}
                      onValueChange={(v) => { const config = { ...row.config, [q.key]: v }; void save({ ...row, config, assumptions: resolveConfig(config).assumptions }); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{q.options.map((o) => <SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
                    </Select>
                    <div className="text-xs text-muted-foreground">Used: {resolved.effective[q.key]}</div>
                  </div>
                ))}
              </TabsContent>

              <TabsContent value="assumptions">
                {resolved.assumptions.length === 0 ? <p className="text-sm text-muted-foreground">No assumptions — every choice was decided.</p> : (
                  <ul className="space-y-1">{resolved.assumptions.map((a) => (
                    <li key={a.code} className="panel px-3 py-2 text-sm"><span className="font-mono">{a.code}</span> {a.statement}</li>
                  ))}</ul>
                )}
              </TabsContent>

              <TabsContent value="certificate">
                {!row.last_report ? <p className="text-sm text-muted-foreground">Run Build Assurance to produce the certificate.</p> : (
                  <div className="panel space-y-2 px-4 py-3">
                    <div className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4" />Build Success Certificate · {relTime(row.last_report.at)}</div>
                    <div className="label-mono">Framework Required File &amp; Integrity Audit{row.last_report.frameworkFiles?.framework ? ` · ${row.last_report.frameworkFiles.framework} (from ${row.last_report.frameworkFiles.source})` : ""}</div>
                    {!row.last_report.frameworkFiles ? <p className="text-xs text-muted-foreground">Run Build Assurance again to produce this audit.</p> : (
                      <table className="w-full text-xs">
                        <thead><tr className="text-left text-muted-foreground"><th className="py-1 pr-2">File</th><th className="py-1 pr-2">Expected Location</th><th className="py-1 pr-2">Exists</th><th className="py-1 pr-2">Valid</th><th className="py-1">Status</th></tr></thead>
                        <tbody>{row.last_report.frameworkFiles.rows.map((r) => {
                          const st = r.status ?? (r.exists ? "VALID" : "MISSING");
                          return (
                          <tr key={r.expected} className="border-t border-border align-top">
                            <td className="py-1 pr-2 font-mono">{r.found ?? r.required}</td>
                            <td className="py-1 pr-2 font-mono text-muted-foreground">{r.expected}</td>
                            <td className={cn("py-1 pr-2 font-mono font-semibold", r.exists ? "text-success" : "text-destructive")}>{r.exists ? "Yes" : "No"}</td>
                            <td className={cn("py-1 pr-2 font-mono font-semibold", st === "VALID" ? "text-success" : "text-destructive")}>{st === "MISSING" ? "—" : st === "VALID" ? "Yes" : "No"}</td>
                            <td className={cn("py-1 font-mono font-semibold", st === "VALID" ? "text-success" : st === "INVALID" ? "text-warning" : "text-destructive")}>
                              {st === "VALID" ? "✓ Exists and Valid" : st === "INVALID" ? "⚠ Exists but Invalid" : "✗ Missing"}
                              {r.problems?.length ? <div className="font-normal text-muted-foreground">{r.problems.join("; ")}</div> : null}
                            </td>
                          </tr>
                        ); })}</tbody>
                      </table>
                    )}
                    <table className="w-full text-xs"><tbody>
                      {row.last_report.stages.map((s) => (
                        <tr key={s.id} className="border-t border-border align-top">
                          <td className="py-1 pr-2">{s.label}{s.note ? <div className="text-muted-foreground">{s.note}</div> : null}</td>
                          <td className={cn("py-1 font-mono font-semibold", s.result === "PASS" ? "text-success" : s.result === "FAIL" ? "text-destructive" : "text-muted-foreground")}>{s.result}</td>
                          <td className="py-1 font-mono text-muted-foreground">{s.errors.slice(0, 8).join("\n")}{s.errors.length > 8 ? `\n+${s.errors.length - 8} more` : ""}</td>
                        </tr>
                      ))}
                    </tbody></table>
                    <div className="text-sm">Technical Build Score <span className="font-mono font-semibold">{row.last_report.score}%</span> · Compile {row.last_report.compileAllowed ? "allowed" : "BLOCKED"}</div>
                    <div className={cn("font-mono text-sm font-semibold", row.last_report.verified ? "text-success" : "text-destructive")}>FINAL STATUS: {row.last_report.verified ? "BUILD VERIFIED" : "NOT VERIFIED"}</div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="repair" className="panel space-y-2 px-4 py-3 text-sm">
                <div className="label-mono">Repair mode for this build</div>
                <Select value={row.repair_mode} onValueChange={(v) => void save({ ...row, repair_mode: v as RepairMode })}>
                  <SelectTrigger className="w-[260px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="approval">Approval — I approve each repair</SelectItem>
                    <SelectItem value="auto">Auto — repair loop runs on its own</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Applies to generated builds only; imported repositories are never repaired automatically. Auto Recovery of missing planned files is available on the gate above; code repair loops arrive later.</p>
              </TabsContent>

              <TabsContent value="audit">
                {row.audit.length === 0 ? <p className="text-sm text-muted-foreground">No validation runs yet.</p> : (
                  <table className="w-full text-xs"><thead className="label-mono"><tr><th className="text-left">Time</th><th className="text-left">Stage</th><th className="text-left">Result</th><th className="text-left">Errors</th><th className="text-left">Repairs</th></tr></thead>
                    <tbody>{row.audit.map((a, i) => (
                      <tr key={i} className="border-t border-border"><td>{new Date(a.at).toLocaleString()}</td><td>{a.stage}</td><td className="font-mono">{a.result}</td><td>{a.errors}</td><td>{a.repairs}</td></tr>
                    ))}</tbody></table>
                )}
              </TabsContent>

              <TabsContent value="registry" className="grid gap-3 md:grid-cols-2 text-xs">
                <div className="panel px-3 py-2"><div className="label-mono mb-1">Framework registry</div>
                  {FRAMEWORK_REGISTRY.map((f) => <div key={f.id}><span className="font-mono">{f.id}</span> — {[...f.mandatoryFiles, ...(f.anyOfFiles ?? []).map((g) => g.join("|")), ...(f.requiredDirs ?? []).map((d) => d + "/")].join(", ") || "—"}</div>)}
                </div>
                <div className="panel px-3 py-2"><div className="label-mono mb-1">Host profile registry</div>
                  {HOST_REGISTRY.map((h) => <div key={h.id}><span className="font-mono">{h.label}</span> — {h.requiredFiles.map((g) => g.join("|")).join(", ") || "no mandatory files"}</div>)}
                </div>
              </TabsContent>
            </Tabs>
          </>
        )}
      </div>
    </Shell>
  );
}
