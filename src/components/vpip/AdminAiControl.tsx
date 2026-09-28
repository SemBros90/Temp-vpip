import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ACCESS_LABEL,
  ADMIN_MODULES,
  getControlState,
  setControlProvider,
  setEmergencyOff,
  setEntirePanel,
  setModuleAccess,
  subscribeControl,
  type AccessLevel,
  type ModuleState,
  type ControlState,
} from "@/lib/vpip/admin-ai-control";
import { PROVIDER_LABEL, PROVIDER_MODELS, type ProviderId } from "@/lib/vpip/types";

const PROVIDERS = Object.keys(PROVIDER_LABEL) as ProviderId[];

function isProviderId(value: string): value is ProviderId {
  return PROVIDERS.includes(value as ProviderId);
}

function defaultModel(provider: ProviderId) {
  const model = PROVIDER_MODELS[provider][0];
  if (!model) throw new Error(`No default model is configured for ${provider}.`);
  return model;
}

export function AdminAiControl() {
  const [control, setControl] = useState<ControlState | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [requests, setRequests] = useState<any[]>([]);
  const [responses, setResponses] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await getControlState();
      setControl(next.control);
      setModules(next.modules);
      setRequests(next.requests);
      setResponses(next.responses);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not load Admin AI Control.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    return subscribeControl(() => void refresh());
  }, [refresh]);

  const active = modules.filter((module) => module.enabled).length;
  const today = useMemo(
    () =>
      requests.filter(
        (request) => new Date(request.created_at).toDateString() === new Date().toDateString(),
      ),
    [requests],
  );
  const tokensToday = today
    .filter((request) => request.token_count != null)
    .reduce((total, request) => total + Number(request.token_count), 0);
  const hasTokenTelemetry = today.some((request) => request.token_count != null);
  const configuredProvider = control?.provider ?? "";
  const selectedProvider: ProviderId = isProviderId(configuredProvider)
    ? configuredProvider
    : "openai";
  const modelOptions = PROVIDER_MODELS[selectedProvider];

  const act = async (fn: () => Promise<void>, note: string) => {
    setBusy(true);
    try {
      await fn();
      await refresh();
      toast.success(note);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Control action failed.");
    } finally {
      setBusy(false);
    }
  };

  const changeProvider = (provider: ProviderId) => {
    const model = defaultModel(provider);
    void act(
      () => setControlProvider(provider, model),
      `${PROVIDER_LABEL[provider]} selected for Admin AI.`,
    );
  };

  const changeModel = (model: string) => {
    if (!model.trim()) return;
    void act(() => setControlProvider(selectedProvider, model.trim()), "Admin AI model updated.");
  };

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-surface p-4">
        <div className="flex flex-wrap items-start gap-2">
          <div>
            <div className="text-sm font-semibold">Admin AI Control</div>
            <p className="text-xs text-muted-foreground">
              The mandatory authorization and routing boundary between every Admin module, VPIP, and
              its selected provider.
            </p>
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              disabled={busy}
              onClick={() => void act(() => setEntirePanel(true), "Entire Admin Panel connected.")}
            >
              Connect Entire Admin Panel
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() =>
                void act(() => setEntirePanel(false), "Entire Admin Panel disconnected.")
              }
            >
              Disconnect Entire Admin Panel
            </Button>
            <Button
              disabled={busy}
              variant="destructive"
              onClick={() => void act(() => setEmergencyOff(), "Emergency AI OFF is active.")}
            >
              EMERGENCY AI OFF
            </Button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-5">
          <Metric
            label="Admin AI Status"
            value={
              control?.emergency_off
                ? "Emergency off"
                : control?.enabled
                  ? "Connected"
                  : "Disconnected"
            }
          />
          <Metric
            label="Connected AI Provider"
            value={
              isProviderId(configuredProvider)
                ? PROVIDER_LABEL[configuredProvider]
                : (control?.provider ?? "—")
            }
          />
          <Metric label="Current Model" value={control?.model ?? "—"} />
          <Metric
            label="Connection Health"
            value={control?.enabled && !control.emergency_off ? "Ready" : "Offline"}
          />
          <Metric label="Current Active Modules" value={`${active} / ${ADMIN_MODULES.length}`} />
          <Metric
            label="Last AI Activity"
            value={requests[0] ? new Date(requests[0].created_at).toLocaleString() : "Never"}
          />
          <Metric label="Last Prompt Executed" value={requests[0]?.prompt_preview ?? "—"} />
          <Metric
            label="Last Response Time"
            value={requests[0]?.response_ms != null ? `${requests[0].response_ms} ms` : "—"}
          />
          <Metric label="Total AI Requests Today" value={String(today.length)} />
          <Metric
            label="Total Tokens Used"
            value={hasTokenTelemetry ? String(tokensToday) : "Not reported"}
          />
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="text-sm font-semibold">AI Provider Management</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Choose the provider used by all Admin AI requests. Changing a provider also selects its
          default supported model; both values are saved together and enforced by the Admin AI
          request boundary.
        </p>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <label className="grid gap-1 text-xs font-medium">
            Provider
            <select
              aria-label="AI provider"
              className="rounded border border-border bg-background px-2 py-1.5 text-xs"
              value={selectedProvider}
              disabled={busy || !control}
              onChange={(event) => changeProvider(event.target.value as ProviderId)}
            >
              {PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {PROVIDER_LABEL[provider]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Model
            <select
              aria-label="AI model"
              className="rounded border border-border bg-background px-2 py-1.5 text-xs"
              value={modelOptions.includes(control?.model ?? "") ? control?.model : "custom"}
              disabled={busy || !control}
              onChange={(event) =>
                event.target.value !== "custom" && changeModel(event.target.value)
              }
            >
              {modelOptions.map((model) => (
                <option key={model} value={model}>
                  {model}
                </option>
              ))}
              <option value="custom">Custom model…</option>
            </select>
          </label>
          <label className="grid gap-1 text-xs font-medium">
            Custom model
            <input
              aria-label="Custom AI model"
              className="rounded border border-border bg-background px-2 py-1.5 text-xs"
              value={control?.model ?? ""}
              disabled={busy || !control}
              placeholder="Enter a provider model ID"
              onChange={(event) =>
                setControl((value) => (value ? { ...value, model: event.target.value } : value))
              }
              onBlur={(event) => changeModel(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
            />
          </label>
        </div>
      </div>

      <div className="rounded-md border border-border bg-surface p-4">
        <div className="text-sm font-semibold">Module Access Matrix</div>
        <p className="mb-3 text-xs text-muted-foreground">
          Connection state is persisted per module. Every access change is recorded in the
          append-only Admin AI action log.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="p-2">Module</th>
                <th className="p-2">State</th>
                <th className="p-2">Permission</th>
                <th className="p-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {ADMIN_MODULES.map(([key, label]) => {
                const module = modules.find((item) => item.module_key === key);
                const level = module?.access_level ?? "disconnected";
                return (
                  <tr key={key} className="border-b border-border/60">
                    <td className="p-2 font-medium">{label}</td>
                    <td className="p-2">{module?.enabled ? "AI Enabled" : "AI Disabled"}</td>
                    <td className="p-2">
                      <select
                        className="rounded border border-border bg-background px-2 py-1"
                        value={level}
                        disabled={busy}
                        onChange={(event) =>
                          void act(
                            () => setModuleAccess(key, event.target.value as AccessLevel),
                            `${label} access updated.`,
                          )
                        }
                      >
                        {(Object.keys(ACCESS_LABEL) as AccessLevel[]).map((access) => (
                          <option key={access} value={access}>
                            {ACCESS_LABEL[access]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="p-2 space-x-2">
                      <button
                        className="underline"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => setModuleAccess(key, "read_analyze_recommend"),
                            `${label} connected.`,
                          )
                        }
                      >
                        Connect
                      </button>
                      <button
                        className="underline"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            () => setModuleAccess(key, "disconnected"),
                            `${label} disconnected.`,
                          )
                        }
                      >
                        Disconnect
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <HistoryTable
        title="AI Request History"
        columns={["Time", "Module", "Provider", "Model", "Prompt Size", "Response Size", "Status"]}
        rows={requests
          .slice(0, 25)
          .map((request) => [
            new Date(request.created_at).toLocaleString(),
            request.origin_module,
            request.provider,
            request.model,
            `${request.prompt_size} chars`,
            request.response_size == null ? "—" : `${request.response_size} chars`,
            request.status,
          ])}
      />
      <HistoryTable
        title="AI Response History"
        columns={["Time", "Module", "Response Summary", "Duration", "Status"]}
        rows={responses
          .slice(0, 25)
          .map((response) => [
            new Date(response.created_at).toLocaleString(),
            response.origin_module,
            response.response_summary ?? "",
            `${response.duration_ms} ms`,
            response.status,
          ])}
      />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="label-mono">{label}</div>
      <div className="truncate font-medium" title={value}>
        {value}
      </div>
    </div>
  );
}
function HistoryTable({
  title,
  columns,
  rows,
}: {
  title: string;
  columns: string[];
  rows: string[][];
}) {
  return (
    <div className="rounded-md border border-border bg-surface p-4">
      <div className="text-sm font-semibold">{title}</div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[760px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th key={column} className="p-2">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? (
              rows.map((row, index) => (
                <tr key={`${row[0]}-${index}`} className="border-b border-border/60">
                  {row.map((value, cell) => (
                    <td key={cell} className="max-w-[300px] truncate p-2" title={value}>
                      {value}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td className="p-2 text-muted-foreground" colSpan={columns.length}>
                  No execution events recorded yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
