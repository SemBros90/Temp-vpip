import { Link, useParams } from "@tanstack/react-router";
import {
  Boxes,
  BrainCircuit,
  Brain,
  GraduationCap,
  Layers,
  Network,
  ShieldAlert,
  Camera,
  FileText,
  GitBranch,
  HardDriveDownload,
  Inbox,
  LayoutDashboard,
  Library,
  MessagesSquare,
  Package,
  Search,
  Settings as SettingsIcon,
  Sparkles,
  Table2,
  Stethoscope,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { useVpip } from "@/lib/vpip/store";
import { PROVIDER_LABEL } from "@/lib/vpip/types";
import { cn } from "@/lib/utils";

const projectNav = [
  { to: "/projects/$projectId", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/projects/$projectId/memory", label: "Project Memory", icon: Brain },
  { to: "/projects/$projectId/discussions", label: "Discussions", icon: MessagesSquare },
  { to: "/projects/$projectId/inbox", label: "Knowledge Inbox", icon: Inbox },
  { to: "/projects/$projectId/register", label: "Master Register", icon: Table2 },
  { to: "/projects/$projectId/explorer", label: "Knowledge Explorer", icon: Search },
  { to: "/projects/$projectId/ask", label: "Ask Project Memory", icon: BrainCircuit },
  { to: "/projects/$projectId/documents", label: "Documents", icon: FileText },
  { to: "/projects/$projectId/prompts", label: "Prompts", icon: Sparkles },
  { to: "/projects/$projectId/context", label: "Context Packages", icon: Layers },
  { to: "/projects/$projectId/builds", label: "Build Sessions", icon: HardDriveDownload },
  { to: "/projects/$projectId/repositories", label: "Repositories", icon: GitBranch },
  { to: "/projects/$projectId/import-diagnostics", label: "Import Diagnostics", icon: Stethoscope },
  { to: "/projects/$projectId/artifacts", label: "Artifacts & Builds", icon: Package },
  { to: "/projects/$projectId/outcomes", label: "Outcomes & Failures", icon: ShieldAlert },
  { to: "/projects/$projectId/lessons", label: "Lessons Learned", icon: GraduationCap },
  { to: "/projects/$projectId/snapshots", label: "Snapshots", icon: Camera },
] as const;

function SaveIndicator() {
  const { dirty, lastSavedAt, saveState, saveError, saveNow, tabId, otherTabs } = useVpip();
  const failed = saveState === "error";
  const saving = saveState === "saving" || (dirty && !failed);
  return (
    <div className="space-y-1.5">
      <Link
        to="/diagnostics/persistence"
        className="label-mono flex items-center gap-2 hover:text-foreground"
      >
        <span
          className={cn(
            "size-1.5 rounded-full",
            failed ? "bg-destructive" : saving ? "bg-warning" : "bg-success",
          )}
        />
        {failed
          ? "Save failed"
          : saving
            ? "Saving…"
            : lastSavedAt
              ? `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`
              : "Vault ready"}
      </Link>
      {failed ? (
        <div className="rounded-sm border border-destructive/50 bg-destructive/10 p-2 text-[11px] leading-snug text-destructive">
          <div className="font-semibold">Changes are not stored</div>
          <div className="mt-1 break-words">{saveError}</div>
          <button
            type="button"
            onClick={() => void saveNow()}
            className="mt-1.5 underline underline-offset-2"
          >
            Retry save
          </button>
        </div>
      ) : null}
      {otherTabs.length ? (
        <div className="rounded-sm border border-warning/50 bg-warning/10 p-2 text-[11px] leading-snug text-warning-foreground">
          Also open in {otherTabs.length} other tab{otherTabs.length > 1 ? "s" : ""} (
          {otherTabs.join(", ")}). This tab is {tabId}. Edit in one tab only — the last
          save wins.
        </div>
      ) : null}
    </div>
  );
}

export function Shell({
  children,
  title,
  subtitle,
  actions,
  scroll = true,
}: {
  children: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  scroll?: boolean;
}) {
  const params = useParams({ strict: false }) as { projectId?: string };
  const projectId = params.projectId;
  const { ws } = useVpip();
  const project = ws.projects.find((p) => p.id === projectId);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      <aside className="flex w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
        <div className="flex items-center gap-2.5 border-b border-sidebar-border px-4 py-3.5">
          <div className="grid size-8 place-items-center rounded-md bg-primary text-primary-foreground">
            <Boxes className="size-4" />
          </div>
          <div className="leading-tight">
            <div className="font-mono text-sm font-semibold tracking-tight">VPIP</div>
            <div className="label-mono">Project Intelligence</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3">
          <div className="label-mono px-2 pb-1.5">Workspace</div>
          <NavItem to="/" icon={Library} label="Projects" exact />
          <NavItem to="/intelligence" icon={Network} label="Intelligence Register" />
          <NavItem to="/validation" icon={ShieldCheck} label="Repository Validation" />
          <NavItem to="/settings" icon={SettingsIcon} label="Settings" />

          {project ? (
            <>
              <div className="label-mono mt-5 px-2 pb-1.5 truncate">{project.name}</div>
              {projectNav.map((item) => (
                <NavItem
                  key={item.label}
                  to={item.to}
                  params={{ projectId: project.id }}
                  icon={item.icon}
                  label={item.label}
                  exact={"exact" in item ? item.exact : false}
                />
              ))}
            </>
          ) : null}
        </nav>

        <div className="space-y-1.5 border-t border-sidebar-border px-4 py-3">
          <SaveIndicator />
          <div className="label-mono">
            Default engine · {PROVIDER_LABEL[ws.settings.defaultProvider]}
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-6 py-3.5">
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold tracking-tight">{title}</h1>
            {subtitle ? (
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{subtitle}</div>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        </header>
        <div className={cn("min-h-0 flex-1", scroll ? "overflow-y-auto" : "overflow-hidden")}>
          {children}
        </div>
      </main>
    </div>
  );
}

function NavItem({
  to,
  params,
  icon: Icon,
  label,
  exact,
}: {
  to: string;
  params?: Record<string, string>;
  icon: typeof Library;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      to={to as any}
      params={params as never}
      activeOptions={{ exact: exact ?? false }}
      activeProps={{
        className:
          "bg-sidebar-accent text-sidebar-accent-foreground border-l-2 border-sidebar-primary",
      }}
      inactiveProps={{ className: "border-l-2 border-transparent text-muted-foreground" }}
      className="flex items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
    >
      <Icon className="size-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}
