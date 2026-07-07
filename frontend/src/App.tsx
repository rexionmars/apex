import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { type DomainObject, type ViewKey, viewsFor } from "@/lib/nav";
import { TitleBar } from "@/components/TitleBar";
import { NavTree } from "@/components/mct/NavTree";
import { BrowseBar } from "@/components/mct/BrowseBar";
import { Inspector } from "@/components/mct/Inspector";
import { StatusBar } from "@/components/mct/StatusBar";
import { BatchOverview } from "@/components/mct/views/BatchOverview";
import { CarcassOverview } from "@/components/mct/views/CarcassOverview";
import { CarcassImages } from "@/components/mct/views/CarcassImages";
import { LiveMonitor } from "@/components/mct/views/LiveMonitor";
import { AnalisePage } from "@/pages/AnalisePage";
import { AvaliacaoPage } from "@/pages/AvaliacaoPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { ImportarPage } from "@/pages/ImportarPage";
import type { GlobalStats } from "@/lib/api";

// bump.fn is called by any view when data changes → reloads the tree,
// inspector, and status bar.
export const bump = { fn: () => {} };

export default function App() {
  const [selected, setSelected] = useState<DomainObject | null>(null);
  const [view, setView] = useState<ViewKey>("overview");
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState<GlobalStats | null>(null);

  const refresh = () => setRefreshKey((k) => k + 1);

  useEffect(() => {
    bump.fn = refresh;
  }, []);

  useEffect(() => {
    if (api.isBridged()) api.globalStats().then(setStats).catch(() => {});
  }, [refreshKey]);

  const views = useMemo(() => viewsFor(selected), [selected]);

  // when selecting an object, pick the first valid view
  function select(obj: DomainObject) {
    setSelected(obj);
    const vs = viewsFor(obj);
    setView(vs[0]?.key ?? "overview");
  }

  // path (breadcrumb): from the object's root down to it
  const path = useMemo<DomainObject[]>(() => {
    if (!selected) return [];
    if (selected.type === "carcass") {
      return [
        { type: "batch", id: `batch:${selected.batchId}`, name: batchName(selected.batchId, stats), batchId: selected.batchId },
        selected,
      ];
    }
    return [selected];
  }, [selected, stats]);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar stats={stats} onOpenRepo={() => api.openExternal("https://github.com/rexionmars")} />

      <div className="flex min-h-0 flex-1">
        {/* Navigation tree (left) */}
        <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
          <NavTree selected={selected} onSelect={select} refreshKey={refreshKey} />
        </nav>

        {/* Center column: browse bar + views area */}
        <div className="flex min-w-0 flex-1 flex-col">
          <BrowseBar
            path={path}
            views={views}
            activeView={view}
            onView={setView}
          />
          <main className="panel-scroll min-h-0 flex-1 overflow-auto">
            <ViewRouter
              obj={selected}
              view={view}
              onOpenCarcass={(carcassId, tag) =>
                select({ type: "carcass", id: `carcass:${carcassId}`, name: `#${tag}`, batchId: selected?.batchId, carcassId })
              }
              onChanged={refresh}
            />
          </main>
        </div>

        {/* Inspector (right) */}
        <Inspector
          obj={selected}
          collapsed={inspectorCollapsed}
          onToggle={() => setInspectorCollapsed((c) => !c)}
          refreshKey={refreshKey}
        />
      </div>

      {/* Status bar (bottom) */}
      <StatusBar refreshKey={refreshKey} />
    </div>
  );
}

function batchName(batchId: number | undefined, _stats: GlobalStats | null): string {
  return batchId ? `Batch ${batchId}` : "Batch";
}

function ViewRouter({
  obj,
  view,
  onOpenCarcass,
  onChanged,
}: {
  obj: DomainObject | null;
  view: ViewKey;
  onOpenCarcass: (carcassId: number, tag: string) => void;
  onChanged: () => void;
}) {
  if (!obj) {
    return (
      <div className="flex h-full items-center justify-center p-10 text-center">
        <div className="max-w-md">
          <div className="eyebrow mb-2">No selection</div>
          <p className="text-sm text-muted-foreground">
            Choose a <strong>batch</strong> or <strong>carcass</strong> in the navigation on the left, or
            open <strong>Import</strong> / <strong>Dashboard</strong> to get started.
          </p>
        </div>
      </div>
    );
  }

  // root objects
  if (obj.type === "live") return <LiveMonitor />;
  if (obj.type === "import") return <ImportarPage />;
  if (obj.type === "dashboard") return <DashboardPage />;

  // batch
  if (obj.type === "batch") {
    if (view === "analysis") return <AnalisePage batchId={obj.batchId ?? null} />;
    if (view === "grading") return <AvaliacaoPage batchId={obj.batchId ?? null} />;
    return <BatchOverview obj={obj} onOpenCarcass={onOpenCarcass} onChanged={onChanged} />;
  }

  // carcass
  if (obj.type === "carcass") {
    if (view === "images") return <CarcassImages obj={obj} onChanged={onChanged} />;
    if (view === "analysis") return <AnalisePage batchId={obj.batchId ?? null} focusCarcassId={obj.carcassId} />;
    return <CarcassOverview obj={obj} onChanged={onChanged} />;
  }

  return null;
}
