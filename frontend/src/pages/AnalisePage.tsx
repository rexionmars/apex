import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Play, RefreshCw, Loader2, Download, LayoutGrid, Table2, GitCompare, ScatterChart, Hexagon, FlaskConical } from "lucide-react";
import {
  api,
  type InferenceProbe,
  type AnalysisRow,
} from "@/lib/api";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { AdvancedLab } from "@/components/AdvancedLab";
import { cn } from "@/lib/utils";
import { summarize } from "@/lib/stats";
import { Histogram, Scatter } from "@/components/charts";

type Tab = "galeria" | "tabela" | "conformacao" | "correlacao" | "comparar" | "lab";

const TABS: { value: Tab; label: string; icon: React.ElementType }[] = [
  { value: "galeria", label: "Gallery", icon: LayoutGrid },
  { value: "tabela", label: "Table", icon: Table2 },
  { value: "conformacao", label: "Conformation", icon: Hexagon },
  { value: "correlacao", label: "Correlation", icon: ScatterChart },
  { value: "comparar", label: "Compare", icon: GitCompare },
  { value: "lab", label: "Lab", icon: FlaskConical },
];

export function AnalisePage({ batchId, focusCarcassId }: { batchId: number | null; focusCarcassId?: number }) {
  const [probe, setProbe] = useState<InferenceProbe | null>(null);
  const [runGrade, setRunGrade] = useState(false);
  const [rows, setRows] = useState<AnalysisRow[]>([]);
  const [toAnalyze, setToAnalyze] = useState(0);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);
  const [tab, setTab] = useState<Tab>("galeria");
  const bridged = api.isBridged();

  useEffect(() => {
    if (!bridged) return;
    api.inferenceProbe().then(setProbe).catch(() => setProbe(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (ev: { current: number; total: number; done?: boolean }) => {
      setProgress({ current: ev.current, total: ev.total });
      if (ev.done) setTimeout(() => setProgress(null), 800);
    };
    EventsOn("analyze:progress", handler);
    return () => EventsOff("analyze:progress");
  }, []);

  async function refresh(id: number) {
    const [r, c] = await Promise.all([api.listAnalyses(id), api.countToAnalyze(id)]);
    setRows(r);
    setToAnalyze(c);
  }

  useEffect(() => {
    if (batchId !== null) refresh(batchId).catch((e) => toast.error(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batchId]);

  async function analyzeBatch(reanalyze: boolean) {
    if (batchId === null) return;
    setProgress({ current: 0, total: reanalyze ? rows.length : toAnalyze });
    try {
      const done = await api.analyzeBatch(batchId, runGrade, reanalyze);
      await refresh(batchId);
      toast.success(`${done} image(s) analyzed.`);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setProgress(null);
    }
  }

  const fatValues = useMemo(() => rows.map((r) => r.fatPercent), [rows]);
  const summary = useMemo(() => summarize(fatValues), [fatValues]);

  function exportCsv() {
    const header = [
      "physical_tag", "fat_percent", "background_removed", "finishing_class",
      "eg_value", "conv_leg", "conv_loin", "conv_shoulder", "conformation_index",
      "conformation_grade_estimate", "fat_thickness_mm", "gr_measure_mm",
      "loin_eye_area_cm2", "analyzed_at",
    ];
    const lines = rows.map((r) =>
      [
        r.physicalTag, r.fatPercent.toFixed(2), r.backgroundRemoved ? 1 : 0,
        r.finishingClass, r.egValue ?? "",
        r.convPerna ?? "", r.convLombo ?? "", r.convPaleta ?? "",
        r.conformationIndex ?? "", r.conformationGrade,
        r.fatThicknessMm ?? "", r.grMeasureMm ?? "", r.loinEyeAreaCm2 ?? "", r.analyzedAt,
      ].join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "analyses.csv";
    a.click();
  }

  if (!bridged) {
    return (
      <div className="p-5">
        <EmptyState eyebrow="Bridge required">
          This screen must run inside the app (<code>wails dev</code> or a compiled binary).
        </EmptyState>
      </div>
    );
  }

  const busy = progress !== null;

  return (
    <div className="flex flex-col gap-4 p-5">
      {/* action strip */}
      <div className="panel flex flex-col gap-2.5 rounded-md p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={runGrade} onChange={(e) => setRunGrade(e.target.checked)} />
            include grade (experimental)
          </label>

          <div className="ml-auto flex items-center gap-2">
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="size-4" /> CSV
              </Button>
            )}
            <Button
              size="sm"
              onClick={() => analyzeBatch(false)}
              disabled={busy || !probe?.available || toAnalyze === 0}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Analyze {toAnalyze > 0 && `(${toAnalyze})`}
            </Button>
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => analyzeBatch(true)} disabled={busy || !probe?.available}>
                <RefreshCw className="size-4" /> Reanalyze
              </Button>
            )}
          </div>
        </div>

        {progress && (
          <div className="flex flex-col gap-1">
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="telemetry text-[11px] text-muted-foreground">
              analyzing {progress.current} of {progress.total}…
            </div>
          </div>
        )}
      </div>

      {/* compact telemetry strip */}
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-sm border border-border bg-background/30 px-3 py-2">
          <StatInline label="n" value={String(summary.n)} />
          <StatInline label="mean" value={`${summary.mean.toFixed(1)}%`} accent />
          <StatInline label="σ" value={`±${summary.std.toFixed(1)}`} />
          <StatInline label="med" value={`${summary.median.toFixed(1)}%`} />
          <StatInline label="range" value={`${summary.min.toFixed(1)}–${summary.max.toFixed(1)}`} />
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {probe?.available ? (
              <span className="status-pill text-ok">engine · {probe.device}</span>
            ) : (
              <span className="status-pill text-alert">engine offline</span>
            )}
            <span className="status-pill text-primary">{rows.length} analyzed</span>
            {rows.some((r) => r.finishingClass) && (
              <span className="status-pill text-alert">
                grade · {rows.filter((r) => r.finishingClass).length}/{rows.length}
              </span>
            )}
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          eyebrow="No analysis"
          action={
            toAnalyze > 0 ? (
              <Button
                size="sm"
                onClick={() => analyzeBatch(false)}
                disabled={busy || !probe?.available}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
                Analyze batch ({toAnalyze})
              </Button>
            ) : undefined
          }
        >
          {toAnalyze > 0
            ? `No analysis yet. Process ${toAnalyze} image(s) in this batch.`
            : "No images in this batch to analyze. Import or capture photos first."}
        </EmptyState>
      ) : (
        <>
          <SegmentedControl
            value={tab}
            onChange={setTab}
            options={TABS}
            className="self-start"
          />

          {tab === "galeria" && <Galeria rows={rows} focusCarcassId={focusCarcassId} />}
          {tab === "tabela" && <TabelaDist rows={rows} values={fatValues} focusCarcassId={focusCarcassId} />}
          {tab === "conformacao" && <Conformacao rows={rows} />}
          {tab === "correlacao" && <Correlacao rows={rows} />}
          {tab === "comparar" && <Comparar rows={rows} />}
          {tab === "lab" && <AdvancedLab rows={rows} batchId={batchId} />}
        </>
      )}
    </div>
  );
}

