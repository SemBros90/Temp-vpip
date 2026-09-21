import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Camera, Download, Lock } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, relTime, Tag } from "@/components/vpip/common";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import { useProject } from "@/lib/vpip/store";
import { download, slug } from "@/lib/vpip/files";

export const Route = createFileRoute("/projects/$projectId/snapshots")({
  head: () => ({
    meta: [
      { title: "Snapshots — VPIP" },
      {
        name: "description",
        content: "Every generated document, prompt and report is frozen as a permanent, immutable snapshot of the project at that moment.",
      },
      { property: "og:title", content: "Snapshots — VPIP" },
      { property: "og:description", content: "Immutable history of everything the project produced." },
    ],
  }),
  component: SnapshotsPage,
});

function SnapshotsPage() {
  const { projectId } = Route.useParams();
  const p = useProject(projectId);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = p.snapshots.find((s) => s.id === openId) ?? p.snapshots[0];

  return (
    <Shell title="Snapshots" subtitle={`${p.snapshots.length} immutable records`}>
      <div className="mx-auto max-w-6xl px-6 py-6">
        {p.snapshots.length === 0 ? (
          <EmptyState
            title="No snapshots yet"
            description="Generating a document or prompt automatically freezes a permanent snapshot here."
          />
        ) : (
          <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
            <div className="panel divide-y divide-border self-start">
              {p.snapshots.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setOpenId(s.id)}
                  className={`flex w-full items-start gap-2 px-3 py-2.5 text-left text-sm ${
                    open?.id === s.id ? "bg-surface-2 text-foreground" : "text-muted-foreground"
                  }`}
                >
                  <Camera className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{s.title}</span>
                    <span className="label-mono">
                      {s.kind} · {relTime(s.createdAt)}
                    </span>
                  </span>
                </button>
              ))}
            </div>

            {open ? (
              <div className="panel p-5">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{open.title}</h2>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Tag>{open.kind}</Tag>
                      <Tag>{new Date(open.createdAt).toLocaleString()}</Tag>
                      <span className="label-mono flex items-center gap-1">
                        <Lock className="size-3" /> immutable
                      </span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() => download(open.markdown, `${slug(open.title)}-snapshot.md`)}
                  >
                    <Download className="size-4" /> Markdown
                  </Button>
                </div>
                <Markdown source={open.markdown} />
              </div>
            ) : null}
          </div>
        )}
      </div>
    </Shell>
  );
}
