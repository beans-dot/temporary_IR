'use client';

import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_CHART_SERIES, orderSeriesForChart } from '@/lib/chartStyleUtils';
import { cn } from '@/lib/utils';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

function OptionChip({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'rounded-sm px-2.5 py-1.5 text-xs font-bold transition-colors',
        pressed
          ? 'bg-primary text-primary-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

export function ChartOptionsPanel() {
  const options = useAnalysisStore((s) => s.chartOptions);
  const setChartOption = useAnalysisStore((s) => s.setChartOption);
  const pivot = useAnalysisStore((s) => s.pivot);
  const [seriesOpen, setSeriesOpen] = useState(false);
  const seriesRef = useRef<HTMLDivElement>(null);

  const trendTargets = useMemo(() => {
    if (!pivot) return [] as Array<{ key: string; label: string }>;
    const items = pivot.rows.map((r) => ({
      key: `${r.targetKey}__${r.metricId}`,
      label: `[${r.targetLabel}] ${r.metricName}`,
      isYeonsung: r.isYeonsung,
      metricId: r.metricId,
    }));
    return orderSeriesForChart(items)
      .slice(0, MAX_CHART_SERIES)
      .map(({ key, label }) => ({ key, label }));
  }, [pivot]);

  const toggleTrendSeries = (key: string, value: boolean) => {
    setChartOption('trendlineSeries', {
      ...options.trendlineSeries,
      [key]: value,
    });
  };

  useEffect(() => {
    if (!options.showTrendline) setSeriesOpen(false);
  }, [options.showTrendline]);

  useEffect(() => {
    if (!seriesOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!seriesRef.current?.contains(event.target as Node)) {
        setSeriesOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [seriesOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        className="inline-flex rounded-md border border-input bg-muted p-0.5"
        role="group"
        aria-label="차트 옵션"
      >
        <OptionChip
          pressed={options.showDataLabels}
          onClick={() =>
            setChartOption('showDataLabels', !options.showDataLabels)
          }
        >
          데이터 라벨
        </OptionChip>
        <OptionChip
          pressed={options.showTrendline}
          onClick={() =>
            setChartOption('showTrendline', !options.showTrendline)
          }
        >
          추세선
        </OptionChip>
        <OptionChip
          pressed={options.showReferenceLine}
          onClick={() =>
            setChartOption('showReferenceLine', !options.showReferenceLine)
          }
        >
          기준선
        </OptionChip>
      </div>

      {options.showTrendline && (
        <div ref={seriesRef} className="relative">
          <button
            type="button"
            aria-expanded={seriesOpen}
            aria-haspopup="listbox"
            onClick={() => setSeriesOpen((open) => !open)}
            className="inline-flex h-8 items-center gap-1 rounded-md border border-input bg-background px-2 text-xs font-bold text-foreground"
          >
            추세 대상
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          {seriesOpen && (
            <div className="absolute left-0 z-30 mt-1 w-72 max-w-[calc(100vw-4rem)] rounded-md border bg-background p-2 shadow-lg">
              <div className="mb-1.5 text-xs font-semibold text-muted-foreground">
                추세선 표시 대상
              </div>
              {trendTargets.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  조회된 데이터가 있으면 대상이 표시됩니다.
                </p>
              ) : (
                <ul className="max-h-64 space-y-1.5 overflow-y-auto">
                  {trendTargets.map((t) => {
                    const checked = options.trendlineSeries[t.key] !== false;
                    return (
                      <li
                        key={t.key}
                        className="flex items-center justify-between gap-2"
                      >
                        <Label
                          htmlFor={`opt-trend-${t.key}`}
                          className="truncate text-xs font-normal"
                          title={t.label}
                        >
                          {t.label}
                        </Label>
                        <Switch
                          id={`opt-trend-${t.key}`}
                          checked={checked}
                          onCheckedChange={(v) => toggleTrendSeries(t.key, v)}
                        />
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {options.showReferenceLine && (
        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-muted-foreground">
          기준값
          <Input
            type="number"
            aria-label="기준값"
            className="h-8 w-20 text-xs"
            value={options.referenceValue}
            onChange={(e) =>
              setChartOption('referenceValue', Number(e.target.value))
            }
          />
        </label>
      )}
    </div>
  );
}
