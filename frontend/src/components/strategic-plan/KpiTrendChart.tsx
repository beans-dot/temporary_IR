'use client';

import {
  Bar,
  CartesianGrid,
  Cell,
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

const TARGET_COLOR = '#333333';
const UP_COLOR = '#dc2626';
const DOWN_COLOR = '#2563eb';
const FLAT_COLOR = '#a3a3a3';

interface TrendRow {
  year: number;
  target: number | null;
  actual: number | null;
  rate: number | null;
  bar: string;
}

function asNumber(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 직전 학년도 달성값보다 크면 빨강, 작으면 파랑. 같거나 비교할 값이 없으면 회색. */
function barColor(actual: number | null, previous: number | null): string {
  if (actual === null || previous === null || actual === previous) return FLAT_COLOR;
  return actual > previous ? UP_COLOR : DOWN_COLOR;
}

function trendRows(kpi: SpKpi, years: number[]): TrendRow[] {
  const inverse = isInverseKpi(kpi.kpiCode, kpi.displayCode);
  return [...years]
    .sort((a, b) => a - b)
    .map((year) => {
      const target = asNumber(kpi.targets[year]);
      const actual = asNumber(kpi.results[year]);
      const previous = asNumber(kpi.results[year - 1]);
      return {
        year,
        target,
        actual,
        rate: achievementRate(actual, target, inverse),
        bar: barColor(actual, previous),
      };
    });
}

function TrendLegend() {
  const items = [
    { label: '목표값', swatch: 'line' as const, color: TARGET_COLOR },
    { label: '전년대비 상승', swatch: 'bar' as const, color: UP_COLOR },
    { label: '전년대비 하락', swatch: 'bar' as const, color: DOWN_COLOR },
  ];
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 pt-1 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className={item.swatch === 'line' ? 'h-0.5 w-4' : 'h-2.5 w-2.5'}
            style={{ background: item.color }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
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
          <Legend content={<TrendLegend />} />
          <Bar
            dataKey="actual"
            name="달성값"
            fill={FLAT_COLOR}
            maxBarSize={32}
            radius={[2, 2, 0, 0]}
            isAnimationActive={false}
          >
            {data.map((row) => (
              <Cell key={row.year} fill={row.bar} />
            ))}
          </Bar>
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
