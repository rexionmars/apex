import { histogram, pearson } from "@/lib/stats";

// Single-series color = system accent cyan (via CSS var).
const CYAN = "var(--color-primary)";
const INK = "var(--color-muted-foreground)";
const GRID = "var(--color-hairline)";

// Histogram of values (e.g. distribution of fat % across the batch).
export function Histogram({
  values,
  bins = 12,
  unit = "%",
  height = 160,
}: {
  values: number[];
  bins?: number;
  unit?: string;
  height?: number;
}) {
  const w = 460;
  const h = height;
  const pad = { l: 32, r: 8, t: 8, b: 24 };
  const bars = histogram(values, bins);
  if (bars.length === 0)
    return <div className="text-xs text-muted-foreground">no data</div>;
  const maxCount = Math.max(...bars.map((b) => b.count), 1);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const bw = innerW / bars.length;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="histogram">
      {/* y axis (count) */}
      {[0, 0.5, 1].map((f) => {
        const y = pad.t + innerH * (1 - f);
        return (
          <g key={f}>
            <line x1={pad.l} y1={y} x2={w - pad.r} y2={y} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 4} y={y + 3} textAnchor="end" fontSize={9} fill={INK}>
              {Math.round(maxCount * f)}
            </text>
          </g>
        );
      })}
      {/* bars: thin mark, rounded top, 2px gap */}
      {bars.map((b, i) => {
        const bh = (b.count / maxCount) * innerH;
        const x = pad.l + i * bw;
        const y = pad.t + innerH - bh;
        return (
          <rect
            key={i}
            x={x + 1}
            y={y}
            width={Math.max(bw - 2, 1)}
            height={bh}
            rx={2}
            fill={CYAN}
            opacity={0.85}
          >
            <title>
              {b.x0.toFixed(0)}–{b.x1.toFixed(0)}{unit}: {b.count}
            </title>
          </rect>
        );
      })}
      {/* x axis (min and max) */}
      <text x={pad.l} y={h - 6} fontSize={9} fill={INK}>
        {bars[0].x0.toFixed(0)}{unit}
      </text>
      <text x={w - pad.r} y={h - 6} textAnchor="end" fontSize={9} fill={INK}>
        {bars[bars.length - 1].x1.toFixed(0)}{unit}
      </text>
    </svg>
  );
}

// Scatter: model fat % (x) vs. measured physical reference (y).
export function Scatter({
  points,
  xLabel,
  yLabel,
  height = 220,
}: {
  points: { x: number; y: number; label?: string }[];
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  const w = 460;
  const h = height;
  const pad = { l: 40, r: 12, t: 12, b: 32 };
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 2)
    return (
      <div className="text-xs text-muted-foreground">
        needs ≥2 carcasses with measured physical reference
      </div>
    );

  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const xlo = Math.min(...xs), xhi = Math.max(...xs);
  const ylo = Math.min(...ys), yhi = Math.max(...ys);
  const innerW = w - pad.l - pad.r;
  const innerH = h - pad.t - pad.b;
  const sx = (x: number) => pad.l + ((x - xlo) / (xhi - xlo || 1)) * innerW;
  const sy = (y: number) => pad.t + innerH - ((y - ylo) / (yhi - ylo || 1)) * innerH;

  const { r, n } = pearson(pts.map((p) => [p.x, p.y] as [number, number]));

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="scatter">
        {/* grid */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={pad.l}
            y1={pad.t + innerH * f}
            x2={w - pad.r}
            y2={pad.t + innerH * f}
            stroke={GRID}
            strokeWidth={1}
          />
        ))}
        {/* points: ≥8px, 2px ring on the surface */}
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={CYAN} stroke="var(--color-background)" strokeWidth={1.5}>
            <title>{p.label ? `${p.label}: ` : ""}{p.x.toFixed(1)} / {p.y.toFixed(1)}</title>
          </circle>
        ))}
        {/* axes */}
        <text x={pad.l} y={h - 8} fontSize={9} fill={INK}>{xlo.toFixed(0)}</text>
        <text x={w - pad.r} y={h - 8} textAnchor="end" fontSize={9} fill={INK}>{xhi.toFixed(0)}</text>
        <text x={(pad.l + w - pad.r) / 2} y={h - 8} textAnchor="middle" fontSize={9} fill={INK}>{xLabel}</text>
        <text x={4} y={pad.t + 8} fontSize={9} fill={INK}>{yhi.toFixed(0)}</text>
        <text x={4} y={pad.t + innerH} fontSize={9} fill={INK}>{ylo.toFixed(0)}</text>
      </svg>
      <div className="telemetry text-center text-[11px] text-muted-foreground">
        Pearson r = <span className={Math.abs(r) >= 0.5 ? "text-primary" : ""}>{Number.isFinite(r) ? r.toFixed(2) : "—"}</span> · n={n} · {yLabel}
      </div>
    </div>
  );
}
