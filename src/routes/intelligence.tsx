import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, Trash2 } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { download } from "@/lib/vpip/files";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { PATTERN_TYPES, type PatternType } from "@/lib/vpip/types";

export const Route = createFileRoute("/intelligence")({
  head: () => ({
    meta: [
      { title: "Project Intelligence Register — VPIP" },
      {
        name: "description",
        content:
          "Organizational knowledge across every project: success patterns, failure patterns, reusable decisions, requirements and prompt structures.",
      },
      { property: "og:title", content: "Project Intelligence Register — VPIP" },
      {
        property: "og:description",
        content: "Search reusable patterns and trace each back to the project it came from.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntelligencePage,
});

function IntelligencePage() {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<PatternType | "All">("All");

  const records = (ws.intelligence ?? []).filter((r) => {
    if (type !== "All" && r.patternType !== type) return false;
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return `${r.code} ${r.title} ${r.description} ${r.tags.join(" ")} ${r.sourceProjectName ?? ""}`
      .toLowerCase()
      .includes(q);
  });

  const exportAll = () => {
    const lines = ["# Project Intelligence Register", ""];
    for (const r of ws.intelligence ?? []) {
      lines.push(
        `## ${r.code} — ${r.title}`,
        "",
        `Pattern: ${r.patternType} · Source project: ${r.sourceProjectName ?? "—"} · ${new Date(r.createdAt).toLocaleString()}`,
        "",
        r.description,
        "",
      );
    }
    download(lines.join("\n"), "project-intelligence-register.md");
  };

  return (
    <Shell
      title="Project Intelligence Register"
      subtitle={`${(ws.intelligence ?? []).length} organizational patterns across ${ws.projects.length} projects`}
      actions={
        <Button size="sm" variant="outline" className="h-8" onClick={exportAll}>
          <Download className="size-4" /> Export register
        </Button>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search patterns, decisions, prompt structures…"
            className="h-9 max-w-md bg-surface-2 text-sm"
          />
          <Select value={type} onValueChange={(v) => setType(v as PatternType | "All")}>
            <SelectTrigger className="h-9 w-56 bg-surface-2 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="All">All pattern types</SelectItem>
              {PATTERN_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {records.length ? (
          <div className="panel divide-y divide-border">
            {records.map((r) => (
              <div key={r.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-semibold text-primary">{r.code}</span>
                  <Tag>{r.patternType}</Tag>
                  <span className="text-sm font-medium">{r.title}</span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto size-7 text-destructive"
                    onClick={() => actions.deleteIntelligence(r.id)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                  {r.description}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {r.tags.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                  {r.sourceProjectId ? (
                    <Link to="/projects/$projectId" params={{ projectId: r.sourceProjectId }}>
                      <Tag className="hover:text-primary">
                        Open source project · {r.sourceProjectName}
                      </Tag>
                    </Link>
                  ) : null}
                  {r.provider ? <Tag>{r.provider}</Tag> : null}
                  <Tag>{r.author}</Tag>
                  <Tag>{new Date(r.createdAt).toLocaleString()}</Tag>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            title="No organizational patterns yet"
            description="Promote lessons, outcomes and failures from any project's Lessons Learned screen to build the register."
          />
        )}
      </div>
    </Shell>
  );
}
