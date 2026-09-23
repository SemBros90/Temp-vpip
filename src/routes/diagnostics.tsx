import { createFileRoute } from "@tanstack/react-router";
import { Shell } from "@/components/vpip/Shell";
import { Stat } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { useVpip } from "@/lib/vpip/store";

export const Route = createFileRoute("/diagnostics")({
  head: () => ({
    meta: [
      { title: "Persistence diagnostics — VPIP" },
      {
        name: "description",
        content:
          "Storage provider, workspace totals and last save, load and sync timestamps for the VPIP vault.",
      },
      { property: "og:title", content: "Persistence diagnostics — VPIP" },
      {
        property: "og:description",
        content: "Verify that every VPIP record is loaded from and saved to the project database.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Diagnostics,
});

function Diagnostics() {
  const { ws, loaded, dirty, lastSavedAt, lastLoadedAt, loadError, reload, saveNow } = useVpip();

  const count = (t: string) => ws.knowledge.filter((k) => k.type === t && k.status === "Approved").length;
  const rows: Array<[string, string]> = [
    ["Storage provider", "Cloud database (Postgres) — single source of truth"],
    ["Local browser storage", "Only the coder panel layout (vpip-coder-layout)"],
    ["Workspace", "Single shared workspace"],
    ["Projects", String(ws.projects.length)],
    ["Load state", loaded ? (loadError ? "Failed" : "Loaded") : "Loading"],
    ["Load error", loadError ?? "None"],
    ["Unsaved changes", dirty ? "Yes" : "No"],
    ["Last load", lastLoadedAt ?? "—"],
    ["Last save", lastSavedAt ?? "—"],
    ["Last sync", lastSavedAt ?? lastLoadedAt ?? "—"],
  ];

  return (
    <Shell
      title="Persistence diagnostics"
      subtitle="Temporary stabilisation panel — verifies what is stored and when it was last synced"
      actions={
        <>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void reload()}>
            Reload from database
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => void saveNow()}>
            Force save
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Stat label="Discussions" value={ws.discussions.length} />
          <Stat label="Requirements" value={count("Requirement")} />
          <Stat label="Decisions" value={count("Decision")} />
          <Stat label="Risks" value={count("Risk")} />
          <Stat label="Assumptions" value={count("Assumption")} />
          <Stat label="Documents" value={ws.documents.length} />
          <Stat label="Build sessions" value={ws.buildSessions.length} />
          <Stat label="Context packages" value={ws.contextPackages.length} />
        </div>

        <section className="panel">
          <div className="label-mono border-b border-border px-4 py-2.5">Vault status</div>
          <div className="divide-y divide-border">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 px-4 py-2 text-sm">
                <span className="text-muted-foreground">{k}</span>
                <span className="text-right font-mono text-xs">{v}</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Shell>
  );
}
