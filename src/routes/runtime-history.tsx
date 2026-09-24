import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeEventsView, RuntimeNav } from "@/components/vpip/RuntimeEventsView";

export const Route = createFileRoute("/runtime-history")({
  validateSearch: (s) => z.object({ projectId: z.string().optional(), buildId: z.string().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "Runtime History · VPIP" },
      { name: "description", content: "Every VPIP runtime event: launch, sync, install, start, stop, pause, resume, destroy, cleanup, validation and errors." },
      { property: "og:title", content: "Runtime History · VPIP" },
      { property: "og:description", content: "Searchable, filterable history of every VPIP runtime event." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { projectId, buildId } = Route.useSearch();
  return (
    <Shell title="Runtime History">
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtime History</h1>
          <p className="text-sm text-muted-foreground">Every runtime event, newest first. Read-only.</p>
        </div>
        <RuntimeNav />
        <RuntimeEventsView mode="history" initialProjectId={projectId} initialBuildId={buildId} />
      </div>
    </Shell>
  );
}
