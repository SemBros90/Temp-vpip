import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState } from "@/components/vpip/common";
import { Input } from "@/components/ui/input";
import { RepoCompatibilityPanel, Section, StagesView, Table, useRepoReport } from "@/components/vpip/RepoCompatibilityPanel";
import { importVerdict } from "@/lib/vpip/repo-analyzer";
import * as gh from "@/lib/vpip/github";
import { useProject } from "@/lib/vpip/store";
import type { CodeSide, RepoReport } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/import-diagnostics")({
  head: () => ({
    meta: [
      { title: "Import Diagnostics — VPIP" },
      { name: "description", content: "Why an imported repository's preview can or cannot run, and exactly what must be fixed." },
      { property: "og:title", content: "Import Diagnostics — VPIP" },
      { property: "og:description", content: "Compatibility report, dependency graph, backend isolation and build health stages for imported repositories." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ImportDiagnosticsPage,
});

function ImportDiagnosticsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const navigate = useNavigate();
  const repos = p.repositories;
  const [repoId, setRepoId] = useState<string | undefined>(repos[0]?.id);
  const repo = repos.find((r) => r.id === repoId) ?? repos[0];
  const build = p.buildSessions.find((b) => b.repositoryId === repo?.id) ?? (!repo ? p.buildSessions.find((b) => (b.files?.length ?? 0) > 0) : undefined);
  const report = useRepoReport(projectId, repo?.id, build?.id);

  return (
    <Shell title="Import Diagnostics">
      <div className="mx-auto max-w-6xl space-y-4 px-6 py-6">
        {repos.length > 1 ? (
          <div className="flex flex-wrap gap-2">
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => setRepoId(r.id)}
                className={`rounded-md border px-2 py-1 text-xs ${r.id === repo?.id ? "border-primary bg-primary/10" : "border-border"}`}
              >
                {r.fullName}
              </button>
            ))}
          </div>
        ) : null}
        {!repo && !build ? (
          <EmptyState title="No imported repository" description="Use Pull repository on the Projects page, or connect one on the Repositories page." />
        ) : (
          <>
            {report ? <Overview report={report} /> : null}
            <RepoCompatibilityPanel
              projectId={projectId}
              repository={repo}
              build={build}
              loadFiles={async () =>
                build?.files?.length
                  ? build.files.map((f) => ({ path: f.path, content: f.content }))
                  : repo
                    ? gh.readBranchFiles(repo.token, repo.fullName, repo.currentBranch)
                    : []
              }
              onPreview={build ? () => void navigate({ to: "/projects/$projectId/coder/$buildId", params: { projectId, buildId: build.id } }) : undefined}
            />
          </>
        )}
      </div>
    </Shell>
  );
}

function Overview({ report }: { report: RepoReport }) {
  const [q, setQ] = useState("");
  const { verdict, mustFix } = importVerdict(report);
  const ins = report.previewDiagnostics.insights;
  const split = ins?.codeSplit ?? {};
  const counts = useMemo(() => {
    const c: Record<CodeSide, number> = { Frontend: 0, Backend: 0, Shared: 0 };
    for (const v of Object.values(split)) c[v]++;
    return c;
  }, [split]);
  const tone = verdict === "Preview can run" ? "text-success" : verdict === "Preview cannot run" ? "text-destructive" : "text-warning";
  const stats: Array<[string, string | number]> = [
    ["Total files", ins?.totalFiles ?? "—"],
    ["Dependencies", report.dependencies.length],
    ["Missing dependencies", report.dependencies.filter((d) => d.status === "Missing").length],
    ["Missing assets", report.imports.filter((i) => i.kind === "Missing asset").length],
    ["Alias issues", report.imports.filter((i) => i.kind === "Broken alias").length],
    ["Unsupported features", report.unsupported.length],
    ["Runtime issues", report.previewDiagnostics.runtimeErrors.length],
    ["Preview readiness", `${report.health.previewReadiness}%`],
  ];
  const fileRows = Object.entries(split)
    .filter(([path]) => !q || path.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 400)
    .map(([path, side]) => [side, path, (ins?.packagesByFile[path] ?? []).join(", "), ins?.edges.filter((e) => e.from === path).length ?? 0]);

  return (
    <div className="space-y-4 text-sm">
      <div className="rounded-md border border-border p-4">
        <div className="label-mono">Verdict</div>
        <div className={`text-2xl font-semibold ${tone}`}>{verdict}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Health {report.health.overall}% · entry {ins?.entry ?? "not found"} · {report.classification.frameworks.join(" + ") || report.classification.primary}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          {stats.map(([k, v]) => (
            <div key={k} className="rounded border border-border p-2">
              <div className="text-[11px] text-muted-foreground">{k}</div>
              <div className="text-lg font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </div>

      <Section title={`Must fix (${mustFix.length})`}>
        <Table head={["File", "Problem", "Fix"]} rows={mustFix.slice(0, 300).map((m) => [m.file || "—", m.problem, m.fix])} empty="Nothing blocks the preview." />
      </Section>

      <StagesView report={report} />

      <Section title={`Code split — Frontend ${counts.Frontend} · Backend ${counts.Backend} · Shared ${counts.Shared}`}>
        <Input className="mb-2 h-7 text-xs" placeholder="Search files…" value={q} onChange={(e) => setQ(e.target.value)} />
        <Table head={["Side", "File", "Packages", "Imports"]} rows={fileRows} empty="No code files." />
      </Section>

      <Section title={`Server-only files (${ins?.serverOnly.length ?? 0}) — never executed in the preview`}>
        <Table head={["File", "Server / Node APIs"]} rows={(ins?.serverOnly ?? []).map((s) => [s.path, s.apis.join(", ")])} empty="No server-only APIs found." />
      </Section>

      <Section title={`Dependency graph — ${ins?.edges.length ?? 0} links, ${ins?.unreachable.length ?? 0} files not reached from the entry`}>
        <Table
          head={["Unreached file (not imported from the app entry)"]}
          rows={(ins?.unreachable ?? []).slice(0, 200).map((u) => [u])}
          empty="Every frontend file is reachable from the entry."
        />
      </Section>

      <Section title={`Assets — ${ins?.assets.present ?? 0} loaded, ${ins?.assets.missing ?? 0} missing, ${ins?.assets.skippedTooLarge.length ?? 0} skipped (too large)`}>
        <Table head={["Skipped (over 2 MB)"]} rows={(ins?.assets.skippedTooLarge ?? []).map((a) => [a])} empty="No oversized assets." />
      </Section>

      {ins?.tailwind || ins?.remix ? (
        <Section title="Config files">
          {ins.tailwind ? (
            <div className="text-xs">
              Tailwind content: {ins.tailwind.content.join(", ") || "—"} · plugins: {ins.tailwind.plugins.join(", ") || "none"}
            </div>
          ) : null}
          {ins.remix ? <div className="text-xs">Remix app directory: {ins.remix.appDirectory}</div> : null}
        </Section>
      ) : null}
    </div>
  );
}
