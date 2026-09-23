import { createFileRoute } from "@tanstack/react-router";

/** Which provider keys exist on the server. Values are never sent to the browser. */
const ENV: Record<string, string> = {
  openai: "OPENAI_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  Gemini: "GEMINI_API_KEY",
  Claude: "ANTHROPIC_API_KEY",
};

export const Route = createFileRoute("/api/ai/status")({
  server: {
    handlers: {
      GET: async () => {
        const status: Record<string, boolean> = {};
        for (const [id, env] of Object.entries(ENV)) {
          status[id] = Boolean(process.env[env]?.trim());
        }
        return new Response(JSON.stringify(status), {
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
      },
    },
  },
});
