import { useState } from "react";
import { BrainCog, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useEngine } from "@/components/vpip/common";
import { useVpipActions } from "@/lib/vpip/store";
import { extractFromSource, type ExtractionSource } from "@/lib/vpip/upgrade";
import { useAiKeys } from "@/lib/vpip/keys";
import { PROVIDER_LABEL } from "@/lib/vpip/types";

/**
 * V-13 — Universal knowledge extraction.
 * Runs the extraction engine on any project object and files the results as
 * Knowledge Inbox candidates. Nothing is auto-approved.
 */
export function ExtractButton({
  projectId,
  source,
  label = "Extract knowledge",
}: {
  projectId: string;
  source: ExtractionSource;
  label?: string;
}) {
  const actions = useVpipActions();
  const { provider, cfg, author } = useEngine();
  const { keys } = useAiKeys();
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    if (!source.text.trim()) {
      toast.error("There is nothing to extract from yet.");
      return;
    }
    setBusy(true);
    try {
      const candidates = await extractFromSource(provider, cfg, source);
      if (!candidates.length) {
        toast.info("No durable knowledge found in this source.");
        return;
      }
      actions.addKnowledge(
        candidates.map((c) => ({
          projectId,
          type: c.type,
          status: "candidate" as const,
          title: c.title,
          description: c.description,
          sourceKind: source.kind,
          sourceRefId: source.refId,
          sourceDiscussionTitle: source.label,
          sourceMessages: [],
          provider,
          author,
        })),
      );
      actions.logActivity({
        projectId,
        subjectType: source.kind,
        subjectId: source.refId,
        subjectLabel: source.label,
        action: "Extracted",
        provider,
        model: cfg.model,
        author,
        note: `${candidates.length} candidates`,
      });
      toast.success(`${candidates.length} candidates sent to the Knowledge Inbox.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button size="sm" variant="outline" className="h-8" disabled={busy} onClick={() => void run()}>
      {busy ? <Loader2 className="size-4 animate-spin" /> : <BrainCog className="size-4" />}
      {label}
    </Button>
  );
}
