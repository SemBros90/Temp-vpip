import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

/** Scheduled cost control: auto-pause bookkeeping (10 min idle) and auto-destroy (24 h idle). */
export const Route = createFileRoute("/api/public/runtime-sweep")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const denied = await authenticateCronRequest(request);
        if (denied) return denied;
        const { sweep } = await import("@/lib/vpip/runtime/runtime.server");
        const result = await sweep();
        return Response.json(result);
      },
    },
  },
});
