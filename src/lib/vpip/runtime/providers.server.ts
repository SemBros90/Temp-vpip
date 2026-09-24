import { RUNTIME_PROVIDERS, type ProviderState } from "./providers";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function providerStatuses() {
  const db = await admin();
  const { data: rows } = await db.from("vpip_runtime_providers").select("*");
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  return RUNTIME_PROVIDERS.map((p) => {
    const row = byId.get(p.id);
    const credsPresent = p.credentials.map((n) => ({ name: n, present: !!process.env[n] }));
    const hasCreds = credsPresent.every((c) => c.present);
    const enabled = row ? row.enabled : true;
    let state: ProviderState;
    if (!p.implemented) state = "not_implemented";
    else if (!hasCreds) state = "missing_credentials";
    else if (!enabled) state = "disconnected";
    else if (row?.last_test_ok) state = "connected";
    else state = "configured";
    return {
      ...p,
      state,
      enabled,
      credentials: credsPresent,
      lastTestAt: row?.last_test_at ?? null,
      lastTestOk: row?.last_test_ok ?? null,
      lastTestMessage: row?.last_test_message ?? null,
    };
  });
}

/** Real connection test per implemented adapter. No credentials are returned. */
export async function testProvider(id: string): Promise<{ ok: boolean; message: string }> {
  const def = RUNTIME_PROVIDERS.find((p) => p.id === id);
  if (!def) throw new Error("Unknown provider.");
  if (!def.implemented) return { ok: false, message: "No adapter implemented for this provider yet." };
  const missing = def.credentials.filter((n) => !process.env[n]);
  let result: { ok: boolean; message: string };
  if (missing.length) {
    result = { ok: false, message: `Provider Not Configured: missing ${missing.join(", ")}` };
  } else if (id === "e2b") {
    try {
      const res = await fetch("https://api.e2b.dev/sandboxes", { headers: { "X-API-Key": process.env["E2B_API_KEY"]! } });
      result = res.ok
        ? { ok: true, message: `E2B reachable (HTTP ${res.status}).` }
        : { ok: false, message: res.status === 401 || res.status === 403 ? `E2B rejected the key (HTTP ${res.status}).` : `E2B error (HTTP ${res.status}).` };
    } catch (e) {
      result = { ok: false, message: `Network error: ${e instanceof Error ? e.message : String(e)}` };
    }
  } else {
    result = { ok: false, message: "No test available." };
  }
  const db = await admin();
  await db.from("vpip_runtime_providers").upsert({ id, last_test_at: new Date().toISOString(), last_test_ok: result.ok, last_test_message: result.message, updated_at: new Date().toISOString() });
  return result;
}

export async function setProviderEnabled(id: string, enabled: boolean) {
  const def = RUNTIME_PROVIDERS.find((p) => p.id === id);
  if (!def) throw new Error("Unknown provider.");
  const db = await admin();
  const { error } = await db.from("vpip_runtime_providers").upsert({ id, enabled, is_active: enabled && id === "e2b", updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}
