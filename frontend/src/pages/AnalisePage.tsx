import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Cpu, Play, RefreshCw, Loader2, Download, LayoutGrid, Table2, GitCompare, ScatterChart, Hexagon } from "lucide-react";
import {
  api,
  type Batch,
  type InferenceProbe,
  type AnalysisRow,
} from "@/lib/api";
import { EventsOn, EventsOff } from "../../wailsjs/runtime/runtime";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { summarize } from "@/lib/stats";
import { Histogram, Scatter } from "@/components/charts";

type Tab = "galeria" | "tabela" | "conformacao" | "correlacao" | "comparar";

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
      <div className="mx-auto max-w-2xl rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
        This screen must run inside the app (<code>wails dev</code> or a compiled binary).
      </div>
    );
  }

  const busy = progress !== null;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 p-6">
      {/* analysis controls (the batch comes from navigation) */}
      <div className="panel flex flex-col gap-3 rounded-md p-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={runGrade} onChange={(e) => setRunGrade(e.target.checked)} />
            include grade (experimental)
          </label>

          <div className="ml-auto flex items-center gap-2">
            {rows.length > 0 && (
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="size-4" /> CSV
              </Button>
            )}
            <Button onClick={() => analyzeBatch(false)} disabled={busy || !probe?.available || toAnalyze === 0}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              Analyze batch {toAnalyze > 0 && `(${toAnalyze})`}
            </Button>
            {rows.length > 0 && (
              <Button variant="outline" onClick={() => analyzeBatch(true)} disabled={busy || !probe?.available}>
                <RefreshCw className="size-4" /> Reanalyze
              </Button>
            )}
          </div>
        </div>

        {progress && (
          <div className="flex flex-col gap-1">
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }}
              />
            </div>
            <div className="telemetry text-[11px] text-muted-foreground">
              analyzing {progress.current} of {progress.total}…
            </div>
          </div>
        )}
      </div>

      {/* batch statistics */}
      {rows.length > 0 && (
        <>
          <div className="grid grid-cols-6 gap-3">
            <Stat label="carcasses" value={String(summary.n)} />
            <Stat label="mean fat" value={`${summary.mean.toFixed(1)}%`} accent />
            <Stat label="std dev" value={`±${summary.std.toFixed(1)}`} />
            <Stat label="median" value={`${summary.median.toFixed(1)}%`} />
            <Stat label="min" value={`${summary.min.toFixed(1)}%`} />
            <Stat label="max" value={`${summary.max.toFixed(1)}%`} />
          </div>
          {/* status readout (Open MCT color code: color = state, with label) */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="status-pill text-ok">validated segmentation · IoU 0.92</span>
            <span className="status-pill text-alert">experimental grade · n=22</span>
            <span className="status-pill text-primary">analysis saved to batch</span>
          </div>
        </>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
          {toAnalyze > 0
            ? `No analysis yet. Click Analyze batch to process ${toAnalyze} image(s).`
            : "No images in this batch to analyze. Import or capture photos first."}
        </div>
      ) : (
        <>
          {/* tabs */}
          <div className="flex gap-1 border-b border-hairline">
            <TabBtn active={tab === "galeria"} onClick={() => setTab("galeria")} icon={LayoutGrid}>Gallery</TabBtn>
            <TabBtn active={tab === "tabela"} onClick={() => setTab("tabela")} icon={Table2}>Table + distribution</TabBtn>
            <TabBtn active={tab === "conformacao"} onClick={() => setTab("conformacao")} icon={Hexagon}>Conformation</TabBtn>
            <TabBtn active={tab === "correlacao"} onClick={() => setTab("correlacao")} icon={ScatterChart}>Physical correlation</TabBtn>
            <TabBtn active={tab === "comparar"} onClick={() => setTab("comparar")} icon={GitCompare}>Compare</TabBtn>
          </div>

          {tab === "galeria" && <Galeria rows={rows} />}
          {tab === "tabela" && <TabelaDist rows={rows} values={fatValues} />}
          {tab === "conformacao" && <Conformacao rows={rows} />}
          {tab === "correlacao" && <Correlacao rows={rows} />}
          {tab === "comparar" && <Comparar rows={rows} />}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="panel rounded-lg p-2.5">
      <div className="eyebrow">{label}</div>
      <div className={cn("telemetry mt-0.5 text-xl font-semibold", accent && "text-primary")}>{value}</div>
    </div>
  );
}

function TabBtn({
  active, onClick, icon: Icon, children,
}: { active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors",
        active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
      )}
    >
      <Icon className="size-3.5" /> {children}
    </button>
  );
}

