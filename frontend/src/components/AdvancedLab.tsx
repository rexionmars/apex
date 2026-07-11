import { useEffect, useMemo, useState } from "react";
import {
  api,
  type AnalysisRow,
  type CarcassGradeRow,
} from "@/lib/api";
import { SegmentedControl } from "@/components/ui/segmented";
import { EmptyState } from "@/components/ui/empty-state";
import { Scatter } from "@/components/charts";
import { cn } from "@/lib/utils";
import {
  summarize,
  corrMatrix,
  modeCategory,
  finishingOrdinal,
  conformationOrdinal,
  iqrOutliers,
  type CorrMethod,
  type CorrCell,
} from "@/lib/stats";

const LABELS: Record<string, string> = {
  fatPercent: "model fat %",
  egValue: "EG (exp.)",
  convPerna: "conv leg",
  convLombo: "conv loin",
  convPaleta: "conv shldr",
  conformationIndex: "conv index",
  fatThicknessMm: "fat mm",
  grMeasureMm: "GR mm",
  loinEyeAreaCm2: "LEA cm²",
  raterFinishing: "rater finish",
  raterConformation: "rater conf",
  modelFinishing: "model finish",
  modelConformation: "model conf (est.)",
};

const EXPERIMENTAL = new Set(["egValue", "modelFinishing", "modelConformation"]);

type GroupBy = "stratum" | "treatment";

