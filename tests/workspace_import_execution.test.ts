import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { emptyWorkspace, type Workspace } from "../src/lib/vpip/types";

type Row = Record<string, unknown>;
type Result<T = unknown> = Promise<{ data: T; error: null } | { data: null; error: { message: string } }>;
type Log = { type: "select" | "upsert" | "delete"; table: string; detail?: unknown };

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vpip-import-test-"));
process.on("exit", () => fs.rmSync(TMP_DIR, { recursive: true, force: true }));
const T = "2026-02-20T10:00:00.000Z";

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

type Hook = {
  match: (log: Log) => boolean;
  remaining: number;
  message: string;
  before?: (db: MockSupabase, log: Log) => void;
};

class MockSupabase {
  tables = new Map<string, Map<string, Row>>();
  logs: Log[] = [];
  hooks: Hook[] = [];

  seed(table: string, rows: Row[]) {
    const map = this.ensure(table);
    for (const row of rows) map.set(String(row.id), clone(row));
  }

  snapshot(table: string): Row[] {
    return [...this.ensure(table).values()].map((x) => clone(x));
  }

  addHook(hook: Hook) {
    this.hooks.push(hook);
  }

  from(table: string) {
    return new TableBuilder(this, table);
  }

  ensure(table: string) {
    if (!this.tables.has(table)) this.tables.set(table, new Map());
    return this.tables.get(table)!;
  }

  failIfHooked(log: Log): string | null {
    for (const hook of this.hooks) {
      if (hook.remaining > 0 && hook.match(log)) {
        hook.before?.(this, log);
        hook.remaining -= 1;
        return hook.message;
      }
    }
    return null;
  }
}

class TableBuilder {
  constructor(private db: MockSupabase, private table: string) {}

  select(columns = "*") {
    return new SelectBuilder(this.db, this.table, columns);
  }

  upsert(rows: Row[] | Row, options?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    return new UpsertBuilder(this.db, this.table, Array.isArray(rows) ? rows : [rows], options);
  }

  delete() {
    return new DeleteBuilder(this.db, this.table);
  }
}

class SelectBuilder {
  filters: Array<(row: Row) => boolean> = [];
  orders: Array<{ col: string; asc: boolean }> = [];

  constructor(
    private db: MockSupabase,
    private table: string,
    private columns: string,
  ) {}

  eq(col: string, value: unknown) {
    this.filters.push((r) => r[col] === value);
    return this;
  }

  neq(col: string, value: unknown) {
    this.filters.push((r) => r[col] !== value);
    return this;
  }

  in(col: string, values: unknown[]) {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orders.push({ col, asc: opts?.ascending !== false });
    return this;
  }

  private run() {
    const fail = this.db.failIfHooked({ type: "select", table: this.table, detail: this.columns });
    this.db.logs.push({ type: "select", table: this.table, detail: this.columns });
    if (fail) return { data: null, error: { message: fail } } as const;

    let rows = this.db.snapshot(this.table);
    for (const f of this.filters) rows = rows.filter(f);
    for (let i = this.orders.length - 1; i >= 0; i -= 1) {
      const { col, asc } = this.orders[i];
      rows.sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        if (av === bv) return 0;
        return asc ? (av < bv ? -1 : 1) : av > bv ? -1 : 1;
      });
    }
    return { data: rows, error: null } as const;
  }

  range(from: number, to: number): Result<Row[]> {
    const out = this.run();
    if (out.error) return Promise.resolve(out);
    return Promise.resolve({ data: out.data.slice(from, to + 1), error: null });
  }

  maybeSingle(): Result<Row | null> {
    const out = this.run();
    if (out.error) return Promise.resolve(out as { data: null; error: { message: string } });
    const row = out.data[0] ?? null;
    if (this.columns === "*" || this.columns.includes(",")) return Promise.resolve({ data: row, error: null });
    if (!row) return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: { [this.columns]: row[this.columns] }, error: null });
  }
}

class UpsertBuilder implements PromiseLike<{ data: Row[] | null; error: { message: string } | null }> {
  constructor(
    private db: MockSupabase,
    private table: string,
    private rows: Row[],
    private options?: { onConflict?: string; ignoreDuplicates?: boolean },
  ) {}

