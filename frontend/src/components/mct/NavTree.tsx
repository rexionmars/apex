import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Layers, FolderInput, LayoutDashboard, Beef, Radio, Plus } from "lucide-react";
import { api } from "@/lib/api";
import type { DomainObject } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/empty-state";
import { bump } from "@/App";

// Open MCT-style navigation tree: fixed roots + Batches › Carcasses.
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
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function loadBatches() {
    setLoading(true);
    try {
      const bs = await api.listBatches();
      setBatches(
        bs.map((b) => ({ type: "batch" as const, id: `batch:${b.id}`, name: b.name, batchId: b.id }))
      );
    } catch {
      /* bridge unavailable */
    } finally {
      setLoading(false);
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

  async function createBatch() {
    const name = newName.trim() || `Batch ${new Date().toISOString().slice(0, 10)}`;
    setCreating(true);
    try {
      const b = await api.createBatch({ name });
      setNewName("");
      setShowCreate(false);
      bump.fn();
      await loadBatches();
      onSelect({ type: "batch", id: `batch:${b.id}`, name: b.name, batchId: b.id });
      toast.success(`Batch "${b.name}" created.`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setCreating(false);
    }
  }

  const roots: DomainObject[] = [
    { type: "live", id: "live", name: "Live monitor" },
    { type: "import", id: "import", name: "Import images" },
    { type: "dashboard", id: "dashboard", name: "Project dashboard" },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="eyebrow px-3 pb-1.5 pt-3">Navigation</div>
      <div className="panel-scroll flex-1 overflow-auto px-1.5 pb-2" role="tree">
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
        <div className="flex items-center justify-between px-2 pb-1">
          <div className="eyebrow">Batches</div>
          <button
            type="button"
            title="New batch"
            onClick={() => setShowCreate((v) => !v)}
            className="app-no-drag flex size-5 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {showCreate && (
          <div className="mb-2 flex gap-1 px-1.5">
            <Input
              className="h-7 text-xs"
              placeholder="Batch name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createBatch()}
              autoFocus
            />
            <Button size="sm" onClick={createBatch} disabled={creating}>
              Add
            </Button>
          </div>
        )}

        {loading && (
          <div className="px-3 py-2">
            <div className="loading-line" />
          </div>
        )}

        {!loading && batches.length === 0 && (
          <EmptyState
            eyebrow="No batches"
            className="mx-1 border-dashed px-3 py-4"
            action={
              <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
                <Plus className="size-3.5" /> Create batch
              </Button>
            }
          >
            Create a batch to register carcasses, or import images.
          </EmptyState>
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
            {expanded.has(b.id) && children[b.id] !== undefined && children[b.id].length === 0 && (
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
      role="treeitem"
      aria-selected={selected}
      tabIndex={0}
      className={cn(
        "app-no-drag group flex h-7 cursor-pointer items-center gap-1 rounded-sm pr-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
        selected ? "bg-primary/25 text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
      )}
      style={{ paddingLeft: 6 + depth * 16 }}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
        if (e.key === "ArrowRight" && expandable && !expanded) {
          e.preventDefault();
          onToggle?.();
        }
        if (e.key === "ArrowLeft" && expandable && expanded) {
          e.preventDefault();
          onToggle?.();
        }
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        onClick={(e) => {
          e.stopPropagation();
          onToggle?.();
        }}
        className={cn(
          "flex size-4 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          !expandable && "invisible"
        )}
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
