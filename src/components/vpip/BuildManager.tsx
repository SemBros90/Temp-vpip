import { AlertTriangle, CheckCircle2, ListChecks, Loader2, PlayCircle, RefreshCw, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tag, relTime } from "@/components/vpip/common";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  REQUIREMENT_STATUSES,
  type BuildHealth,
  type BuildPlan,
  type BuildRequirement,
  type RequirementStatus,
  type ValidationReport,
  type ValidationStatus,
} from "@/lib/vpip/types";
import type { CalibratedReport } from "@/lib/vpip/validation-calibration";

const statusTone: Record<RequirementStatus, string> = {
  "Not Started": "text-muted-foreground border-border-strong bg-muted",
  "In Progress": "text-info border-info/40 bg-info/10",
  Completed: "text-success border-success/40 bg-success/10",
  Failed: "text-destructive border-destructive/40 bg-destructive/10",
  Blocked: "text-warning border-warning/40 bg-warning/10",
};

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="panel px-3 py-2">
      <div className="label-mono text-[10px]">{label}</div>
      <div className={cn("mt-0.5 font-mono text-lg font-semibold tabular-nums", tone)}>{value}</div>
    </div>
  );
}

function statusTone2(s: ValidationStatus) {
  return s === "Pass" ? "text-success" : s === "Fail" ? "text-destructive" : "text-muted-foreground";
}

export interface BuildManagerProps {
  requirements: BuildRequirement[];
  plan: BuildPlan | undefined;
  report: ValidationReport;
  /** Unified verdict (same engine as Runtime Validation Center). */
  calibrated?: CalibratedReport | undefined;
  health: BuildHealth;
  gate: { blocked: boolean; reasons: string[] };
  busy: boolean;
  onExtract: () => void;
  onPlan: () => void;
  onValidate: () => void;
  onRepair: () => void;
  onRequirementStatus: (id: string, status: RequirementStatus) => void;
}

