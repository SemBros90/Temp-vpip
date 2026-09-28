import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { emptyWorkspace, type Workspace } from "../src/lib/vpip/types";
import { importCollections, validateWorkspaceImport } from "../src/lib/vpip/workspace-import-schema";
import { mergeWorkspaceImport } from "../src/lib/vpip/workspace-import";

type TestCase = { name: string; run: () => void };
const tests: TestCase[] = [];
const test = (name: string, run: () => void) => tests.push({ name, run });

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function baseWorkspace(): Workspace {
  const ws = emptyWorkspace();
  ws.projects = [{
    id: "p1",
    name: "Project One",
    description: "d",
    archived: false,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  }];
  return ws;
}

function sampleBuildSession(projectId = "p1") {
  return {
    id: "b1",
    code: "BUILD-001",
    projectId,
    promptId: "pr1",
    promptTitle: "Prompt",
    promptKind: "Custom Prompt",
    promptVersion: 1,
    status: "Queued",
    contextPackage: "ctx",
    counts: { decisions: 0, requirements: 0, documents: 0, discussions: 0 },
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
    turns: [{
      id: "t1",
      createdAt: "2026-02-01T00:00:00.000Z",
      provider: "openai",
      model: "gpt-4o",
      seq: 1,
      role: "assistant",
      content: "ok",
      trace: {
        buildCode: "BUILD-001",
        promptId: "pr1",
        promptVersion: 1,
        decisionCodes: [],
        requirementCodes: [],
        documentIds: [],
        discussionIds: [],
      },
    }],
    files: [{
      id: "f1",
      path: "src/a.ts",
      content: "x",
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
      versions: [{
        id: "v1",
        createdAt: "2026-02-01T00:00:00.000Z",
        provider: "openai",
        model: "gpt-4o",
        seq: 1,
        content: "x",
        note: "n",
        trace: {
          buildCode: "BUILD-001",
          promptId: "pr1",
          promptVersion: 1,
          decisionCodes: [],
          requirementCodes: [],
          documentIds: [],
          discussionIds: [],
        },
      }],
    }],
    actions: [],
    terminal: [],
    dbConnections: [],
    agentTasks: [],
    requirements: [],
  };
}

test("import collections are exactly 22", () => {
  assert.equal(importCollections.length, 22);
});

test("validate accepts v1 and missing optional collections", () => {
  const parsed = validateWorkspaceImport({
    version: 1,
    projects: [{
      id: "p1",
      name: "X",
      description: "",
      archived: false,
      createdAt: "2026-02-01T00:00:00.000Z",
      updatedAt: "2026-02-01T00:00:00.000Z",
    }],
  });
  assert.equal(parsed.version, 1);
  assert.equal(parsed.projects.length, 1);
  assert.equal(parsed.discussions.length, 0);
});

for (const bad of [{}, null, [], { version: 2, projects: [] }, { version: 1, projects: [], unknown: [] }]) {
  test(`validate rejects invalid root ${JSON.stringify(bad)}`.slice(0, 110), () => {
    assert.throws(() => validateWorkspaceImport(bad));
  });
}

test("validate rejects duplicate IDs", () => {
  assert.throws(() => validateWorkspaceImport({
    projects: [
      { id: "p1", name: "A", description: "", archived: false, createdAt: "x", updatedAt: "x" },
      { id: "p1", name: "B", description: "", archived: false, createdAt: "x", updatedAt: "x" },
    ],
  }));
});

test("validate rejects malformed nested build messages/files", () => {
  const payload = {
    projects: [{ id: "p1", name: "A", description: "", archived: false, createdAt: "x", updatedAt: "x" }],
    buildSessions: [{
      ...sampleBuildSession("p1"),
      turns: [{ ...sampleBuildSession("p1").turns[0], role: "broken-role" }],
    }],
  };
  assert.throws(() => validateWorkspaceImport(payload));
});

test("merge adds only new IDs and keeps conflicts unchanged", () => {
  const current = baseWorkspace();
  current.repositories = [{
    id: "r1",
    projectId: "p1",
    provider: "GitHub",
    owner: "o",
    name: "n",
    fullName: "o/n",
    description: "",
    visibility: "private",
    defaultBranch: "main",
    currentBranch: "main",
    htmlUrl: "u",
    token: "secret",
    status: "Connected",
    createdAt: "x",
    updatedAt: "x",
  }];

  const incoming = clone(current);
  incoming.projects.push({
    id: "p2",
    name: "Second",
    description: "",
    archived: false,
    createdAt: "2026-02-01T00:00:00.000Z",
    updatedAt: "2026-02-01T00:00:00.000Z",
  });
  incoming.repositories[0] = { ...incoming.repositories[0], token: "DIFFERENT" };

  const { workspace, report } = mergeWorkspaceImport(current, incoming);
  assert.equal(workspace.projects.length, 2);
  assert.equal(workspace.repositories[0]?.token, "secret");
  assert.equal(report.added, 1);
  assert.equal(report.conflicts.length, 1);
});

