import { createFileRoute } from "@tanstack/react-router";

type ProviderId = "openai" | "deepseek" | "perplexity" | "Gemini" | "Claude" | "lovable";

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
  lovable: {
    label: "Lovable AI",
    url: "https://ai.gateway.lovable.dev/v1/responses",
    env: "LOVABLE_API_KEY",
    dialect: "responses",
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
  messages?: Array<{ role: string; content: string; attachments?: Array<{ mediaType: string; dataUrl: string }> }>;
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

function streamText(frame: string) {
  const match = frame.match(/^data:\s*(.+)$/m);
  const body = match?.[1];
  if (!body || body === "[DONE]") return "";
  try { return (JSON.parse(body) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content ?? ""; } catch { return ""; }
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

async function handleChatRequest(request: Request): Promise<Response> {
        const body = (await request.json().catch(() => ({}))) as Body;
        const adminModule = request.headers.get("X-VPIP-Admin-Module");
        const started = Date.now();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let controlDb: any;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let execution: any;
        let providerTokens: number | null = null;
        const recordAction = async (action: string, status: string, detail: Record<string, unknown>) => {
          if (controlDb) await controlDb.from("vpip_admin_ai_actions").insert({ action, status, files: [], detail: { ...detail, actor: request.headers.get("X-VPIP-Admin-Actor") ?? "Platform owner" } });
        };
        const finishExecution = async (status: string, responseText: string) => {
          if (!execution || !controlDb) return;
          const duration = Date.now() - started;
          await controlDb.from("vpip_admin_ai_request_history").update({ status, response_ms: duration, response_size: responseText.length, token_count: providerTokens }).eq("id", execution.id);
          await controlDb.from("vpip_admin_ai_response_history").insert({ request_id: execution.id, origin_module: adminModule, response_summary: responseText.slice(0, 500) || null, duration_ms: duration, status });
          await recordAction(status === "completed" ? "admin_ai_response_received" : "admin_ai_response_failed", status, { module: adminModule, request_id: execution.id, duration_ms: duration, response_size: responseText.length });
        };
        // Coder AI 1 / AI 2 obey the Control on/off switch, emergency stop and their module row.
        const coderModule = request.headers.get("X-VPIP-Coder-Module");
        if (coderModule === "ai1" || coderModule === "ai2") {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const cdb = supabaseAdmin as unknown as { from: (table: string) => any };
          const [{ data: control }, { data: module }] = await Promise.all([
            cdb.from("admin_ai_settings").select("ai_enabled,emergency_stop").eq("id", "default").maybeSingle(),
            cdb.from("admin_ai_modules").select("ai_enabled,permission_level").eq("module_name", coderModule).maybeSingle(),
          ]);
          const label = coderModule === "ai1" ? "AI 1" : "AI 2";
          if (control?.emergency_stop) return json({ error: `${label} is blocked: Emergency AI OFF is active in Admin AI Control.` }, 403);
          if (!control?.ai_enabled || !module?.ai_enabled || module.permission_level === "disconnected") return json({ error: `${label} is blocked: connect it in Admin AI Control.` }, 403);
        }
        // Admin calls cannot bypass the Control registry.
        if (adminModule) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          // Migrations are deployed independently of generated client database types.
          // Keep the route compatible while the generated types catch up.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          controlDb = supabaseAdmin as unknown as { from: (table: string) => any };
          const [{ data: control }, { data: module }] = await Promise.all([
            controlDb.from("admin_ai_settings").select("ai_enabled,emergency_stop,provider,model").eq("id", "default").maybeSingle(),
            controlDb.from("admin_ai_modules").select("ai_enabled,permission_level").eq("module_name", adminModule).maybeSingle(),
          ]);
          const allowed = control?.ai_enabled && !control.emergency_stop && module?.ai_enabled && module.permission_level !== "disconnected";
          if (!allowed) return json({ error: "Admin AI Control has disconnected this module or activated the emergency kill switch." }, 403);
          if (control.provider !== body.provider || control.model !== body.model) return json({ error: "Request provider/model does not match Admin AI Control configuration." }, 403);
          const prompt = body.messages?.at(-1)?.content ?? "";
          const { data, error } = await controlDb.from("vpip_admin_ai_request_history").insert({ origin_module: adminModule, actor: request.headers.get("X-VPIP-Admin-Actor") ?? "Platform owner", provider: body.provider, model: body.model, status: "started", prompt_preview: prompt.slice(0, 500), prompt_size: prompt.length }).select("id").single();
          if (error) return json({ error: "Admin AI Control could not record this request." }, 503);
          execution = data;
          await recordAction("admin_ai_prompt_executed", "started", { module: adminModule, request_id: execution.id, provider: body.provider, model: body.model, prompt_size: prompt.length });
        }
        const provider = body.provider;
        if (!provider || !(provider in PROVIDERS)) {
          await finishExecution("failed", "Unknown AI engine.");
          return json({ error: "Unknown AI engine." }, 400);
        }
        const conf = PROVIDERS[provider];
        const key = body.apiKey?.trim() || process.env[conf.env];
        if (!key) {
          await finishExecution("failed", "Provider key is not configured.");
          return json(
            {
              error: `No ${conf.label} API key is configured. Add one in Settings, or ask for ${conf.env} to be stored on the server.`,
            },
            400,
          );
        }
        if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
          await finishExecution("failed", "Invalid AI request.");
          return json({ error: "A model and at least one message are required." }, 400);
        }
        const imageAttachments = body.messages.flatMap((message) => message.attachments ?? []);
        if (imageAttachments.length > 3 || imageAttachments.some((attachment) => !/^image\/(png|jpe?g|gif|webp)$/.test(attachment.mediaType) || !attachment.dataUrl.startsWith(`data:${attachment.mediaType};base64,`) || attachment.dataUrl.length > 6 * 1024 * 1024)) {
          await finishExecution("failed", "Invalid image attachment.");
          return json({ error: "Attach up to 3 PNG, JPEG, GIF, or WebP images of 4 MB or less." }, 400);
        }

        const stream = body.stream !== false;
        const anthropic = conf.dialect === "anthropic";
        const responses = conf.dialect === "responses";

        const systemText = body.messages
          .filter((m) => m.role === "system")
          .map((m) => m.content)
          .join("\n\n");
        const turns = body.messages.filter((m) => m.role !== "system");
        const anthropicContent = (message: { content: string; attachments?: Array<{ mediaType: string; dataUrl: string }> }) =>
          message.attachments?.length
            ? [{ type: "text", text: message.content }, ...message.attachments.map((attachment) => ({ type: "image", source: { type: "base64", media_type: attachment.mediaType, data: attachment.dataUrl.split(",")[1] ?? "" } }))]
            : message.content;
        const openAiContent = (message: { content: string; attachments?: Array<{ mediaType: string; dataUrl: string }> }) =>
          message.attachments?.length
            ? [{ type: "text", text: message.content }, ...message.attachments.map((attachment) => ({ type: "image_url", image_url: { url: attachment.dataUrl } }))]
            : message.content;
        const responseContent = (message: { content: string; attachments?: Array<{ mediaType: string; dataUrl: string }> }) =>
          [{ type: "input_text", text: message.content }, ...(message.attachments ?? []).map((attachment) => ({ type: "input_image", image_url: attachment.dataUrl }))];

        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (anthropic) {
          headers["x-api-key"] = key;
          headers["anthropic-version"] = "2023-06-01";
        } else {
          headers["Authorization"] = `Bearer ${key}`;
        }
        const isLovable = provider === "lovable";
        if (isLovable) {
          headers["Lovable-API-Key"] = key;
          headers["X-Lovable-AIG-SDK"] = "fetch";
        }

        const payload = anthropic
          ? {
              model: body.model,
              max_tokens: 8192,
              stream,
              ...(systemText ? { system: systemText } : {}),
              messages: turns.map((m) => ({
                role: m.role === "assistant" ? "assistant" : "user",
                content: anthropicContent(m),
              })),
            }
          : responses
            ? {
                model: body.model,
                stream,
                ...(isLovable ? { store: false, reasoning: { effort: "medium" } } : {}),
                ...(systemText ? { instructions: systemText } : {}),
                input: turns.map((m) => ({
                  role: m.role === "assistant" ? "assistant" : "user",
                  content: responseContent(m),
                })),
              }
            : { model: body.model, messages: body.messages.map((message) => ({ ...message, content: openAiContent(message) })), stream };

        let upstream: Response;
        try {
          upstream = await fetch(conf.url, {
            method: "POST",
            headers,
            body: JSON.stringify(payload),
            signal: request.signal,
          });
        } catch (err) {
          await finishExecution("failed", err instanceof Error ? err.message : "Provider could not be reached.");
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
          await finishExecution("failed", message);
          return json({ error: message }, status);
        }

        if (!stream) {
          if (anthropic) {
            const data = (await upstream.json()) as {
              content?: Array<{ text?: string }>;
              usage?: { input_tokens?: number; output_tokens?: number };
            };
            providerTokens = (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0) || null; const content = (data.content ?? []).map((c) => c.text ?? "").join("");
            await finishExecution("completed", content); return json({ content });
          }
          if (responses) {
            const data = (await upstream.json()) as {
              output?: Array<{ content?: Array<{ text?: string }> }>;
              usage?: { total_tokens?: number };
            };
            providerTokens = data.usage?.total_tokens ?? null;
            const content = (data.output ?? [])
                .flatMap((o) => o.content ?? [])
                .map((c) => c.text ?? "")
                .join("");
            await finishExecution("completed", content); return json({ content });
          }
          const data = (await upstream.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: { total_tokens?: number };
          };
          providerTokens = data.usage?.total_tokens ?? null;
          const content = data.choices?.[0]?.message?.content ?? "";
          await finishExecution("completed", content); return json({ content });
        }

        const [providerBody, telemetryBody] = upstream.body.tee();
        const telemetry = telemetryBody.pipeTo(new WritableStream<Uint8Array>({
          write(chunk) { const raw = new TextDecoder().decode(chunk); const matches = [...raw.matchAll(/"total_tokens"\s*:\s*(\d+)/g)]; if (matches.length) providerTokens = Number(matches.at(-1)?.[1]); },
        }));
        const normalized = anthropic ? anthropicToOpenAiStream(providerBody) : responses ? responsesToOpenAiStream(providerBody) : providerBody;
        const decoder = new TextDecoder(); let streamedText = ""; let streamBuffer = "";
        const recorded = normalized.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) { streamBuffer += decoder.decode(chunk, { stream: true }); const frames = streamBuffer.split("\n\n"); streamBuffer = frames.pop() ?? ""; streamedText += frames.map(streamText).join(""); controller.enqueue(chunk); },
          async flush() { streamBuffer += decoder.decode(); streamedText += streamText(streamBuffer); await telemetry; await finishExecution("completed", streamedText); },
        }));

        return new Response(
          recorded,
          {
            headers: {
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              Connection: "keep-alive",
            },
          },
        );
      }

/**
 * Translate runtime configuration failures into a clear service-unavailable
 * response rather than leaking an unhandled server exception as HTTP 500.
 * Provider failures are handled in `handleChatRequest` and retain their
 * provider-specific status and message.
 */
function chatRuntimeError(error: unknown) {
  const detail = error instanceof Error ? error.message : "Unknown server error";
  console.error("[AI chat] Request setup failed", error);
  return json(
    {
      error: detail.includes("Supabase environment variable")
        ? "Admin AI chat is unavailable because its server database connection is not configured. Connect Supabase in Lovable Cloud and try again."
        : "Admin AI chat is temporarily unavailable while its control configuration is being loaded. Please try again.",
    },
    503,
  );
}

export const Route = createFileRoute("/api/ai/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => handleChatRequest(request).catch(chatRuntimeError),
    },
  },
});