export function AdvancedLab({
  rows,
  batchId,
}: {
  rows: AnalysisRow[];
  batchId: number | null;
}) {
  const [grades, setGrades] = useState<CarcassGradeRow[]>([]);
  const [method, setMethod] = useState<CorrMethod>("pearson");
  const [selected, setSelected] = useState<{ a: string; b: string } | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("stratum");

  useEffect(() => {
    if (batchId == null || !api.isBridged()) {
      setGrades([]);
      return;
    }
    api.listCarcassGrades(batchId).then(setGrades).catch(() => setGrades([]));
  }, [batchId]);

  const gradeByCarcass = useMemo(() => {
    const m = new Map<number, CarcassGradeRow>();
    for (const g of grades) m.set(g.carcassId, g);
    return m;
  }, [grades]);

  const series = useMemo(() => buildSeries(rows, gradeByCarcass), [rows, gradeByCarcass]);
  const keys = useMemo(() => Object.keys(series), [series]);
  const cells = useMemo(() => corrMatrix(series, method), [series, method]);

  // default selection: first cell with n >= 3
  const active = useMemo(() => {
    if (selected && keys.includes(selected.a) && keys.includes(selected.b)) return selected;
    const hit = cells.find((c) => c.n >= 3);
    return hit ? { a: hit.a, b: hit.b } : null;
  }, [selected, cells, keys]);

  const activeCell = active
    ? cells.find((c) => c.a === active.a && c.b === active.b)
    : undefined;

  const scatterPoints = useMemo(() => {
    if (!active) return [];
    const sa = series[active.a];
    const sb = series[active.b];
    const pts: { x: number; y: number; label?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      const x = sa[i];
      const y = sb[i];
      if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
        pts.push({ x, y, label: `#${rows[i].physicalTag}` });
      }
    }
    return pts;
  }, [active, series, rows]);

  const qc = useMemo(() => computeQC(rows, gradeByCarcass), [rows, gradeByCarcass]);
  const strata = useMemo(() => groupStats(rows, groupBy), [rows, groupBy]);

  if (rows.length === 0) {
    return (
      <EmptyState eyebrow="Lab">
        Run batch analysis first to unlock validation correlations and QC.
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* QC */}
      <div className="panel rounded-md p-3">
        <div className="eyebrow mb-2">Batch QC</div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <QCStat label="analyzed" value={String(qc.n)} />
          <QCStat label="BG removed" value={`${qc.bgPct}%`} ok={qc.bgPct >= 80} />
          <QCStat label="phys. refs" value={`${qc.physN}/${qc.n}`} ok={qc.physN > 0} />
          <QCStat label="human grades" value={`${qc.gradedN}/${qc.n}`} ok={qc.gradedN > 0} />
          <QCStat
            label="fat outliers"
            value={String(qc.outliers)}
            ok={qc.outliers === 0}
            alert={qc.outliers > 0}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <span className="status-pill text-ok">fat % validated</span>
          <span className="status-pill text-alert">EG / model grades experimental</span>
          {qc.gradedN === 0 && (
            <span className="status-pill text-muted-foreground">no rater grades in batch</span>
          )}
        </div>
      </div>

      {/* Correlation */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Correlation matrix</div>
        <SegmentedControl
          value={method}
          onChange={setMethod}
          options={[
            { value: "pearson", label: "Pearson" },
            { value: "spearman", label: "Spearman" },
          ]}
        />
      </div>

      {keys.length < 2 ? (
        <EmptyState eyebrow="Insufficient variables">
          Need at least two numeric series with overlapping values (add physical refs or grades).
        </EmptyState>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_minmax(260px,400px)]">
          <CorrHeatmap
            keys={keys}
            cells={cells}
            active={active}
            onSelect={(a, b) => setSelected({ a, b })}
          />

          <div className="panel rounded-md p-3">
            {active && activeCell ? (
              <>
                <div className="eyebrow mb-1">
                  {LABELS[active.a] ?? active.a} × {LABELS[active.b] ?? active.b}
                </div>
                <div className="telemetry mb-2 text-sm">
                  {method} r ={" "}
                  <span className={cn(Math.abs(activeCell.r) >= 0.5 && "text-primary")}>
                    {Number.isFinite(activeCell.r) ? activeCell.r.toFixed(3) : "—"}
                  </span>{" "}
                  · n={activeCell.n}
                </div>
                {(EXPERIMENTAL.has(active.a) || EXPERIMENTAL.has(active.b)) && (
                  <p className="mb-2 text-[11px] text-alert">
                    Pair includes an experimental model output — interpret with caution.
                  </p>
                )}
                {activeCell.n < 3 ? (
                  <EmptyState eyebrow="Too few pairs" className="border-0 py-4">
                    Need at least 3 paired observations for a stable correlation.
                  </EmptyState>
                ) : (
                  <Scatter
                    points={scatterPoints}
                    xLabel={LABELS[active.a] ?? active.a}
                    yLabel={LABELS[active.b] ?? active.b}
                    height={200}
                  />
                )}
              </>
            ) : (
              <EmptyState eyebrow="Select a cell" className="border-0">
                Click a matrix cell to inspect the scatter.
              </EmptyState>
            )}
          </div>
        </div>
      )}

      {/* Stratified */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="eyebrow">Stratified fat %</div>
        <SegmentedControl
          value={groupBy}
          onChange={setGroupBy}
          options={[
            { value: "stratum", label: "Stratum" },
            { value: "treatment", label: "Treatment" },
          ]}
        />
      </div>

      {strata.length === 0 ? (
        <EmptyState eyebrow="No groups">
          Fill stratum / treatment on carcasses to see group summaries.
        </EmptyState>
      ) : (
        <div className="panel-scroll overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-panel-solid text-left">
              <tr className="border-b border-hairline">
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  {groupBy}
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">n</th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  mean ± σ
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  median
                </th>
                <th className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">
                  phys. refs
                </th>
              </tr>
            </thead>
            <tbody>
              {strata.map((s) => (
                <tr key={s.key} className="border-b border-hairline/50 hover:bg-secondary/30">
                  <td className="px-3 py-1.5">{s.key || "—"}</td>
                  <td className="telemetry px-3 py-1.5">{s.n}</td>
                  <td className="telemetry px-3 py-1.5 text-primary">
                    {s.mean.toFixed(1)}% ± {s.std.toFixed(1)}
                  </td>
                  <td className="telemetry px-3 py-1.5">{s.median.toFixed(1)}%</td>
                  <td className="telemetry px-3 py-1.5 text-muted-foreground">
                    {s.physN}/{s.n}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function buildSeries(
  rows: AnalysisRow[],
  gradeByCarcass: Map<number, CarcassGradeRow>
): Record<string, (number | null)[]> {
  const out: Record<string, (number | null)[]> = {
    fatPercent: rows.map((r) => r.fatPercent),
    egValue: rows.map((r) => r.egValue),
    convPerna: rows.map((r) => r.convPerna),
    convLombo: rows.map((r) => r.convLombo),
    convPaleta: rows.map((r) => r.convPaleta),
    conformationIndex: rows.map((r) => r.conformationIndex),
    fatThicknessMm: rows.map((r) => r.fatThicknessMm),
    grMeasureMm: rows.map((r) => r.grMeasureMm),
    loinEyeAreaCm2: rows.map((r) => r.loinEyeAreaCm2),
    modelFinishing: rows.map((r) => finishingOrdinal(r.finishingClass)),
    modelConformation: rows.map((r) => conformationOrdinal(r.conformationGrade)),
  };

  const hasRater = rows.some((r) => gradeByCarcass.has(r.carcassId));
  if (hasRater) {
    out.raterFinishing = rows.map((r) => {
      const g = gradeByCarcass.get(r.carcassId);
      return g ? finishingOrdinal(modeCategory(g.finishing) ?? "") : null;
    });
    out.raterConformation = rows.map((r) => {
      const g = gradeByCarcass.get(r.carcassId);
      return g ? conformationOrdinal(modeCategory(g.conformation) ?? "") : null;
    });
  }

  // Drop series with fewer than 2 finite values (keeps matrix readable)
  for (const k of Object.keys(out)) {
    const n = out[k].filter((v) => v != null && Number.isFinite(v)).length;
    if (n < 2) delete out[k];
  }
  return out;
}

function computeQC(rows: AnalysisRow[], gradeByCarcass: Map<number, CarcassGradeRow>) {
  const n = rows.length;
  const bgN = rows.filter((r) => r.backgroundRemoved).length;
  const physN = rows.filter(
    (r) => r.fatThicknessMm != null || r.grMeasureMm != null || r.loinEyeAreaCm2 != null
  ).length;
  const gradedN = rows.filter((r) => gradeByCarcass.has(r.carcassId)).length;
  const fats = rows.map((r) => r.fatPercent);
  const outliers = iqrOutliers(fats).length;
  return {
    n,
    bgPct: n ? Math.round((bgN / n) * 100) : 0,
    physN,
    gradedN,
    outliers,
  };
}

function groupStats(rows: AnalysisRow[], by: GroupBy) {
  const map = new Map<string, AnalysisRow[]>();
  for (const r of rows) {
    const key = (by === "stratum" ? r.stratum : r.treatment)?.trim() || "";
    if (!key) continue;
    const list = map.get(key) ?? [];
    list.push(r);
    map.set(key, list);
  }
  return [...map.entries()]
    .map(([key, list]) => {
      const s = summarize(list.map((r) => r.fatPercent));
      const physN = list.filter(
        (r) => r.fatThicknessMm != null || r.grMeasureMm != null || r.loinEyeAreaCm2 != null
      ).length;
      return { key, ...s, physN };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function QCStat({
  label,
  value,
  ok,
  alert,
}: {
  label: string;
  value: string;
  ok?: boolean;
  alert?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="eyebrow">{label}</span>
      <span
        className={cn(
          "telemetry text-sm font-semibold",
          ok && "text-ok",
          alert && "text-alert"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function CorrHeatmap({
  keys,
  cells,
  active,
  onSelect,
}: {
  keys: string[];
  cells: CorrCell[];
  active: { a: string; b: string } | null;
  onSelect: (a: string, b: string) => void;
}) {
  const lookup = new Map<string, CorrCell>();
  for (const c of cells) {
    lookup.set(`${c.a}|${c.b}`, c);
    lookup.set(`${c.b}|${c.a}`, c);
  }

  function cell(a: string, b: string): CorrCell | undefined {
    if (a === b) return undefined;
    return lookup.get(`${a}|${b}`);
  }

  function bg(r: number, n: number): string {
    if (!Number.isFinite(r) || n < 3) return "transparent";
    const t = Math.min(1, Math.abs(r));
    const alpha = 0.12 + t * 0.45;
    if (r >= 0) return `rgba(177, 167, 207, ${alpha})`; // primary lavender
    return `rgba(210, 158, 175, ${alpha})`; // error rose
  }

  return (
    <div className="panel-scroll overflow-auto rounded-md border border-border">
      <table className="w-full border-collapse text-[11px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-panel-solid px-2 py-1.5" />
            {keys.map((k) => (
              <th
                key={k}
                className="max-w-[72px] truncate px-1.5 py-1.5 text-center font-normal text-muted-foreground"
                title={LABELS[k] ?? k}
              >
                {shortLabel(k)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((row) => (
            <tr key={row}>
              <th
                className="sticky left-0 max-w-[88px] truncate bg-panel-solid px-2 py-1 text-left font-normal text-muted-foreground"
                title={LABELS[row] ?? row}
              >
                {shortLabel(row)}
              </th>
              {keys.map((col) => {
                if (row === col) {
                  return (
                    <td key={col} className="bg-secondary/40 px-1 py-1 text-center text-muted-foreground">
                      —
                    </td>
                  );
                }
                const c = cell(row, col);
                const isActive =
                  active &&
                  ((active.a === row && active.b === col) ||
                    (active.a === col && active.b === row));
                const r = c?.r;
                const n = c?.n ?? 0;
                return (
                  <td key={col} className="p-0">
                    <button
                      type="button"
                      onClick={() => {
                        const hit = cell(row, col);
                        if (hit) onSelect(hit.a, hit.b);
                      }}
                      className={cn(
                        "app-no-drag flex h-8 w-full min-w-[48px] flex-col items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                        isActive && "ring-1 ring-inset ring-primary"
                      )}
                      style={{ background: bg(r ?? NaN, n) }}
                      title={`${LABELS[row]} × ${LABELS[col]}: r=${Number.isFinite(r!) ? r!.toFixed(2) : "—"} n=${n}`}
                    >
                      <span className="telemetry font-semibold">
                        {n < 3 || !Number.isFinite(r!) ? "—" : r!.toFixed(2)}
                      </span>
                      <span className="text-[9px] text-muted-foreground">n={n}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function shortLabel(k: string): string {
  const s = LABELS[k] ?? k;
  return s.length > 10 ? s.slice(0, 9) + "…" : s;
}
