import { createFileRoute, Link } from "@tanstack/react-router";
import { Download, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EnginePicker, relTime, Stat, Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { useProject, useVpip } from "@/lib/vpip/store";
import { exportProjectZip } from "@/lib/vpip/files";
import { PROVIDER_LABEL, type ProviderId } from "@/lib/vpip/types";
import { useAiKeys } from "@/lib/vpip/keys";

export const Route = createFileRoute("/projects/$projectId/")({
  head: () => ({
    meta: [
      { title: "Project dashboard — VPIP" },
      {
        name: "description",
        content: "Live counts of discussions, decisions, requirements, risks, prompts and documents for this project.",
      },
      { property: "og:title", content: "Project dashboard — VPIP" },
      { property: "og:description", content: "The state of your project memory at a glance." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { projectId } = Route.useParams();
  const { ws } = useVpip();
  const p = useProject(projectId);

  if (!p.project) {
    return (
      <Shell title="Project not found">
        <div className="p-6 text-sm text-muted-foreground">
          This project no longer exists. <Link to="/" className="text-primary underline">Back to projects</Link>
        </div>
      </Shell>
    );
  }

  const count = (t: string) => p.approved.filter((k) => k.type === t).length;
  const connected = (Object.keys(ws.settings.providers) as ProviderId[]).filter(
    (id) => ws.settings.providers[id].apiKey,
  );
  const lastActivity = [
    p.project.updatedAt,
    ...p.discussions.map((d) => d.updatedAt),
    ...p.documents.map((d) => d.createdAt),
  ].sort().at(-1);

  return (
    <Shell
      title={p.project.name}
      subtitle={p.project.description || "No project brief."}
      actions={
        <>
          <EnginePicker />
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={async () => {
              await exportProjectZip({
                project: p.project!,
                discussions: p.discussions,
                knowledge: p.knowledge,
                documents: p.documents,
                prompts: p.prompts,
                snapshots: p.snapshots,
              });
              toast.success("Project folder exported as ZIP");
            }}
          >
            <Download className="size-4" /> Export folder
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-6xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Discussions" value={p.discussions.length} />
          <Stat label="Decisions" value={count("Decision")} />
          <Stat label="Requirements" value={count("Requirement")} />
          <Stat label="Risks" value={count("Risk")} />
          <Stat label="Questions" value={count("Question")} />
          <Stat label="Prompts" value={p.prompts.length} />
          <Stat label="Documents" value={p.documents.length} />
          <Stat
            label="Inbox candidates"
            value={p.candidates.length}
            hint={p.candidates.length ? "Waiting for your approval" : "All reviewed"}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="panel p-4 lg:col-span-2">
            <div className="label-mono mb-3">Recent discussions</div>
            {p.discussions.length === 0 ? (
              <div className="flex flex-col items-start gap-2 text-xs text-muted-foreground">
                No discussions yet. Discussion creates knowledge.
                <Button asChild size="sm" className="h-7">
                  <Link to="/projects/$projectId/discussions" params={{ projectId }}>
                    <MessagesSquare className="size-3.5" /> Start one
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {[...p.discussions]
                  .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
                  .slice(0, 7)
                  .map((d) => (
                    <li key={d.id}>
                      <Link
                        to="/projects/$projectId/discussions/$discussionId"
                        params={{ projectId, discussionId: d.id }}
                        className="flex items-center justify-between gap-3 py-2 hover:text-primary"
                      >
                        <span className="truncate text-sm">{d.title}</span>
                        <span className="flex shrink-0 items-center gap-1.5">
                          <Tag>{d.type}</Tag>
                          <Tag>{d.messages.length} msg</Tag>
                          <span className="label-mono">{relTime(d.updatedAt)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
              </ul>
            )}
          </div>

          <div className="panel space-y-4 p-4">
            <div>
              <div className="label-mono mb-2">Connected engines</div>
              {connected.length === 0 ? (
                <div className="text-xs text-muted-foreground">
                  No API keys yet —{" "}
                  <Link to="/settings" className="text-primary underline">
                    add one in Settings
                  </Link>
                  .
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {connected.map((id) => (
                    <Tag key={id}>
                      {PROVIDER_LABEL[id]} · {ws.settings.providers[id].model}
                    </Tag>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="label-mono mb-1">Last activity</div>
              <div className="font-mono text-sm">{relTime(lastActivity)}</div>
            </div>
            <div>
              <div className="label-mono mb-1">Snapshots</div>
              <div className="font-mono text-sm">{p.snapshots.length}</div>
            </div>
            <div className="border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
              Discussion creates knowledge. Knowledge creates decisions. Decisions create
              documents. Documents create prompts.
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
}
