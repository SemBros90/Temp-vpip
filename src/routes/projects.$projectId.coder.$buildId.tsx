import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  CornerDownLeft,
  Database,
  ExternalLink,
  FilePlus2,
  FileText,
  FolderPlus,
  Gavel,
  History,
  ListChecks,
  Loader2,
  MessagesSquare,
  Monitor,
  PanelLeft,
  PanelLeftClose,
  PanelsTopLeft,
  Pencil,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Trash2,
  Waypoints,
} from "lucide-react";
import {
  Group,
  Panel,
  Separator as ResizeSeparator,
  type GroupImperativeHandle,
  type PanelImperativeHandle,
} from "react-resizable-panels";
import { toast } from "sonner";
import { Shell } from "@/components/vpip/Shell";
import { EmptyState, EnginePicker, Tag, relTime, useEngine } from "@/components/vpip/common";
import { AgentPanel } from "@/components/vpip/AgentPanel";
import { AuditorPanel } from "@/components/vpip/AuditorPanel";
import { Markdown } from "@/lib/vpip/markdown";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { RuntimePanel } from "@/components/vpip/RuntimePanel";
import { Server } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Stethoscope } from "lucide-react";
import { applyPreviewResult } from "@/lib/vpip/repo-analyzer";
import { RepoCompatibilityPanel, useRepoEnv, useRepoReport, useRunCompatibility } from "@/components/vpip/RepoCompatibilityPanel";
import { previewOptionsFrom, repoDiagnosticsSummary } from "@/lib/vpip/repo-analyzer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useProject, useVpipActions } from "@/lib/vpip/store";
import { useAiKeys } from "@/lib/vpip/keys";
import { coderModePrompt, coderSystemPrompt, coderTrace, runCoderTurn } from "@/lib/vpip/coder";
import {
  FOLDER_KEEP,
  buildPreviewDoc,
  buildTree,
  diffLines,
  fileName,
  languageOf,
  normalizePath,
  parseProposedFiles,
  runTerminalCommand,
  searchFiles,
  validateFiles,
  type TreeNode,
} from "@/lib/vpip/coder-fs";
import { BuildManager } from "@/components/vpip/BuildManager";
import { useUnifiedVerdict } from "@/lib/vpip/use-unified-validation";
import { checkCompleteness, auditFrameworkFiles, frameworkAuditIssues } from "@/lib/vpip/build-assurance";
import { unifyValidation } from "@/lib/vpip/validation-calibration";
import {
  REPAIR_MODES,
  attachFiles,
  buildGate,
  buildPlanPrompt,
  buildRequirements,
  computeHealth,
  extractRequirements,
  extractRequirementsWithAi,
  parseBuildPlan,
  repairInstruction,
  validateBuild,
} from "@/lib/vpip/orchestration";
import { completeChat } from "@/lib/vpip/ai";
import {
  BUILD_STATUSES,
  CODER_CHAT_MODES,
  CODE_ARTIFACTS,
  DB_ENGINES,
  DB_FIELDS,
  PROVIDER_LABEL,
  type BuildStatus,
  type CodeArtifact,
  type CoderActionKind,
  type CoderFile,
  type CoderTrace,
  type CoderTurn,
  type DbEngine,
  type RequirementStatus,
} from "@/lib/vpip/types";

