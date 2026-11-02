'use client';

import { useMemo } from 'react';
import Image from 'next/image';
import { formatValueWithUnit } from '@/lib/dataFormatters';
import {
  groupTiedUniversities,
  type RelativeMetricGroup,
  type RelativeUnivScore,
  type RelativeYearScale,
} from '@/lib/relativeCompare';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { RelativeExpandOptions } from './RelativeExpandOptions';

const TICKS = [0, 25, 50, 75, 100] as const;

function TiedMarker({
  members,
  unit,
}: {
  members: RelativeUnivScore[];
  unit: string | null;
}) {
  const hasYeonsung = members.some((m) => m.isYeonsung);
  const position = members[0].position;
  const value = members[0].value;
  const names = members.map((m) => m.label).join(', ');

  return (
    <div
      className="group absolute z-10"
      style={{
        left: `${position}%`,
        top: '50%',
        transform: 'translate(-50%, -50%)',
      }}
    >
      {hasYeonsung ? (
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-primary bg-white shadow-md ring-2 ring-primary/20">
          <Image
            src="/ysu-symbol.jpg"
            alt="연성대학교"
            width={26}
            height={26}
            className="rounded-full object-contain"
          />
          {members.length > 1 && (
            <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-0.5 text-[9px] font-bold text-primary-foreground">
              {members.length}
            </span>
          )}
        </div>
      ) : (
        <div className="relative">
          <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/70 shadow-sm ring-1 ring-background transition-transform group-hover:scale-150 group-hover:bg-foreground" />
          {members.length > 1 && (
            <span className="absolute -right-2 -top-2 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-foreground/80 px-0.5 text-[8px] font-bold text-background">
              {members.length}
            </span>
          )}
        </div>
      )}
      <div
        className={cn(
          'pointer-events-none absolute left-1/2 z-20 hidden max-w-[280px] -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block',
          hasYeonsung ? 'bottom-[calc(100%+6px)]' : 'bottom-[calc(100%+8px)]',
        )}
      >
        <div
          className={cn(
            'whitespace-normal break-keep font-bold leading-snug',
            hasYeonsung && 'text-primary',
          )}
        >
          {names}
        </div>
        <div className="mt-0.5 text-muted-foreground">
          {formatValueWithUnit(value, unit)}
        </div>
      </div>
    </div>
  );
}

function YearScaleRow({
  scale,
  unit,
}: {
  scale: RelativeYearScale;
  unit: string | null;
}) {
  const tiedGroups = useMemo(
    () => groupTiedUniversities(scale.universities),
    [scale.universities],
  );

  return (
    <div className="grid gap-2 sm:grid-cols-[minmax(130px,200px)_1fr] sm:items-center">
      <div className="min-w-0 text-xs text-muted-foreground">
        <span className="font-bold text-foreground">{scale.year}년</span>
        <span className="ml-1">
          (평균 {formatValueWithUnit(scale.mean, unit)})
        </span>
      </div>

      <div className="relative px-1 pb-5 pt-5">
        <div className="relative h-0 border-t-2 border-foreground/25">
          {TICKS.map((t) => (
            <div
              key={t}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${t}%` }}
            >
              <div
                className={cn(
                  'mx-auto',
                  t === 50
                    ? 'h-4 w-0.5 bg-foreground'
                    : 'h-2.5 w-px bg-foreground/40',
                )}
              />
              <div
                className={cn(
                  'mt-1 text-center text-[10px] tabular-nums text-muted-foreground',
                  t === 50 && 'font-bold text-foreground',
                )}
              >
                {t}
              </div>
            </div>
          ))}

          {tiedGroups.map((members) => (
            <TiedMarker
              key={`${members.map((m) => m.univCode).join('-')}-${members[0].value}`}
              members={members}
              unit={unit}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricGroupBlock({ group }: { group: RelativeMetricGroup }) {
  return (
    <div className="space-y-3">
      <div className="text-sm font-bold">{group.metricName}</div>
      <div className="space-y-4 border-l-2 border-border pl-3">
        {group.scales.map((scale) => (
          <YearScaleRow
            key={scale.year}
            scale={scale}
            unit={group.metricUnit}
          />
        ))}
      </div>
    </div>
  );
}

export function RelativeComparePanel() {
  const loading = useAnalysisStore((s) => s.loading);
  const relativeLoading = useAnalysisStore((s) => s.relativeLoading);
  const pivot = useAnalysisStore((s) => s.pivot);
  const relativeScales = useAnalysisStore((s) => s.relativeScales);
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const relativeExpand = useAnalysisStore((s) => s.relativeExpand);
  const isInternal = analysisScope === 'internal';
  const comparing = loading || relativeLoading;

  const queried = pivot !== null;
  const showEmpty = queried && !comparing && relativeScales.length === 0;
  const expandOn = relativeExpand.allSeries || relativeExpand.allDepts;

  const emptyMessage = isInternal
    ? expandOn
      ? '비교할 계열·학과 데이터가 없습니다.'
      : '비교할 대상 데이터가 없습니다. 대상을 더 선택하거나 전체 계열/학과 보기를 켜 주세요.'
    : '비교할 대학 데이터가 없습니다.';

  return (
    <Card>
      <CardHeader className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>상대비교</CardTitle>
          <RelativeExpandOptions idPrefix="rel-panel" />
        </div>
        <p className="text-xs text-muted-foreground">
          {isInternal
            ? '대학 평균은 항상 표시됩니다. 비교군 평균을 50으로 두고 상대 위치를 나타냅니다. 동점이면 한 점에 모으며, 마우스 오버 시 대상명과 값을 확인할 수 있습니다.'
            : '비교군(선택 대학) 평균을 50으로 두고, 선택 연도별로 우리대학의 상대 위치를 표시합니다. 동점이면 한 점에 모으며, 마우스 오버 시 대학명과 점수를 확인할 수 있습니다.'}
        </p>
      </CardHeader>
      <CardContent>
        {comparing && (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            상대비교 계산 중…
          </div>
        )}
        {!comparing && !queried && (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            대상과 지표를 선택하면 상대비교가 표시됩니다.
          </div>
        )}
        {showEmpty && (
          <div className="flex h-24 items-center justify-center text-sm text-muted-foreground">
            {emptyMessage}
          </div>
        )}
        {!comparing && relativeScales.length > 0 && (
          <div className="space-y-8">
            {relativeScales.map((group) => (
              <MetricGroupBlock key={group.metricId} group={group} />
            ))}
            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-primary bg-white">
                  <Image
                    src="/ysu-symbol.jpg"
                    alt=""
                    width={16}
                    height={16}
                    className="rounded-full object-contain"
                  />
                </span>
                {isInternal ? '대학 전체' : '연성대학교'}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/70" />
                {isInternal ? '계열·학과 (동점이면 숫자 뱃지)' : '타 대학 (동점이면 숫자 뱃지)'}
              </span>
              <span>0–100 상대위치 · 50 = 해당 연도 비교군 평균</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
