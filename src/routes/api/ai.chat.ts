import { createFileRoute } from "@tanstack/react-router";

type ProviderId = "openai" | "deepseek";

const PROVIDERS: Record<ProviderId, { baseUrl: string; env: string }> = {
  openai: { baseUrl: "https://api.openai.com/v1", env: "OPENAI_API_KEY" },
  deepseek: { baseUrl: "https://api.deepseek.com/v1", env: "DEEPSEEK_API_KEY" },
};

interface Body {
  provider?: ProviderId;
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  stream?: boolean;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
        const key = process.env[conf.env];
        if (!key) {
          return json(
            { error: `No ${provider === "openai" ? "OpenAI" : "DeepSeek"} API key is configured for this app.` },
            400,
          );
        }
        if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
          return json({ error: "A model and at least one message are required." }, 400);
        }

        const stream = body.stream !== false;
        let upstream: Response;
        try {
          upstream = await fetch(`${conf.baseUrl}/chat/completions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify({
              model: body.model,
              messages: body.messages,
              stream,
            }),
            signal: request.signal,
          });
        } catch (err) {
          return json(
            { error: err instanceof Error ? err.message : "The engine could not be reached." },
            502,
          );
        }

        if (!upstream.ok || !upstream.body) {
          let detail = "";
          try {
            const errBody = (await upstream.json()) as { error?: { message?: string } };
            detail = errBody?.error?.message ?? "";
          } catch {
            detail = await upstream.text().catch(() => "");
          }
          const message =
            upstream.status === 401
              ? "The stored API key was rejected by the provider."
              : upstream.status === 429
                ? "Rate limited or out of credit with the provider."
                : `${upstream.status} ${upstream.statusText}${detail ? ` — ${detail}` : ""}`;
          return json({ error: message }, upstream.status === 401 ? 401 : 502);
        }

        if (!stream) {
          const data = (await upstream.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
          };
          return json({ content: data.choices?.[0]?.message?.content ?? "" });
        }

        return new Response(upstream.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        });
      },
    },
  },
});
