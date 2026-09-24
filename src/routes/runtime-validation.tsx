import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ShieldCheck } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeNav } from "@/components/vpip/RuntimeEventsView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useVpip } from "@/lib/vpip/store";
import { runtimeReadiness } from "@/lib/vpip/runtime/runtime.functions";

export const Route = createFileRoute("/runtime-validation")({
  head: () => ({
    meta: [
      { title: "Runtime Validation Center · VPIP" },
      { name: "description", content: "Readiness for the Pull → Sync → Integrity → Install → Run → Preview → Pause → Resume → Destroy runtime validation workflow." },
      { property: "og:title", content: "Runtime Validation Center · VPIP" },
      { property: "og:description", content: "Runtime validation workflow readiness for VPIP build sessions." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type R = Awaited<ReturnType<typeof runtimeReadiness>>;

function Page() {
  const { ws } = useVpip();
  const check = useServerFn(runtimeReadiness);
  const builds = (ws.buildSessions ?? []) as Array<{ id: string; code: string; projectId: string }>;
  const [buildId, setBuildId] = useState("");
  const [result, setResult] = useState<R | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pname = (id: string) => ws.projects.find((p: { id: string; name: string }) => p.id === id)?.name ?? id;

  const go = async () => {
    setBusy(true);
    try { setResult(await check({ data: { buildId } })); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <Shell title="Runtime Validation Center">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtime Validation Center</h1>
          <p className="text-sm text-muted-foreground">Checks readiness only. It never creates a sandbox, runs commands, or changes files.</p>
        </div>
        <RuntimeNav />
        <div className="flex gap-2">
          <select className="h-9 flex-1 rounded border border-border bg-background px-2 text-sm" value={buildId} onChange={(e) => setBuildId(e.target.value)} aria-label="Build session">
            <option value="">Select a build session…</option>
            {builds.map((b) => <option key={b.id} value={b.id}>{pname(b.projectId)} · {b.code}</option>)}
          </select>
          <Button onClick={() => void go()} disabled={!buildId || busy}><ShieldCheck className="size-4" /> Check readiness</Button>
        </div>
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        {result ? (
          <div className="space-y-2">
            <div className="text-sm">Overall: <Badge variant={result.ready ? "default" : "destructive"}>{result.ready ? "Ready to validate" : "Blocked"}</Badge></div>
            <ol className="space-y-1">
              {result.stages.map((s, i) => (
                <li key={s.stage} className="flex items-start gap-3 rounded border border-border p-2 text-sm">
                  <span className="w-5 text-muted-foreground">{i + 1}</span>
                  <span className="w-32 font-medium">{s.stage}</span>
                  <Badge variant={s.state === "blocked" ? "destructive" : s.state === "ready" ? "default" : "secondary"}>{s.state}</Badge>
                  <span className="text-muted-foreground">{s.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}
