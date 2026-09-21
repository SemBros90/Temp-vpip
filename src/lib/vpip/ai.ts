import type { ProviderConfig, ProviderId } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AIError extends Error {}

function endpoint(cfg: ProviderConfig) {
  return `${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`;
}

async function readError(res: Response) {
  let detail = "";
  try {
    const body = await res.json();
    detail = body?.error?.message ?? JSON.stringify(body);
  } catch {
    detail = await res.text().catch(() => "");
  }
  if (res.status === 401) return "Invalid API key.";
  if (res.status === 429) return "Rate limited or out of credit with the provider.";
  return `${res.status} ${res.statusText}${detail ? ` — ${detail}` : ""}`;
}

export async function streamChat(
  provider: ProviderId,
  cfg: ProviderConfig,
  messages: ChatMessage[],
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (!cfg.apiKey) {
    throw new AIError(`No API key saved for ${provider}. Add one in Settings.`);
  }
  const res = await fetch(endpoint(cfg), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({ model: cfg.model, messages, stream: true }),
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
  let out = "";
  out = await streamChat(provider, cfg, messages, () => {});
  return out;
}

export async function testConnection(
  provider: ProviderId,
  cfg: ProviderConfig,
): Promise<{ ok: boolean; message: string }> {
  try {
    if (!cfg.apiKey) return { ok: false, message: "No API key saved." };
    const res = await fetch(endpoint(cfg), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: "user", content: "ping" }],
        max_tokens: 5,
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