function StatInline({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="eyebrow">{label}</span>
      <span className={cn("telemetry text-sm font-semibold", accent && "text-primary")}>{value}</span>
    </div>
  );
}

function useFocusHighlight(focused: boolean) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!focused || !ref.current) return;
    ref.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [focused]);
  return ref;
}

// ---- Gallery ----
function Galeria({ rows, focusCarcassId }: { rows: AnalysisRow[]; focusCarcassId?: number }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
      {rows.map((r) => (
        <GalleryCard key={r.id} row={r} focused={focusCarcassId === r.carcassId} />
      ))}
    </div>
  );
}

function GalleryCard({ row: r, focused }: { row: AnalysisRow; focused: boolean }) {
  const ref = useFocusHighlight(focused);
  return (
    <div
      ref={ref as React.RefObject<HTMLDivElement>}
      className={cn(
        "panel overflow-hidden rounded-md transition-colors",
        focused && "ring-1 ring-primary"
      )}
    >
      <div className="aspect-square bg-black/40">
        {r.overlayUrl ? (
          <img src={r.overlayUrl} className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">no overlay</div>
        )}
      </div>
      <div className="flex items-center justify-between p-2">
        <span className="telemetry text-xs">#{r.physicalTag}</span>
        <span className="telemetry text-sm font-semibold text-primary">{r.fatPercent.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ---- Table + distribution ----
function TabelaDist({
  rows,
  values,
  focusCarcassId,
}: {
  rows: AnalysisRow[];
  values: number[];
  focusCarcassId?: number;
}) {
  const [sortKey, setSortKey] = useState<"tag" | "fat">("fat");
  const sorted = useMemo(() => {
    const s = [...rows];
    if (sortKey === "fat") s.sort((a, b) => b.fatPercent - a.fatPercent);
    else s.sort((a, b) => a.physicalTag.localeCompare(b.physicalTag));
    return s;
  }, [rows, sortKey]);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(280px,420px)]">
      <div className="panel-scroll max-h-[520px] overflow-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-panel-solid text-left">
            <tr className="border-b border-hairline">
              <Th onClick={() => setSortKey("tag")} active={sortKey === "tag"}>Carcass</Th>
              <Th onClick={() => setSortKey("fat")} active={sortKey === "fat"}>Fat %</Th>
              <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Grade</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Fat mm</th>
              <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">LEA cm²</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <TableRow key={r.id} row={r} focused={focusCarcassId === r.carcassId} />
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel rounded-md p-3">
        <div className="eyebrow mb-2">Batch fat distribution</div>
        <Histogram values={values} />
      </div>
    </div>
  );
}

function TableRow({ row: r, focused }: { row: AnalysisRow; focused: boolean }) {
  const ref = useFocusHighlight(focused);
  return (
    <tr
      ref={ref as React.RefObject<HTMLTableRowElement>}
      className={cn(
        "border-b border-hairline/50 hover:bg-secondary/30",
        focused && "bg-primary/15"
      )}
    >
      <td className="telemetry px-3 py-1.5">#{r.physicalTag}</td>
      <td className="telemetry px-3 py-1.5 text-primary">{r.fatPercent.toFixed(1)}</td>
      <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.finishingClass || "—"}</td>
      <td className="telemetry px-3 py-1.5 text-xs">{r.fatThicknessMm ?? "—"}</td>
      <td className="telemetry px-3 py-1.5 text-xs">{r.loinEyeAreaCm2 ?? "—"}</td>
    </tr>
  );
}

