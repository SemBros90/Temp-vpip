/** Phase 10 Root Cause Engine. Pure, read-only evidence correlation helpers. */
import { buildGraph } from "./dep-trace";

export type Check = "PASS" | "FAIL";
export interface Timed {
  created_at?: string;
  date?: string;
}
export interface FailureEvidence extends Timed {
  id: string;
  code?: string;
  title?: string;
  root_cause?: string;
  status?: string;
  project_id?: string;
}
export interface SnapshotEvidence extends Timed {
  id: string;
  label: string;
  project_id?: string;
  metadata?: Record<string, unknown>;
  files?: Array<{ path: string; content?: string }>;
}
export interface CommitEvidence {
  sha: string;
  message: string;
  author: string;
  date: string;
}
export interface BranchEvidence {
  name: string;
  sha: string;
  headCommittedAt: string;
}
export interface RootCauseReport {
  issue: FailureEvidence;
  firstAppearance: string;
  firstCommit: CommitEvidence | null;
  firstSnapshot: SnapshotEvidence | null;
  firstBranch: BranchEvidence | null;
  files: string[];
  imports: string[];
  config: string[];
  timeline: Array<{ at: string; kind: string; evidence: string }>;
  causeChain: string[];
}

const time = (row: Timed) =>
  Date.parse(row.created_at ?? row.date ?? "") || Number.MAX_SAFE_INTEGER;
const words = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[a-z][\w-]{3,}/g) ?? []).filter(
      (word) => !["that", "with", "from", "this", "error", "failure", "build"].includes(word),
    ),
  );

/** Produces a deterministic, evidence-only root-cause chain; it does not alter repository state. */
export function traceRootCause(args: {
  issue: FailureEvidence;
  commits: CommitEvidence[];
  snapshots: SnapshotEvidence[];
  branches: BranchEvidence[];
  builds: Timed[];
  runtime: Timed[];
}): RootCauseReport {
  const { issue, commits, snapshots, branches, builds, runtime } = args;
  const started = time(issue);
  const description = `${issue.title ?? ""} ${issue.root_cause ?? ""}`;
  const terms = words(description);
  const beforeOrAt = <T extends Timed>(rows: T[]) =>
    rows.filter((row) => time(row) <= started).sort((a, b) => time(b) - time(a))[0] ?? null;
  const firstCommit =
    commits
      .filter((commit) => Date.parse(commit.date) <= started)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))[0] ?? null;
  const firstSnapshot = beforeOrAt(snapshots);
  const firstBranch =
    branches
      .filter((branch) => Date.parse(branch.headCommittedAt) <= started)
      .sort((a, b) => Date.parse(a.headCommittedAt) - Date.parse(b.headCommittedAt))[0] ?? null;
  const files = [
    ...new Set(
      (firstSnapshot?.files ?? [])
        .filter(
          (file) =>
            terms.has(file.path.split("/").pop()?.split(".")[0].toLowerCase() ?? "") ||
            [...terms].some((term) => file.path.toLowerCase().includes(term)),
        )
        .map((file) => file.path),
    ),
  ].slice(0, 20);
  const index = new Map(
    (firstSnapshot?.files ?? []).map((file) => [file.path, file.content ?? ""]),
  );
  const graph = buildGraph(index);
  const imports = files
    .flatMap((file) => graph.imports.get(file) ?? [])
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 20);
  const config = (firstSnapshot?.files ?? [])
    .filter((file) =>
      /(^|\/)(package\.json|vite\.config|tsconfig|eslint\.config|\.env|supabase\/config)/.test(
        file.path,
      ),
    )
    .map((file) => file.path)
    .slice(0, 12);
  const timeline = [
    firstCommit && {
      at: firstCommit.date,
      kind: "Commit",
      evidence: `${firstCommit.sha.slice(0, 7)} · ${firstCommit.message.split("\n")[0]}`,
    },
    firstSnapshot && {
      at: firstSnapshot.created_at ?? "",
      kind: "Snapshot",
      evidence: firstSnapshot.label,
    },
    beforeOrAt(builds) && {
      at: beforeOrAt(builds)?.created_at ?? "",
      kind: "Build",
      evidence: "Last recorded build at or before the issue",
    },
    beforeOrAt(runtime) && {
      at: beforeOrAt(runtime)?.created_at ?? "",
      kind: "Runtime",
      evidence: "Last recorded runtime event at or before the issue",
    },
    {
      at: issue.created_at ?? "",
      kind: "First appearance",
      evidence: `${issue.code ?? issue.id} · ${issue.title ?? "Untitled failure"}`,
    },
  ].filter(Boolean) as Array<{ at: string; kind: string; evidence: string }>;
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  const causeChain = [
    `Observed failure: ${issue.title ?? issue.code ?? issue.id}.`,
    issue.root_cause
      ? `Recorded root cause: ${issue.root_cause}.`
      : "Recorded root cause is not yet supplied; chain is correlation-only.",
    firstCommit
      ? `Nearest preceding commit: ${firstCommit.sha.slice(0, 7)}.`
      : "No preceding commit was available in the loaded GitHub history.",
    firstSnapshot
      ? `Nearest preceding snapshot: ${firstSnapshot.label}.`
      : "No preceding snapshot was available.",
    files.length
      ? `Affected-file evidence: ${files.join(", ")}.`
      : "No file name could be correlated from the retained issue and snapshot evidence.",
    imports.length
      ? `Import propagation: ${imports.join(", ")}.`
      : "No internal import propagation was found in the selected snapshot.",
    config.length
      ? `Configuration inspected: ${config.join(", ")}.`
      : "No build/config file was present in the selected snapshot.",
    "Conclusion: verify this evidence with a reproducible build/runtime check before approving any repair.",
  ];
  return {
    issue,
    firstAppearance: issue.created_at ?? "Unknown",
    firstCommit,
    firstSnapshot,
    firstBranch,
    files,
    imports,
    config,
    timeline,
    causeChain,
  };
}

