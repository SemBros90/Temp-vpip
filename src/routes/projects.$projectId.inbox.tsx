import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, Merge, MessageSquarePlus, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, relTime, Tag, TypeTag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import {
  KNOWLEDGE_TYPES,
  type DiscussionType,
  type KnowledgeItem,
  type KnowledgeType,
} from "@/lib/vpip/types";

const DISCUSSION_TYPE_FOR: Record<KnowledgeType, DiscussionType> = {
  Decision: "Decision",
  Requirement: "Requirement",
  Idea: "General",
  Risk: "Risk",
  Question: "General",
  Assumption: "General",
};

export const Route = createFileRoute("/projects/$projectId/inbox")({
  head: () => ({
    meta: [
      { title: "Knowledge Inbox — VPIP" },
      {
        name: "description",
        content: "Extracted decisions, requirements, ideas, risks and questions wait here until you approve them.",
      },
      { property: "og:title", content: "Knowledge Inbox — VPIP" },
      { property: "og:description", content: "Nothing becomes project knowledge without your approval." },
    ],
  }),
  component: InboxPage,
});

function InboxPage() {
  const { projectId } = Route.useParams();
  const { project, candidates } = useProject(projectId);
  const actions = useVpipActions();
  const [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<KnowledgeItem | null>(null);

  const navigate = useNavigate();

  const toggle = (id: string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const discuss = (k: KnowledgeItem) => {
    let discussionId = k.sourceDiscussionId;
    if (!discussionId) {
      const created = actions.createDiscussion({
        projectId,
        title: `Discuss · ${k.code} ${k.title}`,
        type: DISCUSSION_TYPE_FOR[k.type],
      });
      discussionId = created.id;
    }
    void navigate({
      to: "/projects/$projectId/discussions/$discussionId",
      params: { projectId, discussionId },
      search: { focus: k.id },
    });
  };

  return (
    <Shell
      title="Knowledge Inbox"
      subtitle={`${candidates.length} candidates awaiting review · ${project?.name ?? ""}`}
      actions={
        <>
          <Button
            size="sm"
            variant="outline"
            className="h-8"
            disabled={selected.length < 2}
            onClick={() => {
              actions.mergeKnowledge(selected, `Merged ${selected.length} candidates`);
              setSelected([]);
              toast.success("Candidates merged");
            }}
          >
            <Merge className="size-4" /> Merge selected
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={selected.length === 0}
            onClick={() => {
              selected.forEach((id) => actions.updateKnowledge(id, { status: "approved" }, "Approved"));
              setSelected([]);
              toast.success("Approved into the Master Register");
            }}
          >
            <Check className="size-4" /> Approve selected
          </Button>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-3 px-6 py-6">
        {candidates.length === 0 ? (
          <EmptyState
            title="Inbox empty"
            description="Open a discussion and run Extract knowledge. Candidates land here first — nothing is ever auto-approved."
          />
        ) : (
          candidates.map((k) => (
            <div key={k.id} className="panel flex gap-3 p-4">
              <Checkbox
                className="mt-1"
                checked={selected.includes(k.id)}
                onCheckedChange={() => toggle(k.id)}
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <TypeTag type={k.type} />
                  <span className="text-sm font-medium">{k.title}</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {k.description}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {k.sourceDiscussionId ? (
                    <Link
                      to="/projects/$projectId/discussions/$discussionId"
                      params={{ projectId, discussionId: k.sourceDiscussionId }}
                    >
                      <Tag className="hover:text-primary">
                        source · {k.sourceDiscussionTitle}
                      </Tag>
                    </Link>
                  ) : null}
                  {k.sourceMessages.length ? (
                    <Tag>messages {k.sourceMessages.join(", ")}</Tag>
                  ) : null}
                  {k.provider ? <Tag>{k.provider}</Tag> : null}
                  <span className="label-mono">{relTime(k.createdAt)}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-start gap-1">
                <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing(k)}>
                  <Pencil className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="Reject"
                  onClick={() => actions.updateKnowledge(k.id, { status: "rejected" }, "Rejected")}
                >
                  <X className="size-4 text-destructive" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8"
                  title="Approve"
                  onClick={() => actions.updateKnowledge(k.id, { status: "approved" }, "Approved")}
                >
                  <Check className="size-4 text-success" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      <EditDialog item={editing} onClose={() => setEditing(null)} />
    </Shell>
  );
}

function EditDialog({ item, onClose }: { item: KnowledgeItem | null; onClose: () => void }) {
  const actions = useVpipActions();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<KnowledgeType>("Decision");

  return (
    <Dialog
      open={!!item}
      onOpenChange={(open) => {
        if (!open) onClose();
        else if (item) {
          setTitle(item.title);
          setDescription(item.description);
          setType(item.type);
        }
      }}
    >
      <DialogContent
        onOpenAutoFocus={() => {
          if (item) {
            setTitle(item.title);
            setDescription(item.description);
            setType(item.type);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Edit candidate</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <div className="label-mono mb-1">Type</div>
            <Select value={type} onValueChange={(v) => setType(v as KnowledgeType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KNOWLEDGE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="label-mono mb-1">Title</div>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div>
            <div className="label-mono mb-1">Description</div>
            <Textarea rows={6} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={() => {
              if (!item) return;
              actions.updateKnowledge(item.id, { title, description, type }, "Edited");
              onClose();
              toast.success("Candidate updated");
            }}
          >
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
