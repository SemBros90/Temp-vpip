import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, History, Loader2, RotateCcw, ShieldCheck, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { coderTrace } from "@/lib/vpip/coder";
import type { IngestionAudit } from "@/lib/vpip/git-remote";
import type { AnalyzerFile } from "@/lib/vpip/repo-analyzer";
import type { BuildSession, RepoReport, Repository } from "@/lib/vpip/types";
import {
  LOW_CONFIDENCE,
  applyOp,
  classifyExtended,
  createSnapshot,
  dependencyAudit,
  envAudit,
  listAudit,
  listProposals,
  listSnapshots,
  logAudit,
  readiness,
  saveProposals,
  saveReportExtras,
  simulateRepair,
  snapshotFiles,
  updateProposal,
  type AuditEntry,
  type RepairProposal,
  type RepoSnapshot,
} from "@/lib/vpip/safe-repair";
import { Section, Table } from "./RepoCompatibilityPanel";

const riskTone = (r: string) => (r === "Safe" ? "text-success" : r === "Medium Risk" ? "text-warning" : "text-destructive");

export function SafeRepairPanel({
  projectId,
  repository,
  build,
  report,
  env,
  runtimeErrors = [],
  onPreview,
}: {
  projectId: string;
  repository?: Repository | undefined;
  build?: BuildSession | undefined;
  report?: RepoReport | undefined;
  env: Record<string, string>;
  runtimeErrors?: string[];
  onPreview?: (() => void) | undefined;
}) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const user = ws.settings.author || "VPIP user";
  const files: AnalyzerFile[] = useMemo(() => (build?.files ?? []).map((f) => ({ path: f.path, content: f.content })), [build?.files]);
  const [snaps, setSnaps] = useState<Array<Omit<RepoSnapshot, "files">>>([]);
  const [proposals, setProposals] = useState<RepairProposal[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const repoId = repository?.id ?? build?.repositoryId;

  const refresh = useCallback(async () => {
    try {
      const [s, p, a] = await Promise.all([listSnapshots(projectId), listProposals(projectId), listAudit(projectId)]);
      setSnaps(s);
      setProposals(p);
      setAudit(a);
    } catch (e) {
      toast.error(`Could not load repair records: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [projectId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const zero = snaps.find((s) => s.isZero && (!build || s.buildSessionId === build.id)) ?? snaps.find((s) => s.isZero);
  const ingestion = zero?.metadata["ingestion"] as IngestionAudit | undefined;
  const cls = useMemo(() => classifyExtended(files), [files]);
  const envA = useMemo(() => envAudit(files, env), [files, env]);
  const depA = useMemo(() => dependencyAudit(files, report), [files, report]);
  const ready = useMemo(() => readiness(report, ingestion, envA, depA, runtimeErrors.length ? runtimeErrors : report?.previewDiagnostics.runtimeErrors ?? []), [report, ingestion, envA, depA, runtimeErrors]);

  async function wrap(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
      void refresh();
    }
  }

  const checkReadiness = () =>
    wrap("Checking readiness…", async () => {
      if (report) await saveReportExtras(report.id, { readiness: ready });
      await logAudit({ projectId, repositoryId: repoId, user, action: "Preview readiness check", files: [], dependencies: [], note: `Repository ${ready.repositoryIntegrity}% · Dependencies ${ready.dependencyIntegrity}% · Environment ${ready.environmentIntegrity}% · Preview ${ready.previewReadiness}% · ${ready.failures.length} exact failures` });
      onPreview?.();
    });

  const createZero = () =>
    wrap("Creating Rollback Point Zero…", async () => {
      if (!build || !files.length) throw new Error("No build files to snapshot.");
      const audit: IngestionAudit = { found: files.map((f) => f.path), imported: files.map((f) => f.path), ignored: files.filter((f) => f.content.startsWith("vpip-skipped:")).map((f) => ({ path: f.path, reason: "too large" })), failed: [], missing: [], at: new Date().toISOString() };
      audit.imported = audit.imported.filter((p) => !audit.ignored.some((i) => i.path === p));
      await createSnapshot({ projectId, repositoryId: repoId, buildSessionId: build.id, label: "Rollback Point Zero", isZero: true, files, metadata: { url: repository?.htmlUrl, branch: repository?.currentBranch, commitSha: repository?.lastCommitSha, createdFrom: "build files present in VPIP (imported before Rollback Point Zero existed)", ingestion: audit } });
      await logAudit({ projectId, repositoryId: repoId, user, action: "Create Rollback Point Zero", files: [], dependencies: [], note: `Snapshot of ${files.length} files from build ${build.code}` });
      toast.success("Rollback Point Zero created");
    });

  async function restoreFiles(target: AnalyzerFile[], note: string) {
    if (!build) throw new Error("No build to restore into.");
    const trace = coderTrace(build, [], []);
    const want = new Map(target.map((f) => [f.path, f.content]));
    const changed: string[] = [];
    for (const f of build.files ?? []) if (!want.has(f.path)) {
      actions.deleteCoderPath(build.id, f.path);
      changed.push(f.path);
    }
    for (const [path, content] of want) {
      const cur = build.files?.find((f) => f.path === path)?.content;
      if (cur !== content) {
        actions.writeCoderFile(build.id, path, content, { note, trace });
        changed.push(path);
      }
    }
    return changed;
  }

  const restore = (snap: Omit<RepoSnapshot, "files">) =>
    wrap(`Restoring ${snap.label}…`, async () => {
      if (!build) throw new Error("No build to restore into.");
      if (!window.confirm(`Restore "${snap.label}"? The current files are snapshotted first, so this can be undone.`)) return;
      await createSnapshot({ projectId, repositoryId: repoId, buildSessionId: build.id, label: `Before restoring ${snap.label}`, isZero: false, files, metadata: { reason: "automatic snapshot before restore" } });
      const target = await snapshotFiles(snap.id);
      const changed = await restoreFiles(target, `Restore ${snap.label}`);
      await logAudit({ projectId, repositoryId: repoId, user, action: "Restore snapshot", changeType: "Rollback", risk: "Safe", files: changed, dependencies: [], note: `Restored "${snap.label}" (${snap.createdAt}) — ${changed.length} files changed` });
      toast.success(`Restored ${snap.label} — ${changed.length} files`);
    });

  const simulate = () =>
    wrap("Simulating repair…", async () => {
      if (!report) throw new Error("Scan the repository first.");
      const list = simulateRepair(files, report, envA, depA, { projectId, repositoryId: repoId, buildSessionId: build?.id });
      await saveProposals(list);
      await logAudit({ projectId, repositoryId: repoId, user, action: "Repair simulation", files: [...new Set(list.flatMap((p) => p.files.map((f) => f.path)))], dependencies: list.flatMap((p) => p.dependencies.map((d) => `${d.op} ${d.name}${d.version ? "@" + d.version : ""}`)), note: `${list.length} proposals generated; zero changes made` });
      toast.success(list.length ? `${list.length} repair proposals — nothing changed yet` : "No repairs needed");
    });

  async function decide(p: RepairProposal, decision: "Approved" | "Rejected", work: AnalyzerFile[] = [...files]) {
    if (decision === "Rejected") {
      const next = { ...p, status: "Rejected" as const, decidedAt: new Date().toISOString(), decidedBy: user };
      await updateProposal(next);
      await logAudit({ projectId, repositoryId: repoId, user, action: "Reject", changeType: p.classification, risk: p.risk, confidence: p.confidence, files: p.files.map((f) => f.path), dependencies: p.dependencies.map((d) => d.name), note: p.fix });
      return;
    }
    if (!build) throw new Error("No build to apply changes to.");
    const approvedFiles = p.approvedFiles;
    if (!approvedFiles.length) throw new Error(`"${p.fix}": no files approved.`);
    const op = p.impact.op;
    if (op.kind === "env" && !(envValues[op.key] ?? "").trim()) throw new Error(`Enter a value for ${op.key} before approving.`);
    if (op.kind === "env" && !repoId) throw new Error("Connect a repository to store environment values.");
    const snap = await createSnapshot({ projectId, repositoryId: repoId, buildSessionId: build.id, label: `Before: ${p.fix}`, isZero: false, files: work, metadata: { proposalId: p.id, env: { ...env } } });
    await logAudit({ projectId, repositoryId: repoId, user, action: "Approve", changeType: p.classification, risk: p.risk, confidence: p.confidence, files: approvedFiles, dependencies: p.dependencies.map((d) => `${d.op} ${d.name}${d.version ? "@" + d.version : ""}`), note: p.fix });
    const trace = coderTrace(build, [], []);
    const modified: string[] = [];
    if (op.kind === "env") {
      actions.setRepoEnv(projectId, repoId!, op.key, envValues[op.key]!.trim());
      modified.push(`env:${op.key}`);
    } else {
      // Recompute against current files so several approved changes to one file stack correctly.
      for (const c of applyOp(work, op)) {
        if (!approvedFiles.includes(c.path)) continue;
        actions.writeCoderFile(build.id, c.path, c.after, { note: `Approved repair: ${p.fix}`, trace });
        const i = work.findIndex((f) => f.path === c.path);
        if (i >= 0) work[i] = { path: c.path, content: c.after };
        else work.push({ path: c.path, content: c.after });
        modified.push(c.path);
      }
    }
    const next = { ...p, status: "Applied" as const, snapshotId: snap.id, decidedAt: new Date().toISOString(), decidedBy: user };
    await updateProposal(next);
    await logAudit({ projectId, repositoryId: repoId, user, action: "Apply", changeType: p.classification, risk: p.risk, confidence: p.confidence, files: modified, dependencies: p.dependencies.map((d) => `${d.op} ${d.name}${d.version ? "@" + d.version : ""}`), note: `${p.fix} — snapshot ${snap.id}` });
  }

  const revert = (p: RepairProposal) =>
    wrap("Reverting…", async () => {
      if (!p.snapshotId || !build) throw new Error("No snapshot recorded for this change.");
      const op = p.impact.op;
      let changed: string[];
      if (op.kind === "env") {
        const s = snaps.find((x) => x.id === p.snapshotId);
        const prev = (s?.metadata["env"] as Record<string, string> | undefined)?.[op.key] ?? "";
        actions.setRepoEnv(projectId, repoId!, op.key, prev);
        changed = [`env:${op.key}`];
      } else {
        const target = await snapshotFiles(p.snapshotId);
        const trace = coderTrace(build, [], []);
        changed = [];
        for (const path of p.files.map((f) => f.path)) {
          const before = target.find((f) => f.path === path);
          if (before) actions.writeCoderFile(build.id, path, before.content, { note: `Revert: ${p.fix}`, trace });
          else actions.deleteCoderPath(build.id, path);
          changed.push(path);
        }
      }
      await updateProposal({ ...p, status: "Reverted", decidedAt: new Date().toISOString(), decidedBy: user });
      await logAudit({ projectId, repositoryId: repoId, user, action: "Revert", changeType: p.classification, risk: p.risk, confidence: p.confidence, files: changed, dependencies: p.dependencies.map((d) => d.name), note: `Reverted: ${p.fix}` });
      toast.success("Change reverted");
    });

  const approveOne = (p: RepairProposal, d: "Approved" | "Rejected") =>
    wrap(d === "Approved" ? "Applying…" : "Rejecting…", async () => {
      await decide(p, d);
      toast.success(d === "Approved" ? `Applied: ${p.fix}` : `Rejected: ${p.fix}`);
    });

  const batch = (d: "Approved" | "Rejected") =>
    wrap(d === "Approved" ? "Applying batch…" : "Rejecting batch…", async () => {
      const list = open.filter((p) => selected.has(p.id));
      if (!list.length) throw new Error("Select proposals first.");
      const work = [...files];
      for (const p of list) await decide(p, d, work);
      await logAudit({ projectId, repositoryId: repoId, user, action: d === "Approved" ? "Batch approve" : "Batch reject", files: list.flatMap((p) => p.approvedFiles), dependencies: list.flatMap((p) => p.dependencies.map((x) => x.name)), note: `${list.length} proposals` });
      setSelected(new Set());
      toast.success(`${list.length} proposals ${d === "Approved" ? "applied" : "rejected"}`);
    });

  const toggleFile = (p: RepairProposal, path: string, on: boolean) => {
    const next = { ...p, approvedFiles: on ? [...new Set([...p.approvedFiles, path])] : p.approvedFiles.filter((x) => x !== path) };
    setProposals((l) => l.map((x) => (x.id === p.id ? next : x)));
    void updateProposal(next);
  };

  const open = proposals.filter((p) => p.status === "Proposed");
  const latestSim = proposals[0]?.simulationId;
  const simList = proposals.filter((p) => p.simulationId === latestSim);

  return (
    <div className="rounded-md border border-border p-3 text-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ShieldCheck className="size-4 text-primary" />
        <strong>Safe Repair</strong>
        <span className="text-xs text-muted-foreground">Nothing changes without your approval. Every action is logged and reversible.</span>
        {busy ? (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> {busy}
          </span>
        ) : null}
      </div>
      <Tabs defaultValue="ingestion">
        <TabsList className="flex h-auto flex-wrap">
          <TabsTrigger value="ingestion">Ingestion Audit</TabsTrigger>
          <TabsTrigger value="classification">Classification</TabsTrigger>
          <TabsTrigger value="envdeps">Environment &amp; Dependencies</TabsTrigger>
          <TabsTrigger value="readiness">Preview Readiness</TabsTrigger>
          <TabsTrigger value="rollback">Rollback</TabsTrigger>
          <TabsTrigger value="repair">Repair Proposals{open.length ? ` (${open.length})` : ""}</TabsTrigger>
          <TabsTrigger value="audit">Audit Log</TabsTrigger>
        </TabsList>

        <TabsContent value="ingestion" className="space-y-3">
          {!ingestion ? (
            <p className="text-xs text-muted-foreground">
              This repository was imported before the ingestion audit existed. Pull it again to get a full file count from the source. {!zero && build ? "You can also create Rollback Point Zero from the files currently in VPIP (Rollback tab)." : ""}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                {(
                  [
                    ["Total Files Found", ingestion.found.length],
                    ["Total Files Imported", ingestion.imported.length],
                    ["Total Files Ignored", ingestion.ignored.length],
                    ["Total Files Failed", ingestion.failed.length],
                    ["Missing Files", ingestion.missing.length],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="rounded border border-border p-2">
                    <div className="text-[11px] text-muted-foreground">{k}</div>
                    <div className={`text-lg font-semibold ${k.startsWith("Missing") || k.includes("Failed") ? (v ? "text-destructive" : "text-success") : ""}`}>{v}</div>
                  </div>
                ))}
              </div>
              <Section title={`Missing files (${ingestion.missing.length})`}>
                <Table head={["Path"]} rows={ingestion.missing.map((m) => [m])} empty="No files lost — every file found was imported or explicitly ignored." />
              </Section>
              <Section title={`Ignored (${ingestion.ignored.length}) and failed (${ingestion.failed.length})`}>
                <Table head={["Path", "Status", "Reason"]} rows={[...ingestion.ignored.map((i) => [i.path, "Ignored", i.reason]), ...ingestion.failed.map((i) => [i.path, "Failed", i.reason])]} empty="None." />
              </Section>
              <Section title={`Imported files (${ingestion.imported.length})`}>
                <Table head={["Path"]} rows={ingestion.imported.slice(0, 2000).map((p) => [p])} empty="None." />
              </Section>
            </>
          )}
        </TabsContent>

        <TabsContent value="classification">
          <Table
            head={["Item", "Detected", "Evidence"]}
            rows={(
              [
                ["Framework", cls.framework],
                ["Package Manager", cls.packageManager],
                ["Build System", cls.buildSystem],
                ["Repository Type", cls.repositoryType],
                ["Monorepo Status", cls.monorepo],
                ["Deployment Platform", cls.deployment],
                ["CI/CD Platform", cls.cicd],
              ] as const
            ).map(([k, e]) => [k, <span key="v" className={e.value === "Unknown" ? "text-muted-foreground" : ""}>{e.value}</span>, e.evidence])}
            empty="No files."
          />
        </TabsContent>

        <TabsContent value="envdeps" className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Variables Required", envA.required.length],
                ["Variables Found", envA.found.length],
                ["Variables Missing", envA.missing.length],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded border border-border p-2">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="text-lg font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <Section title={`Environment variables — .env files preserved unchanged: ${envA.envFiles.join(", ") || "none in repository"}`}>
            <Table
              head={["Variable", "Status", "Where / used by"]}
              rows={[...envA.found.map((f) => [f.key, <span key="s" className="text-success">Found</span>, f.where]), ...envA.missing.map((m) => [m.key, <span key="s" className="text-destructive">Missing</span>, m.sources.join(", ")])]}
              empty="No environment variables are used by the code."
            />
          </Section>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              [
                ["Installed Dependencies", depA.installed.length],
                ["Missing Dependencies", depA.missing.length],
                ["Version Conflicts", depA.conflicts.length],
                ["Resolution Status", depA.status],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded border border-border p-2">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="text-lg font-semibold">{v}</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-muted-foreground">Manifests: {depA.manifests.join(", ") || "none"} · Lockfiles: {depA.lockfiles.join(", ") || "none"}{depA.lockSource ? ` (versions read from ${depA.lockSource})` : ""}</div>
          <Section title="Dependency problems">
            <Table
              head={["Package", "Problem", "Detail"]}
              rows={[
                ...depA.missing.map((m) => [m.name, "Missing", `used by ${m.usedBy.slice(0, 3).join(", ")}`]),
                ...depA.conflicts.map((c) => [c.name, "Version conflict", `requires ${c.required}, lockfile ${c.installed}`]),
                ...depA.invalid.map((n) => [n, "Invalid name", ""]),
                ...depA.unresolvedImports.map((u) => [u.spec, "Unresolved import", u.referencedBy]),
                ...depA.peer.filter((p) => !p.satisfied).map((p) => [p.name, "Peer not installed", `requires ${p.required}`]),
              ]}
              empty="No dependency problems."
            />
          </Section>
          <Section title={`Peer dependencies (${depA.peer.length})`}>
            <Table head={["Package", "Required", "Installed"]} rows={depA.peer.map((p) => [p.name, p.required, p.installed ?? "—"])} empty="No peer dependencies declared." />
          </Section>
          <Section title="Code problems (separate from dependencies)">
            <Table head={["Problem", "Import", "File", "Expected"]} rows={depA.codeProblems.map((c) => [c.kind, c.spec, c.referencedBy, c.expectedPath])} empty="No code problems." />
          </Section>
        </TabsContent>

        <TabsContent value="readiness" className="space-y-3">
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              [
                ["Repository Integrity", ready.repositoryIntegrity],
                ["Dependency Integrity", ready.dependencyIntegrity],
                ["Environment Integrity", ready.environmentIntegrity],
                ["Preview Readiness", ready.previewReadiness],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded border border-border p-2">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className={`text-lg font-semibold ${v >= 90 ? "text-success" : v >= 60 ? "text-warning" : "text-destructive"}`}>{v}%</div>
              </div>
            ))}
          </div>
          {!ingestion ? <p className="text-xs text-warning">Repository integrity is 0% because no ingestion audit exists for this import.</p> : null}
          <Button size="sm" className="h-8" disabled={!!busy} onClick={() => void checkReadiness()}>
            Run readiness check{onPreview ? " & open preview" : ""}
          </Button>
          <Section title={`Exact failures (${ready.failures.length})`}>
            <Table head={["File", "Dependency", "Environment variable", "Error"]} rows={ready.failures.map((f) => [f.file, f.dependency, f.envVar, f.error])} empty="No failures detected." />
          </Section>
        </TabsContent>

        <TabsContent value="rollback" className="space-y-3">
          {!zero && build ? (
            <Button size="sm" variant="outline" className="h-8" disabled={!!busy} onClick={() => void createZero()}>
              <History className="size-4" /> Create Rollback Point Zero from current build files
            </Button>
          ) : null}
          <Table
            head={["Snapshot", "Created", "Files", "Action"]}
            rows={[...snaps].reverse().map((s) => [
              <span key="l" className={s.isZero ? "font-semibold text-primary" : ""}>{s.label}{s.isZero ? " ★" : ""}</span>,
              new Date(s.createdAt).toLocaleString(),
              s.tree.length,
              <Button key="r" size="sm" variant="outline" className="h-6 px-2 text-xs" disabled={!!busy || !build} onClick={() => void restore(s)}>
                <RotateCcw className="size-3" /> Restore
              </Button>,
            ])}
            empty="No snapshots yet."
          />
          {zero ? (
            <Section title={`Rollback Point Zero metadata`}>
              <pre className="whitespace-pre-wrap text-[11px]">{JSON.stringify({ ...zero.metadata, ingestion: undefined }, null, 2)}</pre>
            </Section>
          ) : null}
        </TabsContent>

        <TabsContent value="repair" className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="h-8" disabled={!!busy || !report || !build} onClick={() => void simulate()}>
              <Wand2 className="size-4" /> Simulate repair (no changes)
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={!!busy || !selected.size} onClick={() => void batch("Approved")}>
              Batch approve ({selected.size})
            </Button>
            <Button size="sm" variant="outline" className="h-8" disabled={!!busy || !selected.size} onClick={() => void batch("Rejected")}>
              Batch reject
            </Button>
          </div>
          {latestSim ? (
            <Section title="Latest simulation — what would change">
              <Table
                head={["Files to change", "Dependencies to install", "Dependencies to remove", "Configurations to change", "Environment variables to change"]}
                rows={[[
                  [...new Set(simList.flatMap((p) => p.files.filter((f) => f.action !== "env").map((f) => f.path)))].join(", ") || "—",
                  simList.flatMap((p) => p.dependencies.filter((d) => d.op !== "remove").map((d) => `${d.name}@${d.version}`)).join(", ") || "—",
                  simList.flatMap((p) => p.dependencies.filter((d) => d.op === "remove").map((d) => d.name)).join(", ") || "—",
                  simList.filter((p) => /Configuration/.test(p.classification)).map((p) => p.files.map((f) => f.path).join(", ")).join(", ") || "—",
                  simList.filter((p) => p.classification === "Environment Change").map((p) => p.files[0]?.path.replace("env:", "")).join(", ") || "—",
                ]]}
                empty="—"
              />
            </Section>
          ) : null}
          {proposals.length === 0 ? <p className="text-xs text-muted-foreground">No proposals yet. Run a simulation.</p> : null}
          {proposals.map((p) => (
            <div key={p.id} className="rounded-md border border-border p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                {p.status === "Proposed" ? (
                  <Checkbox
                    checked={selected.has(p.id)}
                    onCheckedChange={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(p.id); else n.delete(p.id); return n; })}
                  />
                ) : null}
                <strong className="text-sm">{p.fix}</strong>
                <span className="rounded border border-border px-1.5">{p.classification}</span>
                <span className={`font-medium ${riskTone(p.risk)}`}>{p.risk}</span>
                <span className={p.confidence < LOW_CONFIDENCE ? "text-destructive" : "text-success"}>Confidence {p.confidence}%</span>
                <span className="ml-auto text-muted-foreground">{p.status}{p.decidedBy ? ` · ${p.decidedBy} · ${new Date(p.decidedAt!).toLocaleString()}` : ""}</span>
              </div>
              {p.confidence < LOW_CONFIDENCE ? (
                <div className="mt-1 flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3.5" /> Low confidence — review the change carefully before approving.
                </div>
              ) : null}
              <div className="mt-2 grid gap-1 md:grid-cols-2">
                <div><span className="text-muted-foreground">Problem:</span> {p.problem}</div>
                <div><span className="text-muted-foreground">Proposed fix:</span> {p.fix}</div>
                <div><span className="text-muted-foreground">Why:</span> {p.impact.why}</div>
                <div><span className="text-muted-foreground">Solves:</span> {p.impact.solves}</div>
                <div><span className="text-muted-foreground">Dependencies affected:</span> {p.dependencies.map((d) => `${d.op} ${d.name}${d.version ? "@" + d.version : ""}`).join(", ") || "none"} ({p.impact.dependencyCount})</div>
                <div><span className="text-muted-foreground">Confidence explanation:</span> {p.confidenceNote}</div>
                <div><span className="text-muted-foreground">UI impact:</span> {p.impact.ui}</div>
                <div><span className="text-muted-foreground">Business logic impact:</span> {p.impact.businessLogic}</div>
                <div><span className="text-muted-foreground">Build impact:</span> {p.impact.build}</div>
                <div><span className="text-muted-foreground">Deployment impact:</span> {p.impact.deployment}</div>
                <div><span className="text-muted-foreground">Database impact:</span> {p.impact.database}</div>
                <div><span className="text-muted-foreground">Security impact:</span> {p.impact.security}</div>
                <div><span className="text-muted-foreground">Rollback available:</span> {p.impact.rollback}</div>
                <div><span className="text-muted-foreground">Consequences:</span> {p.impact.consequences}</div>
              </div>
              <div className="mt-1 rounded bg-surface-2 p-2"><span className="text-muted-foreground">In plain words:</span> {p.impact.plain}</div>
              <div className="mt-2">
                <div className="text-muted-foreground">Files affected {p.status === "Proposed" ? "(tick to approve per file)" : ""}:</div>
                {p.files.map((f) => {
                  const pv = p.impact.preview.find((x) => x.path === f.path);
                  return (
                    <details key={f.path} className="ml-1">
                      <summary className="flex cursor-pointer items-center gap-2">
                        {p.status === "Proposed" && f.action !== "env" ? (
                          <Checkbox checked={p.approvedFiles.includes(f.path)} onCheckedChange={(v) => toggleFile(p, f.path, !!v)} onClick={(e) => e.stopPropagation()} />
                        ) : null}
                        <span className="font-mono">{f.path}</span> <span className="text-muted-foreground">({f.action})</span>
                      </summary>
                      {pv && f.action !== "env" ? (
                        <div className="grid grid-cols-2 gap-1">
                          <pre className="max-h-48 overflow-auto rounded border border-border p-1 text-[10px]">{pv.before.slice(0, 4000) || "(new file)"}</pre>
                          <pre className="max-h-48 overflow-auto rounded border border-border p-1 text-[10px]">{pv.after.slice(0, 4000)}</pre>
                        </div>
                      ) : null}
                    </details>
                  );
                })}
              </div>
              {p.status === "Proposed" && p.impact.op.kind === "env" ? (
                <Input
                  type="password"
                  className="mt-2 h-7 text-xs"
                  placeholder={`Value for ${p.impact.op.key} (required to approve)`}
                  value={envValues[p.impact.op.key] ?? ""}
                  onChange={(e) => setEnvValues((v) => ({ ...v, [(p.impact.op as { key: string }).key]: e.target.value }))}
                />
              ) : null}
              <div className="mt-2 flex gap-2">
                {p.status === "Proposed" ? (
                  <>
                    <Button size="sm" className="h-7" disabled={!!busy} onClick={() => void approveOne(p, "Approved")}>Approve</Button>
                    <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => void approveOne(p, "Rejected")}>Reject</Button>
                  </>
                ) : p.status === "Applied" ? (
                  <Button size="sm" variant="outline" className="h-7" disabled={!!busy} onClick={() => void revert(p)}>
                    <RotateCcw className="size-3" /> Revert
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="audit">
          <Table
            head={["Time", "User", "Repository", "Action", "Change type", "Risk", "Confidence", "Files modified", "Dependencies modified", "Note"]}
            rows={audit.map((a) => [
              new Date(a.createdAt).toLocaleString(),
              a.user,
              ws.repositories?.find((r) => r.id === a.repositoryId)?.fullName ?? a.repositoryId ?? "—",
              a.action,
              a.changeType ?? "—",
              a.risk ?? "—",
              a.confidence != null ? `${a.confidence}%` : "—",
              a.files.join(", ") || "—",
              a.dependencies.join(", ") || "—",
              a.note,
            ])}
            empty="No actions logged yet."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