export function rootCauseAudit(
  report: RootCauseReport | null,
): Array<{ capability: string; status: Check; evidence: string }> {
  const yes = (condition: unknown, evidence: string, missing: string) => ({
    status: condition ? ("PASS" as const) : ("FAIL" as const),
    evidence: condition ? evidence : missing,
  });
  return [
    {
      capability: "Known issue selected",
      ...yes(report, "A retained failure record was selected.", "Select a known failure record."),
    },
    {
      capability: "First failing commit",
      ...yes(
        report?.firstCommit,
        report?.firstCommit?.sha.slice(0, 7) ?? "",
        "No commit precedes the issue in loaded history.",
      ),
    },
    {
      capability: "First failing snapshot",
      ...yes(
        report?.firstSnapshot,
        report?.firstSnapshot?.label ?? "",
        "No snapshot precedes the issue.",
      ),
    },
    {
      capability: "First failing branch",
      ...yes(
        report?.firstBranch,
        report?.firstBranch?.name ?? "",
        "No branch head precedes the issue.",
      ),
    },
    {
      capability: "Timeline reconstruction",
      ...yes(
        report?.timeline.length,
        `${report?.timeline.length ?? 0} correlated event(s).`,
        "No timeline evidence.",
      ),
    },
    {
      capability: "Dependency cause tracing",
      ...yes(
        report?.imports.length,
        `${report?.imports.length ?? 0} import edge(s).`,
        "No dependency edge correlated.",
      ),
    },
    {
      capability: "Import cause tracing",
      ...yes(
        report?.imports.length,
        "Internal import graph evaluated.",
        "No internal import was matched.",
      ),
    },
    {
      capability: "Build cause tracing",
      ...yes(
        report?.config.length,
        `${report?.config.length ?? 0} build/config file(s) inspected.`,
        "No build/config evidence.",
      ),
    },
    {
      capability: "Runtime cause tracing",
      ...yes(
        report?.timeline.some((event) => event.kind === "Runtime"),
        "Runtime evidence correlated.",
        "No runtime event precedes the issue.",
      ),
    },
    {
      capability: "Configuration cause tracing",
      ...yes(
        report?.config.length,
        "Snapshot configuration inspected.",
        "No configuration file available.",
      ),
    },
    {
      capability: "Cause chain generation",
      ...yes(
        report?.causeChain.length,
        `${report?.causeChain.length ?? 0} evidence chain link(s).`,
        "No cause chain.",
      ),
    },
  ];
}