  private run(selectCols?: string): { data: Row[] | null; error: { message: string } | null } {
    const fail = this.db.failIfHooked({ type: "upsert", table: this.table, detail: { count: this.rows.length, selectCols } });
    this.db.logs.push({ type: "upsert", table: this.table, detail: { count: this.rows.length, selectCols } });
    if (fail) return { data: null, error: { message: fail } };

    const map = this.db.ensure(this.table);
    const changed: Row[] = [];
    for (const row of this.rows) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const exists = map.has(id);
      if (exists && this.options?.ignoreDuplicates) continue;
      map.set(id, clone(row));
      changed.push(clone(row));
    }
    if (!selectCols) return { data: [], error: null };
    if (selectCols === "id") return { data: changed.map((r) => ({ id: r.id })), error: null };
    return { data: changed, error: null };
  }

  select(columns: string): Result<Row[]> {
    return Promise.resolve(this.run(columns) as { data: Row[]; error: null } | { data: null; error: { message: string } });
  }

  then<TResult1 = { data: Row[] | null; error: { message: string } | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[] | null; error: { message: string } | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }
}

class DeleteBuilder {
  filters: Array<(row: Row) => boolean> = [];

  constructor(private db: MockSupabase, private table: string) {}

  in(col: string, values: unknown[]): Result<Row[]> {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[col]));
    return this.run();
  }

  neq(col: string, value: unknown): Result<Row[]> {
    this.filters.push((r) => r[col] !== value);
    return this.run();
  }

  private run(): Result<Row[]> {
    const fail = this.db.failIfHooked({ type: "delete", table: this.table });
    this.db.logs.push({ type: "delete", table: this.table });
    if (fail) return Promise.resolve({ data: null, error: { message: fail } });

    const map = this.db.ensure(this.table);
    const rows = [...map.values()].filter((row) => this.filters.every((f) => f(row)));
    for (const row of rows) map.delete(String(row.id));
    return Promise.resolve({ data: rows.map((r) => clone(r)), error: null });
  }
}

async function loadDbWithMock(mock: MockSupabase, tag: string) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const dbSrcPath = path.join(ROOT, "src/lib/vpip/db.ts");
  const mockPath = path.join(TMP_DIR, `supabase-mock-${tag}.mts`);
  const runtimePath = path.join(TMP_DIR, `db-runtime-${tag}.mts`);

  (globalThis as { __VPIP_TEST_SUPABASE?: MockSupabase }).__VPIP_TEST_SUPABASE = mock;
  fs.writeFileSync(mockPath, "export const supabase = (globalThis as any).__VPIP_TEST_SUPABASE;\n");

  let dbSource = fs.readFileSync(dbSrcPath, "utf8");
  dbSource = dbSource.replace('import { supabase } from "@/integrations/supabase/client";', `import { supabase } from "${mockPath}";`);
  for (const name of ["workspace-import-schema", "workspace-import", "types"]) {
    dbSource = dbSource.replaceAll(`from "./${name}"`, `from ${JSON.stringify(path.join(ROOT, "src/lib/vpip", `${name}.ts`))}`);
  }
  fs.writeFileSync(runtimePath, dbSource);

  return import(`file://${runtimePath}?v=${Date.now()}-${Math.random()}`);
}

function baseWorkspace(projectId = "existing-project"): Workspace {
  const ws = emptyWorkspace();
  ws.projects = [{ id: projectId, name: "Existing", description: "", archived: false, createdAt: T, updatedAt: T }];
  return ws;
}

