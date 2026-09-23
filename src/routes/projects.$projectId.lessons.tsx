import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Download, Share2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag, TypeTag, useEngine } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { download, slug } from "@/lib/vpip/files";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { PATTERN_TYPES, type PatternType } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/lessons")({
  head: () => ({
    meta: [
      { title: "Lessons Learned — VPIP" },
      {
        name: "description",
        content:
          "The project's lessons learned register: approved lessons, failure causes, recorded outcomes and resolved failures, promotable to organizational patterns.",
      },
      { property: "og:title", content: "Lessons Learned — VPIP" },
      {
        property: "og:description",
        content: "Turn build and prompt experience into reusable organizational knowledge.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: LessonsPage,
});

interface LessonRow {
  id: string;
  code: string;
  source: string;
  title: string;
  body: string;
  provider?: string | undefined;
  date: string;
  suggested: PatternType;
}

function LessonsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();
  const [query, setQuery] = useState("");
  const [patternFor, setPatternFor] = useState<Record<string, PatternType>>({});

  const rows: LessonRow[] = [
    ...p.approved
      .filter((k) => k.type === "Lesson Learned" || k.type === "Failure Cause")
      .map((k) => ({
        id: k.id,
        code: k.code,
        source: k.type,
        title: k.title,
        body: k.description,
        provider: k.provider,
        date: k.createdAt,
        suggested: (k.type === "Failure Cause" ? "Failure Pattern" : "Success Pattern") as PatternType,
      })),
    ...p.outcomes
      .filter((o) => o.lessons.trim() || o.recommendations.trim())
      .map((o) => ({
        id: o.id,
        code: o.code,
        source: `Outcome · ${o.result}`,
        title: o.subjectLabel,
        body: [o.lessons, o.recommendations].filter(Boolean).join("\n\n"),
        provider: o.provider,
        date: o.createdAt,
        suggested: (o.result === "Failure" ? "Failure Pattern" : "Success Pattern") as PatternType,
      })),
    ...p.failures.map((f) => ({
      id: f.id,
      code: f.code,
      source: `Failure · ${f.status}`,
      title: f.title,
      body: [f.rootCause, f.resolution, f.lessons].filter(Boolean).join("\n\n"),
      provider: f.provider,
      date: f.createdAt,
      suggested: "Failure Pattern" as PatternType,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date));

  const filtered = query.trim()
    ? rows.filter((r) =>
        `${r.code} ${r.title} ${r.body} ${r.source}`.toLowerCase().includes(query.toLowerCase()),
      )
    : rows;

  const promote = (r: LessonRow) => {
    const patternType = patternFor[r.id] ?? r.suggested;
    const rec = actions.addIntelligence({
      projectId,
      patternType,
      title: r.title.slice(0, 160),
      description: r.body,
      tags: [r.source],
      sourceProjectId: projectId,
      sourceProjectName: p.project?.name ?? "",
      sourceKind: r.source,
      sourceId: r.id,
      provider,
      model: cfg.model,
      author,
    });
    actions.logActivity({
      projectId,
      subjectType: "Intelligence",
      subjectId: rec.id,
      subjectLabel: `${rec.code} — ${rec.title}`,
      action: "Recorded",
      provider,
      model: cfg.model,
      author,
      note: patternType,
    });
    toast.success(`${rec.code} added to the Project Intelligence Register.`);
  };

  const exportRegister = () => {
    const lines = [`# Lessons Learned Register — ${p.project?.name ?? ""}`, ""];
    for (const r of rows) {
      lines.push(`## ${r.code} — ${r.title}`, "", `Source: ${r.source} · ${new Date(r.date).toLocaleString()}`, "", r.body, "");
    }
    download(lines.join("\n"), `${slug(p.project?.name ?? "project")}-lessons-learned.md`);
  };

  return (
    <Shell
      title="Lessons Learned"
      subtitle={`${rows.length} entries across approved knowledge, outcomes and failures`}
      actions={
        <Button size="sm" variant="outline" className="h-8" onClick={exportRegister}>
          <Download className="size-4" /> Export register
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search lessons, root causes, recommendations…"
          className="h-9 bg-surface-2 text-sm"
        />

        {filtered.length ? (
          <div className="panel divide-y divide-border">
            {filtered.map((r) => (
              <div key={`${r.source}-${r.id}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{r.code}</span>
                  {r.source === "Lesson Learned" || r.source === "Failure Cause" ? (
                    <TypeTag type={r.source} />
                  ) : (
                    <Tag>{r.source}</Tag>
                  )}
                  <span className="text-sm font-medium">{r.title}</span>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {r.body}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.provider ? <Tag>{r.provider}</Tag> : null}
                  <Tag>{new Date(r.date).toLocaleString()}</Tag>
                  <span className="ml-auto flex items-center gap-1.5">
                    <Select
                      value={patternFor[r.id] ?? r.suggested}
                      onValueChange={(v) => setPatternFor((s) => ({ ...s, [r.id]: v as PatternType }))}
                    >
                      <SelectTrigger className="h-7 w-52 bg-surface-2 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PATTERN_TYPES.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => promote(r)}>
                      <Share2 className="size-3.5" /> Promote
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No lessons yet"
            description="Record outcomes and failures, and approve Lesson Learned or Failure Cause candidates in the Knowledge Inbox — they all collect here."
          />
        )}
      </div>
    </Shell>
  );
}
