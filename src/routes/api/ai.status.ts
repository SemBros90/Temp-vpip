import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ai/status")({
  server: {
    handlers: {
      GET: async () =>
        new Response(
          JSON.stringify({
            openai: Boolean(process.env["OPENAI_API_KEY"]),
            deepseek: Boolean(process.env["DEEPSEEK_API_KEY"]),
            perplexity: Boolean(process.env["PERPLEXITY_API_KEY"]),
            Gemini: Boolean(process.env["GEMINI_API_KEY"]),
            Claude: Boolean(process.env["CLAUDE_API_KEY"]),
          }),
          { headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } },
        ),
    },
  },
});