test("merge marks key-reordered JSON as unchanged", () => {
  const current = baseWorkspace();
  current.documents = [{
    id: "d1",
    projectId: "p1",
    kind: "Project Summary",
    title: "T",
    markdown: "M",
    createdAt: "x",
    provider: "openai",
    model: "gpt-4o",
  }];
  const incoming = clone(current);
  incoming.documents[0] = JSON.parse('{"projectId":"p1","id":"d1","title":"T","kind":"Project Summary","markdown":"M","createdAt":"x","model":"gpt-4o","provider":"openai"}');
  const { report } = mergeWorkspaceImport(current, incoming);
  assert.equal(report.unchanged, 2);
  assert.equal(report.conflicts.length, 0);
});

test("merge rejects orphan project links before any DB write path", () => {
  const current = baseWorkspace();
  const incoming = baseWorkspace();
  incoming.documents.push({
    id: "d2",
    projectId: "missing-project",
    kind: "Project Summary",
    title: "X",
    markdown: "x",
    createdAt: "x",
  });
  assert.throws(() => mergeWorkspaceImport(current, incoming));
});

test("merge rejects repo child rows with mismatched project relationship", () => {
  const current = baseWorkspace();
  current.repositories = [{
    id: "repo-1",
    projectId: "p1",
    provider: "GitHub",
    owner: "o",
    name: "n",
    fullName: "o/n",
    description: "",
    visibility: "private",
    defaultBranch: "main",
    currentBranch: "main",
    htmlUrl: "u",
    token: "s",
    status: "Connected",
    createdAt: "x",
    updatedAt: "x",
  }];
  const incoming = clone(current);
  incoming.repoEnv.push({
    id: "env-1",
    projectId: "wrong-project",
    repositoryId: "repo-1",
    key: "A",
    value: "B",
    updatedAt: "x",
  });
  assert.throws(() => mergeWorkspaceImport(current, incoming));
});

test("merge does not mutate input objects", () => {
  const current = baseWorkspace();
  const incoming = baseWorkspace();
  incoming.projects.push({
    id: "p2",
    name: "N",
    description: "",
    archived: false,
    createdAt: "x",
    updatedAt: "x",
  });
  const beforeCurrent = clone(current);
  const beforeIncoming = clone(incoming);
  mergeWorkspaceImport(current, incoming);
  assert.deepEqual(current, beforeCurrent);
  assert.deepEqual(incoming, beforeIncoming);
});

test("empty import is harmless no-op", () => {
  const current = baseWorkspace();
  const incoming = baseWorkspace();
  const { workspace, report } = mergeWorkspaceImport(current, incoming);
  assert.deepEqual(workspace, current);
  assert.equal(report.added, 0);
  assert.equal(report.conflicts.length, 0);
});

test("db vaultImport path is insert-only and keeps settings unchanged", () => {
  const dbPath = path.join(process.cwd(), "src/lib/vpip/db.ts");
  const content = fs.readFileSync(dbPath, "utf8");
  const importStart = content.indexOf("export function vaultImport");
  const importEnd = content.indexOf("export async function verifySave", importStart);
  assert.ok(importStart > -1 && importEnd > importStart, "vaultImport block not found");
  const block = content.slice(importStart, importEnd);

  assert.match(block, /ignoreDuplicates:\s*true/);
  assert.doesNotMatch(block, /\.delete\(/);
  assert.doesNotMatch(block, /writeSettings\s*=\s*true/);
  assert.match(block, /writeWorkspace\(plan\.workspace, insertOnly, false\)/);
});

test("diagnostic vaultSize does not track ownership ids", () => {
  const dbPath = path.join(process.cwd(), "src/lib/vpip/db.ts");
  const content = fs.readFileSync(dbPath, "utf8");
  const start = content.indexOf("export async function vaultSize");
  const end = content.indexOf("export async function vaultClear", start);
  const block = content.slice(start, end);
  assert.match(block, /vaultRead<Workspace>\(false\)/);
});

test("store import guards block not-loaded and unsaved states", () => {
  const storePath = path.join(process.cwd(), "src/lib/vpip/store.tsx");
  const content = fs.readFileSync(storePath, "utf8");
  assert.match(content, /Wait until the existing workspace has loaded before importing\./);
  assert.match(content, /An import is already running\./);
  assert.match(content, /still saving\. Wait for Saved, then import the file again\./);
  assert.match(content, /deferredUpdatesRef\.current\.push\(fn\)/);
  assert.match(content, /beforeunload/);
});

let passed = 0;
let failed = 0;
for (const t of tests) {
  try {
    t.run();
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
