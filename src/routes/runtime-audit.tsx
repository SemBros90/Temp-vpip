import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeEventsView, RuntimeNav } from "@/components/vpip/RuntimeEventsView";

export const Route = createFileRoute("/runtime-audit")({
  head: () => ({
    meta: [
      { title: "Runtime Audit Center · VPIP" },
      { name: "description", content: "Single read-only location for all VPIP runtime, sandbox, validation, environment, sync and cleanup events with CSV/JSON export." },
      { property: "og:title", content: "Runtime Audit Center · VPIP" },
      { property: "og:description", content: "All VPIP runtime activity in one read-only audit view with export." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <Shell title="Runtime Audit Center">
      <div className="mx-auto max-w-7xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtime Audit Center</h1>
          <p className="text-sm text-muted-foreground">All runtime activity in one place. Read-only. Export includes every event matching the filters.</p>
        </div>
        <RuntimeNav />
        <RuntimeEventsView mode="audit" />
      </div>
    </Shell>
  );
}
