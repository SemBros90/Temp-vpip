import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import * as rt from "./runtime.server";

/** VPIP is a single-owner system: no user sign-in. All runtime calls act as the local owner. */
async function caller(): Promise<rt.Caller> {
  return rt.ownerCaller();
}

const rowInput = z.object({ rowId: z.string().min(1).max(64) });

export const runtimeInfo = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), buildId: z.string() }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const role = await rt.requireProjectAccess(c, data.projectId);
    const row = await rt.activeRowForBuild(data.buildId);
    return { configured: await rt.e2bReady(), role, row: row && row.project_id === data.projectId ? row : null };
  });

export const runtimeLaunch = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ buildId: z.string() }).parse(d))
  .handler(async ({ data }) => rt.launch(await caller(), data.buildId));

export const runtimeSync = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.syncOnly(await caller(), data.rowId));

export const runtimeInstall = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.installOnly(await caller(), data.rowId));

export const runtimeStart = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.startRuntime(await caller(), data.rowId));

export const runtimeStop = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.stopRuntime(await caller(), data.rowId));

export const runtimePause = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.pauseRuntime(await caller(), data.rowId));

export const runtimeResume = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.resumeRuntime(await caller(), data.rowId));

export const runtimeDestroy = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.destroyRuntime(await caller(), data.rowId));

export const runtimeHeartbeat = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.heartbeat(await caller(), data.rowId));

export const runtimeStatusFn = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => rt.runtimeStatus(await caller(), data.rowId));

/** Issues the preview cookie (owner / authorized users only) and returns the proxied preview path. */
export const runtimePreviewAccess = createServerFn({ method: "POST" })
  .inputValidator((d) => rowInput.parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const { row } = await rt.runtimeStatus(c, data.rowId);
    if (!row.preview_slug) throw new Error("Runtime has no preview.");
    const token = await rt.signPreviewToken(row.id, c.userId);
    setCookie(`vpip_rt_${row.id}`, token, {
      path: "/runtime/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      partitioned: true,
      maxAge: 12 * 3600,
    });
    await rt.audit({ projectId: row.project_id, buildId: row.build_id, rowId: row.id, sandboxId: row.e2b_sandbox_id, userId: c.userId, email: c.email, action: "preview_access", status: "info" });
    return { path: `/runtime/${row.id}-${row.preview_slug}/?v=${encodeURIComponent(row.updated_at)}` };
  });

export const runtimeAudit = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ projectId: z.string(), buildId: z.string().optional() }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    await rt.requireProjectAccess(c, data.projectId);
    let q = c.supabase.from("vpip_runtime_audit").select("*").eq("project_id", data.projectId).order("created_at", { ascending: false }).limit(300);
    if (data.buildId) q = q.eq("build_id", data.buildId);
    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);
    return rows ?? [];
  });

/** Runtime History / Audit Center query: read-only, server-side filters + pagination. */
const eventsInput = z.object({
  projectId: z.string().max(64).optional(),
  buildId: z.string().max(64).optional(),
  runtimeId: z.string().max(80).optional(),
  actions: z.array(z.string().max(64)).max(40).optional(),
  status: z.enum(["started", "success", "failed", "info"]).optional(),
  from: z.string().max(40).optional(),
  to: z.string().max(40).optional(),
  search: z.string().max(200).optional(),
  page: z.number().int().min(0).max(100000).default(0),
  pageSize: z.number().int().min(1).max(5000).default(50),
});

export const runtimeEvents = createServerFn({ method: "POST" })
  .inputValidator((d) => eventsInput.parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    let q = c.supabase.from("vpip_runtime_audit").select("*", { count: "exact" }).order("created_at", { ascending: false });
    if (data.projectId) q = q.eq("project_id", data.projectId);
    if (data.buildId) q = q.eq("build_id", data.buildId);
    if (data.runtimeId) q = q.or(`sandbox_row_id.eq.${data.runtimeId.replace(/[^\w-]/g, "")},e2b_sandbox_id.eq.${data.runtimeId.replace(/[^\w-]/g, "")}`);
    if (data.actions?.length) q = q.in("action", data.actions);
    if (data.status) q = q.eq("status", data.status);
    if (data.from) q = q.gte("created_at", data.from);
    if (data.to) q = q.lte("created_at", data.to);
    if (data.search) {
      const s = data.search.replace(/[%,()*]/g, " ").trim();
      if (s) q = q.or(`action.ilike.%${s}%,error.ilike.%${s}%,e2b_sandbox_id.ilike.%${s}%,sandbox_row_id.ilike.%${s}%,build_id.ilike.%${s}%`);
    }
    const start = data.page * data.pageSize;
    const { data: rows, count, error } = await q.range(start, start + data.pageSize - 1);
    if (error) throw new Error(error.message);
    return { rows: rows ?? [], total: count ?? 0 };
  });

/** Runtime dashboard: all sandboxes plus provider readiness. */
export const runtimeDashboard = createServerFn({ method: "POST" })
  .handler(async () => {
    const c = await caller();
    const { data: projects } = await c.supabase.from("vpip_projects").select("id");
    const projectIds = (projects ?? []).map((p) => p.id);
    if (projectIds.length) await rt.sweep({ projectIds });
    const { data: rows } = await c.supabase.from("vpip_runtime_sandboxes").select("*").order("created_at", { ascending: false }).limit(500);
    return { configured: await rt.e2bReady(), rows: rows ?? [] };
  });

/* ---------------- provider framework ---------------- */

export const runtimeProviders = createServerFn({ method: "POST" }).handler(async () => {
  const { providerStatuses } = await import("./providers.server");
  return providerStatuses();
});

export const runtimeProviderTest = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().max(40) }).parse(d))
  .handler(async ({ data }) => {
    const { testProvider } = await import("./providers.server");
    const r = await testProvider(data.id);
    const c = await caller();
    const { data: p } = await c.supabase.from("vpip_projects").select("id").limit(1).maybeSingle();
    if (p) await rt.audit({ projectId: p.id, userId: c.userId, action: "provider_test", status: r.ok ? "success" : "failed", error: r.ok ? null : r.message, detail: { provider: data.id, scope: "global" } });
    return r;
  });

export const runtimeProviderSetEnabled = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ id: z.string().max(40), enabled: z.boolean() }).parse(d))
  .handler(async ({ data }) => {
    const { setProviderEnabled } = await import("./providers.server");
    await setProviderEnabled(data.id, data.enabled);
    const c = await caller();
    const { data: p } = await c.supabase.from("vpip_projects").select("id").limit(1).maybeSingle();
    if (p) await rt.audit({ projectId: p.id, userId: c.userId, action: data.enabled ? "provider_connect" : "provider_disconnect", status: "success", detail: { provider: data.id, scope: "global" } });
    return { ok: true };
  });

/* ---------------- validation center (readiness only, never runs) ---------------- */

export const runtimeReadiness = createServerFn({ method: "POST" })
  .inputValidator((d) => z.object({ buildId: z.string().max(64) }).parse(d))
  .handler(async ({ data }) => {
    const c = await caller();
    const r = await rt.readiness(c, data.buildId);
    await rt.audit({ projectId: r.projectId, buildId: data.buildId, userId: c.userId, action: "validation_readiness", status: r.ready ? "success" : "info", detail: { ready: r.ready, blockers: r.stages.filter((s) => s.state === "blocked").map((s) => s.stage), warning: r.stages.some((s) => s.state === "warning") } });
    return r;
  });
