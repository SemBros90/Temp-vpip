import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Download, Loader2, PlugZap, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { testConnection } from "@/lib/vpip/ai";
import { exportWorkspaceZip } from "@/lib/vpip/files";
import { vaultSize } from "@/lib/vpip/db";
import {
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  type ProviderId,
  type Workspace,
} from "@/lib/vpip/types";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — VPIP" },
      {
        name: "description",
        content: "API keys, default engine, auto-save interval, vault export and import. Keys never leave this device.",
      },
      { property: "og:title", content: "Settings — VPIP" },
      { property: "og:description", content: "Configure OpenAI and DeepSeek and manage your local vault." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { ws, saveNow, resetVault, importWorkspace } = useVpip();
  const actions = useVpipActions();
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [size, setSize] = useState(0);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void vaultSize().then(setSize);
  }, [ws]);

  const test = async (id: ProviderId) => {
    setTesting(id);
    const res = await testConnection(id, ws.settings.providers[id]);
    actions.setProvider(id, {
      status: res.ok ? "ok" : "error",
      statusMessage: res.message,
      testedAt: new Date().toISOString(),
    });
    setTesting(null);
    res.ok ? toast.success(res.message) : toast.error(res.message);
  };

  return (
    <Shell title="Settings" subtitle="Engines, storage and vault maintenance">
      <div className="mx-auto max-w-4xl space-y-5 px-6 py-6">
        <section className="panel p-5">
          <div className="label-mono mb-4">AI engines</div>
          <div className="space-y-5">
            {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((id) => {
              const cfg = ws.settings.providers[id];
              return (
                <div key={id} className="space-y-2 border-b border-border pb-5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{PROVIDER_LABEL[id]}</span>
                    <Tag>
                      {cfg.status === "ok" ? "connected" : cfg.status === "error" ? "error" : "not tested"}
                    </Tag>
                    {ws.settings.defaultProvider === id ? <Tag>default</Tag> : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_200px]">
                    <div>
                      <div className="label-mono mb-1">API key</div>
                      <Input
                        type="password"
                        placeholder={id === "openai" ? "sk-…" : "sk-…"}
                        value={cfg.apiKey}
                        onChange={(e) => actions.setProvider(id, { apiKey: e.target.value })}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div>
                      <div className="label-mono mb-1">Model</div>
                      <Select
                        value={cfg.model}
                        onValueChange={(v) => actions.setProvider(id, { model: v })}
                      >
                        <SelectTrigger className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDER_MODELS[id].map((m) => (
                            <SelectItem key={m} value={m} className="font-mono text-xs">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <div className="label-mono mb-1">Base URL</div>
                    <Input
                      value={cfg.baseUrl}
                      onChange={(e) => actions.setProvider(id, { baseUrl: e.target.value })}
                      className="font-mono text-xs"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void test(id)}>
                      {testing === id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PlugZap className="size-4" />
                      )}
                      Test connection
                    </Button>
                    <Button
                      size="sm"
                      variant={ws.settings.defaultProvider === id ? "secondary" : "outline"}
                      className="h-8"
                      onClick={() => actions.setSettings({ defaultProvider: id })}
                    >
                      Make default
                    </Button>
                    {cfg.statusMessage ? (
                      <span className="truncate text-xs text-muted-foreground">{cfg.statusMessage}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Keys are stored only in this browser's local vault and are sent directly to the provider
            you select. Switching engines never changes your project memory.
          </p>
        </section>

        <section className="panel p-5">
          <div className="label-mono mb-4">Storage</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="label-mono mb-1">Project root label</div>
              <Input
                value={ws.settings.projectRootLabel}
                onChange={(e) => actions.setSettings({ projectRootLabel: e.target.value })}
              />
            </div>
            <div>
              <div className="label-mono mb-1">Backup folder label</div>
              <Input
                value={ws.settings.backupFolderLabel}
                onChange={(e) => actions.setSettings({ backupFolderLabel: e.target.value })}
              />
            </div>
            <div>
              <div className="label-mono mb-1">Auto-save interval (sec)</div>
              <Input
                type="number"
                min={5}
                value={ws.settings.autoSaveIntervalSec}
                onChange={(e) =>
                  actions.setSettings({ autoSaveIntervalSec: Number(e.target.value) || 30 })
                }
              />
            </div>
            <div>
              <div className="label-mono mb-1">Author name</div>
              <Input
                value={ws.settings.author}
                onChange={(e) => actions.setSettings({ author: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button size="sm" className="h-8" onClick={() => saveNow().then(() => toast.success("Vault saved"))}>
              Save now
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={async () => {
                await exportWorkspaceZip(ws);
                toast.success("Workspace exported");
              }}
            >
              <Download className="size-4" /> Export workspace ZIP
            </Button>
            <input
              ref={importRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const parsed = JSON.parse(await file.text()) as Workspace;
                  importWorkspace(parsed);
                  toast.success("Workspace imported");
                } catch {
                  toast.error("That file is not a valid workspace.json");
                }
              }}
            />
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => importRef.current?.click()}
            >
              <Upload className="size-4" /> Import workspace.json
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => {
                if (window.confirm("Erase the entire local vault? Export first if unsure.")) {
                  void resetVault().then(() => toast.success("Vault cleared"));
                }
              }}
            >
              <Trash2 className="size-4 text-destructive" /> Clear vault
            </Button>
            <span className="label-mono">{(size / 1024).toFixed(1)} KB stored</span>
          </div>
        </section>
      </div>
    </Shell>
  );
}