function fullImport(projectId = "p-import"): Workspace {
  const ws = emptyWorkspace();
  ws.version = 1;
  ws.projects = [{ id: projectId, name: "Imported", description: "d", archived: false, createdAt: T, updatedAt: T }];
  ws.discussions = [{ id: "d1", projectId, title: "Discussion", type: "general", summary: "", messages: [{ id: "m1", createdAt: T, seq: 1, role: "user", content: "hello" }], attachments: [], reopenedAt: T, reopenContext: ["ctx"], createdAt: T, updatedAt: T } as Workspace["discussions"][number]];
  ws.knowledge = [{ id: "k1", projectId, code: "DEC-001", type: "decision", status: "candidate", title: "Decision", description: "desc", sourceMessages: [1], author: "You", createdAt: T, updatedAt: T, revisions: [{ at: T, note: "created", author: "You" }], mergedFrom: [] } as Workspace["knowledge"][number]];
  ws.documents = [{ id: "doc1", projectId, kind: "Project Summary", title: "Doc", markdown: "# doc", createdAt: T, provider: "openai", model: "gpt" } as Workspace["documents"][number]];
  ws.prompts = [{ id: "pr1", projectId, kind: "Custom Prompt", title: "Prompt", version: 1, markdown: "do", createdAt: T, linkedDecisionIds: ["k1"], linkedRequirementIds: [], linkedDocumentIds: ["doc1"], linkedDiscussionIds: ["d1"] } as Workspace["prompts"][number]];
  ws.snapshots = [{ id: "s1", projectId, kind: "Prompt", title: "Snap", refId: "pr1", markdown: "m", createdAt: T }];
  ws.buildSessions = [{
    id: "b1", code: "BUILD-001", projectId, promptId: "pr1", promptTitle: "Prompt", promptKind: "Custom Prompt", promptVersion: 1, status: "Queued", contextPackage: "ctx", counts: { decisions: 0, requirements: 0, documents: 0, discussions: 0 },
    turns: [{ id: "t1", createdAt: T, seq: 1, role: "assistant", content: "ok", trace: { buildCode: "BUILD-001", promptId: "pr1", promptVersion: 1, decisionCodes: [], requirementCodes: [], documentIds: [], discussionIds: [] } }],
    files: [{ id: "f1", path: "src/a.ts", content: "x", createdAt: T, updatedAt: T, versions: [{ id: "v1", createdAt: T, seq: 1, content: "x", note: "n", trace: { buildCode: "BUILD-001", promptId: "pr1", promptVersion: 1, decisionCodes: [], requirementCodes: [], documentIds: [], discussionIds: [] } }] }],
    actions: [{ id: "ac1", createdAt: T, seq: 1, kind: "write", summary: "sum", filesModified: ["src/a.ts"], trace: { buildCode: "BUILD-001", promptId: "pr1", promptVersion: 1, decisionCodes: [], requirementCodes: [], documentIds: [], discussionIds: [] } }],
    terminal: [{ id: "te1", createdAt: T, stream: "stdout", output: "ok", command: "npm", exitCode: 0 }],
    dbConnections: [{ id: "db1", createdAt: T, engine: "postgres", label: "main", config: { host: "h" } }],
    agentTasks: [{ id: "task1", projectId, createdAt: T, updatedAt: T, code: "TASK-001", buildSessionId: "b1", promptId: "pr1", promptTitle: "Prompt", promptVersion: 1, type: "code", status: "Done", instruction: "ship", trace: { buildCode: "BUILD-001", promptId: "pr1", promptVersion: 1, decisionCodes: [], requirementCodes: [], documentIds: [], discussionIds: [] }, changes: [{ id: "chg1", createdAt: T, taskId: "task1", buildCode: "BUILD-001", promptId: "pr1", path: "src/a.ts", action: "created" }] }],
    requirements: [{ id: "req1", createdAt: T, code: "REQ-001", title: "Need", detail: "detail", status: "Open", files: ["src/a.ts"], buildSessionId: "b1", updatedAt: T }],
    buildPlan: { files: [{ path: "src/a.ts", purpose: "entry", requirements: ["REQ-001"] }], dependencies: ["react"], buildOrder: ["src/a.ts"], moduleMap: [{ path: "src/a.ts", imports: [] }], markdown: "plan", createdAt: T },
    validation: { at: T, issues: [{ kind: "note", severity: "low", message: "none" }], dependencyStatus: "ok", startupStatus: "ok", compileStatus: "ok", missingDependencies: [] },
    sourceDocumentIds: ["doc1"], sourceDiscussionIds: ["d1"], createdAt: T, updatedAt: T,
  } as Workspace["buildSessions"][number]];
  ws.repositories = [{ id: "repo1", projectId, provider: "GitHub", owner: "o", name: "n", fullName: "o/n", description: "", visibility: "private", defaultBranch: "main", currentBranch: "main", htmlUrl: "https://x", token: "tok", status: "Connected", createdAt: T, updatedAt: T } as Workspace["repositories"][number]];
  ws.repoBranches = [{ id: "rb1", repositoryId: "repo1", name: "main", sha: "sha", createdAt: T }];
  ws.repoCommits = [{ id: "rc1", projectId, repositoryId: "repo1", sha: "abc", message: "init", branch: "main", files: ["src/a.ts"], author: "bot", decisionCodes: [], requirementCodes: [], provider: "GitHub", createdAt: T } as Workspace["repoCommits"][number]];
  ws.artifacts = [{ id: "art1", code: "ART-001", projectId, type: "source", name: "a.ts", path: "src/a.ts", content: "x", size: 1, decisionCodes: [], requirementCodes: [], createdAt: T, updatedAt: T } as Workspace["artifacts"][number]];
  ws.buildRecords = [{ id: "run1", code: "RUN-001", projectId, buildSessionId: "b1", buildCode: "BUILD-001", promptId: "pr1", promptTitle: "Prompt", promptVersion: 1, status: "Completed", startedAt: T, logs: ["ok"], artifactIds: ["art1"], decisionCodes: [], requirementCodes: [], createdAt: T, updatedAt: T } as Workspace["buildRecords"][number]];
  ws.changeRecords = [{ id: "cr1", projectId, action: "Created", path: "src/a.ts", createdAt: T } as Workspace["changeRecords"][number]];
  ws.promptPhases = [{ id: "pp1", projectId, promptId: "pr1", phaseNo: 1, title: "Plan", markdown: "plan", status: "Pending", createdAt: T, updatedAt: T } as Workspace["promptPhases"][number]];
  ws.phaseRuns = [{ id: "phr1", projectId, phaseId: "pp1", promptId: "pr1", attempt: 1, status: "Running", startedAt: T, createdAt: T } as Workspace["phaseRuns"][number]];
  ws.contextPackages = [{ id: "ctx1", projectId, code: "CTX-001", title: "Ctx", markdown: "ctx", counts: { a: 1 }, decisionIds: [], requirementIds: [], documentIds: ["doc1"], discussionIds: ["d1"], promptIds: ["pr1"], createdAt: T, updatedAt: T } as Workspace["contextPackages"][number]];
  ws.outcomes = [{ id: "out1", projectId, code: "OUT-001", subjectType: "build", subjectId: "b1", subjectLabel: "Build", result: "ok", notes: "n", lessons: "l", recommendations: "r", author: "You", createdAt: T, updatedAt: T } as Workspace["outcomes"][number]];
  ws.failures = [{ id: "fl1", projectId, code: "FAIL-001", subjectType: "build", subjectId: "b1", subjectLabel: "Build", title: "none", rootCause: "none", resolution: "none", lessons: "none", status: "Open", buildIds: [], promptIds: [], requirementCodes: [], decisionCodes: [], author: "You", createdAt: T, updatedAt: T } as Workspace["failures"][number]];
  ws.activity = [{ id: "act1", projectId, subjectType: "build", subjectId: "b1", subjectLabel: "Build", action: "Created", author: "You", note: "ok", createdAt: T } as Workspace["activity"][number]];
  ws.intelligence = [{ id: "i1", projectId, code: "PAT-001", patternType: "workflow", title: "Pattern", description: "desc", tags: ["tag"], author: "You", createdAt: T, updatedAt: T } as Workspace["intelligence"][number]];
  ws.repoReports = [{ id: "rr1", projectId, repositoryId: "repo1", branch: "main", classification: { frameworks: [], primary: "React", language: "ts", packageManager: "yarn", buildSystem: "vite", workspaceType: "single", appRoot: "/" }, dependencies: [], imports: [], aliases: [], environment: [], unsupported: [], previewDiagnostics: { buildStatus: "ok", repairs: [], runtimeErrors: [] }, health: { overall: 100, dependencies: 100, imports: 100, assets: 100, environment: 100, previewReadiness: 100 }, createdAt: T } as Workspace["repoReports"][number]];
  ws.repoEnv = [{ id: "env1", projectId, repositoryId: "repo1", key: "A", value: "B", updatedAt: T }];
  return ws;
}

