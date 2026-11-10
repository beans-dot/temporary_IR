'use client';

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  achievementRate,
  fmt,
  fmt1,
  fmtWithUnit,
  isInverseKpi,
} from '@/lib/strategic-plan/format';
import type { SpKpi } from '@/lib/strategic-plan/types';

const TARGET_COLOR = '#1d4ed8';
const ACTUAL_COLOR = '#0f766e';

interface TrendRow {
  year: number;
  target: number | null;
  actual: number | null;
  rate: number | null;
}

function asNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function trendRows(kpi: SpKpi, years: number[]): TrendRow[] {
  const inverse = isInverseKpi(kpi.kpiCode, kpi.displayCode);
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const target = asNumber(kpi.targets[year]);
      const actual = asNumber(kpi.results[year]);
      return {
        year,
        target,
        actual,
        rate: achievementRate(actual, target, inverse),
      };
    });
}

function TrendTooltip({
  active,
  payload,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TrendRow }>;
  unit: string | null;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;

  return (
    <div className="rounded-md border border-border bg-background px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-bold">{row.year}학년도</p>
      <p>목표값 {fmtWithUnit(row.target, unit)}</p>
      <p>달성값 {fmtWithUnit(row.actual, unit)}</p>
      <p>달성률 {row.rate === null ? '–' : `${fmt1(row.rate)}%`}</p>
    </div>
  );
}

export function KpiTrendChart({
  kpi,
  years,
}: {
  kpi: SpKpi;
  years: number[];
}) {
  const data = trendRows(kpi, years);
  const values = data.flatMap((row) =>
    [row.target, row.actual].filter((value): value is number => value !== null),
  );
  const label = kpi.displayCode ?? kpi.kpiCode;

  if (values.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        표시할 목표값·달성값이 없습니다.
      </p>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const lo = min >= 0 ? 0 : min;
  const hi = max === lo ? lo + 1 : max + (max - lo) * 0.08;

  return (
    <div
      className="h-52 w-full"
      role="img"
      aria-label={`${label} 연도별 목표값과 달성값 변화 추이`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="year" tick={{ fontSize: 11 }} />
          <YAxis
            tick={{ fontSize: 11 }}
            width={52}
            domain={[lo, hi]}
            tickFormatter={(value) => fmt(Number(value))}
          />
          <Tooltip
            content={<TrendTooltip unit={kpi.unit} />}
            allowEscapeViewBox={{ x: false, y: false }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar
            dataKey="actual"
            name="달성값"
            fill={ACTUAL_COLOR}
            maxBarSize={32}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          />
          <Line
            dataKey="target"
            name="목표값"
            type="linear"
            stroke={TARGET_COLOR}
            strokeWidth={2}
            dot={{ r: 3, fill: TARGET_COLOR, strokeWidth: 0 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