// ---- Gallery ----
function Galeria({ rows }: { rows: AnalysisRow[] }) {
  return (
    <div className="grid grid-cols-4 gap-3">
      {rows.map((r) => (
        <div key={r.id} className="panel overflow-hidden rounded-lg">
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
      ))}
    </div>
  );
}

// ---- Table + distribution ----
function TabelaDist({ rows, values }: { rows: AnalysisRow[]; values: number[] }) {
  const [sortKey, setSortKey] = useState<"tag" | "fat">("fat");
  const sorted = useMemo(() => {
    const s = [...rows];
    if (sortKey === "fat") s.sort((a, b) => b.fatPercent - a.fatPercent);
    else s.sort((a, b) => a.physicalTag.localeCompare(b.physicalTag));
    return s;
  }, [rows, sortKey]);

  return (
    <div className="grid grid-cols-[1fr_460px] gap-4">
      <div className="panel-scroll max-h-[520px] overflow-auto rounded-lg border border-border">
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
              <tr key={r.id} className="border-b border-hairline/50 hover:bg-secondary/30">
                <td className="telemetry px-3 py-1.5">#{r.physicalTag}</td>
                <td className="telemetry px-3 py-1.5 text-primary">{r.fatPercent.toFixed(1)}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.finishingClass || "—"}</td>
                <td className="telemetry px-3 py-1.5 text-xs">{r.fatThicknessMm ?? "—"}</td>
                <td className="telemetry px-3 py-1.5 text-xs">{r.loinEyeAreaCm2 ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel rounded-lg p-3">
        <div className="eyebrow mb-2">Batch fat distribution</div>
        <Histogram values={values} />
      </div>
    </div>
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
      <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No conformation results yet. Conformation runs during analysis when the background is
        removed (a clean silhouette is required). Re-run the batch analysis.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="rounded-md border border-terra/30 bg-terra/5 p-2 text-[11px] text-muted-foreground">
        Integral-invariant convexity of the carcass profile, per anatomical region (leg / loin /
        shoulder). Blue = convex (muscled), red = concave. The convexity map and indices are{" "}
        <strong>objective measures</strong>; the estimated grade is <strong>not validated</strong> —
        research showed conformation is not reliably recoverable from a single 2D image at this
        sample size. Use it as an indicative reference, to be validated as the paired dataset grows.
      </p>

      <div className="grid grid-cols-3 gap-3">
        {withConf.map((r) => (
          <div key={r.id} className="panel overflow-hidden rounded-lg">
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
                  <span className="status-pill text-terra">{r.conformationGrade} · est.</span>
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
      <p className="rounded-md border border-terra/30 bg-terra/5 p-2 text-[11px] text-muted-foreground">
        Tests whether the model's fat % (surface image) predicts the physical reference measured
        on the animal. Fill in the physical reference in each carcass's Overview.
      </p>
      <div className="grid grid-cols-2 gap-4">
        <div className="panel rounded-lg p-3">
          <div className="eyebrow mb-2">Model fat × fat thickness</div>
          <Scatter points={fatPoints} xLabel="model fat (%)" yLabel="fat thickness (mm)" />
        </div>
        <div className="panel rounded-lg p-3">
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
              "telemetry rounded-md border px-2 py-1 text-xs transition-colors",
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
        <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          Select up to 4 carcasses to compare side by side.
        </div>
      ) : (
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${chosen.length}, minmax(0,1fr))` }}>
          {chosen.map((r) => (
            <div key={r.id} className="panel overflow-hidden rounded-lg">
              <div className="aspect-square bg-black/40">
                {r.overlayUrl && <img src={r.overlayUrl} className="h-full w-full object-contain" />}
              </div>
              <div className="flex flex-col gap-0.5 p-2">
                <span className="telemetry text-sm">#{r.physicalTag}</span>
                <span className="telemetry text-lg font-semibold text-primary">{r.fatPercent.toFixed(1)}%</span>
                {r.finishingClass && (
                  <span className="text-[11px] text-terra">grade: {r.finishingClass}</span>
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