type TestCase = { name: string; run: () => Promise<void> };
const tests: TestCase[] = [];
const test = (name: string, run: () => Promise<void>) => tests.push({ name, run });

test("ordinary save regression: vaultWrite+vaultRead work", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  const db = await loadDbWithMock(mem, "roundtrip");

  const ws = baseWorkspace("save-p1");
  ws.prompts = [{ id: "save-pr1", projectId: "save-p1", kind: "Custom Prompt", title: "Prompt", version: 1, markdown: "text", createdAt: T, linkedDecisionIds: [], linkedRequirementIds: [], linkedDocumentIds: [], linkedDiscussionIds: [] } as Workspace["prompts"][number]];
  await db.vaultWrite(ws);
  const out = await db.vaultRead<Workspace>();

  assert.ok(out);
  assert.equal(out?.projects[0]?.id, "save-p1");
  assert.equal(out?.prompts[0]?.id, "save-pr1");
});

test("import is insert-only and preserves existing records byte-for-byte", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "Owner", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: { openai: { model: "x" } }, saved_at: T }]);
  mem.seed("vpip_projects", [{ id: "existing-project", name: "Existing", description: "", archived: false, created_at: T, updated_at: T }]);
  mem.seed("vpip_prompts", [{ id: "keep-pr", project_id: "existing-project", kind: "Custom Prompt", title: "Keep", version: 1, markdown: "old", status: "Draft", linked_decision_ids: [], linked_requirement_ids: [], linked_document_ids: [], linked_discussion_ids: [], created_at: T }]);
  const db = await loadDbWithMock(mem, "insert-only");

  const beforeSettings = clone(mem.snapshot("vpip_settings"));
  const beforeKeep = clone(mem.snapshot("vpip_prompts").find((r) => r.id === "keep-pr"));

  const result = await db.vaultImport(fullImport("p-add"));
  assert.ok(result.report.added > 0);
  assert.equal(result.workspace.projects.some((p: { id: string }) => p.id === "p-add"), true);
  assert.equal(result.workspace.discussions.some((d: { id: string }) => d.id === "d1"), true);
  assert.equal(result.workspace.prompts.some((p: { id: string }) => p.id === "pr1"), true);

  assert.deepEqual(mem.snapshot("vpip_settings"), beforeSettings);
  assert.deepEqual(mem.snapshot("vpip_prompts").find((r) => r.id === "keep-pr"), beforeKeep);
  assert.equal(mem.logs.filter((l) => l.type === "delete").length, 0);
  assert.equal(mem.logs.filter((l) => l.type === "upsert" && l.table === "vpip_settings").length, 0);
});

