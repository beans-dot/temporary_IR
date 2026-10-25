'use client';

import { Fragment, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  exportStamp,
  kpiExportRows,
  writeXlsxAndLog,
} from '@/lib/strategic-plan/exportXlsx';
import {
  achievementRate,
  fmt,
  fmt1,
  isInverseKpi,
} from '@/lib/strategic-plan/format';
import { goalAccent } from '@/lib/strategic-plan/goalAccent';
import type { SpKpi, SpTask } from '@/lib/strategic-plan/types';
import { cn } from '@/lib/utils';
import {
  useStrategicPlanStore,
  type SpKpiSortKey,
} from '@/store/useStrategicPlanStore';
import { SpCodeBadge } from '@/components/strategic-plan/SpCodeBadge';
import { EmptyState, SectionLabel } from './ui';

function sortValue(kpi: SpKpi, key: SpKpiSortKey, year: number) {
  if (key === 'code') return kpi.kpiCode;
  if (key === 'baseline') return kpi.baseline;
  if (key === 'lastTarget') return kpi.targets[year] ?? null;
  return null;
}

function kpiRate(kpi: SpKpi, year: number) {
  return achievementRate(
    kpi.results[year] ?? null,
    kpi.targets[year] ?? null,
    isInverseKpi(kpi.kpiCode, kpi.displayCode),
  );
}

/** 달성률 100% 이상은 달성, 그 미만은 미달성, 실적·목표가 없어 계산할 수 없으면 미입력 */
function outcomeCounts(kpis: SpKpi[], year: number) {
  let achieved = 0;
  let missed = 0;
  let missing = 0;
  for (const kpi of kpis) {
    const rate = kpiRate(kpi, year);
    if (rate === null) missing += 1;
    else if (rate >= 100) achieved += 1;
    else missed += 1;
  }
  return { achieved, missed, missing, total: kpis.length };
}

function OutcomeLight({ rate }: { rate: number | null }) {
  if (rate === null) {
    return <span className="text-muted-foreground">–</span>;
  }
  const achieved = rate >= 100;
  return (
    <span
      className="inline-flex items-center justify-center"
      title={achieved ? '달성' : '미달성'}
      aria-label={achieved ? '달성' : '미달성'}
    >
      <span
        className={cn(
          'h-3.5 w-3.5 rounded-full',
          achieved ? 'bg-emerald-500' : 'bg-red-500',
        )}
        aria-hidden
      />
    </span>
  );
}

