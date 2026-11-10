'use client';

import { useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { FileSpreadsheet, FileText } from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  descriptiveStatsFromPivot,
  type DescriptiveStats,
} from '@/lib/descriptiveStats';
import { logDataExport } from '@/lib/exportLog';
import {
  buildQueryMarkdown,
  queryMarkdownFilename,
  type QueryMarkdownScreen,
} from '@/lib/queryMarkdown';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  CorrDragGhost,
  CorrelationPanel,
  useCorrelationDrag,
} from './CorrelationPanel';

const COLUMNS: Array<{
  key: keyof DescriptiveStats;
  label: string;
}> = [
  { key: 'mean', label: '평균(Mean)' },
  { key: 'median', label: '중앙값(Median)' },
  { key: 'modes', label: '최빈값(Mode)' },
  { key: 'variance', label: '분산(Variance)' },
  { key: 'standardDeviation', label: '표준편차(Standard Deviation)' },
  { key: 'range', label: '범위(Range)' },
  { key: 'iqr', label: '사분위수(IQR)' },
  { key: 'skewness', label: '왜도(Skewness)' },
  { key: 'kurtosis', label: '첨도(Kurtosis)' },
];

function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return Number(value).toLocaleString('ko-KR', {
    maximumFractionDigits: 4,
  });
}

function formatCell(stats: DescriptiveStats, key: keyof DescriptiveStats): string {
  if (key === 'modes') {
    if (!stats.modes || stats.modes.length === 0) return '-';
    return stats.modes.map((mode) => formatStat(mode)).join(', ');
  }
  const value = stats[key];
  return typeof value === 'number' ? formatStat(value) : '-';
}

