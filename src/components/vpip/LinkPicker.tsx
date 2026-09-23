import { Checkbox } from "@/components/ui/checkbox";

export interface LinkOption {
  id: string;
  primary: string;
  secondary?: string;
}

export function LinkPicker({
  label,
  options,
  selected,
  onToggle,
  emptyHint,
}: {
  label: string;
  options: LinkOption[];
  selected: string[];
  onToggle: (id: string, next: boolean) => void;
  emptyHint: string;
}) {
  return (
    <div className="panel p-3">
      <div className="label-mono mb-2 flex items-center justify-between">
        <span>{label}</span>
        <span>{selected.length} linked</span>
      </div>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">{emptyHint}</p>
      ) : (
        <div className="max-h-52 space-y-1.5 overflow-y-auto pr-1">
          {options.map((o) => {
            const checked = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex cursor-pointer items-start gap-2 rounded-sm px-1.5 py-1 text-sm hover:bg-surface-2"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={checked}
                  onCheckedChange={(v) => onToggle(o.id, v === true)}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{o.primary}</span>
                  {o.secondary ? (
                    <span className="label-mono block truncate">{o.secondary}</span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
