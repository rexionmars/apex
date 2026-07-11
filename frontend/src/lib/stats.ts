// Estatísticas descritivas e correlação para a estação de análise / Lab.

export interface Summary {
  n: number;
  mean: number;
  std: number;
  min: number;
  max: number;
  median: number;
}

export function summarize(xs: number[]): Summary {
  const n = xs.length;
  if (n === 0) return { n: 0, mean: 0, std: 0, min: 0, max: 0, median: 0 };
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const median =
    n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return { n, mean, std: Math.sqrt(variance), min: sorted[0], max: sorted[n - 1], median };
}

export type CorrMethod = "pearson" | "spearman";

export interface CorrResult {
  r: number;
  n: number;
}

// Pearson r entre dois vetores pareados (ignora pares com NaN/null).
export function pearson(pairs: [number, number][]): CorrResult {
  const clean = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  const n = clean.length;
  if (n < 3) return { r: NaN, n };
  const mx = clean.reduce((s, [a]) => s + a, 0) / n;
  const my = clean.reduce((s, [, b]) => s + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [a, b] of clean) {
    sxy += (a - mx) * (b - my);
    sxx += (a - mx) ** 2;
    syy += (b - my) ** 2;
  }
  const d = Math.sqrt(sxx * syy);
  return { r: d === 0 ? NaN : sxy / d, n };
}

// Average ranks with ties (mid-rank).
function ranks(xs: number[]): number[] {
  const indexed = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j < indexed.length && indexed[j].v === indexed[i].v) j++;
    const avg = (i + j - 1) / 2 + 1; // 1-based mid-rank
    for (let k = i; k < j; k++) out[indexed[k].i] = avg;
    i = j;
  }
  return out;
}

export function spearman(pairs: [number, number][]): CorrResult {
  const clean = pairs.filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (clean.length < 3) return { r: NaN, n: clean.length };
  const rx = ranks(clean.map(([a]) => a));
  const ry = ranks(clean.map(([, b]) => b));
  return pearson(rx.map((x, i) => [x, ry[i]] as [number, number]));
}

export function correlate(pairs: [number, number][], method: CorrMethod = "pearson"): CorrResult {
  return method === "spearman" ? spearman(pairs) : pearson(pairs);
}

export interface CorrCell {
  a: string;
  b: string;
  r: number;
  n: number;
  method: CorrMethod;
}

/** Pairwise correlation for aligned series (same index = same carcass). */
export function corrMatrix(
  series: Record<string, (number | null)[]>,
  method: CorrMethod = "pearson"
): CorrCell[] {
  const keys = Object.keys(series);
  const cells: CorrCell[] = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = keys[i];
      const b = keys[j];
      const sa = series[a];
      const sb = series[b];
      const len = Math.min(sa.length, sb.length);
      const pairs: [number, number][] = [];
      for (let k = 0; k < len; k++) {
        const x = sa[k];
        const y = sb[k];
        if (x != null && y != null && Number.isFinite(x) && Number.isFinite(y)) {
          pairs.push([x, y]);
        }
      }
      const { r, n } = correlate(pairs, method);
      cells.push({ a, b, r, n, method });
    }
  }
  return cells;
}

/** Category with the most votes; null if empty. */
export function modeCategory(votes: Record<string, number>): string | null {
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of Object.entries(votes)) {
    if (!k || n <= 0) continue;
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

/** Magro/Escasso/Mediano → 1..3; numeric strings pass through. */
export function finishingOrdinal(label: string): number | null {
  if (!label) return null;
  const map: Record<string, number> = {
    magro: 1,
    escasso: 2,
    mediano: 3,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
  };
  const v = map[label.trim().toLowerCase()];
  return v ?? null;
}

/** Inferior…Excelente or 1..5 → ordinal. */
export function conformationOrdinal(label: string): number | null {
  if (!label) return null;
  const map: Record<string, number> = {
    inferior: 1,
    regular: 2,
    boa: 3,
    muito: 4,
    "muito boa": 4,
    excelente: 5,
    "1": 1,
    "2": 2,
    "3": 3,
    "4": 4,
    "5": 5,
  };
  const key = label.trim().toLowerCase();
  if (map[key] != null) return map[key];
  // "Muito boa" variants
  if (key.includes("excelente")) return 5;
  if (key.includes("muito")) return 4;
  if (key.includes("boa")) return 3;
  if (key.includes("regular")) return 2;
  if (key.includes("inferior")) return 1;
  return null;
}

/** Fat % outliers via Tukey IQR (1.5×). */
export function iqrOutliers(xs: number[]): number[] {
  if (xs.length < 4) return [];
  const sorted = [...xs].sort((a, b) => a - b);
  const q = (p: number) => {
    const i = (sorted.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi ? sorted[lo] : sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
  };
  const q1 = q(0.25);
  const q3 = q(0.75);
  const iqr = q3 - q1;
  const lo = q1 - 1.5 * iqr;
  const hi = q3 + 1.5 * iqr;
  return xs.filter((v) => v < lo || v > hi);
}

// Histograma: bins uniformes entre min e max.
export function histogram(xs: number[], bins = 12): { x0: number; x1: number; count: number }[] {
  if (xs.length === 0) return [];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const span = hi - lo || 1;
  const w = span / bins;
  const out = Array.from({ length: bins }, (_, i) => ({
    x0: lo + i * w,
    x1: lo + (i + 1) * w,
    count: 0,
  }));
  for (const v of xs) {
    let i = Math.floor((v - lo) / w);
    if (i >= bins) i = bins - 1;
    if (i < 0) i = 0;
    out[i].count++;
  }
  return out;
}
