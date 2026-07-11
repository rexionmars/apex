import { ChevronRight } from "lucide-react";
import type { DomainObject, ViewDef, ViewKey } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { SegmentedControl } from "@/components/ui/segmented";

// Open MCT browse bar: path (breadcrumb) on the left, view switcher on the right.
export function BrowseBar({
  path,
  views,
  activeView,
  onView,
  actions,
}: {
  path: DomainObject[];
  views: ViewDef[];
  activeView: ViewKey;
  onView: (v: ViewKey) => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between gap-4 border-b border-border bg-panel px-4">
      <div className="flex min-w-0 items-center gap-1.5 text-sm">
        {path.length === 0 ? (
          <span className="text-muted-foreground">Select an object in the navigation</span>
        ) : (
          path.map((o, i) => (
            <span key={o.id} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground" />}
              <span className={cn("truncate", i === path.length - 1 ? "font-medium text-foreground" : "text-muted-foreground")}>
                {o.name}
              </span>
            </span>
          ))
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {actions}
        {views.length > 1 && (
          <SegmentedControl
            value={activeView}
            onChange={onView}
            options={views.map((v) => ({ value: v.key, label: v.label }))}
          />
        )}
      </div>
    </div>
  );
}
