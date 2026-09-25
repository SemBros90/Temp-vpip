import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { audit } from "@/lib/vpip/discovery-db";
import type { DOutput } from "@/lib/vpip/discovery";
import { formatSize, artifactSize } from "@/lib/vpip/artifacts";
import { useProject, useVpip, useVpipActions } from "@/lib/vpip/store";
import type { KnowledgeType } from "@/lib/vpip/types";

/** Phase D-02 — push discovery outputs into the Knowledge Inbox as candidates. */

// Fixed mapping by output type (not AI classification); Knowledge Inbox reviewers can change it.
const TYPE_FOR: Record<string, KnowledgeType> = {
  Requirements: "Requirement",
  Risks: "Risk",
  Assumptions: "Assumption",
  Decisions: "Decision",
};

const refOf = (sessionId: string, kind: string) => `${sessionId}:${kind}`;

export function DiscoveryExtraction({
  projectId,
  sessionId,
  outputs,
}: {
  projectId: string;
  sessionId: string;
  outputs: DOutput[];
}) {
  const { ws } = useVpip();
  const { project, knowledge } = useProject(projectId);
  const actions = useVpipActions();
  const [selected, setSelected] = useState<string[]>([]);
  const [dupes, setDupes] = useState<DOutput[] | null>(null);
  const [result, setResult] = useState<number | null>(null);

  const existing = (o: DOutput) =>
    knowledge.filter((k) => k.sourceKind === "Discovery" && k.sourceRefId === refOf(sessionId, o.kind));

  const chosen = outputs.filter((o) => selected.includes(o.id));

  const push = async (items: DOutput[]) => {
    const author = ws.settings.author || "Owner";
    const pushed: { o: DOutput; version: number }[] = [];
    const records = items.map((o) => {
      const version = existing(o).length + 1;
      pushed.push({ o, version });
      const description = [
        `Source: Discovery`,
        `Discovery Session ID: ${sessionId}`,
        `Project Name: ${project?.name ?? ""}`,
        `Output Type: ${o.kind}`,
        `Generated Timestamp: ${o.created_at}`,
        `Created By: ${author}`,
        `Status: Pending Review`,
        ``,
        o.markdown,
      ].join("\n");
      return {
        projectId,
        type: TYPE_FOR[o.kind] ?? ("Idea" as KnowledgeType),
        status: "candidate" as const,
        title: `Discovery · ${o.kind}${version > 1 ? ` (v${version})` : ""}`,
        description,
        sourceMessages: [],
        author,
        version,
        sourceKind: "Discovery" as const,
        sourceRefId: refOf(sessionId, o.kind),
      };
    });
    if (records.length) actions.addKnowledge(records);
    for (const { o, version } of pushed) {
      await audit(projectId, sessionId, "Pushed To Knowledge Inbox", {
        user: author,
        output_type: o.kind,
        output_id: o.id,
        output_version: o.version,
        inbox_ref: refOf(sessionId, o.kind),
        inbox_version: version,
      }).catch(() => undefined);
    }
    setResult(records.length);
    setSelected([]);
    if (records.length) toast.success(`Knowledge successfully sent to Knowledge Inbox. Items Created: ${records.length}`);
  };

  const start = () => {
    const d = chosen.filter((o) => existing(o).length > 0);
    if (d.length) setDupes(d);
    else void push(chosen);
  };

  return (
    <div className="space-y-3 p-4">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSelected(outputs.map((o) => o.id))}>Select All</Button>
        <Button size="sm" variant="outline" onClick={() => setSelected([])}>Clear Selection</Button>
        <Button size="sm" disabled={!chosen.length} onClick={start}>Push Selected To Knowledge Inbox</Button>
      </div>
      <table className="w-full text-sm">
        <thead className="text-left text-muted-foreground">
          <tr><th className="w-8" /><th>Title</th><th>Type</th><th>Size</th><th>Generated</th><th>In Inbox</th></tr>
        </thead>
        <tbody>
          {outputs.map((o) => (
            <tr key={o.id} className="border-t">
              <td className="py-2">
                <Checkbox
                  checked={selected.includes(o.id)}
                  onCheckedChange={() =>
                    setSelected((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]))
                  }
                />
              </td>
              <td>{o.kind}</td>
              <td>{TYPE_FOR[o.kind] ?? "Idea"}</td>
              <td>{formatSize(artifactSize(o.markdown))}</td>
              <td>{new Date(o.created_at).toLocaleString()}</td>
              <td>{existing(o).length ? `Yes (${existing(o).length})` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {result !== null && (
        <div className="rounded border border-primary/40 bg-primary/5 p-3 text-sm">
          Knowledge successfully sent to Knowledge Inbox. Items Created: {result}.{" "}
          <Link to="/projects/$projectId/inbox" params={{ projectId }} className="underline">View Knowledge Inbox</Link>
        </div>
      )}
      <Dialog open={!!dupes} onOpenChange={(o) => !o && setDupes(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Already exists in Knowledge Inbox</DialogTitle>
            <DialogDescription>
              {dupes?.map((d) => d.kind).join(", ")} was already pushed from this session. Nothing will be overwritten.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              const skip = new Set(dupes?.map((d) => d.id));
              setDupes(null);
              void push(chosen.filter((o) => !skip.has(o.id)));
            }}>Skip</Button>
            <Button onClick={() => { setDupes(null); void push(chosen); }}>Create New Version</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