test("re-import is idempotent with optional normalization", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  mem.seed("vpip_projects", [{ id: "p1", name: "P", description: "", archived: false, created_at: T, updated_at: T }]);
  mem.seed("vpip_prompts", [{ id: "pr1", project_id: "p1", kind: "Custom Prompt", title: "Prompt", version: 1, markdown: "M", status: "Draft", linked_decision_ids: [], linked_requirement_ids: [], linked_document_ids: [], linked_discussion_ids: [], created_at: T }]);
  const db = await loadDbWithMock(mem, "idempotent");

  const incoming = emptyWorkspace();
  incoming.version = 1;
  incoming.projects = [{ id: "p1", name: "P", description: "", archived: false, createdAt: T, updatedAt: T }];
  incoming.prompts = [{ id: "pr1", projectId: "p1", kind: "Custom Prompt", title: "Prompt", version: 1, markdown: "M", createdAt: T } as Workspace["prompts"][number]];

  const a = await db.vaultImport(incoming);
  const b = await db.vaultImport(incoming);
  assert.equal(a.report.conflicts.length, 0);
  assert.equal(b.report.added, 0);
  assert.equal(b.report.conflicts.length, 0);
});

test("concurrent ID collision after initial read: existing server row wins", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  mem.seed("vpip_projects", [{ id: "base", name: "Base", description: "", archived: false, created_at: T, updated_at: T }]);
  mem.addHook({
    remaining: 1,
    match: (log) => log.type === "upsert" && log.table === "vpip_projects",
    message: "",
    before: (db) => db.seed("vpip_projects", [{ id: "race-project", name: "ServerWins", description: "", archived: false, created_at: T, updated_at: T }]),
  });
  const db = await loadDbWithMock(mem, "collision");

  const incoming = emptyWorkspace();
  incoming.version = 1;
  incoming.projects = [{ id: "race-project", name: "Incoming", description: "", archived: false, createdAt: T, updatedAt: T }];
  const out = await db.vaultImport(incoming);

  assert.equal(out.report.added, 0);
  assert.equal(out.report.conflicts.some((c: { id: string; collection: string }) => c.id === "race-project" && c.collection === "projects"), true);
  assert.equal(mem.snapshot("vpip_projects").find((r) => r.id === "race-project")?.name, "ServerWins");
});

