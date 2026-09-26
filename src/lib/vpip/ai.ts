import type { ProviderConfig, ProviderId } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AIError extends Error {}

/**
 * All provider calls go through this app's own server endpoint.
 * API keys live in encrypted server storage and are never sent to the browser.
 */
const CHAT_URL = "/api/ai/chat";

async function readError(res: Response) {
  try {
    const body = (await res.json()) as { error?: string };
    if (body?.error) return body.error;
  } catch {
    /* fall through */
  }
  return `${res.status} ${res.statusText}`;
}

export async function streamChat(
  provider: ProviderId,
  cfg: ProviderConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
  route?: { originModule: string; actor?: string },
): Promise<string> {
  const res = await fetch(CHAT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(route ? { "X-VPIP-Admin-Module": route.originModule, "X-VPIP-Admin-Actor": route.actor ?? "Platform owner" } : {}) },
    body: JSON.stringify({
      provider,
      model: cfg.model,
      messages,
      stream: true,
      ...(cfg.apiKey?.trim() ? { apiKey: cfg.apiKey.trim() } : {}),
    }),
    signal: signal ?? null,
  });
  if (!res.ok || !res.body) throw new AIError(await readError(res));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta: string = json?.choices?.[0]?.delta?.content ?? "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch {
        /* ignore partial frames */
      }
    }
  }
  return full;
}

export async function completeChat(
  provider: ProviderId,
  cfg: ProviderConfig,
  messages: ChatMessage[],
): Promise<string> {
  return streamChat(provider, cfg, messages, () => {});
}

export async function testConnection(
  provider: ProviderId,
  cfg: ProviderConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        stream: false,
        ...(cfg.apiKey?.trim() ? { apiKey: cfg.apiKey.trim() } : {}),
      }),
    });
    if (!res.ok) return { ok: false, message: await readError(res) };
    return { ok: true, message: `Connected to ${cfg.model}.` };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Connection failed.",
    };
  }
}

export function extractJson<T>(raw: string): T | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = ((fenced ? fenced[1] : raw) ?? raw).trim();
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  const sliced = candidate.slice(start);
  for (let end = sliced.length; end > 0; end--) {
    const chunk = sliced.slice(0, end);
    const last = chunk.trimEnd().slice(-1);
    if (last !== "}" && last !== "]") continue;
    try {
      return JSON.parse(chunk.trimEnd()) as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
