import JSZip from "jszip";
import type {
  Discussion,
  GeneratedDocument,
  GeneratedPrompt,
  KnowledgeItem,
  Project,
  Snapshot,
  Workspace,
} from "./types";

export function slug(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "untitled"
  );
}

function frontMatter(data: Record<string, unknown>) {
  const lines = Object.entries(data)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? JSON.stringify(v) : String(v)}`);
  return `---\n${lines.join("\n")}\n---\n\n`;
}

export function discussionToMarkdown(d: Discussion) {
  const head = frontMatter({
    id: d.id,
    title: d.title,
    type: d.type,
    created: d.createdAt,
    updated: d.updatedAt,
    messages: d.messages.length,
  });
  const body = d.messages
    .map(
      (m) =>
        `## [${m.seq}] ${m.role === "user" ? "User" : "AI"}${
          m.provider ? ` · ${m.provider}/${m.model ?? ""}` : ""
        }\n_${new Date(m.createdAt).toLocaleString()}_\n\n${m.content}\n`,
    )
    .join("\n");
  const summary = d.summary ? `## Summary\n\n${d.summary}\n\n` : "";
  return `${head}# ${d.title}\n\n${summary}${body}`;
}

export function knowledgeToMarkdown(k: KnowledgeItem) {
  const head = frontMatter({
    id: k.code,
    type: k.type,
    status: k.status,
    source_discussion: k.sourceDiscussionTitle,
    source_messages: k.sourceMessages,
    provider: k.provider,
    author: k.author,
    created: k.createdAt,
  });
  const revisions = k.revisions
    .map((r) => `- ${new Date(r.at).toLocaleString()} · ${r.author} · ${r.note}`)
    .join("\n");
  return `${head}# ${k.code} — ${k.title}\n\n${k.description}\n\n## Revision history\n\n${
    revisions || "- (none)"
  }\n`;
}

function folderFor(k: KnowledgeItem) {
  if (k.status !== "approved") return "KnowledgeInbox";
  return (
    {
      Decision: "Decisions",
      Requirement: "Requirements",
      Idea: "Ideas",
      Risk: "Risks",
      Question: "Questions",
      Assumption: "Ideas",
    } as Record<string, string>
  )[k.type];
}

export interface ProjectBundle {
  project: Project;
  discussions: Discussion[];
  knowledge: KnowledgeItem[];
  documents: GeneratedDocument[];
  prompts: GeneratedPrompt[];
  snapshots: Snapshot[];
}

export function addProjectToZip(zip: JSZip, b: ProjectBundle) {
  const root = zip.folder(`Projects/${slug(b.project.name)}`)!;
  root.file(
    "project.json",
    JSON.stringify(
      {
        ...b.project,
        counts: {
          discussions: b.discussions.length,
          knowledge: b.knowledge.length,
          documents: b.documents.length,
          prompts: b.prompts.length,
          snapshots: b.snapshots.length,
        },
      },
      null,
      2,
    ),
  );
  for (const d of b.discussions) {
    root.file(`Discussions/${slug(d.title)}-${d.id.slice(0, 6)}.md`, discussionToMarkdown(d));
    for (const a of d.attachments) {
      const payload = a.data.includes("base64,")
        ? (a.data.split("base64,")[1] ?? "")
        : a.data;
      root.file(`Attachments/${slug(d.title)}/${a.name}`, payload, {
        base64: a.data.includes("base64,"),
      });
    }
  }
  for (const k of b.knowledge) {
    root.file(`${folderFor(k)}/${k.code}-${slug(k.title)}.md`, knowledgeToMarkdown(k));
  }
  for (const doc of b.documents) {
    root.file(`Documents/${slug(doc.title)}.md`, doc.markdown);
  }
  for (const p of b.prompts) {
    root.file(`Prompts/${slug(p.title)}-V${p.version}.md`, p.markdown);
  }
  for (const s of b.snapshots) {
    root.file(
      `Snapshots/${s.createdAt.replace(/[:.]/g, "-")}-${slug(s.title)}.md`,
      s.markdown,
    );
  }
  return root;
}

export async function exportProjectZip(b: ProjectBundle) {
  const zip = new JSZip();
  addProjectToZip(zip, b);
  const blob = await zip.generateAsync({ type: "blob" });
  download(blob, `${slug(b.project.name)}-vpip.zip`);
}

export async function exportWorkspaceZip(ws: Workspace) {
  const zip = new JSZip();
  zip.file(
    "workspace.json",
    JSON.stringify({ ...ws, settings: { ...ws.settings } }, null, 2),
  );
  for (const project of ws.projects) {
    addProjectToZip(zip, {
      project,
      discussions: ws.discussions.filter((d) => d.projectId === project.id),
      knowledge: ws.knowledge.filter((k) => k.projectId === project.id),
      documents: ws.documents.filter((d) => d.projectId === project.id),
      prompts: ws.prompts.filter((p) => p.projectId === project.id),
      snapshots: ws.snapshots.filter((s) => s.projectId === project.id),
    });
  }
  const blob = await zip.generateAsync({ type: "blob" });
  download(blob, `vpip-workspace-${new Date().toISOString().slice(0, 10)}.zip`);
}

export function download(data: Blob | string, filename: string) {
  const blob = typeof data === "string" ? new Blob([data], { type: "text/markdown" }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
