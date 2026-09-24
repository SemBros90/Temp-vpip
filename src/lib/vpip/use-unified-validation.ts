import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { runtimeEvents } from "@/lib/vpip/runtime/runtime.functions";
import { calibrate, evidenceFromAudit, RUNTIME_AUDIT_ACTIONS, type CalibratedReport, type RuntimeEvidence } from "@/lib/vpip/validation-calibration";
import type { AnalyzerFile } from "@/lib/vpip/repo-analyzer";
import type { RepoReport } from "@/lib/vpip/types";

/** Read-only: loads runtime audit evidence for a build and returns the unified calibrated verdict. */
export function useUnifiedVerdict(buildId: string | undefined, report: RepoReport | undefined, files: AnalyzerFile[]) {
  const events = useServerFn(runtimeEvents);
  const [ev, setEv] = useState<RuntimeEvidence | undefined>();
  useEffect(() => {
    if (!buildId) return;
    let live = true;
    events({ data: { buildId, actions: RUNTIME_AUDIT_ACTIONS, page: 0, pageSize: 200 } })
      .then((r) => live && setEv(evidenceFromAudit(r.rows as never)))
      .catch(() => live && setEv(undefined));
    return () => {
      live = false;
    };
  }, [buildId, events]);
  const cal: CalibratedReport | undefined = useMemo(() => (buildId ? calibrate(report, files, ev) : undefined), [buildId, report, files, ev]);
  return { cal, evidence: ev };
}
