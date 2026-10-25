'use client';

import { MonitoringTrendChart } from './MonitoringTrendChart';
import { HierarchyCompareChart } from './HierarchyCompareChart';
import {
  hasHierarchyData,
  UNIV_ONLY_HIERARCHY_MESSAGE,
} from '@/lib/monitoring/aggregate';
import type { KpiViewModel } from '@/lib/monitoring/fetchMonitoringData';
import type { OrgStructure, YearValueMap } from '@/lib/monitoring/types';
import { formatValueWithUnit } from '@/lib/dataFormatters';

function NoSubHierarchyMessage() {
  return (
    <div className="rounded-md border border-dashed bg-background px-4 py-10 text-center text-sm text-muted-foreground">
      {UNIV_ONLY_HIERARCHY_MESSAGE}
    </div>
  );
}

export function MetricDetailViewer({
  view,
  org,
}: {
  view: KpiViewModel;
  org: OrgStructure;
}) {
  return (
    <div className="space-y-8">
      <div>
        <h3 className="mb-1 text-lg">{view.label}</h3>
        <p className="text-sm text-muted-foreground">
          대학 단위 추이와 하위 위계(계열·학과) 비교입니다.
          {view.formula?.kind === 'other' && view.formula.expressionLabel
            ? ` 표시값은 하위지표 계산식 ${view.formula.expressionLabel} 입니다.`
            : view.componentToggles
              ? ' 켠 하위지표만 합산(또는 차감)합니다.'
              : null}
        </p>
      </div>

      <section className="space-y-3">
        <h4 className="text-base font-bold">1. 추이 그래프</h4>
        <p className="text-sm text-muted-foreground">
          {view.accounting
            ? `회계 자료는 조회 연도의 직전 연도 결산입니다. 그래프는 ${view.selectedYear - 2}~${view.selectedYear}년 수입·지출 추이입니다.`
            : `${view.selectedYear}년 기준 직전 2년을 포함한 3개년 추이입니다.`}
          {view.studentBreakdown || view.stackBreakdown
            ? ' 추이는 위에서 켠 구성 항목의 합(총계)으로 그립니다.'
            : view.formula?.kind === 'other'
              ? ' 추이 값은 하위지표 계산 결과입니다. 하위 값이 없는 연도는 기존에 올린 값을 사용합니다.'
              : null}
        </p>
        <MonitoringTrendChart
          key={`trend-${view.id}-${view.stackBreakdown?.keys.join('-') ?? view.studentBreakdown?.keys.join('-') ?? 'plain'}`}
          years={view.years}
          values={view.accounting ? view.accounting.income : view.univ}
          unit={view.unit}
          label={view.accounting ? '수입' : view.label}
          second={
            view.accounting
              ? { values: view.accounting.expense, label: '지출' }
              : undefined
          }
        />
      </section>

      {view.accounting && (
        <section className="space-y-3">
          <h4 className="text-base font-bold">2. 수입·지출 구성</h4>
          <div className="grid gap-4 md:grid-cols-2">
            <AccountingLineTable
              title={`수입 (${view.selectedYear}년)`}
              years={view.years}
              lines={view.accounting.incomeLines}
              unit={view.unit}
            />
            <AccountingLineTable
              title={`지출 (${view.selectedYear}년)`}
              years={view.years}
              lines={view.accounting.expenseLines}
              unit={view.unit}
            />
          </div>
        </section>
      )}

      {view.formula && view.formula.kind === 'other' && (
        <section className="space-y-3">
          <h4 className="text-base font-bold">2. 하위지표 구성</h4>
          <p className="text-sm text-muted-foreground">
            계산식 {view.formula.expressionLabel}. 아래는 하위지표의 대학 단위
            값입니다.
          </p>
          <AccountingLineTable
            title={`하위지표 (${view.selectedYear}년)`}
            years={view.years}
            lines={view.formula.lines}
            unit={view.unit}
          />
        </section>
      )}

      <section className="space-y-3">
        <h4 className="text-base font-bold">
          {view.accounting || (view.formula && view.formula.kind === 'other')
            ? '3. 하위위계별 비교'
            : '2. 하위위계별 비교'}
        </h4>
        {view.hasHierarchy ? (
          <p className="text-sm text-muted-foreground">
            {view.selectedYear}년 기준으로 계열·학과를 켜면 해당 위계가 모두 가로
            막대로 표시됩니다. 같은 위계에서 상위 10%는 밝은 파랑, 하위 10%는 밝은
            빨강입니다. 모든 값이 같거나, 동점 때문에 10%를 넘기면 해당 구간은
            색을 칠하지 않습니다. 달성값순, 이름순, 학과나열순(편제 순서)과
            오름/내림차순을 바꿀 수 있습니다.
            {(view.stackBreakdown ?? view.studentBreakdown) &&
            (view.stackBreakdown ?? view.studentBreakdown)!.keys.length >= 2
              ? ' 구성 항목을 2개 이상 켜면 총계 기준 누적 가로 막대로 구분하고, 항목별 값과 비중은 막대에 마우스를 올리면 볼 수 있습니다.'
              : view.stackBreakdown || view.studentBreakdown
                ? ' 비교 막대도 켠 구성 항목의 합(총계)입니다.'
                : null}
          </p>
        ) : null}
        {view.accounting ? (
          view.hasHierarchy ? (
            <div className="space-y-6">
              <div className="space-y-2">
                <h5 className="text-sm font-bold">수입</h5>
                <HierarchyCompareChart
                  key={`${view.id}-income-${view.selectedYear}`}
                  view={{
                    ...view,
                    label: `${view.label} · 수입`,
                    univ: view.accounting.income,
                    depts: view.accounting.incomeDepts,
                    yoy: view.accounting.incomeYoy,
                    stackBreakdown: undefined,
                    studentBreakdown: undefined,
                    hasHierarchy: hasHierarchyData(
                      view.accounting.incomeDepts,
                      view.selectedYear,
                      view.accounting.income,
                    ),
                  }}
                  org={org}
                />
              </div>
              <div className="space-y-2">
                <h5 className="text-sm font-bold">지출</h5>
                <HierarchyCompareChart
                  key={`${view.id}-expense-${view.selectedYear}`}
                  view={{
                    ...view,
                    label: `${view.label} · 지출`,
                    univ: view.accounting.expense,
                    depts: view.accounting.expenseDepts,
                    yoy: view.accounting.expenseYoy,
                    stackBreakdown: undefined,
                    studentBreakdown: undefined,
                    hasHierarchy: hasHierarchyData(
                      view.accounting.expenseDepts,
                      view.selectedYear,
                      view.accounting.expense,
                    ),
                  }}
                  org={org}
                />
              </div>
            </div>
          ) : (
            <NoSubHierarchyMessage />
          )
        ) : !view.hasHierarchy ? (
          <NoSubHierarchyMessage />
        ) : (
          <HierarchyCompareChart
            key={`${view.id}-${view.selectedYear}-${view.stackBreakdown?.keys.join('-') ?? view.studentBreakdown?.keys.join('-') ?? 'plain'}`}
            view={view}
            org={org}
          />
        )}
      </section>
    </div>
  );
}

function AccountingLineTable({
  title,
  years,
  lines,
  unit,
}: {
  title: string;
  years: number[];
  lines: { name: string; univ: YearValueMap }[];
  unit: string | null;
}) {
  const selectedYear = [...years].sort((a, b) => a - b).at(-1);
  return (
    <div className="rounded-md border bg-background">
      <div className="border-b px-3 py-2 text-sm font-bold">{title}</div>
      <table className="w-full text-sm">
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td className="px-3 py-4 text-muted-foreground">
                하위 항목이 없습니다.
              </td>
            </tr>
          ) : (
            lines.map((line) => (
              <tr key={line.name} className="border-t">
                <td className="px-3 py-1.5">{line.name}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {selectedYear == null
                    ? '-'
                    : formatValueWithUnit(line.univ[selectedYear] ?? null, unit)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
