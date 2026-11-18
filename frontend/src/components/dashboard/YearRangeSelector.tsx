'use client';

import { useEffect, useId, useState } from 'react';
import * as Slider from '@radix-ui/react-slider';
import { RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';

export function YearRangeSelector() {
  const labelId = useId();
  const years = useAnalysisStore((s) => s.years);
  const availableYears = useAnalysisStore((s) => s.availableYears);
  const status = useAnalysisStore((s) => s.yearsStatus);
  const setYears = useAnalysisStore((s) => s.setYears);
  const loadAvailableYears = useAnalysisStore((s) => s.loadAvailableYears);
  const [draft, setDraft] = useState<number[] | null>(null);

  useEffect(() => {
    void loadAvailableYears();
  }, [loadAvailableYears]);

  useEffect(() => {
    setDraft(null);
  }, [years, availableYears]);

  const lastIndex = availableYears.length - 1;
  const startIndex = Math.max(0, availableYears.indexOf(years[0]));
  const endIndex = Math.max(startIndex, availableYears.indexOf(years[years.length - 1]));
  const range = draft ?? [startIndex, endIndex];
  const startYear = availableYears[range[0]];
  const endYear = availableYears[range[1]];
  const isFullRange = range[0] === 0 && range[1] === lastIndex;
  const tickStep = Math.max(1, Math.ceil(lastIndex / 4));

  return (
    <section className="rounded-lg border border-border bg-muted/20 p-3" aria-labelledby={labelId}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={labelId} className="text-sm font-bold">조회 기간</h2>
        {status === 'ready' && availableYears.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-primary"
            aria-label="전체 기간 선택"
            title="전체 기간 선택"
            disabled={isFullRange}
            onClick={() => setYears(availableYears)}
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      {(status === 'idle' || status === 'loading') && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          데이터가 있는 연도를 불러오는 중…
        </p>
      )}
      {status === 'error' && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-destructive" role="alert">조회 가능한 연도를 불러오지 못했습니다.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadAvailableYears()}>
            다시 불러오기
          </Button>
        </div>
      )}
      {status === 'ready' && availableYears.length === 0 && (
        <p className="mt-2 text-xs text-muted-foreground">조회할 데이터가 없습니다.</p>
      )}
      {status === 'ready' && availableYears.length > 0 && (
        <>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-sm font-bold tabular-nums text-primary">
              {startYear === endYear ? `${startYear}년` : `${startYear}년 – ${endYear}년`}
            </span>
            <span className="text-xs text-muted-foreground">
              {isFullRange ? '전체 ' : ''}{range[1] - range[0] + 1}개년
            </span>
          </div>
          {availableYears.length > 1 && (
            <div className="mt-2 px-2.5">
              <Slider.Root
                className="relative flex h-8 w-full touch-none select-none items-center"
                min={0}
                max={lastIndex}
                step={1}
                minStepsBetweenThumbs={0}
                value={range}
                aria-labelledby={labelId}
                onValueChange={setDraft}
                onValueCommit={(next) => {
                  setYears(availableYears.slice(next[0], next[1] + 1));
                  setDraft(null);
                }}
              >
                <Slider.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-border">
                  <Slider.Range className="absolute h-full rounded-full bg-primary" />
                </Slider.Track>
                <Slider.Thumb
                  aria-label="조회 시작연도"
                  aria-valuetext={`${startYear}년`}
                  className="block h-5 w-5 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 active:cursor-grabbing"
                />
                <Slider.Thumb
                  aria-label="조회 종료연도"
                  aria-valuetext={`${endYear}년`}
                  className="block h-5 w-5 cursor-grab rounded-full border-2 border-primary bg-background shadow-sm transition-shadow focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/20 active:cursor-grabbing"
                />
              </Slider.Root>
              <div className="relative h-5 text-[10px] tabular-nums text-muted-foreground" aria-hidden="true">
                {availableYears.map((year, index) => {
                  if (index !== lastIndex && index % tickStep !== 0) return null;
                  return (
                    <span
                      key={year}
                      className="absolute whitespace-nowrap"
                      style={{
                        left: `${(index / lastIndex) * 100}%`,
                        transform: index === 0 ? undefined : index === lastIndex ? 'translateX(-100%)' : 'translateX(-50%)',
                      }}
                    >
                      {year}
                    </span>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