function Th({ children, onClick, active }: { children: React.ReactNode; onClick: () => void; active: boolean }) {
  return (
    <th
      onClick={onClick}
      className={cn(
        "cursor-pointer select-none px-3 py-2 text-xs uppercase tracking-wide",
        active ? "text-primary" : "text-muted-foreground"
      )}
    >
      {children} {active ? "▾" : ""}
    </th>
  );
}

// ---- Conformation (integral-invariant convexity) ----
function Conformacao({ rows }: { rows: AnalysisRow[] }) {
  const withConf = rows.filter((r) => r.conformationMap || r.conformationIndex != null);

  if (withConf.length === 0) {
    return (
      <EmptyState eyebrow="No conformation">
        Conformation runs during analysis when the background is removed. Re-run the batch analysis.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-sm border border-alert/30 bg-alert/5 p-2 text-[11px] text-muted-foreground">
        Integral-invariant convexity of the carcass profile (leg / loin / shoulder). Blue = convex,
        red = concave. Indices are objective; the estimated grade is <strong>not validated</strong>.
      </p>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
        {withConf.map((r) => (
          <div key={r.id} className="panel overflow-hidden rounded-md">
            <div className="aspect-square bg-black/40">
              {r.conformationUrl ? (
                <img src={r.conformationUrl} className="h-full w-full object-contain" />
              ) : (
                <div className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                  no map
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5 p-2.5">
              <div className="flex items-center justify-between">
                <span className="telemetry text-sm">#{r.physicalTag}</span>
                {r.conformationGrade && (
                  <span className="status-pill text-alert">{r.conformationGrade} · est.</span>
                )}
              </div>
              <div className="telemetry grid grid-cols-3 gap-1 text-[11px]">
                <RegionConv label="leg" v={r.convPerna} />
                <RegionConv label="loin" v={r.convLombo} />
                <RegionConv label="shldr" v={r.convPaleta} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RegionConv({ label, v }: { label: string; v: number | null }) {
  const val = v ?? 0;
  const color = val >= 0.02 ? "text-primary" : val <= -0.005 ? "text-error" : "text-muted-foreground";
  return (
    <div className="rounded-sm bg-background/40 px-1.5 py-1 text-center">
      <div className="text-[9px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn("font-semibold", color)}>{v != null ? val.toFixed(3) : "—"}</div>
    </div>
  );
}

// ---- Correlation with physical reference ----
function Correlacao({ rows }: { rows: AnalysisRow[] }) {
  const fatPoints = rows
    .filter((r) => r.fatThicknessMm != null)
    .map((r) => ({ x: r.fatPercent, y: r.fatThicknessMm as number, label: `#${r.physicalTag}` }));
  const aolPoints = rows
    .filter((r) => r.loinEyeAreaCm2 != null)
    .map((r) => ({ x: r.fatPercent, y: r.loinEyeAreaCm2 as number, label: `#${r.physicalTag}` }));

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-sm border border-alert/30 bg-alert/5 p-2 text-[11px] text-muted-foreground">
        Tests whether model fat % predicts the physical reference. Fill physical reference in each
        carcass Overview.
      </p>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="panel rounded-md p-3">
          <div className="eyebrow mb-2">Model fat × fat thickness</div>
          <Scatter points={fatPoints} xLabel="model fat (%)" yLabel="fat thickness (mm)" />
        </div>
        <div className="panel rounded-md p-3">
          <div className="eyebrow mb-2">Model fat × loin eye area</div>
          <Scatter points={aolPoints} xLabel="model fat (%)" yLabel="LEA (cm²)" />
        </div>
      </div>
    </div>
  );
}

// ---- Side-by-side comparison ----
function Comparar({ rows }: { rows: AnalysisRow[] }) {
  const [sel, setSel] = useState<number[]>([]);
  function toggle(id: number) {
    setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 4 ? [...s, id] : s));
  }
  const chosen = rows.filter((r) => sel.includes(r.id));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {rows.map((r) => (
          <button
            key={r.id}
            onClick={() => toggle(r.id)}
            className={cn(
              "telemetry rounded-sm border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
              sel.includes(r.id)
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-secondary"
            )}
          >
            #{r.physicalTag}
          </button>
        ))}
      </div>
      {chosen.length === 0 ? (
        <EmptyState eyebrow="Compare">Select up to 4 carcasses to compare side by side.</EmptyState>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${chosen.length}, minmax(0,1fr))` }}>
          {chosen.map((r) => (
            <div key={r.id} className="panel overflow-hidden rounded-md">
              <div className="aspect-square bg-black/40">
                {r.overlayUrl && <img src={r.overlayUrl} className="h-full w-full object-contain" />}
              </div>
              <div className="flex flex-col gap-0.5 p-2">
                <span className="telemetry text-sm">#{r.physicalTag}</span>
                <span className="telemetry text-lg font-semibold text-primary">{r.fatPercent.toFixed(1)}%</span>
                {r.finishingClass && (
                  <span className="text-[11px] text-alert">grade: {r.finishingClass}</span>
                )}
                {r.fatThicknessMm != null && (
                  <span className="telemetry text-[11px] text-muted-foreground">fat {r.fatThicknessMm}mm</span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
