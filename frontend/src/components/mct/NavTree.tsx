import { useEffect, useState } from "react";
import { ChevronRight, Box, Layers, FolderInput, LayoutDashboard, Beef, Radio } from "lucide-react";
import { api } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { cn } from "@/lib/utils";

// Open MCT-style navigation tree: fixed roots (Import, Dashboard) +
// data hierarchy Batches › Carcasses. Clicking selects; expanding loads children.
export function NavTree({
  selected,
  onSelect,
  refreshKey,
}: {
  selected: DomainObject | null;
  onSelect: (o: DomainObject) => void;
  refreshKey: number;
}) {
  const [batches, setBatches] = useState<DomainObject[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Record<string, DomainObject[]>>({});

  async function loadBatches() {
    try {
      const bs = await api.listBatches();
      setBatches(
        bs.map((b) => ({ type: "batch" as const, id: `batch:${b.id}`, name: b.name, batchId: b.id }))
      );
    } catch {
      /* bridge unavailable */
    }
  }

  useEffect(() => {
    loadBatches();
  }, [refreshKey]);

  async function toggle(obj: DomainObject) {
    const next = new Set(expanded);
    if (next.has(obj.id)) {
      next.delete(obj.id);
    } else {
      next.add(obj.id);
      if (obj.batchId != null && !children[obj.id]) {
        const cs = await api.listCarcasses(obj.batchId);
        setChildren((c) => ({
          ...c,
          [obj.id]: cs.map((x) => ({
            type: "carcass" as const,
            id: `carcass:${x.id}`,
            name: `#${x.physicalTag}`,
            batchId: obj.batchId,
            carcassId: x.id,
            imageCount: x.imageCount,
          })),
        }));
      }
    }
    setExpanded(next);
  }

  const roots: DomainObject[] = [
    { type: "live", id: "live", name: "Live monitor" },
    { type: "import", id: "import", name: "Import images" },
    { type: "dashboard", id: "dashboard", name: "Project dashboard" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="eyebrow px-3 pb-1.5 pt-3">Navigation</div>
      <div className="panel-scroll flex-1 overflow-auto px-1.5 pb-2">
        {/* action roots */}
        {roots.map((r) => (
          <Row
            key={r.id}
            obj={r}
            depth={0}
            selected={selected?.id === r.id}
            icon={r.type === "live" ? Radio : r.type === "import" ? FolderInput : LayoutDashboard}
            onClick={() => onSelect(r)}
          />
        ))}

        <div className="my-1.5 h-px bg-hairline" />
        <div className="eyebrow px-2 pb-1">Batches</div>

        {batches.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground">
            No batches yet. Create one in Dashboard or import images.
          </div>
        )}

        {batches.map((b) => (
          <div key={b.id}>
            <Row
              obj={b}
              depth={0}
              selected={selected?.id === b.id}
              icon={Layers}
              expandable
              expanded={expanded.has(b.id)}
              onToggle={() => toggle(b)}
              onClick={() => onSelect(b)}
            />
            {expanded.has(b.id) &&
              (children[b.id] ?? []).map((c) => (
                <Row
                  key={c.id}
                  obj={c}
                  depth={1}
                  selected={selected?.id === c.id}
                  icon={Beef}
                  badge={c.imageCount ? String(c.imageCount) : undefined}
                  onClick={() => onSelect(c)}
                />
              ))}
            {expanded.has(b.id) && (children[b.id]?.length ?? 0) === 0 && (
              <div className="py-1 pl-9 text-[11px] text-muted-foreground">no carcasses</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({
  obj,
  depth,
  selected,
  icon: Icon,
  expandable,
  expanded,
  badge,
  onToggle,
  onClick,
}: {
  obj: DomainObject;
  depth: number;
  selected: boolean;
  icon: React.ElementType;
  expandable?: boolean;
  expanded?: boolean;
  badge?: string;
  onToggle?: () => void;
  onClick: () => void;
}) {
  return (
    <div
      className={cn(
        "app-no-drag group flex h-7 cursor-pointer items-center gap-1 rounded-sm pr-2 text-sm transition-colors",
        selected ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
      style={{ paddingLeft: 6 + depth * 16 }}
      onClick={onClick}
    >
      <button
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={cn("flex size-4 items-center justify-center", !expandable && "invisible")}
      >
        <ChevronRight className={cn("size-3 transition-transform", expanded && "rotate-90")} />
      </button>
      <Icon className={cn("size-3.5 shrink-0", selected ? "text-primary" : "opacity-70")} />
      <span className="truncate">{obj.name}</span>
      {badge && (
        <span className="telemetry ml-auto rounded-sm bg-background/50 px-1 text-[10px] text-muted-foreground">
          {badge}
        </span>
      )}
    </div>
  );
}

// generic icon (fallback, not used directly)
export const _Box = Box;
