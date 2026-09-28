import assert from "node:assert/strict";
import { emptyWorkspace } from "../src/lib/vpip/types";
import { mergeWorkspaceImport } from "../src/lib/vpip/workspace-import";

const current = emptyWorkspace();
current.projects = [{ id: "p1", name: "P", description: "", archived: false, createdAt: "x", updatedAt: "x" }];
current.prompts = [{
  id: "pr1",
  projectId: "p1",
  kind: "Custom Prompt",
  title: "Prompt",
  version: 1,
  markdown: "M",
  createdAt: "x",
  linkedDecisionIds: [],
  linkedRequirementIds: [],
  linkedDocumentIds: [],
  linkedDiscussionIds: [],
}];

const incoming = emptyWorkspace();
incoming.projects = [{ id: "p1", name: "P", description: "", archived: false, createdAt: "x", updatedAt: "x" }];
incoming.prompts = [{
  id: "pr1",
  projectId: "p1",
  kind: "Custom Prompt",
  title: "Prompt",
  version: 1,
  markdown: "M",
  createdAt: "x",
  // Optional defaults omitted (older app/export behavior)
}];

const result = mergeWorkspaceImport(current, incoming);
assert.equal(result.report.unchanged, 2);
assert.deepEqual(result.report.conflicts, []);
assert.equal(result.report.added, 0);
console.log(JSON.stringify({
  unchanged: result.report.unchanged,
  conflicts: result.report.conflicts,
}, null, 2));