export function DescriptiveStatsGrid() {
  const pivot = useAnalysisStore((s) => s.pivot);
  const loading = useAnalysisStore((s) => s.loading);
  const relativeLoading = useAnalysisStore((s) => s.relativeLoading);
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const hierarchyIntegrate = useAnalysisStore((s) => s.hierarchyIntegrate);
  const relativeExpand = useAnalysisStore((s) => s.relativeExpand);
  const relativeScales = useAnalysisStore((s) => s.relativeScales);
  const selectedTargets = useAnalysisStore((s) => s.selectedTargets);
  const selectedMetrics = useAnalysisStore((s) => s.selectedMetrics);
  const tableRef = useRef<HTMLTableElement>(null);
  const pathname = usePathname();

  const rows = useMemo(
    () => (pivot && pivot.rows.length > 0 ? descriptiveStatsFromPivot(pivot) : []),
    [pivot],
  );
  const hasData = rows.length > 0;
  const markdownBusy = loading || relativeLoading;
  const periodLabel = pivot?.years.length ? pivot.years.join(', ') : '';
  const seriesSignature = rows.map((row) => row.key).join('|');
  const correlation = useCorrelationDrag(seriesSignature);
  const corrItems = useMemo(
    () => rows.map((row) => ({ key: row.key, label: row.name })),
    [rows],
  );
  const corrData = useMemo(() => {
    if (!pivot) return [];
    return pivot.years.map((year) => {
      const point: Record<string, number | string | null> = { year };
      for (const row of pivot.rows) {
        const key = `${row.targetKey}-${row.metricId}`;
        const value = row.values[year];
        point[key] =
          typeof value === 'number' && Number.isFinite(value) ? value : null;
      }
      return point;
    });
  }, [pivot]);

  const handleExcel = () => {
    if (!tableRef.current) return;
    const worksheet = XLSX.utils.table_to_sheet(tableRef.current);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'IR_Descriptive');
    const filename = `ysu-ir-descriptive-${Date.now()}.xlsx`;
    XLSX.writeFile(workbook, filename);
    logDataExport({
      format: 'xlsx',
      source: pathname.includes('competitiveness')
        ? 'competitiveness-descriptive'
        : 'dashboard-descriptive',
      filename,
      summary: pivot
        ? `기초기술통계 ${rows.length}행 · ${pivot.years.join(', ')}`
        : undefined,
    });
  };

  const handleMarkdown = () => {
    if (!pivot || pivot.rows.length === 0 || markdownBusy) return;
    const screen: QueryMarkdownScreen =
      analysisScope === 'internal' ? 'internal' : 'disclosure';
    const generatedAt = new Date();
    const markdown = buildQueryMarkdown({
      screen,
      generatedAt,
      hierarchyIntegrate,
      relativeExpand,
      targets: selectedTargets.map((target) => ({
        label: target.label,
        isYeonsung: target.isYeonsung,
        mode: target.mode,
        univCode: target.univCode,
        deptCode: target.deptCode,
        memberUnivCount: target.memberUnivCodes?.length ?? 0,
        memberDeptCount: target.memberDeptCodes?.length ?? 0,
      })),
      metrics: selectedMetrics.map((metric) => ({
        metricName: metric.metricName,
        unit: metric.unit,
        sourceType: metric.sourceType,
      })),
      pivot,
      relativeScales,
    });
    const filename = queryMarkdownFilename(screen, generatedAt);
    const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    logDataExport({
      format: 'md',
      source: screen === 'internal' ? 'competitiveness-markdown' : 'dashboard-markdown',
      filename,
      summary: `조회 데이터 마크다운 ${pivot.rows.length}행 · 상대비교 ${relativeScales.length}지표 · ${pivot.years.join(', ')}`,
    });
  };

  return (
    <>
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 gap-4">
        <div className="space-y-1.5">
          <CardTitle>기초 기술 통계 데이터</CardTitle>
          <CardDescription>
            {hasData
              ? `조회 기간(${periodLabel})의 연도별 값으로 계산합니다. 결측 연도는 제외하고, 분산·표준편차는 표본(n−1), 왜도·첨도는 Excel과 같으며 첨도는 초과첨도, 사분위수는 Q3−Q1입니다. 계산할 수 없으면 -입니다.`
              : '피벗에 조회된 각 데이터를 조회 기간 기준으로 계산합니다.'}
          </CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExcel}
          disabled={!hasData}
          className="shrink-0"
        >
          <FileSpreadsheet className="mr-1 h-4 w-4" /> 엑셀 다운로드
        </Button>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="flex h-32 items-center justify-center text-muted-foreground">
            조회된 데이터가 없습니다.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table ref={tableRef} className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-secondary">
                  <th className="sticky left-0 z-10 border bg-secondary px-3 py-2 text-left font-bold whitespace-nowrap">
                    데이터명
                  </th>
                  {COLUMNS.map((column) => (
                    <th
                      key={column.key}
                      className="border px-3 py-2 text-right font-bold whitespace-nowrap"
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.key}>
                    <td
                      className={`sticky left-0 z-10 cursor-grab border bg-card px-3 py-2 whitespace-nowrap active:cursor-grabbing ${
                        row.isYeonsung ? 'font-bold text-primary' : ''
                      }`}
                      title="상관계수 분석 칸으로 드래그"
                      onPointerDown={(e) =>
                        correlation.beginPointer(
                          { key: row.key, label: row.name },
                          null,
                          e,
                        )
                      }
                    >
                      {row.name}
                    </td>
                    {COLUMNS.map((column) => (
                      <td
                        key={column.key}
                        className="border px-3 py-2 text-right whitespace-nowrap"
                      >
                        {formatCell(row.stats, column.key)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {hasData ? (
          <CorrelationPanel
            slots={correlation.slots}
            items={corrItems}
            data={corrData}
            hoverSlot={correlation.hoverSlot}
            onClear={correlation.clearSlot}
            onChipPointerDown={(index, item, e) =>
              correlation.beginPointer(item, index, e)
            }
          />
        ) : null}
        {correlation.ghost ? <CorrDragGhost drag={correlation.ghost} /> : null}
      </CardContent>
    </Card>
    <div className="flex justify-start">
      <Button
        type="button"
        variant="outline"
        onClick={handleMarkdown}
        disabled={!hasData || markdownBusy}
      >
        <FileText className="mr-1 h-4 w-4" /> 데이터 마크다운
      </Button>
    </div>
    </>
  );
}
