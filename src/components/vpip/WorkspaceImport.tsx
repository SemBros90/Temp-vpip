import { useRef, useState } from "react";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useVpip } from "@/lib/vpip/store";
import type { ImportReport } from "@/lib/vpip/workspace-import";

export const WorkspaceImport = () => {
  const { importWorkspace, loaded, loadError, dirty, saveState } = useVpip();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState("");
  const waiting = dirty || saveState === "saving";

  async function importFile(file: File) {
    setBusy(true);
    setError("");
    setReport(null);
    try {
      let parsed: unknown;
      try { parsed = JSON.parse(await file.text()); }
      catch { throw new Error("This file is not valid JSON. Choose workspace.json from your export. Nothing was imported."); }
      const result = await importWorkspace(parsed);
      setReport(result);
      toast.success(result.added ? `${result.added} new records imported and verified` : "No new records to import", {
        description: result.conflicts.length ? `${result.conflicts.length} conflicts kept unchanged. See the import report.` : "Existing records and settings were kept.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Import could not finish. Existing records were not replaced.";
      setError(message);
      toast.error("Import not completed", { description: message });
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <>
      <input data-testid="workspace-import-file" ref={input} type="file" accept=".json,application/json" className="hidden" aria-label="Import workspace JSON"
        onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); }} />
      <Button data-testid="workspace-import-button" size="sm" variant="outline" className="h-8" disabled={busy || !loaded || !!loadError || waiting}
        onClick={() => input.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
        {busy ? "Importing…" : "Import workspace.json safely"}
      </Button>
      <p data-testid="workspace-import-guidance" className="basis-full text-xs leading-relaxed text-muted-foreground">
        {waiting ? "Wait for your current changes to finish saving before importing. " : ""}
        Adds new records only. Conflicting records and your current settings stay unchanged. Uses the existing workspace.json format.
      </p>
      {error ? <p data-testid="workspace-import-error" role="alert" className="basis-full break-words rounded border border-destructive/40 p-3 text-sm text-destructive">{error}</p> : null}
      {report ? (
        <section data-testid="workspace-import-report" aria-label="Import results" aria-live="polite" className="min-w-0 basis-full rounded border border-border p-3 text-sm">
          <p data-testid="workspace-import-report-title" className="font-semibold">Import verified — existing data kept</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
            <span data-testid="workspace-import-added">{report.added} added</span>
            <span data-testid="workspace-import-unchanged">{report.unchanged} already present</span>
            <span data-testid="workspace-import-conflict-count">{report.conflicts.length} conflicts kept unchanged</span>
          </div>
          {report.conflicts.length ? (
            <details className="mt-3">
              <summary data-testid="workspace-import-conflicts-toggle" className="cursor-pointer font-medium">View conflicts</summary>
              <p data-testid="workspace-import-conflicts-help" className="my-2 text-xs text-muted-foreground">The existing version was kept in every case, including messages and files inside a record. The incoming versions remain in your original import file.</p>
              <ul className="max-h-64 space-y-2 overflow-y-auto">
                {report.conflicts.map((item, index) => <li data-testid={`workspace-import-conflict-${index}`} key={`${item.collection}:${item.id}`} className="break-all text-xs">
                  <strong>{item.label}</strong> · {item.collection} · ID: {item.id}
                </li>)}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
    </>
  );
};