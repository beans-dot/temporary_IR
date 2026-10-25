import * as XLSX from 'xlsx';
import { logDataExport } from '@/lib/exportLog';
import { taskBudgetUnits } from './evalDraft';
import { achievementRate, fmt1, isInverseKpi, parseAmount } from './format';
import type {
  SpBudgetDraft,
  SpFundSource,
  SpKpi,
  SpTask,
} from './types';

export type XlsxCell = string | number;

const EMPTY_BUDGET = { budget: '', settlement: '' };

export function exportStamp() {
  return new Date().toISOString().slice(0, 10).replace(/-/g, '');
}

export function writeXlsxAndLog({
  rows,
  sheetName,
  filename,
  source,
  summary,
}: {
  rows: XlsxCell[][];
  sheetName: string;
  filename: string;
  source: string;
  summary?: string;
}) {
  const worksheet = XLSX.utils.aoa_to_sheet(rows);
  const colCount = rows[0]?.length ?? 0;
  worksheet['!cols'] = Array.from({ length: colCount }, (_, index) => ({
    wch: Math.max(
      12,
      ...rows.map((row) => String(row[index] ?? '').length + 2),
    ),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, filename);
  logDataExport({
    format: 'xlsx',
    source,
    filename,
    summary,
  });
}

export function kpiExportRows(kpis: SpKpi[], year: number): XlsxCell[][] {
  const rows: XlsxCell[][] = [
    ['코드', '지표명', '단위', '기준값', '목표', '실적', '달성률', '달성여부'],
  ];
  for (const kpi of kpis) {
    const target = kpi.targets[year] ?? null;
    const actual = kpi.results[year] ?? null;
    const rate = achievementRate(
      actual,
      target,
      isInverseKpi(kpi.kpiCode, kpi.displayCode),
    );
    rows.push([
      kpi.displayCode ?? kpi.kpiCode,
      kpi.kpiName,
      kpi.unit ?? '',
      kpi.baseline ?? '',
      target ?? '',
      actual ?? '',
      rate === null ? '' : `${fmt1(rate)}%`,
      rate === null ? '미입력' : rate >= 100 ? '달성' : '미달성',
    ]);
  }
  return rows;
}

export function settlementExportRows(
  tasks: SpTask[],
  fundSources: SpFundSource[],
  budgets: SpBudgetDraft,
  year: number,
): XlsxCell[][] {
  const rows: XlsxCell[][] = [
    [
      '실행과제 코드',
      '실행과제명',
      'TASK 코드',
      'TASK명',
      '재원',
      `${year} 예산`,
      `${year} 결산`,
      '집행률',
    ],
  ];

  for (const task of tasks) {
    const units = taskBudgetUnits(task);
    let taskBudget = 0;
    let taskSettlement = 0;
    let hasBudget = false;
    let hasSettlement = false;

    for (const unit of units) {
      for (const fund of fundSources) {
        const cell =
          budgets[
            `${task.taskCode}::${unit.code}::${fund.fundSourceId}`
          ] ?? EMPTY_BUDGET;
        const budget = parseAmount(cell.budget);
        const settlement = parseAmount(cell.settlement);
        if (budget !== null) {
          taskBudget += budget;
          hasBudget = true;
        }
        if (settlement !== null) {
          taskSettlement += settlement;
          hasSettlement = true;
        }
        const rate =
          budget !== null && budget > 0 && settlement !== null
            ? (settlement / budget) * 100
            : null;
        rows.push([
          task.displayCode ?? task.taskCode,
          task.taskName,
          unit.displayCode ?? unit.code,
          unit.name,
          fund.fundSourceName,
          budget ?? '',
          settlement ?? '',
          rate === null ? '' : `${fmt1(rate)}%`,
        ]);
      }
    }

    const subtotalRate =
      hasBudget && taskBudget > 0 && hasSettlement
        ? (taskSettlement / taskBudget) * 100
        : null;
    rows.push([
      task.displayCode ?? task.taskCode,
      task.taskName,
      '소계',
      '',
      '',
      hasBudget ? taskBudget : '',
      hasSettlement ? taskSettlement : '',
      subtotalRate === null ? '' : `${fmt1(subtotalRate)}%`,
    ]);
  }

  return rows;
}
