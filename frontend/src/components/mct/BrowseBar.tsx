import { ChevronRight } from "lucide-react";
import type { DomainObject, ViewDef, ViewKey } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Open MCT browse bar: path (breadcrumb) on the left, view switcher on the right.
// The selected object defines the path and the available views.
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
      {/* breadcrumb */}
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
        {/* view switcher */}
        {views.length > 1 && (
          <div className="flex items-center gap-0.5 rounded-sm border border-border bg-background/40 p-0.5">
            {views.map((v) => (
              <button
                key={v.key}
                onClick={() => onView(v.key)}
                className={cn(
                  "app-no-drag rounded-[2px] px-2.5 py-1 text-xs transition-colors",
                  activeView === v.key
                    ? "bg-primary/25 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