function DetailRow({
  kpi,
  task,
  years,
  colSpan,
}: {
  kpi: SpKpi;
  task: SpTask | undefined;
  years: number[];
  colSpan: number;
}) {
  return (
    <tr className="bg-muted/30">
      <td colSpan={colSpan} className="px-3 py-3">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <SectionLabel>산출식</SectionLabel>
            <p className="text-sm">{kpi.formula ?? '–'}</p>
          </div>
          <div>
            <SectionLabel>소속 실행과제</SectionLabel>
            <p className="text-sm">
              {task ? `${task.displayCode ?? task.taskCode} · ${task.taskName}` : '–'}
            </p>
          </div>
          <div>
            <SectionLabel>책임부서</SectionLabel>
            <p className="text-sm">{kpi.primaryDept || task?.primaryDept || '–'}</p>
          </div>
          <div>
            <SectionLabel>기준값 참조</SectionLabel>
            <p className="text-sm">
              {fmt(kpi.baseline)}
              {kpi.unit ?? ''}
              {kpi.baselineRef ? ` (${kpi.baselineRef})` : ''}
            </p>
          </div>
          <div>
            <SectionLabel>연도별 실적</SectionLabel>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {years.map((year) => (
                <span key={year}>
                  <span className="text-muted-foreground">{year} </span>
                  <span className="font-bold">
                    {fmt(kpi.results[year])}
                    {kpi.results[year] !== null &&
                    kpi.results[year] !== undefined
                      ? (kpi.unit ?? '')
                      : ''}
                  </span>
                </span>
              ))}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export function KpiView({
  kpis,
  taskByCode,
  years,
  year,
}: {
  kpis: SpKpi[];
  taskByCode: Map<string, SpTask>;
  years: number[];
  year: number;
}) {
  const kpiSort = useStrategicPlanStore((s) => s.kpiSort);
  const toggleKpiSort = useStrategicPlanStore((s) => s.toggleKpiSort);
  const [openCodes, setOpenCodes] = useState<Set<string>>(new Set());

  const sorted = useMemo(() => {
    if (!kpiSort.key) return kpis;
    return [...kpis].sort((a, b) => {
      const va = sortValue(a, kpiSort.key, year);
      const vb = sortValue(b, kpiSort.key, year);
      if (va === null || va === undefined) return 1;
      if (vb === null || vb === undefined) return -1;
      if (typeof va === 'string' && typeof vb === 'string') {
        return va.localeCompare(vb) * kpiSort.dir;
      }
      return ((va as number) - (vb as number)) * kpiSort.dir;
    });
  }, [kpis, kpiSort, year]);

  const counts = useMemo(() => outcomeCounts(kpis, year), [kpis, year]);

  if (kpis.length === 0) {
    return <EmptyState>조건에 맞는 KPI가 없습니다.</EmptyState>;
  }

  const downloadExcel = () => {
    const stamp = exportStamp();
    const filename = `성과지표조회_${year}_${stamp}.xlsx`;
    writeXlsxAndLog({
      rows: kpiExportRows(sorted, year),
      sheetName: '성과지표',
      filename,
      source: 'kpi-xlsx',
      summary: `${year}학년도 성과지표 조회 · ${sorted.length}건`,
    });
  };

  const colSpan = 8;

  const sortHeader = (key: SpKpiSortKey, label: string) => (
    <th className="whitespace-nowrap px-3 py-2 text-left font-bold">
      <button
        type="button"
        onClick={() => toggleKpiSort(key)}
        className="inline-flex items-center gap-1 hover:underline"
      >
        {label}
        {kpiSort.key === key && (
          <span aria-hidden>{kpiSort.dir === 1 ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  );

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={downloadExcel}>
          <FileDown className="h-4 w-4" />
          엑셀 다운로드
        </Button>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b bg-muted/40 px-3 py-2 text-sm">
          <span className="text-emerald-700">
            달성 <b>{counts.achieved}</b>건
          </span>
          <span className="text-red-600">
            미달성 <b>{counts.missed}</b>건
          </span>
          <span className="text-muted-foreground">
            미입력 <b>{counts.missing}</b>건
          </span>
          <span>
            총계 <b>{counts.total}</b>건
          </span>
        </div>
        <table className="w-full min-w-[720px] text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            {sortHeader('code', '코드')}
            <th className="px-3 py-2 text-left font-bold">
              지표명 · 실행과제 · 책임부서
            </th>
            <th className="px-3 py-2 text-left font-bold">단위</th>
            {sortHeader('baseline', '기준값')}
            {sortHeader('lastTarget', `${year} 목표`)}
            <th className="whitespace-nowrap px-3 py-2 text-left font-bold">
              {year} 실적
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-left font-bold">
              달성률
            </th>
            <th className="whitespace-nowrap px-3 py-2 text-center font-bold">
              달성여부
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((kpi) => {
            const task = kpi.taskCode ? taskByCode.get(kpi.taskCode) : undefined;
            const accent = goalAccent(kpi.goalId);
            const open = openCodes.has(kpi.kpiCode);
            const target = kpi.targets[year] ?? null;
            const actual = kpi.results[year] ?? null;
            const rate = kpiRate(kpi, year);
            return (
              <Fragment key={kpi.kpiCode}>
                <tr
                  className="cursor-pointer border-b hover:bg-accent/40"
                  onClick={() =>
                    setOpenCodes((prev) => {
                      const next = new Set(prev);
                      if (next.has(kpi.kpiCode)) next.delete(kpi.kpiCode);
                      else next.add(kpi.kpiCode);
                      return next;
                    })
                  }
                >
                  <td className="whitespace-nowrap px-3 py-2">
                    <span className="flex items-center gap-1.5">
                      {open ? (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span
                        className={cn('h-2 w-2 rounded-full', accent.dot)}
                        aria-hidden
                      />
                      <SpCodeBadge level="kpi">
                        {kpi.displayCode ?? kpi.kpiCode}
                      </SpCodeBadge>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="block font-bold">{kpi.kpiName}</span>
                    {task && (
                      <span className="block text-muted-foreground">
                        {task.taskName} · {kpi.primaryDept || task.primaryDept}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {kpi.unit ?? ''}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(kpi.baseline)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(target)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(actual)}
                  </td>
                  <td
                    className={cn(
                      'px-3 py-2 text-right tabular-nums',
                      rate !== null && rate >= 100 && 'font-bold text-emerald-700',
                    )}
                  >
                    {rate === null ? '–' : `${fmt1(rate)}%`}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <OutcomeLight rate={rate} />
                  </td>
                </tr>
                {open && (
                  <DetailRow
                    kpi={kpi}
                    task={task}
                    years={years}
                    colSpan={colSpan}
                  />
                )}
              </Fragment>
            );
          })}
        </tbody>
        </table>
      </div>
    </div>
  );
}
