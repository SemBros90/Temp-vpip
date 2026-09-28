import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Download, Loader2, PlugZap, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { WorkspaceImport } from "@/components/vpip/WorkspaceImport";
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
import { useAiKeys } from "@/lib/vpip/keys";
import { exportWorkspaceZip } from "@/lib/vpip/files";
import { vaultSize } from "@/lib/vpip/db";
import {
  PROVIDER_LABEL,
  PROVIDER_MODELS,
  type ProviderId,
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
  const { ws, saveNow, resetVault } = useVpip();
  const actions = useVpipActions();
  const { keys } = useAiKeys();
  const [testing, setTesting] = useState<ProviderId | null>(null);
  const [size, setSize] = useState(0);

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
    <Shell title="Settings" subtitle="Engines, storage and vault maintenance" mobileNavigation>
      <div className="mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-6">
        <section className="panel p-5">
          <div className="label-mono mb-4">AI engines</div>
          <div className="space-y-5">
            {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((id) => {
              const cfg = ws.settings.providers[id];
              const configured = keys[id];
              return (
                <div key={id} className="space-y-2 border-b border-border pb-5 last:border-0 last:pb-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{PROVIDER_LABEL[id]}</span>
                    <Tag>{cfg.apiKey?.trim() || configured ? "key configured" : "no key"}</Tag>
                    {cfg.status === "ok" ? <Tag>connected</Tag> : cfg.status === "error" ? <Tag>error</Tag> : null}
                    {ws.settings.defaultProvider === id ? <Tag>default</Tag> : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_200px]">
                    <div>
                      <div className="label-mono mb-1">API key</div>
                      <Input
                        data-testid={`settings-${id.toLowerCase()}-api-key`}
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono text-xs"
                        placeholder={id === "openai" ? "sk-..." : `${PROVIDER_LABEL[id]} API key`}
                        value={cfg.apiKey ?? ""}
                        onChange={(e) => actions.setProvider(id, { apiKey: e.target.value })}
                      />
                    </div>
                    <div>
                      <div className="label-mono mb-1">Model</div>
                      <Select
                        value={cfg.model}
                        onValueChange={(v) => actions.setProvider(id, { model: v })}
                      >
                        <SelectTrigger data-testid={`settings-${id.toLowerCase()}-model`} className="font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROVIDER_MODELS[id].map((m) => (
                            <SelectItem data-testid={`settings-${id.toLowerCase()}-model-${m.replace(/[^a-z0-9-]/gi, "-")}`} key={m} value={m} className="font-mono text-xs">
                              {m}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <Button data-testid={`settings-${id.toLowerCase()}-test-connection`} size="sm" variant="outline" className="h-8" onClick={() => void test(id)}>
                      {testing === id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <PlugZap className="size-4" />
                      )}
                      Test connection
                    </Button>
                    <Button
                      data-testid={`settings-${id.toLowerCase()}-make-default`}
                      size="sm"
                      variant={ws.settings.defaultProvider === id ? "secondary" : "outline"}
                      className="h-8"
                      onClick={() => actions.setSettings({ defaultProvider: id })}
                    >
                      Make default
                    </Button>
                    {cfg.statusMessage ? (
                      <span data-testid={`settings-${id.toLowerCase()}-connection-status`} className="truncate text-xs text-muted-foreground">{cfg.statusMessage}</span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
            Keys you type here are saved in the project database with the rest of your vault, so they
            survive reload and follow the project to any device. Anyone with access to this project
            can use them.
          </p>
        </section>

        <section className="panel p-5">
          <div className="label-mono mb-4">Storage</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <div className="label-mono mb-1">Project root label</div>
              <Input
                data-testid="settings-project-root-label"
                value={ws.settings.projectRootLabel}
                onChange={(e) => actions.setSettings({ projectRootLabel: e.target.value })}
              />
            </div>
            <div>
              <div className="label-mono mb-1">Backup folder label</div>
              <Input
                data-testid="settings-backup-folder-label"
                value={ws.settings.backupFolderLabel}
                onChange={(e) => actions.setSettings({ backupFolderLabel: e.target.value })}
              />
            </div>
            <div>
              <div className="label-mono mb-1">Auto-save interval (sec)</div>
              <Input
                data-testid="settings-auto-save-interval"
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
                data-testid="settings-author-name"
                value={ws.settings.author}
                onChange={(e) => actions.setSettings({ author: e.target.value })}
              />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button data-testid="settings-save-now" size="sm" className="h-8" onClick={() => void saveNow().then((ok) => { if (ok) toast.success("Settings saved"); })}>
              Save now
            </Button>
            <Button
              data-testid="settings-export-workspace"
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
            <Button
              data-testid="settings-clear-vault"
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
            <span data-testid="settings-workspace-size" className="label-mono">{(size / 1024).toFixed(1)} KB stored</span>
            <WorkspaceImport />
          </div>
        </section>
      </div>
    </Shell>
  );
}
