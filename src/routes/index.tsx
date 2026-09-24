import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, ArchiveRestore, FolderPlus, MoreVertical, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, EnginePicker, relTime, Tag } from "@/components/vpip/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useVpip, useVpipActions } from "@/lib/vpip/store";
import { PullRepositoryDialog } from "@/components/vpip/PullRepositoryDialog";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Projects — VPIP" },
      {
        name: "description",
        content:
          "Every VPIP project keeps its own discussions, knowledge register, documents and prompts — stored locally on your machine.",
      },
      { property: "og:title", content: "Projects — VPIP" },
      {
        property: "og:description",
        content: "Local-first project intelligence workspace with interchangeable AI engines.",
      },
    ],
  }),
  component: ProjectsPage,
});

function ProjectsPage() {
  const { ws, loaded } = useVpip();
  const actions = useVpipActions();
  const navigate = useNavigate();
  const [showArchived, setShowArchived] = useState(false);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const projects = ws.projects.filter((p) => p.archived === showArchived);

  const create = () => {
    if (!name.trim()) return;
    const project = actions.createProject(name.trim(), description.trim());
    setOpen(false);
    setName("");
    setDescription("");
    toast.success(`Project "${project.name}" created`);
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id } });
  };

  return (
    <Shell
      title="Projects"
      subtitle="The project owns the memory. AI engines are interchangeable."
      actions={
        <>
          <EnginePicker />
          <PullRepositoryDialog />
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8">
                <FolderPlus className="size-4" /> New project
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create project</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <div className="label-mono mb-1">Project name</div>
                  <Input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Vaigyanic"
                    onKeyDown={(e) => e.key === "Enter" && create()}
                  />
                </div>
                <div>
                  <div className="label-mono mb-1">Brief (optional)</div>
                  <Textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What this project is about — used as grounding context for every engine."
                    rows={4}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button onClick={create} disabled={!name.trim()}>
                  Create project
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="mb-4 flex items-center gap-2">
          <Button
            variant={showArchived ? "outline" : "secondary"}
            size="sm"
            className="h-7"
            onClick={() => setShowArchived(false)}
          >
            Active
          </Button>
          <Button
            variant={showArchived ? "secondary" : "outline"}
            size="sm"
            className="h-7"
            onClick={() => setShowArchived(true)}
          >
            Archived
          </Button>
        </div>

        {!loaded ? (
          <div className="label-mono">Opening vault…</div>
        ) : loadError && ws.projects.length === 0 ? (
          <EmptyState
            title="Could not reach the database"
            description={`Your projects are safe. ${loadError}`}
            action={<Button size="sm" onClick={() => void reload()}>Retry</Button>}
          />
        ) : projects.length === 0 ? (
          <EmptyState
            title={showArchived ? "No archived projects" : "No projects yet"}
            description="A project is a permanent memory container: discussions, knowledge register, documents, prompts and snapshots all live inside it."
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {projects.map((p) => {
              const discussions = ws.discussions.filter((d) => d.projectId === p.id).length;
              const knowledge = ws.knowledge.filter(
                (k) => k.projectId === p.id && k.status === "approved",
              ).length;
              return (
                <div key={p.id} className="panel group relative flex flex-col p-4">
                  <div className="flex items-start justify-between gap-2">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: p.id }}
                      className="min-w-0 flex-1"
                    >
                      <div className="truncate text-sm font-semibold">{p.name}</div>
                      <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                        {p.description || "No brief."}
                      </p>
                    </Link>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-7 shrink-0">
                          <MoreVertical className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            const next = window.prompt("Rename project", p.name);
                            if (next?.trim()) actions.updateProject(p.id, { name: next.trim() });
                          }}
                        >
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => actions.updateProject(p.id, { archived: !p.archived })}
                        >
                          {p.archived ? (
                            <>
                              <ArchiveRestore className="size-4" /> Restore
                            </>
                          ) : (
                            <>
                              <Archive className="size-4" /> Archive
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => {
                            if (
                              window.confirm(
                                `Delete "${p.name}" and everything inside it? This cannot be undone.`,
                              )
                            ) {
                              actions.deleteProject(p.id);
                              toast.success("Project deleted");
                            }
                          }}
                        >
                          <Trash2 className="size-4 text-destructive" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-1.5">
                    <Tag>{discussions} discussions</Tag>
                    <Tag>{knowledge} knowledge</Tag>
                    <Tag>{relTime(p.updatedAt)}</Tag>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </Shell>
  );
}
