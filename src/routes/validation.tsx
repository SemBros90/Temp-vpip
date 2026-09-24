import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Loader2, Play } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Section, Table } from "@/components/vpip/RepoCompatibilityPanel";
import * as gh from "@/lib/vpip/github";
import { buildPreviewDoc } from "@/lib/vpip/coder-fs";
import { analyzeRepository, importVerdict, previewOptionsFrom, type AnalyzerFile } from "@/lib/vpip/repo-analyzer";
import {
  DEFAULT_TARGETS,
  dependencyAudit,
  envAudit,
  ingestionFailure,
  listValidationRuns,
  metricsOf,
  safeRepairId,
  saveValidationRun,
  simulateRepair,
  type ValidationResult,
  type ValidationRun,
  type ValidationTarget,
} from "@/lib/vpip/safe-repair";
import type { CoderFile, RepoReport } from "@/lib/vpip/types";

export const Route = createFileRoute("/validation")({
  head: () => ({
    meta: [
      { title: "Repository Validation — VPIP" },
      { name: "description", content: "Run the import, audit, preview and repair pipeline against reference repositories and track success rates." },
      { property: "og:title", content: "Repository Validation — VPIP" },
      { property: "og:description", content: "Import, preview, repair and compatibility success rates across React, Vite, Next.js, Remix, monorepo, Supabase and static repositories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ValidationPage,
});

const toText = (t: ValidationTarget[]) => t.map((x) => `${x.category} | ${x.repo}${x.branch ? ` | ${x.branch}` : ""}`).join("\n");
const fromText = (s: string): ValidationTarget[] =>
  s
    .split("\n")
    .map((l) => l.split("|").map((x) => x.trim()))
    .filter((p) => p.length >= 2 && p[1])
    .map(([category, repo, branch]) => ({ category: category!, repo: repo!, branch: branch || undefined }));

/** Mounts the real preview in a hidden sandboxed frame and waits for its render status. */
function probePreview(doc: string, timeoutMs = 25_000): Promise<{ rendered: boolean; errors: string[] }> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts allow-forms");
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:1280px;height:800px;visibility:hidden";
    const errors: string[] = [];
    const done = (rendered: boolean) => {
      window.removeEventListener("message", onMsg);
      clearTimeout(timer);
      frame.remove();
      resolve({ rendered, errors });
    };
    const onMsg = (e: MessageEvent) => {
      if (e.source !== frame.contentWindow) return;
      const d = e.data as { __vpipPreview?: boolean; kind?: string; text?: string };
      if (!d?.__vpipPreview) return;
      if (d.kind === "error") errors.push(d.text ?? "");
      if (d.kind === "status") {
        try {
          done(Boolean((JSON.parse(d.text ?? "{}") as { rendered?: boolean }).rendered));
        } catch {
          done(false);
        }
      }
    };
    const timer = setTimeout(() => {
      errors.push(`Preview did not report a status within ${timeoutMs / 1000}s`);
      done(false);
    }, timeoutMs);
    window.addEventListener("message", onMsg);
    frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
}

async function validateOne(t: ValidationTarget): Promise<ValidationResult> {
  const started = Date.now();
  const base: ValidationResult = { category: t.category, repo: t.repo, imported: false, filesFound: 0, filesImported: 0, compatible: false, previewRendered: false, repairable: false, proposals: 0, failures: [], durationMs: 0 };
  try {
    const info = await gh.getRepository("", t.repo);
    const branch = t.branch || info.defaultBranch;
    const { files, audit } = await gh.readBranchFilesAudited("", info.fullName, branch);
    base.filesFound = audit.found.length;
    base.filesImported = audit.imported.length;
    const lost = ingestionFailure(audit);
    if (lost) throw new Error(lost);
    base.imported = true;
    const analysis = analyzeRepository(files as AnalyzerFile[], { branch });
    const report = { ...analysis, id: safeRepairId(), projectId: "validation", createdAt: new Date().toISOString() } as RepoReport;
    base.classification = report.classification.frameworks.join(" + ") || report.classification.primary;
    const verdict = importVerdict(report);
    base.compatible = verdict.verdict !== "Preview cannot run";
    if (!base.compatible) base.failures.push(...verdict.mustFix.slice(0, 5).map((m) => `${m.file}: ${m.problem}`));
    const env = envAudit(files, {});
    const deps = dependencyAudit(files, report);
    const proposals = simulateRepair(files, report, env, deps, { projectId: "validation" });
    base.proposals = proposals.length;
    const fixable = new Set(proposals.flatMap((p) => p.problem));
    base.repairable = deps.missing.length + deps.conflicts.length + deps.invalid.length + env.missing.length === 0 || fixable.size > 0;
    const coderFiles: CoderFile[] = files.map((f) => ({ id: f.path, path: f.path, content: f.content, createdAt: "", updatedAt: "", versions: [] }));
    const doc = buildPreviewDoc(coderFiles, undefined, previewOptionsFrom(report, files, {}));
    if (!doc) base.failures.push("No previewable entry (index.html or app entry) found");
    else {
      const res = await probePreview(doc);
      base.previewRendered = res.rendered;
      if (!res.rendered) base.failures.push(...res.errors.slice(0, 5));
    }
  } catch (e) {
    base.failures.push(e instanceof Error ? e.message : String(e));
  }
  base.durationMs = Date.now() - started;
  return base;
}

function ValidationPage() {
  const [targets, setTargets] = useState(toText(DEFAULT_TARGETS));
  const [runs, setRuns] = useState<ValidationRun[]>([]);
  const [progress, setProgress] = useState("");
  const [live, setLive] = useState<ValidationResult[]>([]);

  useEffect(() => {
    listValidationRuns().then(setRuns).catch((e) => toast.error(String(e)));
  }, []);

  async function run() {
    const list = fromText(targets);
    if (!list.length) return toast.error("Add at least one target: Category | owner/repo | branch");
    const results: ValidationResult[] = [];
    setLive([]);
    for (const [i, t] of list.entries()) {
      setProgress(`${i + 1}/${list.length} — ${t.repo}`);
      results.push(await validateOne(t));
      setLive([...results]);
    }
    const r: ValidationRun = { id: safeRepairId(), targets: list, results, metrics: metricsOf(results), createdAt: new Date().toISOString() };
    try {
      await saveValidationRun(r);
      setRuns((x) => [r, ...x]);
      toast.success("Validation report saved");
    } catch (e) {
      toast.error(`Could not save report: ${e instanceof Error ? e.message : String(e)}`);
    }
    setProgress("");
  }

  const latest = runs[0];
  const shown = progress ? live : latest?.results ?? [];
  const m = progress ? metricsOf(live) : latest?.metrics;

  return (
    <Shell title="Repository Validation">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6 text-sm">
        <p className="text-xs text-muted-foreground">
          Runs the real pipeline — full import with file audit, classification, environment and dependency audits, repair simulation (no changes) and a live preview mount — against each repository. Public repositories only.
        </p>
        <Textarea className="min-h-40 font-mono text-xs" value={targets} onChange={(e) => setTargets(e.target.value)} disabled={!!progress} />
        <Button size="sm" className="h-8" disabled={!!progress} onClick={() => void run()}>
          {progress ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} {progress ? `Running ${progress}` : "Run validation"}
        </Button>
        {m ? (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {(
              [
                ["Import Success Rate", m.importSuccessRate],
                ["Preview Success Rate", m.previewSuccessRate],
                ["Repair Success Rate", m.repairSuccessRate],
                ["Compatibility Success Rate", m.compatibilitySuccessRate],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="rounded border border-border p-2">
                <div className="text-[11px] text-muted-foreground">{k}</div>
                <div className="text-lg font-semibold">{v}%</div>
              </div>
            ))}
          </div>
        ) : null}
        <Section title={progress ? "Current run" : latest ? `Latest report — ${new Date(latest.createdAt).toLocaleString()}` : "No reports yet"}>
          <Table
            head={["Category", "Repository", "Imported", "Files found / imported", "Detected", "Compatible", "Preview", "Repairable", "Proposals", "Failures", "Time"]}
            rows={shown.map((r) => [r.category, r.repo, r.imported ? "Yes" : "No", `${r.filesFound} / ${r.filesImported}`, r.classification ?? "—", r.compatible ? "Yes" : "No", r.previewRendered ? "Rendered" : "Failed", r.repairable ? "Yes" : "No", r.proposals, r.failures.join(" · ") || "—", `${Math.round(r.durationMs / 1000)}s`])}
            empty="Run a validation to see results."
          />
        </Section>
        <Section title={`Report history (${runs.length})`}>
          <Table
            head={["Run", "Targets", "Import", "Preview", "Repair", "Compatibility"]}
            rows={runs.map((r) => [new Date(r.createdAt).toLocaleString(), r.targets.length, `${r.metrics.importSuccessRate}%`, `${r.metrics.previewSuccessRate}%`, `${r.metrics.repairSuccessRate}%`, `${r.metrics.compatibilitySuccessRate}%`])}
            empty="No saved reports."
          />
        </Section>
      </div>
    </Shell>
  );
}