export function BuildManager(props: BuildManagerProps) {
  const { requirements, plan, report, health, gate } = props;
  const errors = report.issues.filter((i) => i.severity === "error");
  const warns = report.issues.filter((i) => i.severity === "warning");
  const cal = props.calibrated;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      {/* 8. build health dashboard */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-medium">Build health</h3>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={props.onValidate} disabled={props.busy}>
              <RefreshCw className="mr-1 size-3.5" /> Validate
            </Button>
            <Button size="sm" variant="outline" onClick={props.onExtract} disabled={props.busy}>
              <ListChecks className="mr-1 size-3.5" /> Extract requirements
            </Button>
            <Button size="sm" variant="outline" onClick={props.onPlan} disabled={props.busy}>
              {props.busy ? (
                <Loader2 className="mr-1 size-3.5 animate-spin" />
              ) : (
                <PlayCircle className="mr-1 size-3.5" />
              )}
              Plan build
            </Button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          <Metric label="Requirements" value={health.requirementsTotal} />
          <Metric label="Complete" value={health.requirementsComplete} tone="text-success" />
          <Metric label="Failed" value={health.requirementsFailed} tone="text-destructive" />
          <Metric label="Blocked" value={health.requirementsBlocked} tone="text-warning" />
          <Metric label="Completion" value={`${health.completion}%`} />
          <Metric label="Files planned" value={health.filesPlanned} />
          <Metric label="Files created" value={health.filesCreated} />
          <Metric
            label="Deps missing"
            value={health.dependenciesMissing}
            tone={health.dependenciesMissing ? "text-destructive" : "text-success"}
          />
          <Metric
            label="Compile"
            value={health.compileStatus}
            tone={statusTone2(health.compileStatus)}
          />
          <Metric
            label="Startup"
            value={health.startupStatus}
            tone={statusTone2(health.startupStatus)}
          />
        </div>
        <div className="text-xs text-muted-foreground">
          Last validated {relTime(report.at)} ·{" "}
          {health.buildComplete
            ? "Build complete: all requirements done, no errors, application boots."
            : "Build not complete — completion is never decided by file count."}
        </div>
      </section>

      {cal ? (
        <section className="panel space-y-1 px-3 py-2 text-xs">
          <div>
            <span className="label-mono">Unified verdict</span> · Runtime{" "}
            <span className="font-mono font-semibold">{cal.runtimeResult}</span> · Validation{" "}
            <span className={cn("font-mono font-semibold", cal.validationResult === "BLOCKED" ? "text-destructive" : cal.validationResult === "PASS" ? "text-success" : "text-warning")}>{cal.validationResult}</span>
            {cal.runtimeOverride ? <span className="text-muted-foreground"> · static findings overridden by successful runtime</span> : null}
          </div>
          {cal.environment.length ? (
            <div className="text-muted-foreground">
              Environment limitations ({cal.environment.length}): <span className="font-mono">{cal.environment.map((e) => e.key).join(", ")}</span> — limit features, never block startup.
            </div>
          ) : null}
        </section>
      ) : null}

      {/* gate + recovery */}
      {gate.blocked ? (
        <section className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium text-destructive">
            <AlertTriangle className="size-4" /> Build BLOCKED — {gate.reasons.join(", ")}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Feature generation is stopped until the build compiles, boots and resolves every import.
          </p>
          <Button size="sm" className="mt-2" onClick={props.onRepair} disabled={props.busy}>
            <Wrench className="mr-1 size-3.5" /> Create repair task
          </Button>
        </section>
      ) : (
        <section className="rounded-md border border-success/40 bg-success/10 px-3 py-2 text-xs text-success">
          <CheckCircle2 className="mr-1 inline size-3.5" /> Validation clear — feature generation
          allowed.
        </section>
      )}

      {/* validation issues */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">
          Validation ({errors.length} errors · {warns.length} warnings)
        </h3>
        {errors.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No blocking errors.{warns.length ? ` ${warns.length} static findings are shown as warnings (one per package).` : ""}
          </p>
        ) : (
          <ul className="space-y-1">
            {errors.map((issue, i) => (
              <li key={i} className="panel flex items-start gap-2 px-3 py-2 text-xs">
                <Tag className="text-destructive">{issue.kind}</Tag>
                <span className="min-w-0 flex-1">
                  {issue.path ? <span className="font-mono">{issue.path} — </span> : null}
                  {issue.message}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 6. requirement register + traceability matrix */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Requirement register</h3>
        {requirements.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No requirements yet. Use “Extract requirements” to build the register from the prompt
            before coding starts.
          </p>
        ) : (
          <ul className="space-y-1">
            {requirements.map((req) => (
              <li key={req.id} className="panel px-3 py-2">
                <div className="flex items-start gap-2">
                  <Tag>{req.code}</Tag>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium">{req.title}</div>
                    {req.files.length ? (
                      <div className="mt-1 font-mono text-[10px] text-muted-foreground">
                        {req.files.join(" · ")}
                      </div>
                    ) : (
                      <div className="mt-1 text-[10px] text-muted-foreground">No files yet</div>
                    )}
                  </div>
                  <Select
                    value={req.status}
                    onValueChange={(v) => props.onRequirementStatus(req.id, v as RequirementStatus)}
                  >
                    <SelectTrigger
                      className={cn("h-7 w-[132px] text-[11px]", statusTone[req.status])}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_STATUSES.map((s) => (
                        <SelectItem key={s} value={s} className="text-xs">
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 2. build plan */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium">Build plan</h3>
        {!plan ? (
          <p className="text-xs text-muted-foreground">
            No plan yet. “Plan build” produces the file list, dependency list, build order and module
            dependency map before any code is generated.
          </p>
        ) : (
          <div className="space-y-3 text-xs">
            <div>
              <div className="label-mono mb-1">Files ({plan.files.length})</div>
              <ul className="space-y-1">
                {plan.files.map((f) => (
                  <li key={f.path} className="panel px-3 py-2">
                    <span className="font-mono">{f.path}</span>
                    {f.requirements.length ? (
                      <span className="ml-2 text-muted-foreground">{f.requirements.join(", ")}</span>
                    ) : null}
                    {f.purpose ? (
                      <div className="mt-0.5 text-muted-foreground">{f.purpose}</div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <div className="label-mono mb-1">Dependencies</div>
              <div className="font-mono">{plan.dependencies.join(", ") || "none"}</div>
            </div>
            <div>
              <div className="label-mono mb-1">Build order</div>
              <div className="font-mono">{plan.buildOrder.join(" → ") || "none"}</div>
            </div>
            <div>
              <div className="label-mono mb-1">Module dependency map</div>
              <ul className="space-y-0.5 font-mono">
                {plan.moduleMap.map((m) => (
                  <li key={m.path}>
                    {m.path} → {m.imports.join(", ") || "—"}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