test("partial insert failure keeps prior inserts and safe retry completes", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  mem.addHook({ remaining: 1, match: (log) => log.type === "upsert" && log.table === "vpip_documents", message: "simulated write failure" });
  const db = await loadDbWithMock(mem, "partial");

  const payload = fullImport("p-partial");
  await assert.rejects(() => db.vaultImport(payload), /Import did not finish/);
  assert.equal(mem.snapshot("vpip_projects").some((r) => r.id === "p-partial"), true);
  assert.equal(mem.snapshot("vpip_documents").length, 0);

  const retry = await db.vaultImport(payload);
  assert.equal(retry.workspace.projects.some((p: { id: string }) => p.id === "p-partial"), true);
  assert.equal(retry.workspace.documents.some((d: { id: string }) => d.id === "doc1"), true);
});

test("post-insert verification read failure surfaces safe retry message", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  let shouldFailRead = false;
  mem.addHook({
    remaining: 1,
    match: (log) => log.type === "upsert" && log.table === "vpip_prompts",
    message: "",
    before: () => {
      shouldFailRead = true;
    },
  });
  mem.addHook({
    remaining: 1,
    match: (log) => shouldFailRead && log.type === "select" && log.table === "vpip_projects",
    message: "simulated read outage",
  });
  const db = await loadDbWithMock(mem, "verify-read-fail");

  await assert.rejects(() => db.vaultImport(fullImport("p-read-fail")), /Some new records may already have been added; retrying the same file is safe/);
  assert.equal(mem.snapshot("vpip_projects").some((r) => r.id === "p-read-fail"), true);
});

test("invalid orphan input fails before any insert writes", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  mem.seed("vpip_projects", [{ id: "base", name: "Base", description: "", archived: false, created_at: T, updated_at: T }]);
  const db = await loadDbWithMock(mem, "orphan");

  const incoming = baseWorkspace("base");
  incoming.version = 1;
  incoming.documents = [{ id: "bad", projectId: "missing", kind: "Project Summary", title: "Bad", markdown: "x", createdAt: T } as Workspace["documents"][number]];
  await assert.rejects(() => db.vaultImport(incoming), /Nothing was imported/);
  assert.equal(mem.logs.filter((l) => l.type === "upsert" && l.table !== "vpip_settings").length, 0);
});

test("diagnostic vaultSize does not widen ownership for later delete sync", async () => {
  const mem = new MockSupabase();
  mem.seed("vpip_settings", [{ id: 1, author: "You", default_provider: "openai", auto_save_interval_sec: 30, project_root_label: "Root", backup_folder_label: "Backup", providers: {}, saved_at: T }]);
  mem.seed("vpip_projects", [{ id: "own-1", name: "Owned", description: "", archived: false, created_at: T, updated_at: T }]);
  const db = await loadDbWithMock(mem, "ownership");

  const loaded = await db.vaultRead<Workspace>();
  mem.seed("vpip_projects", [{ id: "foreign-1", name: "Foreign", description: "", archived: false, created_at: T, updated_at: T }]);
  await db.vaultSize();
  await db.vaultWrite(loaded);

  assert.equal(mem.snapshot("vpip_projects").some((r) => r.id === "foreign-1"), true);
});

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    await t.run();
    passed += 1;
    console.log(`PASS: ${t.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL: ${t.name}`);
    console.error(error);
  }
}

console.log(`\nResult: ${passed} passed, ${failed} failed, ${tests.length} total`);
if (failed > 0) process.exit(1);