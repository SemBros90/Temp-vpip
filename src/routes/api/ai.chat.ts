import { createFileRoute } from "@tanstack/react-router";

type ProviderId = "openai" | "deepseek" | "perplexity" | "Gemini" | "Claude";

interface ProviderDef {
  label: string;
  /** Full chat endpoint, not just the base. */
  url: string;
  env: string;
  /** Anthropic speaks its own Messages protocol; Perplexity moved to the Responses protocol. */
  dialect: "openai" | "anthropic" | "responses";
}

const PROVIDERS: Record<ProviderId, ProviderDef> = {
  openai: {
    label: "OpenAI",
    url: "https://api.openai.com/v1/chat/completions",
    env: "OPENAI_API_KEY",
    dialect: "openai",
  },
  deepseek: {
    label: "DeepSeek",
    url: "https://api.deepseek.com/v1/chat/completions",
    env: "DEEPSEEK_API_KEY",
    dialect: "openai",
  },
  perplexity: {
    label: "Perplexity",
    // Sonar is now the Agent API: chat/completions is retired.
    url: "https://api.perplexity.ai/v1/responses",
    env: "PERPLEXITY_API_KEY",
    dialect: "responses",
  },
  Gemini: {
    label: "Gemini",
    // Google's OpenAI-compatible surface — same request/response shape.
    url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    env: "GEMINI_API_KEY",
    dialect: "openai",
  },
  Claude: {
    label: "Claude",
    url: "https://api.anthropic.com/v1/messages",
    env: "ANTHROPIC_API_KEY",
    dialect: "anthropic",
  },
};

interface Body {
  provider?: ProviderId;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
  apiKey?: string;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function sseFrame(text: string) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

/** Re-shapes Anthropic's SSE stream into the chunk shape the app already reads. */
function anthropicToOpenAiStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as {
              type?: string;
              delta?: { text?: string };
            };
            const text = evt.type === "content_block_delta" ? (evt.delta?.text ?? "") : "";
            if (text) controller.enqueue(encoder.encode(sseFrame(text)));
          } catch {
            /* ignore partial frames */
          }
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}

/** Re-shapes the Responses SSE stream (Perplexity Agent API) into the app's chunk shape. */
function responsesToOpenAiStream(body: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload || payload === "[DONE]") continue;
          try {
            const evt = JSON.parse(payload) as { type?: string; delta?: unknown };
            if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") {
              controller.enqueue(encoder.encode(sseFrame(evt.delta)));
            }
          } catch {
            /* ignore partial frames */
          }
        }
      },
      flush(controller) {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      },
    }),
  );
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as Body;
        const provider = body.provider;
        if (!provider || !(provider in PROVIDERS)) {
          return json({ error: "Unknown AI engine." }, 400);
        }
        const conf = PROVIDERS[provider];
        const key = body.apiKey?.trim() || process.env[conf.env];
        if (!key) {
          return json(
            {
              error: `No ${conf.label} API key is configured. Add one in Settings, or ask for ${conf.env} to be stored on the server.`,
            },
            400,
          );
        }
        if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
          return json({ error: "A model and at least one message are required." }, 400);
        }

        const stream = body.stream !== false;
        const anthropic = conf.dialect === "anthropic";
        const responses = conf.dialect === "responses";

        const systemText = body.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const turns = body.messages.filter((m) => m.role !== "system");

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (anthropic) {
          headers["x-api-key"] = key;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${key}`;
        }

        const payload = anthropic
          ? {
              model: body.model,
              max_tokens: 8192,
              stream,
              ...(systemText ? { system: systemText } : {}),
              messages: turns.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: m.content,
              })),
            }
          : responses
            ? {
                model: body.model,
                stream,
                ...(systemText ? { instructions: systemText } : {}),
                input: turns.map((m) => ({
                  role: m.role === "assistant" ? "assistant" : "user",
                  content: m.content,
                })),
              }
            : { model: body.model, messages: body.messages, stream };

        let upstream: Response;
        try {
          upstream = await fetch(conf.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: request.signal,
          });
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : `${conf.label} could not be reached.` },
            502,
          );
        }

        if (!upstream.ok || !upstream.body) {
          let detail = "";
          const rawText = await upstream.text().catch(() => "");
          try {
            const parsed = JSON.parse(rawText) as unknown;
            const errBody = (Array.isArray(parsed) ? parsed[0] : parsed) as {
              error?: { message?: string };
              message?: string;
            };
            detail = errBody?.error?.message ?? errBody?.message ?? "";
          } catch {
            detail = rawText.slice(0, 300);
          }
          const message =
            upstream.status === 401
              ? `The ${conf.label} API key was rejected.`
              : upstream.status === 403
                ? `${conf.label} refused the request${detail ? ` — ${detail}` : " (key rejected or no access to this model)."}`
              : upstream.status === 404
                ? `${conf.label} does not know the model "${body.model}".`
                : upstream.status === 402 || upstream.status === 429
                  ? `Rate limited or out of credit with ${conf.label}${detail ? ` — ${detail}` : "."}`
                  : `${upstream.status} ${upstream.statusText}${detail ? ` — ${detail}` : ""}`;
          // Keep the provider's client-side status (4xx) so it isn't reported as a server crash.
          const status =
            upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502;
          return json({ error: message }, status);
        }

        if (!stream) {
          if (anthropic) {
            const data = (await upstream.json()) as {
              content?: Array<{ text?: string }>;
            };
            return json({
              content: (data.content ?? []).map((c) => c.text ?? "").join(""),
            });
          }
          if (responses) {
            const data = (await upstream.json()) as {
              output?: Array<{ content?: Array<{ text?: string }> }>;
            };
            return json({
              content: (data.output ?? [])
                .flatMap((o) => o.content ?? [])
                .map((c) => c.text ?? "")
                .join(""),
            });
          }
          const data = (await upstream.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return json({ content: data.choices?.[0]?.message?.content ?? "" });
        }

        return new Response(
          anthropic
            ? anthropicToOpenAiStream(upstream.body)
            : responses
              ? responsesToOpenAiStream(upstream.body)
              : upstream.body,
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          },
        );
      },
    },
  },
});
