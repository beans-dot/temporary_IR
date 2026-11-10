import type { PivotResult } from './api';

/**
 * 조회 기간의 관측값에 대한 기초 기술통계.
 * 분산·표준편차는 표본(n−1), 왜도·첨도는 Excel SKEW·KURT와 같다.
 * 첨도는 초과첨도(정규분포 = 0), 사분위수는 PERCENTILE.INC 기준 Q3−Q1.
 */
export interface DescriptiveStats {
  count: number;
  mean: number | null;
  median: number | null;
  /** 최빈값이 없으면 null. 동률이면 모두 포함(오름차순). */
  modes: number[] | null;
  variance: number | null;
  standardDeviation: number | null;
  range: number | null;
  iqr: number | null;
  skewness: number | null;
  kurtosis: number | null;
}

export interface DescriptiveStatsRow {
  key: string;
  name: string;
  isYeonsung: boolean;
  stats: DescriptiveStats;
}

const EMPTY: DescriptiveStats = {
  count: 0,
  mean: null,
  median: null,
  modes: null,
  variance: null,
  standardDeviation: null,
  range: null,
  iqr: null,
  skewness: null,
  kurtosis: null,
};

/** 조회 기간 연도의 수치만 모은다. 결측은 제외. */
export function valuesInPeriod(
  values: Record<number, number | null | undefined>,
  years: number[],
): number[] {
  const out: number[] = [];
  for (const year of years) {
    const value = values[year];
    if (typeof value === 'number' && Number.isFinite(value)) out.push(value);
  }
  return out;
}

function meanOf(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function medianOf(sorted: number[]): number {
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  if (n % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Excel PERCENTILE.INC / Hyndman-Fan type 7.
 * p는 0~1.
 */
function percentileInc(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0];
  const rank = p * (n - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  if (lower === upper) return sorted[lower];
  const weight = rank - lower;
  return sorted[lower] + weight * (sorted[upper] - sorted[lower]);
}

function modesOf(values: number[]): number[] | null {
  const groups = new Map<string, { value: number; count: number }>();
  for (const value of values) {
    const key = Object.is(value, -0) ? '0' : String(value);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { value, count: 1 });
  }

  let maxCount = 0;
  for (const group of groups.values()) {
    if (group.count > maxCount) maxCount = group.count;
  }
  // 값이 둘 이상인데 반복이 없으면 최빈값을 두지 않는다.
  if (maxCount <= 1 && values.length > 1) return null;

  return [...groups.values()]
    .filter((group) => group.count === maxCount)
    .map((group) => group.value)
    .sort((a, b) => a - b);
}

export function computeDescriptiveStats(values: number[]): DescriptiveStats {
  const n = values.length;
  if (n === 0) return EMPTY;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = meanOf(values);
  const q1 = percentileInc(sorted, 0.25);
  const q3 = percentileInc(sorted, 0.75);

  let variance: number | null = null;
  let standardDeviation: number | null = null;
  let skewness: number | null = null;
  let kurtosis: number | null = null;

  if (n >= 2) {
    let sumSq = 0;
    for (const value of values) {
      const diff = value - mean;
      sumSq += diff * diff;
    }
    variance = sumSq / (n - 1);
    standardDeviation = Math.sqrt(variance);
  }

  const sd = standardDeviation;
  if (sd !== null && sd > 0 && n >= 3) {
    let m3 = 0;
    let m4 = 0;
    for (const value of values) {
      const z = (value - mean) / sd;
      const z2 = z * z;
      m3 += z2 * z;
      m4 += z2 * z2;
    }
    skewness = (n / ((n - 1) * (n - 2))) * m3;
    if (n >= 4) {
      const a = (n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3));
      const b = (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3));
      kurtosis = a * m4 - b;
    }
  }

  return {
    count: n,
    mean,
    median: medianOf(sorted),
    modes: modesOf(values),
    variance,
    standardDeviation,
    range: sorted[n - 1] - sorted[0],
    iqr: q3 - q1,
    skewness,
    kurtosis,
  };
}

export function descriptiveSeriesName(row: {
  targetLabel: string;
  metricName: string;
  metricUnit?: string | null;
}): string {
  const unit = row.metricUnit?.trim();
  const base = `${row.targetLabel} · ${row.metricName}`;
  return unit ? `${base} (${unit})` : base;
}

/** 피벗에 표시된 행마다 조회 기간 기준 기술통계를 만든다. */
export function descriptiveStatsFromPivot(pivot: PivotResult): DescriptiveStatsRow[] {
  return pivot.rows.map((row) => ({
    key: `${row.targetKey}-${row.metricId}`,
    name: descriptiveSeriesName(row),
    isYeonsung: row.isYeonsung,
    stats: computeDescriptiveStats(valuesInPeriod(row.values, pivot.years)),
  }));
}
