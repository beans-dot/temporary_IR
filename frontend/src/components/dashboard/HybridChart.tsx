'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import html2canvas from 'html2canvas';
import { Download } from 'lucide-react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Label,
  LabelList,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { TooltipProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { buildSeriesStyleMap, MAX_CHART_SERIES } from '@/lib/chartStyleUtils';
import {
  assignDualYAxes,
  computeAbsoluteDomain,
  computeIndexDomain,
  formatNumber,
  formatValueWithUnit,
  makeEvenTicks,
  pivotToChart,
  toIndex100,
  type ChartScaleMode,
  type ChartSeries,
} from '@/lib/dataFormatters';
import {
  api,
  ANNUAL_EVENT_CATEGORY_LABEL,
  type AnnualEvent,
  type AnnualEventCategory,
} from '@/lib/api';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { logDataExport } from '@/lib/exportLog';
import { renderMarker } from './ChartMarkers';

type YearHoverState = {
  year: number;
  x: number;
  y: number;
};

function groupEventsByYear(
  events: AnnualEvent[],
): Record<number, AnnualEvent[]> {
  const map: Record<number, AnnualEvent[]> = {};
  for (const e of events) {
    if (!map[e.year]) map[e.year] = [];
    map[e.year].push(e);
  }
  for (const year of Object.keys(map)) {
    map[Number(year)].sort((a, b) => {
      if (a.category === b.category) return a.eventId - b.eventId;
      return a.category === 'YSU' ? -1 : 1;
    });
  }
  return map;
}

function YearEventsMemo({
  year,
  events,
}: {
  year: number;
  events: AnnualEvent[];
}) {
  const byCategory = (['YSU', 'EXTERNAL'] as AnnualEventCategory[])
    .map((category) => ({
      category,
      items: events.filter((e) => e.category === category),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="w-64 rounded-md border border-border bg-white px-3 py-2 text-xs shadow-lg">
      <div className="mb-1.5 font-bold text-foreground">{year}년 변동사항</div>
      <div className="space-y-2">
        {byCategory.map(({ category, items }) => (
          <div key={category}>
            <div className="mb-0.5 font-bold text-muted-foreground">
              [{ANNUAL_EVENT_CATEGORY_LABEL[category]}]
            </div>
            <ul className="space-y-0.5 pl-0.5">
              {items.map((item) => (
                <li
                  key={item.eventId}
                  className="whitespace-pre-wrap leading-relaxed text-foreground"
                >
                  {item.content}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmphasisLegend({
  items,
  emphasizedKeys,
  onToggle,
}: {
  items: Array<{ key: string; label: string; color?: string }>;
  emphasizedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 pt-3">
      {items.map((item) => {
        const on = emphasizedKeys.has(item.key);
        return (
          <li key={item.key}>
            <button
              type="button"
              onClick={() => onToggle(item.key)}
              className="inline-flex max-w-[280px] items-center gap-1.5 text-left text-xs text-foreground"
              title={
                on
                  ? '강조 해제'
                  : '클릭하면 이 선을 굵게 표시합니다'
              }
            >
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: item.color }}
              />
              <span
                className={cn(
                  'truncate',
                  on
                    ? 'font-bold underline decoration-gray-400 decoration-2 underline-offset-2'
                    : 'font-normal',
                )}
              >
                {item.label}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function formatChartValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return '-';
  return formatNumber(n);
}

/** 단일 시리즈에 대해 최소자승 선형회귀로 Trendline 좌표 계산 */
function computeTrendlineForKey(
  data: Array<Record<string, number | string | null>>,
  seriesKey: string,
): Array<number | null> {
  const points: Array<{ x: number; y: number }> = [];
  data.forEach((row, idx) => {
    const v = row[seriesKey];
    if (typeof v === 'number' && Number.isFinite(v)) {
      points.push({ x: idx, y: v });
    }
  });
  if (points.length < 2) {
    return data.map(() => null);
  }
  const n = points.length;
  const sumX = points.reduce((a, p) => a + p.x, 0);
  const sumY = points.reduce((a, p) => a + p.y, 0);
  const sumXY = points.reduce((a, p) => a + p.x * p.y, 0);
  const sumXX = points.reduce((a, p) => a + p.x * p.x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX || 1);
  const intercept = (sumY - slope * sumX) / n;
  return data.map((_, idx) => slope * idx + intercept);
}

const TREND_KEY_PREFIX = '__trend__';

type OriginalLookup = Record<string, Record<string, number | null>>;

function buildOriginalLookup(
  data: Array<Record<string, number | string | null>>,
  series: ChartSeries[],
): OriginalLookup {
  const lookup: OriginalLookup = {};
  for (const row of data) {
    const yearKey = String(row.year);
    lookup[yearKey] = {};
    for (const s of series) {
      const v = row[s.key];
      lookup[yearKey][s.key] =
        typeof v === 'number' && Number.isFinite(v) ? v : null;
    }
  }
  return lookup;
}

function ScaleModeToggle({
  mode,
  onChange,
}: {
  mode: ChartScaleMode;
  onChange: (mode: ChartScaleMode) => void;
}) {
  return (
    <div
      className="inline-flex rounded-md border border-input bg-muted p-0.5"
      role="group"
      aria-label="차트 스케일 모드"
    >
      <button
        type="button"
        onClick={() => onChange('absolute')}
        className={cn(
          'rounded-sm px-3 py-1.5 text-xs font-bold transition-colors',
          mode === 'absolute'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        절대값 비교
      </button>
      <button
        type="button"
        onClick={() => onChange('index')}
        className={cn(
          'rounded-sm px-3 py-1.5 text-xs font-bold transition-colors',
          mode === 'index'
            ? 'bg-background text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )}
      >
        변화량 비교 (Index 100)
      </button>
    </div>
  );
}

function ChartTooltipContent({
  active,
  payload,
  label,
  scaleMode,
  seriesByKey,
  originalLookup,
}: TooltipProps<ValueType, NameType> & {
  scaleMode: ChartScaleMode;
  seriesByKey: Record<string, ChartSeries>;
  originalLookup: OriginalLookup;
}) {
  if (!active || !payload?.length) return null;

  const yearKey = String(label);
  const items = payload.filter(
    (p) => !String(p.dataKey).startsWith('__trend'),
  );

  return (
    <div className="rounded-md border border-border bg-white px-3 py-2 text-xs shadow-md">
      <div className="mb-1.5 font-bold text-foreground">{label}년</div>
      <ul className="space-y-1">
        {items.map((entry) => {
          const key = String(entry.dataKey);
          const series = seriesByKey[key];
          const name = series?.label ?? String(entry.name ?? key);
          const indexVal =
            typeof entry.value === 'number'
              ? entry.value
              : Number(entry.value);
          const original = originalLookup[yearKey]?.[key] ?? null;

          if (scaleMode === 'index') {
            const origText = formatValueWithUnit(original, series?.unit);
            const indexText = Number.isFinite(indexVal)
              ? formatNumber(indexVal)
              : '-';
            return (
              <li key={key} className="flex items-start gap-2">
                <span
                  className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                  style={{ background: entry.color }}
                />
                <span>
                  {name}: {origText}{' '}
                  <span className="text-muted-foreground">
                    [Index: {indexText}]
                  </span>
                </span>
              </li>
            );
          }

          return (
            <li key={key} className="flex items-start gap-2">
              <span
                className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span>
                {name}: {formatValueWithUnit(entry.value, series?.unit)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function HybridChart() {
  const pivot = useAnalysisStore((s) => s.pivot);
  const options = useAnalysisStore((s) => s.chartOptions);
  const chartRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const [scaleMode, setScaleMode] = useState<ChartScaleMode>('absolute');
  const [unitClashNotice, setUnitClashNotice] = useState<string | null>(null);
  /** 단위 충돌 시 절대값 토글 허용 여부(알림 후 이중축 사용) */
  const [allowAbsoluteWithClash, setAllowAbsoluteWithClash] = useState(false);
  const [annualEvents, setAnnualEvents] = useState<AnnualEvent[]>([]);
  const [yearHover, setYearHover] = useState<YearHoverState | null>(null);
  const [emphasizedKeys, setEmphasizedKeys] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    api
      .get<AnnualEvent[]>('/annual-events')
      .then(({ data }) => setAnnualEvents(data))
      .catch(() => setAnnualEvents([]));
  }, []);

  const eventsByYear = useMemo(
    () => groupEventsByYear(annualEvents),
    [annualEvents],
  );

  const hasData = pivot && pivot.rows.length > 0;

  const chartBase = useMemo(
    () => (hasData && pivot ? pivotToChart(pivot) : null),
    [hasData, pivot],
  );

  const seriesSignature = chartBase?.series.map((s) => s.key).join('|') ?? '';
  const unitClash = chartBase?.unitClash ?? false;

  // 단위 교차 선택 시 Index 모드 강제 + 알림
  useEffect(() => {
    if (!chartBase) {
      setUnitClashNotice(null);
      setAllowAbsoluteWithClash(false);
      return;
    }
    if (unitClash) {
      setScaleMode('index');
      setAllowAbsoluteWithClash(false);
      setUnitClashNotice(
        '서로 다른 단위의 지표가 선택되어 [변화량 비교 (Index 100)] 모드로 전환되었습니다. 절대값 비교는 좌·우 이중 Y축으로만 가능합니다.',
      );
    } else {
      setUnitClashNotice(null);
      setAllowAbsoluteWithClash(false);
    }
    // seriesSignature: 선택 지표 조합이 바뀔 때만 재적용
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitClash, seriesSignature]);

  useEffect(() => {
    setEmphasizedKeys(new Set());
  }, [seriesSignature]);

  const toggleEmphasis = (key: string) => {
    setEmphasizedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleScaleModeChange = (mode: ChartScaleMode) => {
    if (mode === 'absolute' && unitClash) {
      if (!allowAbsoluteWithClash) {
        window.alert(
          '서로 다른 단위(예: 명 vs %)의 지표를 동시에 비교할 때 절대값 비교는 수학적으로 무의미합니다.\n\n지수화(Index 100) 렌더링을 권장합니다. 계속 절대값 비교를 선택하면 단위별 좌·우 Y축으로 분리 표시합니다.',
        );
        setAllowAbsoluteWithClash(true);
        setScaleMode('absolute');
        setUnitClashNotice(
          '단위가 다른 지표는 좌·우 Y축으로 분리하여 절대값 비교 중입니다. 추세 비교에는 Index 모드를 권장합니다.',
        );
        return;
      }
    }
    setScaleMode(mode);
    if (mode === 'index' && unitClash) {
      setUnitClashNotice(
        '서로 다른 단위의 지표가 선택되어 [변화량 비교 (Index 100)] 모드로 표시됩니다.',
      );
    } else if (mode === 'absolute' && !unitClash) {
      setUnitClashNotice(null);
    }
  };

  const handleExport = async () => {
    if (!chartRef.current) return;
    const canvas = await html2canvas(chartRef.current, {
      backgroundColor: '#ffffff',
      scale: 2,
    });
    const filename = `ysu-ir-chart-${Date.now()}.png`;
    const link = document.createElement('a');
    link.download = filename;
    link.href = canvas.toDataURL('image/png');
    link.click();
    logDataExport({
      format: 'png',
      source: pathname.includes('competitiveness')
        ? 'competitiveness-chart'
        : 'dashboard-chart',
      filename,
      summary: chartBase
        ? `차트 ${Math.min(chartBase.series.length, MAX_CHART_SERIES)}개 시리즈`
        : undefined,
    });
  };

  if (!hasData || !chartBase) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>추이 차트</CardTitle>
        </CardHeader>
        <CardContent className="flex h-80 items-center justify-center text-muted-foreground">
          대상과 지표를 선택하면 차트가 표시됩니다.
        </CardContent>
      </Card>
    );
  }

  const { data: originalData, series: baseSeries } = chartBase;
  const originalLookup = buildOriginalLookup(originalData, baseSeries);
  const seriesByKey = Object.fromEntries(baseSeries.map((s) => [s.key, s]));

  const useDualAxes = scaleMode === 'absolute' && unitClash;
  const allSeries = useDualAxes ? assignDualYAxes(baseSeries) : baseSeries;
  const { styles: styleMap, visibleKeys, truncated } =
    buildSeriesStyleMap(allSeries);
  const seriesByAllKey = Object.fromEntries(allSeries.map((s) => [s.key, s]));
  const series = visibleKeys
    .map((key) => seriesByAllKey[key])
    .filter((s): s is (typeof allSeries)[number] => !!s);
  const seriesAxisByKey = Object.fromEntries(series.map((s) => [s.key, s]));
  const drawSeries = [...series].sort((a, b) => {
    const ae = emphasizedKeys.has(a.key) ? 1 : 0;
    const be = emphasizedKeys.has(b.key) ? 1 : 0;
    return ae - be;
  });

  const indexResult =
    scaleMode === 'index' ? toIndex100(originalData, series) : null;
  const plotData = indexResult?.data ?? originalData;

  const leftKeys = useDualAxes
    ? series.filter((s) => s.yAxisId === 'left').map((s) => s.key)
    : series.map((s) => s.key);
  const rightKeys = useDualAxes
    ? series.filter((s) => s.yAxisId === 'right').map((s) => s.key)
    : [];

  const leftDomain =
    scaleMode === 'index'
      ? computeIndexDomain(
          plotData,
          series.map((s) => s.key),
        )
      : computeAbsoluteDomain(plotData, leftKeys);
  const rightDomain =
    rightKeys.length > 0
      ? computeAbsoluteDomain(plotData, rightKeys)
      : leftDomain;

  // 1개년만 조회 시 세로 막대형으로 나열(겹침 방지), 2개년 이상은 추이 곡선
  const isSingleYear = plotData.length <= 1;

  // 추세선: 선택 데이터(시리즈)별 on/off. 단일 연도는 회귀 불가 → 제외
  const trendKeys =
    options.showTrendline && !isSingleYear
      ? series
          .filter((s) => options.trendlineSeries[s.key] !== false)
          .map((s) => s.key)
      : [];

  const trendByKey: Record<string, Array<number | null>> = {};
  for (const key of trendKeys) {
    trendByKey[key] = computeTrendlineForKey(plotData, key);
  }

  const mergedData = plotData.map((row, idx) => {
    const out: Record<string, number | string | null> = { ...row };
    for (const key of trendKeys) {
      out[`${TREND_KEY_PREFIX}${key}`] = trendByKey[key][idx] ?? null;
    }
    return out;
  });

  // 막대 모드는 0 기준선에서 시작하도록 도메인 하단을 0으로 고정
  const leftAxisDomain: [number, number] = isSingleYear
    ? [Math.min(0, leftDomain[0]), leftDomain[1]]
    : leftDomain;
  const rightAxisDomain: [number, number] = isSingleYear
    ? [Math.min(0, rightDomain[0]), rightDomain[1]]
    : rightDomain;

  // Y축 눈금선: 스케일을 1/10로 분할(기준선 + 그 위 9개 보조선)
  const leftTicks = makeEvenTicks(leftAxisDomain, 10);
  const rightTicks = makeEvenTicks(rightAxisDomain, 10);

  // 기준선: 절대값 모드 항상, 변화량(Index) 모드는 0~100 범위 내에서만 표시
  const showReference =
    options.showReferenceLine &&
    (scaleMode === 'absolute' ||
      (scaleMode === 'index' &&
        options.referenceValue >= 0 &&
        options.referenceValue <= 100));

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle>추이 차트</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <ScaleModeToggle
            mode={scaleMode}
            onChange={handleScaleModeChange}
          />
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="mr-1 h-4 w-4" /> PNG 저장
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {truncated && (
          <div
            role="status"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            차트 가시성을 위해 최대 {MAX_CHART_SERIES}개 데이터까지만
            지원합니다.
          </div>
        )}
        {unitClashNotice && (
          <div
            role="status"
            className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
          >
            {unitClashNotice}
          </div>
        )}
        <div ref={chartRef} className="bg-white p-2">
          <div className="relative">
          <ResponsiveContainer width="100%" height={420}>
            <ComposedChart
              data={mergedData}
              margin={{
                top: 20,
                right: useDualAxes ? 40 : 30,
                left: 10,
                bottom: 18,
              }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis
                dataKey="year"
                tick={(tickProps) => {
                  const { x, y, payload } = tickProps;
                  const year = Number(payload.value);
                  const hasEvents = (eventsByYear[year]?.length ?? 0) > 0;
                  return (
                    <g
                      transform={`translate(${x},${y})`}
                      onMouseEnter={() => {
                        if (!hasEvents) return;
                        setYearHover({ year, x, y });
                      }}
                      onMouseLeave={() => setYearHover(null)}
                      style={{ cursor: hasEvents ? 'pointer' : 'default' }}
                    >
                      <rect
                        x={-22}
                        y={0}
                        width={44}
                        height={22}
                        fill="transparent"
                      />
                      <text
                        dy={14}
                        textAnchor="middle"
                        fontSize={12}
                        fill={hasEvents ? '#4aa5c4' : '#374151'}
                        textDecoration={hasEvents ? 'underline' : undefined}
                        fontWeight={hasEvents ? 700 : 400}
                      >
                        {payload.value}
                      </text>
                    </g>
                  );
                }}
                interval={0}
              />

              {scaleMode === 'index' ? (
                <YAxis
                  yAxisId="left"
                  domain={leftAxisDomain}
                  ticks={leftTicks}
                  interval={0}
                  allowDataOverflow
                  tick={{ fontSize: 12 }}
                  tickFormatter={formatChartValue}
                  allowDecimals
                  label={{
                    value: 'Index',
                    angle: -90,
                    position: 'insideLeft',
                    style: { fontSize: 11, fill: '#6b7280' },
                  }}
                />
              ) : useDualAxes ? (
                <>
                  <YAxis
                    yAxisId="left"
                    orientation="left"
                    domain={leftAxisDomain}
                    ticks={leftTicks}
                    interval={0}
                    allowDataOverflow
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartValue}
                    allowDecimals
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    domain={rightAxisDomain}
                    ticks={rightTicks}
                    interval={0}
                    allowDataOverflow
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatChartValue}
                    allowDecimals
                  />
                </>
              ) : (
                <YAxis
                  yAxisId="left"
                  domain={leftAxisDomain}
                  ticks={leftTicks}
                  interval={0}
                  allowDataOverflow
                  tick={{ fontSize: 12 }}
                  tickFormatter={formatChartValue}
                  allowDecimals
                />
              )}

              <Tooltip
                content={(props) => (
                  <ChartTooltipContent
                    {...props}
                    scaleMode={scaleMode}
                    seriesByKey={seriesByKey}
                    originalLookup={originalLookup}
                  />
                )}
              />
              <Legend
                content={() => (
                  <EmphasisLegend
                    items={series.map((s) => ({
                      key: s.key,
                      label: s.label,
                      color: styleMap[s.key]?.stroke,
                    }))}
                    emphasizedKeys={emphasizedKeys}
                    onToggle={toggleEmphasis}
                  />
                )}
              />

              {showReference && (
                <ReferenceLine
                  yAxisId="left"
                  y={options.referenceValue}
                  stroke="#ef4444"
                  strokeDasharray="6 3"
                >
                  <Label
                    value={`기준선 ${formatChartValue(options.referenceValue)}`}
                    position="insideTopRight"
                    fontSize={11}
                    fill="#ef4444"
                  />
                </ReferenceLine>
              )}

              {drawSeries.map((s) => {
                const style = styleMap[s.key];
                if (!style) return null;
                const axisId = useDualAxes ? (s.yAxisId ?? 'left') : 'left';
                const emphasized = emphasizedKeys.has(s.key);
                const strokeWidth = emphasized
                  ? style.emphasizedStrokeWidth
                  : style.strokeWidth;

                if (isSingleYear) {
                  return (
                    <Bar
                      key={s.key}
                      yAxisId={axisId}
                      dataKey={s.key}
                      name={s.label}
                      fill={style.stroke}
                      maxBarSize={64}
                      stroke={emphasized ? style.stroke : undefined}
                      strokeWidth={emphasized ? 2 : 0}
                    >
                      {options.showDataLabels && (
                        <LabelList
                          dataKey={s.key}
                          position="top"
                          fontSize={10}
                          fill={style.stroke}
                          formatter={(label: unknown) =>
                            formatChartValue(label)
                          }
                        />
                      )}
                    </Bar>
                  );
                }

                return (
                  <Line
                    key={s.key}
                    yAxisId={axisId}
                    type="monotone"
                    dataKey={s.key}
                    name={s.label}
                    stroke={style.stroke}
                    strokeWidth={strokeWidth}
                    strokeDasharray={style.strokeDasharray}
                    connectNulls
                    isAnimationActive={false}
                    dot={(props) =>
                      renderMarker({
                        cx: props.cx,
                        cy: props.cy,
                        fill: style.stroke,
                        shape: style.shape,
                        r: emphasized ? 5 : 4,
                      })
                    }
                    activeDot={{ r: emphasized ? 7 : 6 }}
                  >
                    {options.showDataLabels && (
                      <LabelList
                        dataKey={s.key}
                        position="top"
                        fontSize={10}
                        fill={style.stroke}
                        formatter={(label: unknown) => {
                          // Index 모드에서도 라벨은 차트 상 값(지수) 표시
                          return formatChartValue(label);
                        }}
                      />
                    )}
                  </Line>
                );
              })}

              {trendKeys.map((key) => {
                const s = seriesAxisByKey[key];
                const style = styleMap[key];
                const axisId = useDualAxes ? (s?.yAxisId ?? 'left') : 'left';
                const emphasized = emphasizedKeys.has(key);
                return (
                  <Line
                    key={`${TREND_KEY_PREFIX}${key}`}
                    yAxisId={axisId}
                    type="linear"
                    dataKey={`${TREND_KEY_PREFIX}${key}`}
                    name={`추세선 [${s?.label ?? key}]`}
                    stroke={style?.stroke ?? '#6b7280'}
                    strokeWidth={emphasized ? 2 : 1}
                    strokeDasharray="8 4"
                    dot={false}
                    connectNulls
                    legendType="none"
                    isAnimationActive={false}
                  />
                );
              })}
            </ComposedChart>
          </ResponsiveContainer>

          {yearHover &&
            (eventsByYear[yearHover.year]?.length ?? 0) > 0 && (
              <div
                className="pointer-events-none absolute z-20"
                style={{
                  left: yearHover.x,
                  top: yearHover.y,
                  transform: 'translate(-50%, calc(-100% - 8px))',
                }}
              >
                <YearEventsMemo
                  year={yearHover.year}
                  events={eventsByYear[yearHover.year]}
                />
              </div>
            )}
          </div>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          범례 항목을 클릭하면 해당 선을 굵게 강조합니다. 다시 클릭하면
          해제됩니다.
          {annualEvents.length > 0
            ? ' 파란 밑줄 연도에 마우스를 올리면 해당 연도 변동사항을 확인할 수 있습니다.'
            : ''}
        </p>
      </CardContent>
    </Card>
  );
}
