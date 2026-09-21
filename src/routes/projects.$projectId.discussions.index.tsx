import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, EnginePicker, relTime, Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { DISCUSSION_TYPES, type DiscussionType } from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/discussions/")({
  head: () => ({
    meta: [
      { title: "Discussions — VPIP" },
      {
        name: "description",
        content: "Typed, permanently saved discussions: architecture, requirements, research, risk, business and more.",
      },
      { property: "og:title", content: "Discussions — VPIP" },
      { property: "og:description", content: "Never one giant timeline — one thread per topic." },
    ],
  }),
  component: DiscussionsPage,
});

function DiscussionsPage() {
  const { projectId } = Route.useParams();
  const { project, discussions } = useProject(projectId);
  const actions = useVpipActions();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("all");
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<DiscussionType>("General");

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    return discussions
      .filter((d) => (filter === "all" ? true : d.type === filter))
      .filter(
        (d) =>
          !q ||
          d.title.toLowerCase().includes(q) ||
          d.messages.some((m) => m.content.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [discussions, query, filter]);

  const create = () => {
    if (!title.trim()) return;
    const d = actions.createDiscussion({ projectId, title: title.trim(), type });
    setOpen(false);
    setTitle("");
    void navigate({
      to: "/projects/$projectId/discussions/$discussionId",
      params: { projectId, discussionId: d.id },
    });
  };

  return (
    <Shell
      title="Discussions"
      subtitle={project?.name}
      actions={
        <>
          <EnginePicker compact />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8">
                <Plus className="size-4" /> New discussion
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>New discussion</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <div className="label-mono mb-1">Title</div>
                  <Input
                    autoFocus
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="CAD Architecture"
                    onKeyDown={(e) => e.key === "Enter" && create()}
                  />
                </div>
                <div>
                  <div className="label-mono mb-1">Type</div>
                  <Select value={type} onValueChange={(v) => setType(v as DiscussionType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DISCUSSION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={!title.trim()}>
                  Create
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      <div className="mx-auto max-w-5xl space-y-4 px-6 py-6">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              placeholder="Search discussion titles and message content…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {DISCUSSION_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {results.length === 0 ? (
          <EmptyState
            title="No discussions"
            description="Create one thread per topic — CAD Architecture, DFM Rules, Business Model. Every message is saved permanently."
          />
        ) : (
          <div className="panel divide-y divide-border">
            {results.map((d) => (
              <div key={d.id} className="group flex items-center gap-3 px-4 py-3">
                <Link
                  to="/projects/$projectId/discussions/$discussionId"
                  params={{ projectId, discussionId: d.id }}
                  className="min-w-0 flex-1"
                >
                  <div className="truncate text-sm font-medium group-hover:text-primary">
                    {d.title}
                  </div>
                  <div className="mt-1 flex items-center gap-1.5">
                    <Tag>{d.type}</Tag>
                    <Tag>{d.messages.length} messages</Tag>
                    {d.attachments.length ? <Tag>{d.attachments.length} files</Tag> : null}
                    <span className="label-mono">{relTime(d.updatedAt)}</span>
                  </div>
                </Link>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 opacity-0 transition group-hover:opacity-100"
                  onClick={() => {
                    if (window.confirm(`Delete discussion "${d.title}"?`))
                      actions.deleteDiscussion(d.id);
                  }}
                >
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </Shell>
  );
}
