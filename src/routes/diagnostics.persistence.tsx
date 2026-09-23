import { createFileRoute, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Shell } from "@/components/vpip/Shell";
import { Stat } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { pingDatabase } from "@/lib/vpip/db";
import { useVpip } from "@/lib/vpip/store";

export const Route = createFileRoute("/diagnostics/persistence")({
  head: () => ({
    meta: [
      { title: "Save & persistence health — VPIP" },
      {
        name: "description",
        content:
          "Live save queue, dirty state, save reliability metrics and database connectivity for the VPIP workspace.",
      },
      { property: "og:title", content: "Save & persistence health — VPIP" },
      {
        property: "og:description",
        content: "Monitor save success, failures, retries and pending changes in VPIP.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PersistenceDiagnostics,
});

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-border py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono break-all">{value}</span>
    </div>
  );
}

function PersistenceDiagnostics() {
  const {
    ws,
    dirty,
    saveState,
    saveError,
    saveMetrics,
    pendingChanges,
    queueLength,
    lastSavedAt,
    lastLoadedAt,
    loadError,
    tabId,
    otherTabs,
    saveNow,
    reload,
  } = useVpip();
  const params = useParams({ strict: false }) as { projectId?: string };
  const [ping, setPing] = useState<{ ok: boolean; ms: number; message: string } | null>(null);
  const [checking, setChecking] = useState(false);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setPing(await pingDatabase());
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
    const i = setInterval(() => void check(), 15000);
    return () => clearInterval(i);
  }, [check]);

  return (
    <Shell
      title="Save & persistence health"
      subtitle="Live state of the write queue, save reliability and database connectivity"
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => void reload()}>
            Reload from database
          </Button>
          <Button size="sm" onClick={() => void saveNow()}>
            Save now
          </Button>
        </>
      }
    >
      <div className="space-y-6 p-6">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Stat
            label="Save state"
            value={saveState === "error" ? "Failed" : saveState === "saving" ? "Saving" : dirty ? "Pending" : "Saved"}
            hint={lastSavedAt ? `Last save ${new Date(lastSavedAt).toLocaleString()}` : "No save yet"}
          />
          <Stat label="Pending changes" value={pendingChanges} hint="Edits not yet written" />
          <Stat label="Save queue" value={queueLength} hint="Writes queued or in flight" />
          <Stat
            label="Connectivity"
            value={ping ? (ping.ok ? "Online" : "Error") : "…"}
            hint={ping ? `${ping.message} · ${ping.ms} ms` : "Checking"}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <section className="panel px-4 py-3">
            <div className="label-mono pb-1">Save diagnostics</div>
            <Row label="Current dirty state" value={dirty ? "Dirty" : "Clean"} />
            <Row label="Last save time" value={lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "—"} />
            <Row
              label="Last save result"
              value={saveState === "error" ? "Failed" : saveMetrics.successes ? "Success (verified)" : "—"}
            />
            <Row
              label="Save duration"
              value={saveMetrics.lastDurationMs === null ? "—" : `${saveMetrics.lastDurationMs} ms`}
            />
            <Row label="Last load time" value={lastLoadedAt ? new Date(lastLoadedAt).toLocaleString() : "—"} />
            <Row label="Load error" value={loadError ?? "None"} />
          </section>

          <section className="panel px-4 py-3">
            <div className="label-mono pb-1">Reliability metrics</div>
            <Row label="Successful saves" value={saveMetrics.successes} />
            <Row label="Failed saves" value={saveMetrics.failures} />
            <Row label="Retry count" value={saveMetrics.retries} />
            <Row label="Last error" value={saveMetrics.lastError ?? "None"} />
            <Row label="Active workspace" value={`Supabase vault · tab ${tabId}`} />
            <Row label="Active project" value={params.projectId ?? "—"} />
            <Row
              label="Other open tabs"
              value={otherTabs.length ? otherTabs.join(", ") : "None detected"}
            />
          </section>
        </div>

        {saveError ? (
          <div className="rounded-sm border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="font-semibold">Last save failed — your changes are not stored</div>
            <div className="mt-1 font-mono text-xs break-all">{saveError}</div>
          </div>
        ) : null}

        <section className="panel px-4 py-3">
          <div className="label-mono pb-1">Workspace totals (in memory, mirrored to database)</div>
          <Row label="Projects" value={ws.projects.length} />
          <Row label="Discussions" value={ws.discussions.length} />
          <Row label="Knowledge records" value={ws.knowledge.length} />
          <Row label="Documents" value={ws.documents.length} />
          <Row label="Prompts" value={ws.prompts.length} />
          <Row label="Build sessions" value={(ws.buildSessions ?? []).length} />
          <Row label="Context packages" value={(ws.contextPackages ?? []).length} />
          <Row label="Snapshots" value={ws.snapshots.length} />
        </section>

        <div className="text-xs text-muted-foreground">
          Connectivity re-checked every 15 seconds{checking ? " · checking…" : ""}.
        </div>
      </div>
    </Shell>
  );
}
