import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { KnowledgeType, ProviderId } from "@/lib/vpip/types";
import { PROVIDER_LABEL, PROVIDER_MODELS } from "@/lib/vpip/types";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div className="panel px-4 py-3">
      <div className="label-mono">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold tabular-nums">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <div className="text-sm font-medium">{title}</div>
      <p className="max-w-md text-xs text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

const typeTone: Record<KnowledgeType, string> = {
  Decision: "text-primary border-primary/40 bg-primary/10",
  Requirement: "text-info border-info/40 bg-info/10",
  Idea: "text-chart-5 border-chart-5/40 bg-chart-5/10",
  Risk: "text-destructive border-destructive/40 bg-destructive/10",
  Question: "text-warning border-warning/40 bg-warning/10",
  Assumption: "text-muted-foreground border-border-strong bg-muted",
  "Lesson Learned": "text-success border-success/40 bg-success/10",
  "Failure Cause": "text-destructive border-destructive/40 bg-destructive/10",
};

export function TypeTag({ type, className }: { type: KnowledgeType; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider",
        typeTone[type],
        className,
      )}
    >
      {type}
    </span>
  );
}

export function Tag({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        "rounded-sm border border-border bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Provider + model switcher. Switching never touches project memory. */
export function EnginePicker({ compact = false }: { compact?: boolean }) {
  const { ws } = useVpip();
  const actions = useVpipActions();
  const provider = ws.settings.defaultProvider;
  const cfg = ws.settings.providers[provider];

  return (
    <div className="flex items-center gap-2">
      {!compact ? <span className="label-mono">Engine</span> : null}
      <Select
        value={provider}
        onValueChange={(v) => actions.setSettings({ defaultProvider: v as ProviderId })}
      >
        <SelectTrigger className="h-8 w-[130px] bg-surface-2 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(PROVIDER_LABEL) as ProviderId[]).map((p) => (
            <SelectItem key={p} value={p} className="font-mono text-xs">
              {PROVIDER_LABEL[p]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={cfg.model} onValueChange={(v) => actions.setProvider(provider, { model: v })}>
        <SelectTrigger className="h-8 w-[170px] bg-surface-2 font-mono text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {[...new Set([...PROVIDER_MODELS[provider], cfg.model])].filter(Boolean).map((m) => (
            <SelectItem key={m} value={m} className="font-mono text-xs">
              {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span
        className={cn(
          "size-1.5 rounded-full",
          cfg.status === "error" ? "bg-destructive" : cfg.status === "ok" ? "bg-success" : "bg-muted-foreground",
        )}
        title={cfg.statusMessage ?? "Not tested yet"}
      />
    </div>
  );
}

export function useEngine() {
  const { ws } = useVpip();
  const provider = ws.settings.defaultProvider;
  return { provider, cfg: ws.settings.providers[provider], author: ws.settings.author };
}

export function relTime(iso?: string) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
