/** Home — live read-only Admin AI Control status. */
import { useCallback, useEffect, useState } from "react";
import { ADMIN_MODULES, getControlState, subscribeControl, type ControlState, type ModuleState } from "@/lib/vpip/admin-ai-control";
import { cn } from "@/lib/utils";

export function AdminControlStatus() {
  const [control, setControl] = useState<ControlState | null>(null);
  const [modules, setModules] = useState<ModuleState[]>([]);
  const [last, setLast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    try { const s = await getControlState(); setControl(s.control); setModules(s.modules); setLast(s.requests[0]?.created_at ?? null); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load control status."); }
  }, []);
  useEffect(() => { void refresh(); return subscribeControl(() => void refresh()); }, [refresh]);
  const status = error ? "Unavailable" : !control ? "Loading…" : control.emergency_off ? "Emergency off" : control.enabled ? "Connected" : "Disconnected";
  const tone = status === "Connected" ? "text-success border-success/40 bg-success/10" : status === "Emergency off" || status === "Unavailable" ? "text-destructive border-destructive/40 bg-destructive/10" : "text-warning border-warning/40 bg-warning/10";
  const active = modules.filter((m) => m.enabled).length;
  return (
    <section aria-label="Admin AI Control status" className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="label-mono">Admin AI Control</div>
        <span role="status" className={cn("rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider", tone)}>{status}</span>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : (
        <div className="grid gap-2 text-xs sm:grid-cols-4">
          <div><div className="text-muted-foreground">Provider</div><div className="font-mono">{control?.provider ?? "—"}</div></div>
          <div><div className="text-muted-foreground">Model</div><div className="truncate font-mono" title={control?.model}>{control?.model ?? "—"}</div></div>
          <div><div className="text-muted-foreground">Active modules</div><div className="font-mono">{active} / {ADMIN_MODULES.length}</div></div>
          <div><div className="text-muted-foreground">Last AI activity</div><div className="font-mono">{last ? new Date(last).toLocaleString() : "Never"}</div></div>
        </div>
      )}
    </section>
  );
}
