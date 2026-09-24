import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, PlugZap, Unplug, Plug } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { RuntimeNav } from "@/components/vpip/RuntimeEventsView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { runtimeProviders, runtimeProviderTest, runtimeProviderSetEnabled } from "@/lib/vpip/runtime/runtime.functions";
import { PROVIDER_STATE_LABEL } from "@/lib/vpip/runtime/providers";

export const Route = createFileRoute("/runtime-settings")({
  head: () => ({
    meta: [
      { title: "Runtime Settings · Runtime Provider · VPIP" },
      { name: "description", content: "Configure, test and disconnect VPIP runtime providers such as E2B. Credentials stay in encrypted secure storage." },
      { property: "og:title", content: "Runtime Provider Settings · VPIP" },
      { property: "og:description", content: "Runtime provider connectors for VPIP Coder." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

type P = Awaited<ReturnType<typeof runtimeProviders>>[number];

function Page() {
  const load = useServerFn(runtimeProviders);
  const test = useServerFn(runtimeProviderTest);
  const setEnabled = useServerFn(runtimeProviderSetEnabled);
  const [rows, setRows] = useState<P[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [configureOpen, setConfigureOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { setRows(await load()); setError(null); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [load]);
  useEffect(() => { void refresh(); }, [refresh]);

  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    try { const m = await fn(); setMsg((s) => ({ ...s, [id]: m })); } catch (e) { setMsg((s) => ({ ...s, [id]: e instanceof Error ? e.message : String(e) })); }
    finally { setBusy(null); void refresh(); }
  };

  return (
    <Shell title="Runtime Settings">
      <div className="mx-auto max-w-5xl space-y-4 p-6">
        <div>
          <h1 className="text-2xl font-semibold">Runtime Settings → Runtime Provider</h1>
          <p className="text-sm text-muted-foreground">Credentials live only in the encrypted secret store — never in the database, repository files or chat. VPIP keeps working in "Provider Not Configured" mode; Browser Preview is unaffected.</p>
        </div>
        <RuntimeNav />
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
        <div className="grid gap-3">
          {rows.map((p) => (
            <div key={p.id} className="rounded border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 font-semibold">{p.name}
                    <Badge variant={p.state === "connected" ? "default" : p.state === "missing_credentials" ? "destructive" : "secondary"}>{PROVIDER_STATE_LABEL[p.state]}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">{p.description}</div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setConfigureOpen(configureOpen === p.id ? null : p.id)}><KeyRound className="size-3.5" /> Configure</Button>
                  <Button size="sm" variant="outline" disabled={!p.implemented || busy === p.id} onClick={() => run(p.id, async () => (await test({ data: { id: p.id } })).message)}><PlugZap className="size-3.5" /> Test Connection</Button>
                  {p.enabled ? (
                    <Button size="sm" variant="outline" disabled={!p.implemented || busy === p.id} onClick={() => run(p.id, async () => { await setEnabled({ data: { id: p.id, enabled: false } }); return "Disconnected. New sandboxes cannot be created until reconnected."; })}><Unplug className="size-3.5" /> Disconnect</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy === p.id} onClick={() => run(p.id, async () => { await setEnabled({ data: { id: p.id, enabled: true } }); return "Reconnected."; })}><Plug className="size-3.5" /> Connect</Button>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                {p.credentials.map((c) => (
                  <span key={c.name} className="rounded border border-border px-2 py-0.5 font-mono">{c.name}: {c.present ? "stored" : "missing"}</span>
                ))}
                {p.lastTestAt ? <span className="text-muted-foreground">Last test {new Date(p.lastTestAt).toLocaleString()}: {p.lastTestMessage}</span> : null}
              </div>
              {msg[p.id] ? <div className="mt-2 text-xs">{msg[p.id]}</div> : null}
              {configureOpen === p.id ? (
                <div className="mt-3 rounded bg-surface-2 p-3 text-xs">
                  Credentials are entered only through Lovable's secure secret form, never typed into VPIP. In the Lovable chat, ask to <b>add or update the secret {p.credentials.map((c) => c.name).join(" and ")}</b>; the form stores it encrypted and only the server can read it. Get the key from <a className="underline" href={p.docsUrl} target="_blank" rel="noreferrer">{p.name}</a>.
                  {!p.implemented ? " This provider has no runtime adapter yet — storing a key prepares it but does not enable it." : ""}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </Shell>
  );
}
