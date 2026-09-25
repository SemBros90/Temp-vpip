import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { Tag, relTime } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { audit, did, insertRows, listSessions } from "@/lib/vpip/discovery-db";
import { COLOR_CLASS, MATURITY, overallReadiness, readyColor, type DSession } from "@/lib/vpip/discovery";

export const Route = createFileRoute("/projects/$projectId/discovery/")({
  head: () => ({
    meta: [
      { title: "Discovery — VPIP" },
      { name: "description", content: "AI-guided project interview: start from one sentence and define the project step by step." },
      { property: "og:title", content: "Discovery — VPIP" },
      { property: "og:description", content: "Structured AI project interview with readiness and maturity tracking." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: DiscoveryList,
});

function DiscoveryList() {
  const { projectId } = Route.useParams();
  const nav = useNavigate();
  const [sessions, setSessions] = useState<DSession[] | null>(null);
  const [idea, setIdea] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSessions(projectId).then(setSessions).catch((e) => toast.error(String(e.message ?? e)));
  }, [projectId]);

  const start = async () => {
    const text = idea.trim();
    if (!text) return;
    setBusy(true);
    try {
      const id = did();
      await insertRows("vpip_discovery_sessions", { id, project_id: projectId, idea: text });
      await audit(projectId, id, "Discovery Started", { idea: text });
      nav({ to: "/projects/$projectId/discovery/$sessionId", params: { projectId, sessionId: id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start discovery.");
      setBusy(false);
    }
  };

  return (
    <Shell
      title="Discovery"
      subtitle="AI-guided project interview. The AI asks; you decide when to move on."
      actions={
        <Button variant="outline" asChild>
          <Link to="/projects/$projectId/discovery/audit" params={{ projectId }}>Discovery audit</Link>
        </Button>
      }
    >
      <div className="max-w-3xl space-y-6">
        <div className="rounded-lg border p-4 space-y-3">
          <div className="font-medium">New discovery</div>
          <p className="text-sm text-muted-foreground">Describe your project in one simple sentence. No technical knowledge needed.</p>
          <Textarea value={idea} onChange={(e) => setIdea(e.target.value)} placeholder="I want to build a medical tourism platform." rows={2} />
          <Button onClick={start} disabled={busy || !idea.trim()}>Start interview</Button>
        </div>
        <div className="space-y-2">
          <div className="font-medium">Sessions</div>
          {sessions === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {sessions?.length === 0 && <p className="text-sm text-muted-foreground">No discovery sessions yet.</p>}
          {sessions?.map((s) => {
            const pct = overallReadiness(s.readiness ?? {});
            return (
              <Link
                key={s.id}
                to="/projects/$projectId/discovery/$sessionId"
                params={{ projectId, sessionId: s.id }}
                className="flex items-center gap-3 rounded-md border p-3 hover:bg-muted/50"
              >
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${COLOR_CLASS[readyColor(pct)]}`}>{pct}%</span>
                <span className="flex-1 truncate">{s.idea}</span>
                <Tag>L{s.maturity} {MATURITY[s.maturity]}</Tag>
                <Tag>{s.status.replace("_", " ")}</Tag>
                <span className="text-xs text-muted-foreground">{relTime(s.updated_at)}</span>
              </Link>
            );
          })}
        </div>
      </div>
    </Shell>
  );
}
