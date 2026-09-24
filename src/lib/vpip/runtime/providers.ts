/**
 * Runtime Provider Framework (client-safe registry).
 * Adding a provider = add an entry here + an adapter in providers.server.ts.
 * Credentials are never stored here or in repository files — only the
 * name of the secret held in the encrypted secret store.
 */
export interface RuntimeProviderDef {
  id: string;
  name: string;
  /** Environment secret names the provider needs (secure storage). */
  credentials: string[];
  /** True when VPIP has a working runtime adapter for this provider. */
  implemented: boolean;
  docsUrl: string;
  description: string;
}

export const RUNTIME_PROVIDERS: RuntimeProviderDef[] = [
  { id: "e2b", name: "E2B", credentials: ["E2B_API_KEY"], implemented: true, docsUrl: "https://e2b.dev/dashboard", description: "Firecracker micro-VM sandboxes with real Node.js." },
  { id: "daytona", name: "Daytona", credentials: ["DAYTONA_API_KEY"], implemented: false, docsUrl: "https://www.daytona.io", description: "Development environment sandboxes." },
  { id: "codesandbox", name: "CodeSandbox", credentials: ["CSB_API_KEY"], implemented: false, docsUrl: "https://codesandbox.io/sdk", description: "CodeSandbox SDK VMs." },
  { id: "webcontainers", name: "WebContainers", credentials: ["WEBCONTAINERS_CLIENT_ID"], implemented: false, docsUrl: "https://webcontainers.io", description: "In-browser Node.js (commercial license required)." },
  { id: "fly", name: "Fly Machines", credentials: ["FLY_API_TOKEN"], implemented: false, docsUrl: "https://fly.io/docs/machines/", description: "Fast-booting VMs on Fly.io." },
  { id: "modal", name: "Modal", credentials: ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"], implemented: false, docsUrl: "https://modal.com", description: "Serverless containers." },
];

export type ProviderState = "connected" | "configured" | "disconnected" | "missing_credentials" | "not_implemented";

export const PROVIDER_STATE_LABEL: Record<ProviderState, string> = {
  connected: "Connected",
  configured: "Configured",
  disconnected: "Disconnected",
  missing_credentials: "Provider Not Configured",
  not_implemented: "Adapter not available yet",
};

/** Runtime event categories used by History + Audit Center. */
export type EventCategory = "sandbox" | "sync" | "install" | "runtime" | "environment" | "cleanup" | "validation" | "preview" | "provider";

export const EVENT_TYPES: Record<string, { label: string; category: EventCategory }> = {
  sandbox_create: { label: "Launch", category: "sandbox" },
  repository_sync: { label: "Sync", category: "sync" },
  node_setup: { label: "Environment", category: "environment" },
  dependency_install: { label: "Install", category: "install" },
  runtime_startup: { label: "Start", category: "runtime" },
  sandbox_start: { label: "Start", category: "runtime" },
  sandbox_stop: { label: "Stop", category: "runtime" },
  sandbox_pause: { label: "Pause", category: "sandbox" },
  sandbox_resume: { label: "Resume", category: "sandbox" },
  sandbox_destroy: { label: "Destroy", category: "sandbox" },
  sandbox_auto_pause: { label: "Cleanup · pause", category: "cleanup" },
  sandbox_auto_destroy: { label: "Cleanup · destroy", category: "cleanup" },
  sandbox_expired: { label: "Cleanup · expired", category: "cleanup" },
  runtime_failure: { label: "Error", category: "runtime" },
  preview_create: { label: "Preview", category: "preview" },
  preview_access: { label: "Preview", category: "preview" },
  preview_health: { label: "Preview health", category: "preview" },
  preview_recovery: { label: "Preview recovery", category: "preview" },
  validation_readiness: { label: "Validation", category: "validation" },
  provider_test: { label: "Provider test", category: "provider" },
  provider_connect: { label: "Provider connect", category: "provider" },
  provider_disconnect: { label: "Provider disconnect", category: "provider" },
};

export const eventLabel = (action: string) => EVENT_TYPES[action]?.label ?? action;
export const eventCategory = (action: string): EventCategory => EVENT_TYPES[action]?.category ?? "runtime";

/** Status display: failures are Errors; env issues / info-level failures surface as Warnings. */
export function eventSeverity(e: { status: string; action: string; detail?: unknown }): "error" | "warning" | "ok" | "info" {
  if (e.status === "failed") return "error";
  const d = (e.detail ?? {}) as Record<string, unknown>;
  if (d["warning"] || (Array.isArray(d["missing"]) && (d["missing"] as unknown[]).length)) return "warning";
  if (e.status === "success") return "ok";
  return "info";
}

export const USER_ACTIONS = new Set(["sandbox_create", "sandbox_stop", "sandbox_pause", "sandbox_resume", "sandbox_destroy", "preview_access", "validation_readiness", "provider_test", "provider_connect", "provider_disconnect"]);