export const Route = createFileRoute("/projects/$projectId/coder/$buildId")({
  head: () => ({
    meta: [
      { title: "AI Coder — VPIP" },
      {
        name: "description",
        content:
          "The AI Coder turns an approved prompt and its linked decisions, requirements, documents and discussions into files, with every action traced to the build session.",
      },
      { property: "og:title", content: "AI Coder — VPIP" },
      {
        property: "og:description",
        content:
          "Project-aware coding workspace: file explorer, coding chat, live preview, terminal and version history.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CoderPage,
});

function CoderPage() {
  const { projectId, buildId } = Route.useParams();
  const p = useProject(projectId);
  const actions = useVpipActions();
  const { provider, cfg } = useEngine();
  const { keys } = useAiKeys();

  const [leftTab, setLeftTab] = useState("explorer");
  const [centerTab, setCenterTab] = useState("chat");
  const [auditorOpen, setAuditorOpen] = useState(true);
  const [rightTab, setRightTab] = useState("preview");
  const [bottomTab, setBottomTab] = useState("terminal");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CoderActionKind>("Generate Code");
  const [artifact, setArtifact] = useState<CodeArtifact>("Component");
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewLogs, setPreviewLogs] = useState<{ kind: string; text: string }[]>([]);
  const [previewStatus, setPreviewStatus] = useState<{ rendered: boolean; compileErrors?: string[]; at: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const workspaceRef = useRef<GroupImperativeHandle | null>(null);
  const filesPanelRef = useRef<PanelImperativeHandle | null>(null);
  const chatPanelRef = useRef<PanelImperativeHandle | null>(null);
  const [filesOpen, setFilesOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [bottomOpen, setBottomOpen] = useState(false);
  const [previewLogsOpen, setPreviewLogsOpen] = useState(false);

  const session = p.buildSessions.find((b) => b.id === buildId);
  const files = useMemo(() => session?.files ?? [], [session?.files]);
  const realFiles = useMemo(() => files.filter((f) => fileName(f.path) !== FOLDER_KEEP), [files]);
  const selected = files.find((f) => f.path === selectedPath) ?? null;

  const opened = useRef(false);
  useEffect(() => {
    if (session && !opened.current) {
      opened.current = true;
      actions.markBuildOpened(session.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id]);

  useEffect(() => {
    inputRef.current?.focus();
  }, [buildId]);

  useEffect(() => {
    const raw = window.localStorage.getItem("vpip-coder-layout");
    if (!raw) return;
    try {
      const layout = JSON.parse(raw) as Record<string, number>;
      workspaceRef.current?.setLayout(layout);
    } catch {
      window.localStorage.removeItem("vpip-coder-layout");
    }
  }, []);

  useEffect(() => {
    setDraft(selected?.content ?? "");
  }, [selected?.path, selected?.updatedAt, selected?.content]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [session?.turns?.length, streaming]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const data = e.data as { __vpipPreview?: boolean; kind?: string; text?: string };
      if (!data?.__vpipPreview) return;
      if (data.kind === "status") {
        try {
          setPreviewStatus({ ...(JSON.parse(data.text ?? "{}") as { rendered: boolean; compileErrors?: string[] }), at: Date.now() });
        } catch {
          /* ignore */
        }
        return;
      }
      setPreviewLogs((l) => [
        ...l.slice(-120),
        { kind: data.kind ?? "log", text: data.text ?? "" },
      ]);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const prompt = p.prompts.find((x) => x.id === session?.promptId);
  const linked = useMemo(() => {
    const ids = (arr?: string[]) => arr ?? [];
    return {
      decisions: p.knowledge.filter((k) => ids(prompt?.linkedDecisionIds).includes(k.id)),
      requirements: p.knowledge.filter((k) => ids(prompt?.linkedRequirementIds).includes(k.id)),
      documents: p.documents.filter((d) => ids(prompt?.linkedDocumentIds).includes(d.id)),
      discussions: p.discussions.filter((d) => ids(prompt?.linkedDiscussionIds).includes(d.id)),
    };
  }, [p.knowledge, p.documents, p.discussions, prompt]);

  const repoReport = useRepoReport(projectId, session?.repositoryId, session?.id);
  const legacyReport = useMemo(() => validateBuild(files), [files]);
  const analyzerFiles = useMemo(() => realFiles.map((f) => ({ path: f.path, content: f.content })), [realFiles]);
  const { cal } = useUnifiedVerdict(session?.id, repoReport, analyzerFiles);
  const repoEnv = useRepoEnv(session?.repositoryId);
  const runCompat = useRunCompatibility();
  const autoScanned = useRef<string | null>(null);
  useEffect(() => {
    if (!session || repoReport || autoScanned.current === session.id) return;
    if (!session.repositoryId || realFiles.length === 0) return;
    autoScanned.current = session.id;
    runCompat(projectId, realFiles, { build: session, buildStatus: "Scanned on open" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, repoReport, realFiles.length]);

  // Record the live preview outcome (compile / runtime / preview stages) on the report.
  const recordedStatus = useRef<number>(0);
  useEffect(() => {
    if (!previewStatus || !repoReport || recordedStatus.current === previewStatus.at) return;
    recordedStatus.current = previewStatus.at;
    const runtimeErrors = previewLogs.filter((l) => l.kind === "error" && !l.text.startsWith("compile:")).map((l) => l.text);
    actions.updateRepoReport(repoReport.id, applyPreviewResult(repoReport, { rendered: previewStatus.rendered, runtimeErrors, compileErrors: previewStatus.compileErrors }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewStatus, repoReport?.id]);

  /** The handed-off prompt text, ready to be sent to the coder. */
  const promptBody = (prompt?.markdown ?? session?.contextPackage ?? "").trim();

  /** Pre-load the originating prompt into the chat input on a fresh session. */
  const prefilled = useRef<string | null>(null);
  useEffect(() => {
    if (!session || prefilled.current === session.id) return;
    prefilled.current = session.id;
    if ((session.turns?.length ?? 0) > 0) return;
    if (!promptBody) return;
    setInput(promptBody);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, promptBody]);

  const trace: CoderTrace | null = session
    ? {
        ...coderTrace(session, linked.decisions, linked.requirements),
        documentIds: linked.documents.map((d) => d.id),
        discussionIds: linked.discussions.map((d) => d.id),
      }
    : null;

  const log = useCallback(
    (kind: CoderActionKind, summary: string, filesModified: string[]) => {
      if (!session || !trace) return;
      actions.logCoderAction(session.id, {
        kind,
        summary,
        filesModified,
        provider,
        model: cfg.model,
        trace,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session?.id, trace, provider, cfg.model],
  );

  if (!session || !trace) {
    return (
      <Shell title="AI Coder">
        <div className="mx-auto max-w-3xl px-6 py-10">
          <EmptyState
            title="Build session not found"
            description="Open a prompt and use Execute In Coder to create a build session."
          />
        </div>
      </Shell>
    );
  }

  const turns = session.turns ?? [];
  const logs = session.terminal ?? [];
  const problems = validateFiles(realFiles);
  const previewDoc = buildPreviewDoc(
    files,
    session.previewEntryPath,
    previewOptionsFrom(repoReport, realFiles, repoEnv),
  );
  const previewErrors = previewLogs.filter((l) => l.kind === "error").map((l) => l.text);

  /** Open the live preview as a standalone page in a new browser tab. */
  const openPreviewInTab = useCallback(() => {
    if (!previewDoc) return;
    const url = URL.createObjectURL(new Blob([previewDoc], { type: "text/html" }));
    window.open(url, "_blank", "noopener");
    // Reclaim the blob once the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, [previewDoc]);

  /* ------------------------------- Module 16 — build orchestration */

  const requirements = session.requirements ?? [];
  const unified = unifyValidation(legacyReport, cal, Boolean(session?.repositoryId));
  // Generated builds: the Build Assurance framework audit always runs (no plan/requirements needed)
  // and its failures block exactly like the certificate and the Runtime "no package.json" message.
  const fwAudit = !session.repositoryId ? auditFrameworkFiles(files.map((f) => ({ path: f.path, content: f.content })), session.buildPlan?.files.map((f) => f.path) ?? []) : null;
  const fwIssues = fwAudit && !fwAudit.complete ? frameworkAuditIssues(fwAudit) : [];
  const report = fwIssues.length
    ? { ...unified, startupStatus: "Fail" as const, issues: [...fwIssues.map((i) => ({ kind: "Startup" as const, severity: "error" as const, ...i })), ...unified.issues] }
    : unified;
  const health = computeHealth(requirements, session.buildPlan, files, report);
  const gate = buildGate(report);
  const genGate = !session.repositoryId && session.buildPlan?.files.length
    ? checkCompleteness(files.map((f) => ({ path: f.path, content: f.content })), session.buildPlan.files.map((f) => f.path))
    : null;
  const genBlocked = genGate ? !genGate.complete : false;
  const genBlockedView = genGate && genBlocked ? (
    <div className="space-y-2 p-4 text-sm">
      <div className="font-mono font-semibold text-destructive">GENERATION INCOMPLETE · BUILD BLOCKED</div>
      <div className="font-mono text-xs">Planned {genGate.planned.length} · Created {genGate.created.length} · Missing {genGate.missing.length}</div>
      <ul className="max-h-60 overflow-y-auto font-mono text-xs text-destructive">{genGate.missing.map((m) => <li key={m}>- {m}</li>)}</ul>
      <p className="text-xs text-muted-foreground">Preview and Runtime stay blocked until every planned file exists. Use Auto Recovery on the Build Assurance page, or ask the coder to create the missing files.</p>
    </div>
  ) : null;
  const hasKey = Boolean(keys[provider] || cfg.apiKey?.trim());

  const runExtractRequirements = async () => {
    if (!promptBody) {
      toast.error("This build session has no prompt text to extract from");
      return;
    }
    setBusy(true);
    try {
      let items: { title: string; detail: string }[] = [];
      if (hasKey) {
        try {
          items = await extractRequirementsWithAi(provider, cfg, promptBody);
        } catch {
          items = [];
        }
      }
      if (!items.length) items = extractRequirements(promptBody);
      const reqs = buildRequirements(session.id, items, new Date().toISOString());
      actions.updateBuildSession(session.id, { requirements: reqs });
      setCenterTab("build");
      toast.success(`${reqs.length} requirements registered`);
    } finally {
      setBusy(false);
    }
  };

  const runPlanBuild = async () => {
    if (!hasKey) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    setBusy(true);
    try {
      const answer = await completeChat(provider, cfg, [
        {
          role: "system",
          content: coderSystemPrompt(session, p.project, linked.decisions, linked.requirements),
        },
        { role: "user", content: buildPlanPrompt(promptBody, requirements) },
      ]);
      const plan = parseBuildPlan(answer, new Date().toISOString());
      if (!plan) {
        toast.error("The engine did not return a usable build plan");
        return;
      }
      actions.updateBuildSession(session.id, { buildPlan: plan });
      setCenterTab("build");
      toast.success(
        `Build plan ready — ${plan.files.length} files, ${plan.dependencies.length} dependencies`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Build planning failed");
    } finally {
      setBusy(false);
    }
  };

  const runValidate = () => {
    const fresh = unifyValidation(validateBuild(files), cal, Boolean(session.repositoryId));
    actions.updateBuildSession(session.id, { validation: fresh });
    const errs = fresh.issues.filter((i) => i.severity === "error");
    errs.slice(0, 20).forEach((i) =>
      actions.appendLog(session.id, {
        stream: "error",
        output: `[${i.kind}] ${i.path ? `${i.path}: ` : ""}${i.message}`,
        exitCode: 1,
      }),
    );
    if (errs.length) {
      setBottomTab("error");
      toast.error(`${errs.length} validation errors`);
    } else {
      toast.success("Compile, import and startup validation passed");
    }
  };

  const runRepairTask = () => {
    setMode("Fix Errors");
    setInput(repairInstruction(report));
    setCenterTab("chat");
    toast.info("Repair task loaded — send it to fix the root cause before new features");
  };

  /* ------------------------------------------------------- file actions */

  const writeFile = (path: string, content: string, note: string) => {
    actions.writeCoderFile(session.id, path, content, {
      note,
      trace,
      provider,
      model: cfg.model,
    });
  };

  const createFile = () => {
    const raw = window.prompt("New file path", selected ? `${selected.path}` : "src/index.html");
    if (!raw) return;
    const path = normalizePath(raw);
    if (!path) return;
    if (files.some((f) => f.path === path)) {
      toast.error("That path already exists");
      return;
    }
    writeFile(path, "", "Created");
    log("Create File", path, [path]);
    setSelectedPath(path);
    setCenterTab("editor");
  };

  const createFolder = () => {
    const raw = window.prompt("New folder path", "src/components");
    if (!raw) return;
    const path = normalizePath(raw);
    if (!path) return;
    writeFile(`${path}/${FOLDER_KEEP}`, "", "Folder created");
    log("Create Folder", path, [path]);
  };

  const renamePath = (from: string, isFolder: boolean) => {
    const raw = window.prompt(isFolder ? "Rename folder to" : "Rename file to", from);
    if (!raw) return;
    const to = normalizePath(raw);
    if (!to || to === from) return;
    actions.renameCoderPath(session.id, from, to);
    log("Rename File", `${from} → ${to}`, [to]);
    if (selectedPath === from) setSelectedPath(to);
  };

  const deletePath = (path: string, isFolder: boolean) => {
    if (!window.confirm(`Delete ${path}${isFolder ? " and everything inside it" : ""}?`)) return;
    actions.deleteCoderPath(session.id, path);
    log(isFolder ? "Delete Folder" : "Delete File", path, [path]);
    if (selectedPath && selectedPath.startsWith(path)) setSelectedPath(null);
  };

  const saveDraft = () => {
    if (!selected) return;
    if (draft === selected.content) {
      toast.info("No changes to save");
      return;
    }
    writeFile(selected.path, draft, "Edited in workspace");
    log("Edit File", selected.path, [selected.path]);
    toast.success(`${fileName(selected.path)} saved as a new version`);
  };

  /* ---------------------------------------------------------- chat turn */

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!keys[provider] && !cfg.apiKey?.trim()) {
      toast.error(`No ${PROVIDER_LABEL[provider]} key is configured. See Settings.`);
      return;
    }
    /* Module 16 — no feature generation while the build cannot compile or boot */
    if (gate.blocked && realFiles.length > 0 && !REPAIR_MODES.includes(mode)) {
      toast.error(`Build BLOCKED: ${gate.reasons.join(", ")}. Repair first.`);
      setMode("Fix Errors");
      setInput(repairInstruction(report));
      setCenterTab("build");
      return;
    }
    const logText = logs
      .slice(-40)
      .filter((l) => l.stream === "error" || l.stream === "build")
      .map((l) => `[${l.stream}] ${l.command ? `$ ${l.command}\n` : ""}${l.output}`)
      .join("\n");
    const errorText = [
      logText,
      problems.join("\n"),
      previewLogs
        .filter((l) => l.kind === "error")
        .map((l) => `[preview] ${l.text}`)
        .join("\n"),
    ]
      .filter(Boolean)
      .join("\n");

    const userContent = `[${mode}] ${text}`;
    actions.appendCoderTurn(session.id, { role: "user", content: userContent, trace });
    setInput("");
    setBusy(true);
    setStreaming("");
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const system =
        coderSystemPrompt(session, p.project, linked.decisions, linked.requirements) +
        (repoReport ? `\n\n${repoDiagnosticsSummary(repoReport)}\n\nUse these diagnostics when repairing: fix missing imports/assets, add missing packages to package.json, never ask for secret values.\n` : "") +
        coderModePrompt({
          mode,
          artifact,
          files: realFiles,
          openFile: selected ?? undefined,
          logs: errorText || undefined,
          connections: (session.dbConnections ?? []).map((c) => `${c.engine} (${c.label})`),
        });
      const answer = await runCoderTurn(
        provider,
        cfg,
        system,
        turns,
        userContent,
        (chunk) => setStreaming((s) => (s ?? "") + chunk),
        controller.signal,
      );
      const proposed = parseProposedFiles(answer);
      const generated = [...proposed];
      const resultingPaths = new Set([
        ...realFiles.map((file) => file.path),
        ...proposed.map((file) => file.path),
      ]);
      const hasWebSource = proposed.some((file) => /\.(?:tsx?|jsx?|css)$/.test(file.path));
      const hasHtml = [...resultingPaths].some((path) => path.endsWith(".html"));
      if (hasWebSource && !hasHtml) {
        generated.push({
          path: "index.html",
          language: "html",
          content:
            '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8" />\n  <meta name="viewport" content="width=device-width, initial-scale=1.0" />\n  <title>Preview</title>\n</head>\n<body>\n  <div id="root"></div>\n</body>\n</html>',
        });
      }
      generated.forEach((file) =>
        writeFile(file.path, file.content, `Written automatically from coder answer`),
      );
      actions.appendCoderTurn(session.id, {
        role: "assistant",
        content: answer,
        provider,
        model: cfg.model,
        trace,
      });
      log(
        mode,
        text.slice(0, 160),
        generated.map((file) => file.path),
      );
      if (generated.length) {
        setSelectedPath(generated[0]?.path ?? null);
        setRightTab("preview");
        setPreviewLogs([]);
        setPreviewKey((key) => key + 1);
        toast.success(`${generated.length} ${generated.length === 1 ? "file" : "files"} written`);
      }
      /* revalidate against the new file set and update the traceability matrix */
      const at = new Date().toISOString();
      const nextFiles: CoderFile[] = [...realFiles];
      generated.forEach((g) => {
        const entry: CoderFile = {
          id: g.path,
          path: g.path,
          content: g.content,
          createdAt: at,
          updatedAt: at,
          versions: [],
        };
        const i = nextFiles.findIndex((f) => f.path === g.path);
        if (i >= 0) nextFiles[i] = entry;
        else nextFiles.push(entry);
      });
      const post = unifyValidation(validateBuild(nextFiles), cal, Boolean(session.repositoryId));
      actions.updateBuildSession(session.id, {
        validation: post,
        requirements: attachFiles(
          requirements,
          generated.map((f) => f.path),
          at,
        ),
        ...(session.status === "Handed Off" || session.status === "Queued"
          ? { status: "In Progress" as BuildStatus }
          : {}),
      });
      const postGate = buildGate(post);
      if (postGate.blocked) {
        post.issues
          .filter((i) => i.severity === "error")
          .slice(0, 20)
          .forEach((i) =>
            actions.appendLog(session.id, {
              stream: "error",
              output: `[${i.kind}] ${i.path ? `${i.path}: ` : ""}${i.message}`,
              exitCode: 1,
            }),
          );
        toast.error(`Build BLOCKED: ${postGate.reasons.join(", ")} — repair before new features`);
        setCenterTab("build");
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        const msg = err instanceof Error ? err.message : "The coder engine failed";
        toast.error(msg);
        actions.appendLog(session.id, { stream: "error", output: msg, exitCode: 1 });
      }
    } finally {
      setStreaming(null);
      setBusy(false);
      abortRef.current = null;
      inputRef.current?.focus();
    }
  };

  /* ----------------------------------------------------------- terminal */

  const execCommand = (cmd: string) => {
    if (!cmd.trim()) return;
    if (cmd.trim() === "clear") {
      actions.clearLogs(session.id, "terminal");
      return;
    }
    const result = runTerminalCommand(cmd, realFiles);
    result.entries.forEach((e) => actions.appendLog(session.id, e));
    if (result.packages) {
      const pkgFile = files.find((f) => f.path === "package.json");
      let json: { dependencies?: Record<string, string> } = {};
      try {
        json = pkgFile ? (JSON.parse(pkgFile.content) as typeof json) : {};
      } catch {
        json = {};
      }
      const deps = { ...(json.dependencies ?? {}) };
      result.packages.add.forEach((pkg) => {
        deps[pkg] = "*";
      });
      result.packages.remove.forEach((pkg) => {
        delete deps[pkg];
      });
      writeFile(
        "package.json",
        JSON.stringify({ ...json, dependencies: deps }, null, 2),
        `Terminal: ${cmd}`,
      );
    }
    log("Terminal Command", cmd, result.packages ? ["package.json"] : []);
    setBottomTab(result.entries.some((e) => e.stream === "build") ? "build" : "terminal");
  };

  return (
    <Shell
      title={`AI Coder · ${session.code}`}
      subtitle={`${session.promptTitle} · V${session.promptVersion} · ${realFiles.length} files`}
      scroll={false}
      actions={
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            title={filesOpen ? "Close files" : "Open files"}
            onClick={() => {
              if (filesPanelRef.current?.isCollapsed()) {
                workspaceRef.current?.setLayout({ files: 22, chat: 28, preview: 50 });
              } else {
                workspaceRef.current?.setLayout({ files: 0, chat: 20, preview: 80 });
              }
            }}
          >
            {filesOpen ? <PanelLeftClose className="size-4" /> : <PanelLeft className="size-4" />}
            Files
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            title="Reset to 20% chat and 80% preview"
            onClick={() => workspaceRef.current?.setLayout({ files: 0, chat: 20, preview: 80 })}
          >
            <PanelsTopLeft className="size-4" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            title={chatOpen ? "Maximize preview" : "Restore coding chat"}
            onClick={() => {
              if (chatPanelRef.current?.isCollapsed()) chatPanelRef.current.expand();
              else chatPanelRef.current?.collapse();
            }}
          >
            <MessagesSquare className="size-4" /> {chatOpen ? "Max preview" : "Chat"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            onClick={() => setBottomOpen((open) => !open)}
          >
            <TerminalIcon className="size-4" /> {bottomOpen ? "Close logs" : "Logs"}
          </Button>
          <Select
            value={session.status}
            onValueChange={(v) =>
              actions.updateBuildSession(session.id, { status: v as BuildStatus })
            }
          >
            <SelectTrigger className="h-8 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {BUILD_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <EnginePicker compact />
        </div>
      }
    >
      <div className={bottomOpen ? "grid h-full min-h-0 grid-rows-[1fr_240px]" : "h-full min-h-0"}>
        <Group
          groupRef={workspaceRef}
          id="vpip-coder-workspace"
          orientation="horizontal"
          defaultLayout={{ files: 0, chat: 20, preview: 80 }}
          onLayoutChanged={(layout) =>
            window.localStorage.setItem("vpip-coder-layout", JSON.stringify(layout))
          }
          className="hidden min-h-0 xl:flex"
        >
          {/* ---------------------------------------------- left panel */}
          <Panel
            id="files"
            panelRef={filesPanelRef}
            defaultSize="0%"
            minSize="240px"
            maxSize="420px"
            collapsedSize="0%"
            collapsible
            onResize={(size) => setFilesOpen(size.asPercentage > 0)}
          >
            <aside className="flex size-full min-h-0 flex-col border-r border-border bg-surface">
              <Tabs
                value={leftTab}
                onValueChange={setLeftTab}
                className="flex min-h-0 flex-1 flex-col gap-0"
              >
                <div className="border-b border-border px-2 py-2">
                  <TabsList className="w-full">
                    <TabsTrigger value="explorer" className="text-xs">
                      Files
                    </TabsTrigger>
                    <TabsTrigger value="search" className="text-xs">
                      Search
                    </TabsTrigger>
                    <TabsTrigger value="context" className="text-xs">
                      Context
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="explorer" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <div className="mb-2 flex items-center gap-1">
                    <Button size="sm" variant="outline" className="h-7 flex-1" onClick={createFile}>
                      <FilePlus2 className="size-3.5" /> File
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 flex-1"
                      onClick={createFolder}
                    >
                      <FolderPlus className="size-3.5" /> Folder
                    </Button>
                  </div>
                  {realFiles.length === 0 && files.length === 0 ? (
                    <p className="px-1 py-3 text-xs text-muted-foreground">
                      No files yet. Ask the coder to generate them, or create one.
                    </p>
                  ) : (
                    <FileTree
                      nodes={buildTree(files)}
                      selectedPath={selectedPath}
                      onSelect={(path) => {
                        setSelectedPath(path);
                        setCenterTab("editor");
                      }}
                      onRename={renamePath}
                      onDelete={deletePath}
                    />
                  )}
                </TabsContent>

                <TabsContent value="search" className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search files and contents"
                    className="mb-2 h-8"
                  />
                  <div className="space-y-1">
                    {searchFiles(realFiles, query).map((h, i) => (
                      <button
                        key={`${h.path}-${h.line}-${i}`}
                        className="block w-full rounded-md px-2 py-1 text-left text-xs hover:bg-surface-2"
                        onClick={() => {
                          setSelectedPath(h.path);
                          setCenterTab("editor");
                        }}
                      >
                        <span className="font-mono text-[11px] text-muted-foreground">
                          {h.path}
                          {h.line ? `:${h.line}` : ""}
                        </span>
                        <span className="block truncate">{h.text}</span>
                      </button>
                    ))}
                    {query && searchFiles(realFiles, query).length === 0 ? (
                      <p className="px-2 text-xs text-muted-foreground">No matches.</p>
                    ) : null}
                    {!query ? (
                      <p className="px-2 text-xs text-muted-foreground">
                        <Search className="mr-1 inline size-3" /> Type to search this session.
                      </p>
                    ) : null}
                  </div>
                </TabsContent>

                <TabsContent value="context" className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  <Link
                    to="/projects/$projectId/builds"
                    params={{ projectId }}
                    className="label-mono mb-3 inline-flex items-center gap-1.5 hover:text-foreground"
                  >
                    <ArrowLeft className="size-3.5" /> Build sessions
                  </Link>
                  <div className="space-y-3">
                    <Section icon={TerminalIcon} label="Originating prompt">
                      {prompt ? (
                        <div className="space-y-1">
                          <div className="truncate text-sm">{prompt.title}</div>
                          <div className="flex flex-wrap gap-1.5">
                            <Tag>{prompt.kind}</Tag>
                            <Tag>V{prompt.version}</Tag>
                            <Tag>{prompt.status ?? "Draft"}</Tag>
                          </div>
                          <Link
                            to="/projects/$projectId/prompts"
                            params={{ projectId }}
                            className="label-mono underline"
                          >
                            open in Prompts
                          </Link>
                        </div>
                      ) : (
                        <Empty text="Prompt was deleted; the frozen package still applies." />
                      )}
                    </Section>

                    {promptBody ? (
                      <Section icon={TerminalIcon} label="Prompt text sent to the coder">
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-surface-2 p-2 text-xs text-muted-foreground">
                          {promptBody}
                        </pre>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2 h-8 w-full"
                          onClick={() => {
                            setInput(promptBody);
                            setCenterTab("chat");
                            inputRef.current?.focus();
                            toast.success("Prompt loaded into the coding chat");
                          }}
                        >
                          <CornerDownLeft className="size-4" /> Load prompt into chat
                        </Button>
                      </Section>
                    ) : null}

                    <Section icon={Gavel} label={`Decisions (${linked.decisions.length})`}>
                      {linked.decisions.length === 0 ? (
                        <Empty text="No decisions linked." />
                      ) : (
                        linked.decisions.map((d) => (
                          <div key={d.id} className="text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {d.code}
                            </span>{" "}
                            {d.title}
                          </div>
                        ))
                      )}
                    </Section>

                    <Section
                      icon={ListChecks}
                      label={`Requirements (${linked.requirements.length})`}
                    >
                      {linked.requirements.length === 0 ? (
                        <Empty text="No requirements linked." />
                      ) : (
                        linked.requirements.map((r) => (
                          <div key={r.id} className="text-sm">
                            <span className="font-mono text-xs text-muted-foreground">
                              {r.code}
                            </span>{" "}
                            {r.title}
                          </div>
                        ))
                      )}
                    </Section>

                    <Section icon={FileText} label={`Documents (${linked.documents.length})`}>
                      {linked.documents.length === 0 ? (
                        <Empty text="No documents linked." />
                      ) : (
                        linked.documents.map((d) => (
                          <div key={d.id} className="truncate text-sm">
                            {d.title}
                          </div>
                        ))
                      )}
                    </Section>

                    <Section
                      icon={MessagesSquare}
                      label={`Discussions (${linked.discussions.length})`}
                    >
                      {linked.discussions.length === 0 ? (
                        <Empty text="No discussions linked." />
                      ) : (
                        linked.discussions.map((d) => (
                          <div key={d.id} className="truncate text-sm">
                            {d.title} <span className="label-mono">({d.type})</span>
                          </div>
                        ))
                      )}
                    </Section>

                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 w-full"
                      onClick={() => {
                        void navigator.clipboard.writeText(session.contextPackage);
                        toast.success("Context package copied");
                      }}
                    >
                      <Copy className="size-4" /> Copy context package
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </aside>
          </Panel>
          <ResizeSeparator className="group relative w-px bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary">
            <span className="absolute inset-y-0 -left-1.5 w-3" />
          </ResizeSeparator>

          {/* -------------------------------------------- center panel */}
          <Panel
            id="chat"
            panelRef={chatPanelRef}
            defaultSize="20%"
            minSize="280px"
            maxSize="55%"
            collapsedSize="0%"
            collapsible
            onResize={(size) => setChatOpen(size.asPercentage > 0)}
          >
            <div className="flex size-full min-h-0">
            <section className="flex size-full min-h-0 min-w-0 flex-1 flex-col bg-background">
              <Tabs
                value={centerTab}
                onValueChange={setCenterTab}
                className="flex min-h-0 flex-1 flex-col gap-0"
              >
                <div className="flex min-w-0 items-center gap-2 overflow-x-auto border-b border-border px-2 py-2">
                  <button
                    type="button"
                    onClick={() => setAuditorOpen((v) => !v)}
                    className={`shrink-0 rounded border px-2 py-1 text-xs ${auditorOpen ? "border-primary text-primary" : "border-border text-muted-foreground"}`}
                    title="Show AI 2 — Auditor beside the Coder"
                  >
                    AI 2
                  </button>
                  <TabsList className="h-8 w-max shrink-0">
                    <TabsTrigger value="chat" className="text-xs">
                      Coding chat
                    </TabsTrigger>
                    <TabsTrigger value="build" className="text-xs">
                      Build manager
                      {gate.blocked ? (
                        <span className="ml-1 size-1.5 rounded-full bg-destructive" />
                      ) : null}
                    </TabsTrigger>
                    <TabsTrigger value="editor" className="text-xs">
                      Editor
                    </TabsTrigger>
                    <TabsTrigger value="history" className="text-xs">
                      History
                    </TabsTrigger>
                    <TabsTrigger value="agent" className="text-xs">
                      Agent
                    </TabsTrigger>
                    <TabsTrigger value="trace" className="text-xs">
                      Actions
                    </TabsTrigger>
                  </TabsList>
                </div>

                {/* chat */}
                <TabsContent value="chat" className="flex min-h-0 flex-1 flex-col gap-0">
                  <Conversation className="min-h-0">
                    <ConversationContent className="gap-5 px-4 py-5">
                      {turns.length === 0 && streaming === null ? (
                        <ConversationEmptyState
                          icon={<BrainCircuit className="size-7" />}
                          title="The coder is loaded and waiting"
                          description="It holds the prompt, the linked decisions, requirements, documents and discussions of this build session, plus the session file tree. Pick a mode and ask it to build."
                        />
                      ) : null}

                      {turns.map((t) => (
                        <TurnBubble key={t.id} turn={t} />
                      ))}

                      {streaming !== null ? (
                        <Message from="assistant">
                          <div className="label-mono">
                            AI Coder · {PROVIDER_LABEL[provider]} · {mode}
                          </div>
                          <MessageContent>
                            {streaming ? (
                              <MessageResponse>{streaming}</MessageResponse>
                            ) : (
                              <Shimmer>Thinking…</Shimmer>
                            )}
                          </MessageContent>
                        </Message>
                      ) : null}
                      <div ref={bottomRef} />
                    </ConversationContent>
                    <ConversationScrollButton />
                  </Conversation>

                  <div className="shrink-0 border-t border-border bg-surface p-3">
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Select value={mode} onValueChange={(v) => setMode(v as CoderActionKind)}>
                          <SelectTrigger className="h-8 w-[190px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CODER_CHAT_MODES.map((m) => (
                              <SelectItem key={m} value={m}>
                                {m}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={artifact}
                          onValueChange={(v) => setArtifact(v as CodeArtifact)}
                        >
                          <SelectTrigger className="h-8 w-[150px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CODE_ARTIFACTS.map((a) => (
                              <SelectItem key={a} value={a}>
                                {a}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {selected ? <Tag>open: {fileName(selected.path)}</Tag> : null}
                      </div>
                      <PromptInput onSubmit={() => void send()} className="bg-surface-2">
                        <PromptInputTextarea
                          ref={inputRef}
                          className="min-h-24 resize-none"
                          placeholder="e.g. build the invoice form for R-002 respecting D-001"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                        />
                        <PromptInputFooter>
                          <PromptInputTools className="min-w-0">
                            <div className="label-mono truncate">
                              Traceable to {session.code} · {linked.decisions.length} decisions ·{" "}
                              {linked.requirements.length} requirements
                            </div>
                          </PromptInputTools>
                          <PromptInputSubmit
                            status={busy ? (streaming ? "streaming" : "submitted") : "ready"}
                            disabled={!input.trim() && !busy}
                            onStop={() => abortRef.current?.abort()}
                          />
                        </PromptInputFooter>
                      </PromptInput>
                    </div>
                  </div>
                </TabsContent>

                {/* editor */}
                <TabsContent value="editor" className="flex min-h-0 flex-1 flex-col gap-0">
                  {selected ? (
                    <>
                      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                        <div className="label-mono">
                          {languageOf(selected.path)} · V{selected.versions.at(-1)?.seq ?? 1} ·{" "}
                          {relTime(selected.updatedAt)}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-8"
                            onClick={() => renamePath(selected.path, false)}
                          >
                            <Pencil className="size-4" /> Rename
                          </Button>
                          <Button size="sm" className="h-8" onClick={saveDraft}>
                            <Save className="size-4" /> Save version
                          </Button>
                        </div>
                      </div>
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        spellCheck={false}
                        className="min-h-0 flex-1 resize-none rounded-none border-0 bg-surface-2 font-mono text-xs leading-relaxed focus-visible:ring-0"
                      />
                    </>
                  ) : (
                    <div className="p-6">
                      <EmptyState
                        title="No file open"
                        description="Pick a file in the explorer, or create one."
                      />
                    </div>
                  )}
                </TabsContent>

                {/* history */}
                <TabsContent value="history" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {selected ? (
                    <VersionHistory
                      file={selected}
                      onRestore={(versionId, seq) => {
                        actions.restoreCoderVersion(session.id, selected.path, versionId);
                        log("Restore Version", `${selected.path} → V${seq}`, [selected.path]);
                        toast.success(`Restored V${seq}`);
                      }}
                    />
                  ) : (
                    <EmptyState
                      title="No file open"
                      description="Open a file to see its versions, compare them and restore one."
                    />
                  )}
                </TabsContent>

                {/* Module 16 — build orchestration */}
                <TabsContent value="build" className="flex min-h-0 flex-1 flex-col gap-0">
                  <BuildManager
                    requirements={requirements}
                    plan={session.buildPlan}
                    report={report}
                    calibrated={cal}
                    health={health}
                    gate={gate}
                    busy={busy}
                    onExtract={runExtractRequirements}
                    onPlan={runPlanBuild}
                    onValidate={runValidate}
                    onRepair={runRepairTask}
                    onRequirementStatus={(id: string, status: RequirementStatus) =>
                      actions.patchBuildRequirement(session.id, id, { status })
                    }
                  />
                </TabsContent>

                {/* Module 14 — AI Development Agent */}
                <TabsContent value="agent" className="flex min-h-0 flex-1 flex-col gap-0">
                  <AgentPanel
                    inputs={{
                      session,
                      project: p.project,
                      register: p.knowledge,
                      decisions: linked.decisions,
                      requirements: linked.requirements,
                      documents: linked.documents,
                      discussions: linked.discussions,
                      repository: p.repositories.find((r) => r.id === session.repositoryId),
                      files,
                    }}
                    trace={trace}
                    provider={provider}
                    cfg={cfg}
                    hasKey={Boolean(keys[provider] || cfg.apiKey?.trim())}
                    errorText={[
                      logs
                        .slice(-40)
                        .filter((l) => l.stream === "error" || l.stream === "build")
                        .map((l) => `[${l.stream}] ${l.output}`)
                        .join("\n"),
                      problems.join("\n"),
                    ]
                      .filter(Boolean)
                      .join("\n")}
                    onSelectFile={(path) => {
                      setSelectedPath(path);
                      setCenterTab("editor");
                    }}
                  />
                </TabsContent>

                {/* action trail */}
                <TabsContent value="trace" className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
                  {(session.actions ?? []).length === 0 ? (
                    <EmptyState
                      title="No coding actions yet"
                      description="Every action records build, prompt, requirement codes, decision codes, files modified, engine and time."
                    />
                  ) : (
                    <div className="space-y-2">
                      {[...(session.actions ?? [])].reverse().map((a) => (
                        <div key={a.id} className="panel p-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-sm font-medium">{a.kind}</span>
                            <span className="label-mono">
                              #{a.seq} · {relTime(a.createdAt)}
                              {a.provider ? ` · ${PROVIDER_LABEL[a.provider]}` : ""}
                              {a.model ? ` · ${a.model}` : ""}
                            </span>
                          </div>
                          {a.summary ? (
                            <p className="mt-1 text-xs text-muted-foreground">{a.summary}</p>
                          ) : null}
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            <Tag>{a.trace.buildCode}</Tag>
                            <Tag>Prompt V{a.trace.promptVersion}</Tag>
                            {a.trace.decisionCodes.map((c) => (
                              <Tag key={`d-${c}`}>{c}</Tag>
                            ))}
                            {a.trace.requirementCodes.map((c) => (
                              <Tag key={`r-${c}`}>{c}</Tag>
                            ))}
                            {a.filesModified.map((f) => (
                              <Tag key={f}>{f}</Tag>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </section>
            {auditorOpen ? (
              <div className="min-h-0 w-1/2 min-w-[280px] border-l border-border">
                <AuditorPanel
                  projectId={projectId}
                  buildId={session.id}
                  buildCode={session.code}
                  originalPrompt={session.contextPackage ?? ""}
                  requirements={linked.requirements}
                  files={files}
                  buildLogs={[
                    logs.slice(-60).map((l) => `[${l.stream}] ${l.output}`).join("\n"),
                    problems.join("\n"),
                  ].filter(Boolean).join("\n")}
                  coderBusy={busy}
                  provider={provider}
                  cfg={cfg}
                  onUsePrompt={(text) => {
                    setInput(text);
                    setCenterTab("chat");
                    toast.success("Corrective prompt placed in the Coder — review it, then send.");
                  }}
                />
              </div>
            ) : null}
            </div>
          </Panel>
          <ResizeSeparator className="group relative w-px bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-primary data-[separator=active]:bg-primary">
            <span className="absolute inset-y-0 -left-1.5 w-3" />
          </ResizeSeparator>

          {/* --------------------------------------------- right panel */}
          <Panel id="preview" defaultSize="80%" minSize="35%">
            <aside className="flex size-full min-h-0 flex-col bg-surface">
              <Tabs
                value={rightTab}
                onValueChange={setRightTab}
                className="flex min-h-0 flex-1 flex-col gap-0"
              >
                <div className="border-b border-border px-2 py-2">
                  <TabsList className="w-full">
                    <TabsTrigger value="preview" className="text-xs">
                      <Monitor className="size-3.5" /> Browser Preview
                    </TabsTrigger>
                    <TabsTrigger value="runtime" className="text-xs">
                      <Server className="size-3.5" /> Runtime Preview
                    </TabsTrigger>
                    <TabsTrigger value="database" className="text-xs">
                      <Database className="size-3.5" /> Database
                    </TabsTrigger>
                    <TabsTrigger value="diagnostics" className="text-xs">
                      <Stethoscope className="size-3.5" /> Diagnostics
                      {repoReport ? ` ${repoReport.health.overall}%` : ""}
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="preview" className="flex min-h-0 flex-1 flex-col gap-0">
                  <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
                    <Select
                      value={session.previewEntryPath ?? ""}
                      onValueChange={(v) => actions.setPreviewEntry(session.id, v)}
                    >
                      <SelectTrigger className="h-7 flex-1 text-xs">
                        <SelectValue placeholder="Entry file" />
                      </SelectTrigger>
                      <SelectContent>
                        {realFiles
                          .filter((f) => f.path.endsWith(".html"))
                          .map((f) => (
                            <SelectItem key={f.path} value={f.path}>
                              {f.path}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => {
                        setPreviewLogs([]);
                        setPreviewKey((k) => k + 1);
                      }}
                    >
                      <RefreshCw className="size-3.5" /> Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={openPreviewInTab}
                      disabled={!previewDoc}
                      title="Open preview in a new full browser tab"
                    >
                      <ExternalLink className="size-3.5" /> Open tab
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7"
                      onClick={() => setPreviewLogsOpen((open) => !open)}
                    >
                      <TerminalIcon className="size-3.5" />
                      Logs{previewLogs.some((entry) => entry.kind === "error") ? " !" : ""}
                    </Button>
                  </div>
                  <div className="relative min-h-0 flex-1 bg-white">
                    {genBlockedView ? genBlockedView : previewDoc ? (
                      <>
                        <iframe
                          key={previewKey}
                          title="Live preview"
                          srcDoc={previewDoc}
                          sandbox="allow-scripts allow-forms"


                          className="size-full border-0"
                        />
                      </>
                    ) : (
                      <div className="p-4">
                        <EmptyState
                          title="Nothing to preview"
                          description="Ask the coder to create the project. Generated files are written automatically and the preview appears here without a repository connection."
                        />
                      </div>
                    )}
                  </div>
                  {previewLogsOpen ? (
                    <div className="h-24 shrink-0 overflow-y-auto border-t border-border bg-surface-2 p-2 font-mono text-[11px]">
                      <div className="label-mono mb-1">Preview logs</div>
                      {previewLogs.length === 0 ? (
                        <span className="text-muted-foreground">no output</span>
                      ) : (
                        previewLogs.map((l, i) => (
                          <div key={i} className={l.kind === "error" ? "text-destructive" : ""}>
                            {l.text}
                          </div>
                        ))
                      )}
                    </div>
                  ) : null}
                </TabsContent>

                <TabsContent value="runtime" className="flex min-h-0 flex-1 flex-col gap-0">
                  {genBlockedView ?? <RuntimePanel projectId={projectId} buildId={session.id} />}
                </TabsContent>

                <TabsContent value="diagnostics" className="min-h-0 flex-1 overflow-y-auto p-3">
                  <RepoCompatibilityPanel
                    projectId={projectId}
                    repository={p.repositories.find((r) => r.id === session.repositoryId)}
                    build={session}
                    loadFiles={async () => realFiles.map((f) => ({ path: f.path, content: f.content }))}
                    runtimeErrors={previewErrors}
                    compact
                    onPreview={() => {
                      setPreviewLogs([]);
                      setPreviewKey((k) => k + 1);
                      setRightTab("preview");
                    }}
                    onAskAI={(summary) => {
                      setInput(`${summary}\n\nDiagnose these repository problems and return the corrected files so the preview runs.`);
                      setCenterTab("chat");
                      setChatOpen(true);
                    }}
                  />
                </TabsContent>

                <TabsContent value="database" className="min-h-0 flex-1 overflow-y-auto p-3">
                  <DbPanel
                    connections={session.dbConnections ?? []}
                    onAdd={(engine, label, config) => {
                      actions.addDbConnection(session.id, { engine, label, config });
                      log("Database Connection", `${engine} · ${label}`, []);
                    }}
                    onRemove={(id, label) => {
                      actions.removeDbConnection(session.id, id);
                      log("Database Connection", `removed ${label}`, []);
                    }}
                  />
                </TabsContent>
              </Tabs>
            </aside>
          </Panel>
        </Group>

        <div className="grid h-full min-h-0 grid-rows-[minmax(320px,45%)_1fr] xl:hidden">
          <section className="flex min-h-0 flex-col border-b border-border bg-surface">
            <div className="label-mono border-b border-border px-3 py-2">Coding chat</div>
            <Conversation className="min-h-0">
              <ConversationContent className="gap-4 p-3">
                {turns.map((turn) => (
                  <TurnBubble key={turn.id} turn={turn} />
                ))}
                {streaming !== null ? (
                  <Message from="assistant">
                    <MessageContent>
                      {streaming ? (
                        <MessageResponse>{streaming}</MessageResponse>
                      ) : (
                        <Shimmer>Thinking…</Shimmer>
                      )}
                    </MessageContent>
                  </Message>
                ) : null}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
            <div className="border-t border-border p-2">
              <PromptInput onSubmit={() => void send()} className="bg-surface-2">
                <PromptInputTextarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask the coder to build or change something…"
                />
                <PromptInputFooter className="justify-end">
                  <PromptInputSubmit
                    status={busy ? "streaming" : "ready"}
                    disabled={!input.trim() && !busy}
                    onStop={() => abortRef.current?.abort()}
                  />
                </PromptInputFooter>
              </PromptInput>
            </div>
          </section>
          <section className="min-h-0 bg-surface">
            {genBlockedView ? genBlockedView : previewDoc ? (
              <>
                <div className="flex items-center justify-end gap-2 border-b border-border px-2 py-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    onClick={openPreviewInTab}
                    title="Open preview in a new full browser tab"
                  >
                    <ExternalLink className="size-3.5" /> Open tab
                  </Button>
                </div>
                <iframe
                  key={`mobile-${previewKey}`}
                  title="Live preview"
                  srcDoc={previewDoc}
                  sandbox="allow-scripts allow-forms"
                  className="size-full border-0 bg-background"
                />
              </>
            ) : (
              <ConversationEmptyState
                title="Nothing to preview"
                description="Generated files will appear here."
              />
            )}
          </section>
        </div>

        {/* ------------------------------------------------ bottom panel */}
        {bottomOpen ? (
          <div className="flex min-h-0 flex-col border-t border-border bg-surface">
            <Tabs
              value={bottomTab}
              onValueChange={setBottomTab}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
                <TabsList>
                  <TabsTrigger value="terminal" className="text-xs">
                    <TerminalIcon className="size-3.5" /> Terminal
                  </TabsTrigger>
                  <TabsTrigger value="build" className="text-xs">
                    Build logs
                  </TabsTrigger>
                  <TabsTrigger value="error" className="text-xs">
                    Error logs {problems.length ? `(${problems.length})` : ""}
                  </TabsTrigger>
                </TabsList>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7"
                  onClick={() =>
                    actions.clearLogs(
                      session.id,
                      bottomTab === "build"
                        ? "build"
                        : bottomTab === "error"
                          ? "error"
                          : "terminal",
                    )
                  }
                >
                  Clear
                </Button>
              </div>

              <TabsContent value="terminal" className="flex min-h-0 flex-1 flex-col gap-0">
                <LogStreamView entries={logs.filter((l) => l.stream === "terminal")} />
                <CommandLine onRun={execCommand} />
              </TabsContent>
              <TabsContent value="build" className="min-h-0 flex-1">
                <LogStreamView entries={logs.filter((l) => l.stream === "build")} />
              </TabsContent>
              <TabsContent
                value="error"
                className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs"
              >
                {problems.length === 0 && logs.filter((l) => l.stream === "error").length === 0 ? (
                  <span className="text-muted-foreground">No errors detected in this session.</span>
                ) : (
                  <div className="space-y-1">
                    {problems.map((pr) => (
                      <div key={pr} className="text-destructive">
                        {pr}
                      </div>
                    ))}
                    {logs
                      .filter((l) => l.stream === "error")
                      .map((l) => (
                        <div key={l.id} className="text-destructive">
                          {l.command ? `$ ${l.command} · ` : ""}
                          {l.output}
                        </div>
                      ))}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </div>
        ) : null}
      </div>
    </Shell>
  );
}

/* ------------------------------------------------------------ sub views */

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof FileText;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="panel space-y-1.5 p-3">
      <div className="label-mono flex items-center gap-1.5">
        <Icon className="size-3.5" /> {label}
      </div>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

function FileTree({
  nodes,
  selectedPath,
  onSelect,
  onRename,
  onDelete,
  depth = 0,
}: {
  nodes: TreeNode[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onRename: (path: string, isFolder: boolean) => void;
  onDelete: (path: string, isFolder: boolean) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-0.5">
      {nodes.map((n) => {
        const isFolder = n.kind === "folder";
        const isOpen = !collapsed[n.path];
        return (
          <div key={n.path}>
            <div
              className={`group flex items-center gap-1 rounded-md px-1 py-1 text-xs hover:bg-surface-2 ${
                selectedPath === n.path ? "bg-surface-2 text-foreground" : ""
              }`}
              style={{ paddingLeft: depth * 10 + 4 }}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                onClick={() =>
                  isFolder ? setCollapsed((c) => ({ ...c, [n.path]: isOpen })) : onSelect(n.path)
                }
              >
                {isFolder ? (
                  isOpen ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )
                ) : (
                  <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{n.name}</span>
              </button>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Rename"
                onClick={() => onRename(n.path, isFolder)}
              >
                <Pencil className="size-3 text-muted-foreground" />
              </button>
              <button
                className="opacity-0 transition-opacity group-hover:opacity-100"
                title="Delete"
                onClick={() => onDelete(n.path, isFolder)}
              >
                <Trash2 className="size-3 text-destructive" />
              </button>
            </div>
            {isFolder && isOpen && n.children.length ? (
              <FileTree
                nodes={n.children}
                selectedPath={selectedPath}
                onSelect={onSelect}
                onRename={onRename}
                onDelete={onDelete}
                depth={depth + 1}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function VersionHistory({
  file,
  onRestore,
}: {
  file: CoderFile;
  onRestore: (versionId: string, seq: number) => void;
}) {
  const versions = [...file.versions].reverse();
  const [leftId, setLeftId] = useState<string | null>(null);
  const left = file.versions.find((v) => v.id === leftId);
  const rows = left ? diffLines(left.content, file.content) : [];

  return (
    <div className="space-y-3">
      <div className="label-mono flex items-center gap-1.5">
        <History className="size-3.5" /> {file.path} · {file.versions.length} versions
      </div>
      <div className="space-y-1.5">
        {versions.map((v) => (
          <div key={v.id} className="panel flex flex-wrap items-center gap-2 p-2.5">
            <span className="font-mono text-xs">V{v.seq}</span>
            <span className="text-xs">{v.note}</span>
            <span className="label-mono">
              {relTime(v.createdAt)}
              {v.provider ? ` · ${PROVIDER_LABEL[v.provider]}` : ""}
            </span>
            {v.trace ? <Tag>{v.trace.buildCode}</Tag> : null}
            <div className="ml-auto flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => setLeftId(v.id === leftId ? null : v.id)}
              >
                <Waypoints className="size-3.5" /> {v.id === leftId ? "Hide diff" : "Compare"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7"
                onClick={() => onRestore(v.id, v.seq)}
              >
                <RotateCcw className="size-3.5" /> Restore
              </Button>
            </div>
          </div>
        ))}
      </div>

      {left ? (
        <div className="panel overflow-x-auto p-0">
          <div className="label-mono border-b border-border px-3 py-2">V{left.seq} → current</div>
          <table className="w-full font-mono text-[11px]">
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={i}
                  className={
                    r.kind === "same"
                      ? ""
                      : r.kind === "added"
                        ? "bg-success/10"
                        : r.kind === "removed"
                          ? "bg-destructive/10"
                          : "bg-warning/10"
                  }
                >
                  <td className="w-1/2 whitespace-pre-wrap border-r border-border px-2 py-0.5 align-top">
                    {r.left ?? ""}
                  </td>
                  <td className="w-1/2 whitespace-pre-wrap px-2 py-0.5 align-top">
                    {r.right ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

function LogStreamView({
  entries,
}: {
  entries: {
    id: string;
    command?: string | undefined;
    output: string;
    exitCode?: number | undefined;
  }[];
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [entries.length]);
  return (
    <div ref={ref} className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
      {entries.length === 0 ? (
        <span className="text-muted-foreground">no output</span>
      ) : (
        entries.map((e) => (
          <div key={e.id} className="mb-1">
            {e.command ? <div className="text-primary">$ {e.command}</div> : null}
            <div
              className={`whitespace-pre-wrap ${e.exitCode ? "text-destructive" : "text-muted-foreground"}`}
            >
              {e.output}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function CommandLine({ onRun }: { onRun: (cmd: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      className="flex shrink-0 items-center gap-2 border-t border-border px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        onRun(value);
        setValue("");
      }}
    >
      <span className="font-mono text-xs text-primary">$</span>
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder='type "help" for the session commands'
        className="h-7 border-0 bg-transparent font-mono text-xs focus-visible:ring-0"
      />
      <Button size="sm" variant="outline" className="h-7" type="submit">
        Run
      </Button>
    </form>
  );
}

function DbPanel({
  connections,
  onAdd,
  onRemove,
}: {
  connections: { id: string; engine: DbEngine; label: string; config: Record<string, string> }[];
  onAdd: (engine: DbEngine, label: string, config: Record<string, string>) => void;
  onRemove: (id: string, label: string) => void;
}) {
  const [engine, setEngine] = useState<DbEngine>("PostgreSQL");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Connection details are whatever you type here. Nothing is pre-filled and nothing is
        hardcoded; the coder is told only which targets exist.
      </p>
      <div className="panel space-y-2 p-3">
        <Select
          value={engine}
          onValueChange={(v) => {
            setEngine(v as DbEngine);
            setConfig({});
          }}
        >
          <SelectTrigger className="h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DB_ENGINES.map((e) => (
              <SelectItem key={e} value={e}>
                {e}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Label, e.g. local"
          className="h-8"
        />
        {DB_FIELDS[engine].map((field) => (
          <Input
            key={field}
            value={config[field] ?? ""}
            onChange={(e) => setConfig((c) => ({ ...c, [field]: e.target.value }))}
            placeholder={field}
            type={
              field.toLowerCase().includes("password") || field.toLowerCase().includes("key")
                ? "password"
                : "text"
            }
            className="h-8"
          />
        ))}
        <Button
          size="sm"
          className="h-8 w-full"
          onClick={() => {
            if (!label.trim()) {
              toast.error("Give the connection a label");
              return;
            }
            onAdd(engine, label.trim(), config);
            setLabel("");
            setConfig({});
            toast.success("Connection saved to this build session");
          }}
        >
          <Check className="size-4" /> Save connection
        </Button>
      </div>

      {connections.map((c) => (
        <div key={c.id} className="panel flex items-start gap-2 p-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              {c.label} <span className="label-mono">· {c.engine}</span>
            </div>
            <div className="mt-1 space-y-0.5 font-mono text-[11px] text-muted-foreground">
              {Object.entries(c.config)
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k}>
                    {k}:{" "}
                    {k.toLowerCase().includes("password") || k.toLowerCase().includes("key")
                      ? "••••••"
                      : v}
                  </div>
                ))}
            </div>
          </div>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => onRemove(c.id, c.label)}>
            <Trash2 className="size-3.5 text-destructive" />
          </Button>
        </div>
      ))}
    </div>
  );
}

function TurnBubble({ turn }: { turn: CoderTurn }) {
  const isUser = turn.role === "user";
  const proposed = isUser ? [] : parseProposedFiles(turn.content);
  return (
    <Message from={isUser ? "user" : "assistant"}>
      <div className="label-mono flex flex-wrap items-center gap-1.5">
        {isUser ? "You" : "AI Coder"} · {relTime(turn.createdAt)}
        {turn.provider ? <span>· {PROVIDER_LABEL[turn.provider]}</span> : null}
      </div>
      <MessageContent>
        {isUser ? (
          <div className="whitespace-pre-wrap">{turn.content}</div>
        ) : (
          <MessageResponse>{turn.content}</MessageResponse>
        )}
      </MessageContent>

      {proposed.length ? (
        <div className="panel space-y-2 p-3">
          <div className="label-mono">Files written automatically ({proposed.length})</div>
          {proposed.map((file) => (
            <div key={file.path} className="flex items-center gap-2">
              <Check className="size-3.5 text-success" />
              <span className="min-w-0 flex-1 truncate font-mono text-xs">{file.path}</span>
              <Tag>saved</Tag>
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1.5">
        <Tag>{turn.trace.buildCode}</Tag>
        <Tag>Prompt V{turn.trace.promptVersion}</Tag>
        {turn.trace.decisionCodes.map((c) => (
          <Tag key={c}>{c}</Tag>
        ))}
        {turn.trace.requirementCodes.map((c) => (
          <Tag key={c}>{c}</Tag>
        ))}
      </div>
    </Message>
  );
}
