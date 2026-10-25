'use client';

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber, formatValueWithUnit } from '@/lib/dataFormatters';
import type { YearValueMap } from '@/lib/monitoring/types';

/** 회계 금액은 원 단위 전체가 축에 잘리므로 억·만으로 줄여 표시한다. 툴팁은 원 그대로. */
function formatAxisTick(value: number, unit: string | null): string {
  if (!Number.isFinite(value)) return '';
  const abs = Math.abs(value);
  if (unit === '원' && abs >= 100_000_000) {
    const eok = value / 100_000_000;
    return `${eok.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}억`;
  }
  if (unit === '원' && abs >= 10_000) {
    const man = value / 10_000;
    return `${man.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만`;
  }
  return formatNumber(value);
}

function yAxisWidth(
  data: Array<{ value: number | null; second?: number | null }>,
  unit: string | null,
): number {
  const peak = data.reduce((max, row) => {
    for (const value of [row.value, row.second]) {
      if (typeof value === 'number' && Number.isFinite(value)) {
        max = Math.max(max, Math.abs(value));
      }
    }
    return max;
  }, 0);
  const longest = [formatAxisTick(0, unit), formatAxisTick(peak, unit)].reduce(
    (max, label) => Math.max(max, label.length),
    1,
  );
  return Math.min(148, Math.max(52, Math.ceil(longest * 8 + 16)));
}

export function MonitoringTrendChart({
  years,
  values,
  unit,
  label,
  second,
}: {
  years: number[];
  values: YearValueMap;
  unit: string | null;
  label: string;
  second?: { values: YearValueMap; label: string };
}) {
  const data = years.map((year) => ({
    year,
    value: values[year] ?? null,
    second: second ? (second.values[year] ?? null) : undefined,
  }));

  const axisWidth = yAxisWidth(data, unit);

  return (
    <div className="h-64 w-full min-w-0">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart
          data={data}
          margin={{ top: 16, right: 20, left: 4, bottom: 4 }}
        >
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis
            dataKey="year"
            tick={{ fontSize: 12 }}
            padding={{ left: 28, right: 28 }}
          />
          <YAxis
            width={axisWidth}
            tick={{ fontSize: 12 }}
            tickFormatter={(v) =>
              formatAxisTick(typeof v === 'number' ? v : Number.NaN, unit)
            }
          />
          <Tooltip
            formatter={(value, name) => [
              typeof value === 'number'
                ? formatValueWithUnit(value, unit)
                : '-',
              String(name),
            ]}
            labelFormatter={(year) => `${year}년`}
          />
          {second ? <Legend /> : null}
          <Line
            type="monotone"
            dataKey="value"
            name={label}
            stroke="#4AA5C4"
            strokeWidth={3}
            dot={{ r: 4 }}
            connectNulls={false}
          />
          {second ? (
            <Line
              type="monotone"
              dataKey="second"
              name={second.label}
              stroke="#B91C1C"
              strokeWidth={3}
              dot={{ r: 4 }}
              connectNulls={false}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
