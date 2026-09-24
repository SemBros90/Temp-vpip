import { useState } from "react";
import { FolderSearch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { readBranchFiles } from "@/lib/vpip/github";
import type { Attachment, BuildSession, Repository } from "@/lib/vpip/types";

const SKIP_DIR = /(^|\/)(node_modules|dist|build|\.git|\.next|\.turbo|coverage|\.cache|vendor)\//;
const SKIP_FILE =
  /(\.(png|jpe?g|gif|webp|ico|svg|woff2?|ttf|eot|otf|mp4|mp3|pdf|zip|gz|lock|map|min\.js)$)|(^|\/)(package-lock\.json|bun\.lockb?|yarn\.lock|pnpm-lock\.yaml|\.gitkeep|\.env[^/]*)$/i;
const PER_FILE = 40_000;
const TOTAL = 350_000;

/** Builds a readable code snapshot: full file tree + as many file bodies as fit. */
export function buildCodeSnapshot(label: string, files: { path: string; content: string }[]) {
  const all = files.filter((f) => !SKIP_DIR.test(f.path)).sort((a, b) => a.path.localeCompare(b.path));
  const readable = all.filter((f) => !SKIP_FILE.test(f.path));
  const parts: string[] = [];
  let used = 0;
  const omitted: string[] = [];
  for (const f of readable) {
    const body = f.content.length > PER_FILE ? `${f.content.slice(0, PER_FILE)}\n…[truncated]` : f.content;
    if (used + body.length > TOTAL) {
      omitted.push(f.path);
      continue;
    }
    used += body.length;
    parts.push(`--- FILE: ${f.path}\n${body}`);
  }
  return [
    `# Code scan: ${label}`,
    `Files in scope: ${all.length} · included in full: ${parts.length}${omitted.length ? ` · omitted for size: ${omitted.length}` : ""}`,
    "",
    "## File tree",
    ...all.map((f) => `- ${f.path}`),
    "",
    "## File contents",
    ...parts,
    ...(omitted.length ? ["", "## Omitted (ask for these if needed)", ...omitted.map((p) => `- ${p}`)] : []),
  ].join("\n");
}

export function RepoScanButton({
  repositories,
  buildSessions,
  onScanned,
}: {
  repositories: Repository[];
  buildSessions: BuildSession[];
  onScanned: (attachment: Attachment, prompt: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const builds = buildSessions.filter((b) => (b.files ?? []).length > 0);

  const finish = (label: string, files: { path: string; content: string }[]) => {
    if (!files.length) {
      toast.error("No readable files found.");
      return;
    }
    const text = buildCodeSnapshot(label, files);
    onScanned(
      {
        id: Math.random().toString(36).slice(2),
        name: `code-scan-${label.replace(/[^\w.-]+/g, "_")}.md`,
        mime: "text/markdown",
        size: text.length,
        data: "",
        text,
        createdAt: new Date().toISOString(),
      },
      `Scan the attached codebase (${label}). Diagnose any bugs, errors or broken logic you find: for each, give the file, the root cause, and the exact corrected code. If I describe a specific problem below, focus on that first.\n\nProblem: `,
    );
    toast.success(`Scanned ${files.length} files from ${label}. Describe the problem and send.`);
  };

  const scanRepo = async (r: Repository) => {
    setBusy(true);
    try {
      const files = await readBranchFiles(r.token, r.fullName, r.currentBranch || r.defaultBranch);
      finish(`${r.fullName}@${r.currentBranch || r.defaultBranch}`, files);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Repository scan failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-8" disabled={busy} title="Let the AI read the project code">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderSearch className="size-4" />}
          Scan code
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Repositories</DropdownMenuLabel>
        {repositories.length ? (
          repositories.map((r) => (
            <DropdownMenuItem key={r.id} onClick={() => void scanRepo(r)}>
              <span className="truncate">{r.fullName}</span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {r.currentBranch || r.defaultBranch}
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No repository connected</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Build session files</DropdownMenuLabel>
        {builds.length ? (
          builds.map((b) => (
            <DropdownMenuItem
              key={b.id}
              onClick={() =>
                finish(
                  `${b.code} ${b.promptTitle}`,
                  (b.files ?? []).map((f) => ({ path: f.path, content: f.content })),
                )
              }
            >
              <span className="truncate">
                {b.code} · {b.promptTitle}
              </span>
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {(b.files ?? []).length} files
              </span>
            </DropdownMenuItem>
          ))
        ) : (
          <DropdownMenuItem disabled>No build files yet</DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
