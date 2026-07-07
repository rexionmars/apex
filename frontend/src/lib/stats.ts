// Estatísticas descritivas simples para a estação de análise.

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

// Pearson r entre dois vetores pareados (ignora pares com NaN/null).
export function pearson(pairs: [number, number][]): { r: number; n: number } {
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
