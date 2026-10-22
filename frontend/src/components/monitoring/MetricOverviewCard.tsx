'use client';

import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatValueWithUnit } from '@/lib/dataFormatters';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SubmetricToggles } from './SubmetricToggles';
import type { KpiViewModel } from '@/lib/monitoring/fetchMonitoringData';
import type { YoySnapshot } from '@/lib/monitoring/types';

function formatDelta(delta: number | null, unit: string | null): string {
  if (delta == null) return '-';
  const sign = delta > 0 ? '+' : '';
  return `${sign}${formatValueWithUnit(delta, unit)}`;
}

export function MetricOverviewCard({
  view,
  selected,
  showValueSource,
  onSelect,
  onComponentToggle,
}: {
  view: KpiViewModel;
  selected: boolean;
  showValueSource: boolean;
  onSelect: () => void;
  onComponentToggle?: (itemId: string, on: boolean) => void;
}) {
  const { yoy } = view;
  const improved = yoy.isImprovement;
  const TrendIcon =
    yoy.delta == null || yoy.delta === 0
      ? Minus
      : yoy.delta > 0
        ? TrendingUp
        : TrendingDown;

  return (
    <Card
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        'h-full cursor-pointer transition-shadow hover:shadow-md',
        selected && 'ring-2 ring-primary',
      )}
    >
      <CardHeader className="space-y-2 p-4 pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-sm leading-snug">{view.label}</CardTitle>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            {showValueSource ? (
              view.valueSource === 'ALIMI' ? (
                <Badge variant="alimi">대학값: 정보공시</Badge>
              ) : view.valueSource === 'MIXED' ? (
                <Badge variant="monitoring">대학값: 공시+입력</Badge>
              ) : view.valueSource === 'MONITORING' ? (
                <Badge variant="monitoring">대학값: 직접입력</Badge>
              ) : null
            ) : null}
            {!view.found ? (
              <Badge variant="secondary">미등록</Badge>
            ) : !view.hasHierarchy ? (
              <Badge variant="outline">대학 단위</Badge>
            ) : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {view.accounting ? (
          <div className="grid grid-cols-2 gap-3">
            <AccountingHeadline
              title="수입"
              yoy={view.accounting.incomeYoy}
              unit={view.unit}
            />
            <AccountingHeadline
              title="지출"
              yoy={view.accounting.expenseYoy}
              unit={view.unit}
            />
          </div>
        ) : (
          <>
            <div>
              <div className="text-2xl font-bold tracking-tight">
                {yoy.currentValue == null
                  ? '-'
                  : formatValueWithUnit(yoy.currentValue, view.unit)}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {yoy.currentYear ? `${yoy.currentYear}년` : '데이터 없음'}
              </div>
            </div>
            <div
              className={cn(
                'flex items-center gap-1 text-sm font-bold',
                improved === true && 'text-emerald-600',
                improved === false && 'text-red-600',
                improved == null && 'text-muted-foreground',
              )}
            >
              <TrendIcon className="h-4 w-4" />
              <span>{formatDelta(yoy.delta, view.unit)}</span>
              <span className="text-xs font-medium text-muted-foreground">
                전년 대비
              </span>
            </div>
            {view.formula?.kind === 'other' && view.formula.expressionLabel ? (
              <p className="text-xs text-muted-foreground">
                {view.formula.expressionLabel}
              </p>
            ) : null}
          </>
        )}
        {view.componentToggles && onComponentToggle ? (
          <SubmetricToggles
            items={view.componentToggles}
            unit={view.unit}
            onChange={onComponentToggle}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function AccountingHeadline({
  title,
  yoy,
  unit,
}: {
  title: string;
  yoy: YoySnapshot;
  unit: string | null;
}) {
  const improved = yoy.isImprovement;
  const TrendIcon =
    yoy.delta == null || yoy.delta === 0
      ? Minus
      : yoy.delta > 0
        ? TrendingUp
        : TrendingDown;

  return (
    <div>
      <div className="text-xs font-bold text-muted-foreground">{title}</div>
      <div className="text-xl font-bold tracking-tight">
        {yoy.currentValue == null
          ? '-'
          : formatValueWithUnit(yoy.currentValue, unit)}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        {yoy.currentYear ? `${yoy.currentYear}년` : '데이터 없음'}
      </div>
      <div
        className={cn(
          'mt-1 flex items-center gap-1 text-xs font-bold',
          improved === true && 'text-emerald-600',
          improved === false && 'text-red-600',
          improved == null && 'text-muted-foreground',
        )}
      >
        <TrendIcon className="h-3.5 w-3.5" />
        <span>{formatDelta(yoy.delta, unit)}</span>
        <span className="font-medium text-muted-foreground">전년 대비</span>
      </div>
    </div>
  );
}
