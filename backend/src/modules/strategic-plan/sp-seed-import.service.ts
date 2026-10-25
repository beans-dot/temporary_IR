import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';
import { IrSpEvaluation } from '../../entities/ir-sp-evaluation.entity';
import { IrSpFundSource } from '../../entities/ir-sp-fund-source.entity';
import { IrSpKpi } from '../../entities/ir-sp-kpi.entity';
import { IrSpKpiResult } from '../../entities/ir-sp-kpi-result.entity';
import { IrSpKpiTarget } from '../../entities/ir-sp-kpi-target.entity';
import { IrSpStrategy } from '../../entities/ir-sp-strategy.entity';
import { IrSpSubtask } from '../../entities/ir-sp-subtask.entity';
import { IrSpTask } from '../../entities/ir-sp-task.entity';
import { IrSpTaskBudget } from '../../entities/ir-sp-task-budget.entity';
import { IrUpdateLog } from '../../entities/ir-update-log.entity';
import { OfficeOrgService } from '../internal-org/office-org.service';
import {
  displayKpiCode,
  displayStrategy,
  displaySubtask,
  displayTask,
  kpiSuffixOf,
  parseKpiCode,
  parseSubtaskCode,
  parseTaskCode,
} from './sp-codes';
import { SpStructureService } from './sp-structure.service';
import {
  ImportSeedSnapshotDto,
  type SpSeedJsonMode,
} from './dto/strategic-plan.dto';
import {
  emptyReport,
  fillExecutionNarrative,
  parseActivities,
  parseFundSplit,
  parseKpiNote,
  readDept,
  readNodeCode,
  readNodeName,
  readNumber,
  reportHasContent,
  warnFundSumGap,
  type ParsedActivity,
  type ParsedKpiNote,
  type ParsedReport,
  type SeedIssue,
} from './sp-seed-report';
import {
  sanitizeKpiPoComments,
  sanitizeKpiPoEvals,
  sanitizeSurveyItems,
  sanitizeSurveyPlans,
  sanitizeTaskActivities,
} from './sanitize-evaluation';
import {
  SP_MAX_YEAR,
  SP_MIN_YEAR,
  SP_SEED_FUND_SOURCE_NAME,
} from './strategic-plan.constants';
import {
  canonicalFundName,
  SEED_EXTRACT_RULES,
  SP_DEPT_GRADE_CATALOG,
  SP_FUND_CATALOG,
  SP_PLAN_GRADE_CATALOG,
} from './sp-seed-codes';

const ISSUE_LIMIT = 80;
const RATE_TOLERANCE = 0.15;

export type SpSeedImportIssue = SeedIssue;

export interface SpSeedImportResult {
  dryRun: boolean;
  year: number;
  fundSourceName: string;
  fundSourceCreated: boolean;
  replaceMissing: boolean;
  /** 사업프로그램·지표 JSON을 기존 값과 합치는 방식. */
  jsonMode: SpSeedJsonMode;
  blocked: boolean;
  budget: {
    matched: number;
    unmatched: number;
    budgetThousand: number;
    executedThousand: number;
    budgetWon: number;
    executedWon: number;
    existingRows: number;
    replace: boolean;
    namedRows: number;
  };
  indicators: {
    matched: number;
    unmatched: number;
    rateMismatch: number;
    averageRate: number | null;
  };
  /** 자체평가 ①~⑤ 본문. 실적 숫자와 별도로 센다. */
  reports: {
    matched: number;
    unmatched: number;
    activities: number;
    kpiNotes: number;
    sections: number;
    /** 이번 파일이 건드릴 실행과제 중, 사업프로그램·지표 JSON이 이미 있는 건수 */
    existingJson: number;
  };
  usesSeedFund: boolean;
  /** 시딩 연도에만 JSON 이름·책임부서를 얹는 건수. 변경이력에 같은 수정으로 남는다. */
  textRevisions: number;
  /** 그 학년도 조직에 없어 행정부서로 만드는 이름 */
  newDepartments: string[];
  /** 개정으로 빠진 코드. 그 학년도에만 만든다. */
  historicalNodes: string[];
  issues: SpSeedImportIssue[];
  issueCount: number;
}

interface ParsedBudget {
  executionCode: string;
  subtaskCode: string;
  name: string;
  /** null이면 재원 구분 없는 합계 → 초기시딩 합계 */
  fundSourceName: string | null;
  budgetThousand: number | null;
  executedThousand: number | null;
}

interface ParsedIndicator {
  executionCode: string;
  code: string;
  name: string;
  unit: string;
  target: number | null;
  actual: number | null;
  rate: number | null;
}

interface ParsedName {
  kind: 'strategy' | 'task' | 'subtask' | 'kpi';
  code: string;
  name: string;
  dept: string;
  /** 실행과제는 전략 코드, 세부TASK·성과지표는 실행과제 코드. */
  parent: string;
}

interface YearTextPatch {
  kind: ParsedName['kind'];
  lineageId: string;
  displayCode: string;
  live: Record<string, unknown>;
  patch: Record<string, unknown>;
}

interface ParsedSnapshot {
  budgets: ParsedBudget[];
  indicators: ParsedIndicator[];
  reports: ParsedReport[];
  names: ParsedName[];
  issues: SpSeedImportIssue[];
}

interface MatchedActivity extends ParsedActivity {
  taskCode: string;
  storedSubtaskCode: string;
  fundSourceId: number | null;
  useSeedFund: boolean;
}

interface MatchedReport {
  taskCode: string;
  activities: MatchedActivity[];
  kpiNotes: Array<ParsedKpiNote & { kpiCode: string }>;
  deptSummary?: string;
  deptAnalysis?: string;
  budgetAdequacy?: string;
  budgetAdequacyGrade?: string;
  processAdequacy?: string;
  processAdequacyGrade?: string;
  kpiAdequacy?: string;
  kpiAdequacyGrade?: string;
  surveyItemsNa?: boolean;
  surveyPlansNa?: boolean;
  surveyItems?: ParsedReport['surveyItems'];
  surveyPlans?: ParsedReport['surveyPlans'];
}

interface MatchedBudget extends ParsedBudget {
  taskCode: string;
  /** 예결산 표가 읽는 안정 코드. 화면의 A11-혁신-1과 다를 수 있다. */
  storedSubtaskCode: string;
  /** null이면 초기시딩 합계. 저장 직전에 재원 id를 채운다. */
  fundSourceId: number | null;
  budgetWon: number | null;
  executedWon: number | null;
}

interface MatchedIndicator extends ParsedIndicator {
  kpiCode: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

function thousandToWon(value: number): number {
  return Math.round(value * 1000);
}

function addTenths(tenths: number, value: number): number {
  return tenths + Math.round(value * 10);
}

function pushIssue(
  issues: SpSeedImportIssue[],
  kind: SpSeedImportIssue['kind'],
  code: string,
  message: string,
) {
  issues.push({ kind, code, message });
}

function jsonModeLabel(mode: SpSeedJsonMode): string {
  if (mode === 'keep') return ' · JSON 신규만';
  if (mode === 'sync') return ' · JSON 동기화';
  return '';
}

/**
 * keep은 같은 키의 기존 값을 남기고 없는 키만 더한다.
 * overwrite는 파일 키로 덮고, 파일에 없는 기존 키는 남긴다.
 */
function mergeKeyedJson<T>(
  mode: Exclude<SpSeedJsonMode, 'sync'>,
  existing: Record<string, T> | null | undefined,
  incoming: Record<string, T>,
): Record<string, T> {
  if (mode === 'keep') return { ...incoming, ...(existing ?? {}) };
  return { ...(existing ?? {}), ...incoming };
}

function hasStoredJson(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).length > 0;
  }
  return false;
}

/** 파일이 사업프로그램·지표 JSON을 쓰는 실행과제 중, 그 칸에 값이 이미 있는 건수. */
function countExistingJson(
  reports: MatchedReport[],
  existing: IrSpEvaluation[],
): number {
  const byCode = new Map(existing.map((row) => [row.taskCode, row]));
  let count = 0;
  for (const report of reports) {
    const stored = byCode.get(report.taskCode);
    if (!stored) continue;
    const touchesActivities =
      report.activities.length > 0 && hasStoredJson(stored.taskActivities);
    const touchesKpi =
      report.kpiNotes.length > 0 &&
      (hasStoredJson(stored.kpiPoEvals) || hasStoredJson(stored.kpiPoComments));
    if (touchesActivities || touchesKpi) count += 1;
  }
  return count;
}

function fundOpenInYear(fund: IrSpFundSource, year: number) {
  if (!fund.isActive) return false;
  if (fund.effectiveFrom > year) return false;
  if (fund.abolishedFrom != null && fund.abolishedFrom <= year) return false;
  return true;
}

function compactName(value: string) {
  return value.replace(/\s+/g, '');
}

function reportHasNarrative(report: ParsedReport) {
  return (
    report.deptSummary !== undefined ||
    report.deptAnalysis !== undefined ||
    report.budgetAdequacy !== undefined ||
    report.budgetAdequacyGrade !== undefined ||
    report.processAdequacy !== undefined ||
    report.processAdequacyGrade !== undefined ||
    report.kpiAdequacy !== undefined ||
    report.kpiAdequacyGrade !== undefined ||
    report.surveyItemsNa !== undefined ||
    report.surveyPlansNa !== undefined ||
    report.surveyItems !== undefined ||
    report.surveyPlans !== undefined
  );
}

function budgetKey(row: Pick<ParsedBudget, 'subtaskCode' | 'fundSourceName'>) {
  return `${row.subtaskCode}\0${row.fundSourceName ?? ''}`;
}

function rememberName(
  names: ParsedName[],
  kind: ParsedName['kind'],
  code: string,
  name: string,
  dept = '',
  parent = '',
) {
  if (!code || (!name && !dept)) return;
  names.push({ kind, code, name, dept, parent });
}

/** 보고서 코드 C32-평생-1, 옛 순서 E32-1-기획을 안정 코드 C32-1, E32-1로 읽는다. */
function parseSeedSubtask(raw: string): {
  taskAlpha: string;
  seq: number;
  hangul: string;
  stable: string;
} | null {
  const value = raw.trim();
  const normal = parseSubtaskCode(value);
  if (normal.seq > 0 && /^[A-Z]\d+$/.test(normal.taskAlpha)) {
    return {
      taskAlpha: normal.taskAlpha,
      seq: normal.seq,
      hangul: normal.hangulCode,
      stable: normal.alphaCode,
    };
  }
  const legacy = /^([A-Za-z]\d+)-(\d+)-([^-]+)$/.exec(value);
  if (!legacy) return null;
  const taskAlpha = legacy[1].toUpperCase();
  const seq = Number(legacy[2]);
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { taskAlpha, seq, hangul: legacy[3], stable: `${taskAlpha}-${seq}` };
}

export function parseSeedSnapshot(
  strategies: unknown[],
  year: number,
): ParsedSnapshot {
  const issues: SpSeedImportIssue[] = [];
  const budgets: ParsedBudget[] = [];
  const indicators: ParsedIndicator[] = [];
  const names: ParsedName[] = [];
  const reportByCode = new Map<string, ParsedReport>();
  const seenBudget = new Set<string>();
  const seenKpis = new Set<string>();

  const pushBudget = (row: ParsedBudget) => {
    const key = budgetKey(row);
    if (seenBudget.has(key)) {
      const fund = row.fundSourceName ?? '합계';
      pushIssue(
        issues,
        'warn',
        row.subtaskCode,
        `${row.subtaskCode} ${fund}가 파일에 중복되어 마지막 금액을 씁니다.`,
      );
      for (let i = budgets.length - 1; i >= 0; i -= 1) {
        if (budgetKey(budgets[i]) === key) budgets.splice(i, 1);
      }
    }
    seenBudget.add(key);
    budgets.push(row);
  };

  strategies.forEach((rawStrategy, index) => {
    if (!isRecord(rawStrategy)) {
      pushIssue(
        issues,
        'warn',
        '',
        `전략과제 ${index + 1}번째 항목이 객체가 아닙니다.`,
      );
      return;
    }
    const strategyCode = readNodeCode(rawStrategy) || `${index + 1}`;
    rememberName(names, 'strategy', readNodeCode(rawStrategy), readNodeName(rawStrategy));
    const executionTasks = rawStrategy.executionTasks;
    if (executionTasks === undefined) return;
    if (!Array.isArray(executionTasks)) {
      pushIssue(
        issues,
        'warn',
        strategyCode,
        `전략과제 ${strategyCode}의 executionTasks가 배열이 아닙니다.`,
      );
      return;
    }

    executionTasks.forEach((rawTask) => {
      if (!isRecord(rawTask)) {
        pushIssue(
          issues,
          'warn',
          strategyCode,
          `전략과제 ${strategyCode} 안에 객체가 아닌 실행과제가 있습니다.`,
        );
        return;
      }
      const executionCode = readNodeCode(rawTask);
      if (!executionCode) {
        pushIssue(
          issues,
          'warn',
          strategyCode,
          `전략과제 ${strategyCode}에 코드 없는 실행과제가 있습니다.`,
        );
        return;
      }
      const executionName = readNodeName(rawTask);
      rememberName(
        names,
        'task',
        executionCode,
        executionName,
        readDept(rawTask),
        strategyCode,
      );
      let report = reportByCode.get(executionCode);
      if (report) {
        pushIssue(
          issues,
          'warn',
          executionCode,
          `${executionCode} 실행과제가 파일에 중복되어 본문은 나중 값을 쓰고 사업 행은 이어서 넣습니다.`,
        );
      } else {
        report = emptyReport(executionCode, executionName);
        reportByCode.set(executionCode, report);
      }
      if (executionName) report.executionName = executionName;
      fillExecutionNarrative(report, rawTask, issues);
      report.activities.push(...parseActivities(rawTask, executionCode, issues));

      const taskRows = rawTask.tasks;
      if (taskRows !== undefined && !Array.isArray(taskRows)) {
        pushIssue(
          issues,
          'warn',
          executionCode,
          `${executionCode}의 tasks가 배열이 아닙니다.`,
        );
      } else if (Array.isArray(taskRows)) {
        for (const rawRow of taskRows) {
          if (!isRecord(rawRow)) {
            pushIssue(
              issues,
              'warn',
              executionCode,
              `${executionCode} 안에 객체가 아닌 세부TASK가 있습니다.`,
            );
            continue;
          }
          const subtaskCode = readNodeCode(rawRow);
          if (!subtaskCode) {
            pushIssue(
              issues,
              'miss',
              executionCode,
              `${executionCode}에 코드 없는 세부TASK가 있습니다.`,
            );
            continue;
          }
          const subtaskName = readNodeName(rawRow);
          rememberName(
            names,
            'subtask',
            subtaskCode,
            subtaskName,
            readDept(rawRow),
            executionCode,
          );
          report.activities.push(...parseActivities(rawRow, subtaskCode, issues));

          const budgetRead = readNumber(
            pick(rawRow, ['예산_천원', 'budget', '예산']),
          );
          const executedRead = readNumber(
            pick(rawRow, ['결산_천원', 'executed', 'settlement', '결산', '집행']),
          );
          const split = parseFundSplit(rawRow, subtaskCode, issues);
          if (split.mode === 'split') {
            if (!budgetRead.ok || !executedRead.ok) {
              pushIssue(
                issues,
                'warn',
                subtaskCode,
                `${subtaskCode} 합계 예산 또는 결산이 숫자가 아닙니다. 재원별 금액만 봅니다.`,
              );
            } else {
              warnFundSumGap(
                issues,
                subtaskCode,
                '예산',
                budgetRead.value,
                split.rows.map((row) => row.budgetThousand),
              );
              warnFundSumGap(
                issues,
                subtaskCode,
                '결산',
                executedRead.value,
                split.rows.map((row) => row.executedThousand),
              );
            }
            if (split.rows.length === 0) {
              pushIssue(
                issues,
                'warn',
                subtaskCode,
                `${subtaskCode} 재원별 금액이 없어 예결산에 넣지 않습니다. 재원별이 있으면 합계는 저장하지 않습니다.`,
              );
            }
            for (const fundRow of split.rows) {
              pushBudget({
                executionCode,
                subtaskCode,
                name: subtaskName,
                fundSourceName: fundRow.fundSourceName,
                budgetThousand: fundRow.budgetThousand,
                executedThousand: fundRow.executedThousand,
              });
            }
            continue;
          }
          if (!budgetRead.ok || !executedRead.ok) {
            pushIssue(
              issues,
              'miss',
              subtaskCode,
              `${subtaskCode}의 예산 또는 결산이 숫자가 아닙니다.`,
            );
            continue;
          }
          if (
            (budgetRead.value !== null && budgetRead.value < 0) ||
            (executedRead.value !== null && executedRead.value < 0)
          ) {
            pushIssue(
              issues,
              'miss',
              subtaskCode,
              `${subtaskCode}의 예산 또는 결산이 음수입니다.`,
            );
            continue;
          }
          if (budgetRead.value === null && executedRead.value === null) continue;
          pushBudget({
            executionCode,
            subtaskCode,
            name: subtaskName,
            fundSourceName: null,
            budgetThousand: budgetRead.value,
            executedThousand: executedRead.value,
          });
        }
      }

      const indicatorRows = rawTask.indicators;
      if (indicatorRows !== undefined && !Array.isArray(indicatorRows)) {
        pushIssue(
          issues,
          'warn',
          executionCode,
          `${executionCode}의 indicators가 배열이 아닙니다.`,
        );
        return;
      }
      if (!Array.isArray(indicatorRows)) return;

      for (const rawIndicator of indicatorRows) {
        if (!isRecord(rawIndicator)) {
          pushIssue(
            issues,
            'warn',
            executionCode,
            `${executionCode} 안에 객체가 아닌 성과지표가 있습니다.`,
          );
          continue;
        }
        const code = readNodeCode(rawIndicator);
        if (!code) {
          pushIssue(
            issues,
            'miss',
            executionCode,
            `${executionCode}에 코드 없는 성과지표가 있습니다.`,
          );
          continue;
        }
        const indicatorName = readNodeName(rawIndicator);
        rememberName(
          names,
          'kpi',
          code,
          indicatorName,
          readDept(rawIndicator),
          executionCode,
        );
        const note = parseKpiNote(rawIndicator, code, indicatorName, issues);
        if (note) report.kpiNotes.push(note);
        const targetRead = readNumber(
          pick(rawIndicator, [`target${year}`, `목표${year}`, 'target', '목표']),
        );
        const actualRead = readNumber(
          pick(rawIndicator, [`actual${year}`, `실적${year}`, 'actual', '실적']),
        );
        const rateRead = readNumber(
          pick(rawIndicator, [`rate${year}`, `달성률${year}`, 'rate', '달성률']),
        );
        if (!targetRead.ok || !actualRead.ok) {
          pushIssue(
            issues,
            'miss',
            code,
            `${code}의 목표 또는 실적이 숫자가 아닙니다.`,
          );
          continue;
        }
        if (targetRead.value === null && actualRead.value === null) {
          if (!note) {
            pushIssue(
              issues,
              'warn',
              code,
              `${code}에 ${year} 목표·실적이 없어 건너뜁니다.`,
            );
          }
          continue;
        }
        if (seenKpis.has(code.toLowerCase())) {
          pushIssue(
            issues,
            'warn',
            code,
            `${code}가 파일에 중복되어 마지막 값을 씁니다.`,
          );
          const prev = indicators.findIndex(
            (row) => row.code.toLowerCase() === code.toLowerCase(),
          );
          if (prev >= 0) indicators.splice(prev, 1);
        }
        seenKpis.add(code.toLowerCase());
        const unitValue = pick(rawIndicator, ['unit', '단위']);
        indicators.push({
          executionCode,
          code,
          name: indicatorName,
          unit: typeof unitValue === 'string' ? unitValue.trim() : '',
          target: targetRead.value,
          actual: actualRead.value,
          rate: rateRead.ok ? rateRead.value : null,
        });
        if (!rateRead.ok) {
          pushIssue(
            issues,
            'warn',
            code,
            `${code}의 달성률이 숫자가 아니어서 대조에서 빼었습니다.`,
          );
        }
      }
    });
  });

  const reports = [...reportByCode.values()].filter(reportHasContent);
  return { budgets, indicators, reports, names, issues };
}

@Injectable()
export class SpSeedImportService {
  constructor(
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly structure: SpStructureService,
    private readonly officeOrg: OfficeOrgService,
  ) {}

  async importSnapshot(
    dto: ImportSeedSnapshotDto,
    userId: string,
  ): Promise<SpSeedImportResult> {
    const year = dto.year ?? 2025;
    if (year < SP_MIN_YEAR || year > SP_MAX_YEAR) {
      throw new BadRequestException(
        `연도는 ${SP_MIN_YEAR}~${SP_MAX_YEAR} 사이여야 합니다.`,
      );
    }
    if (!Array.isArray(dto.strategies) || dto.strategies.length === 0) {
      throw new BadRequestException('strategies 배열이 비어 있습니다.');
    }

    const dryRun = Boolean(dto.dryRun);
    const replaceMissing = Boolean(dto.replaceMissing);
    const jsonMode: SpSeedJsonMode = dto.jsonMode ?? 'overwrite';
    const input = {
      strategies: dto.strategies,
      year,
      dryRun,
      replaceMissing,
      jsonMode,
      userId,
    };
    if (dryRun) return this.apply(this.dataSource.manager, input);
    return this.dataSource.transaction((manager) => this.apply(manager, input));
  }

  private async apply(
    manager: EntityManager,
    input: {
      strategies: unknown[];
      year: number;
      dryRun: boolean;
      replaceMissing: boolean;
      jsonMode: SpSeedJsonMode;
      userId: string;
    },
  ): Promise<SpSeedImportResult> {
    const parsed = parseSeedSnapshot(input.strategies, input.year);
    const [strategies, tasks, subtasks, kpis, fundSources] = await Promise.all([
      manager.find(IrSpStrategy),
      manager.find(IrSpTask),
      manager.find(IrSpSubtask),
      manager.find(IrSpKpi),
      manager.find(IrSpFundSource),
    ]);
    const strategyById = new Map(strategies.map((row) => [row.strategyId, row]));
    const fundByName = new Map(
      fundSources.map((row) => [row.fundSourceName.trim(), row]),
    );
    const taskByAny = new Map<string, IrSpTask>();
    for (const task of tasks) {
      taskByAny.set(task.taskCode, task);
      taskByAny.set(displayTask(task.taskCode, task.hangulCode), task);
    }
    const subtaskCountByTask = new Map<string, number>();
    const subtaskByAny = new Map<string, IrSpSubtask>();
    for (const sub of subtasks) {
      subtaskCountByTask.set(
        sub.taskCode,
        (subtaskCountByTask.get(sub.taskCode) ?? 0) + 1,
      );
      subtaskByAny.set(sub.subtaskCode, sub);
      subtaskByAny.set(
        displaySubtask(sub.taskCode, sub.seqNo, sub.hangulCode),
        sub,
      );
    }
    const kpiByCode = new Map<string, IrSpKpi>();
    for (const kpi of kpis) {
      kpiByCode.set(kpi.kpiCode.toLowerCase(), kpi);
      const task = kpi.taskCode ? taskByAny.get(kpi.taskCode) : undefined;
      const suffix = kpi.suffix ?? kpi.kpiCode.slice(-1);
      if (task && /^[a-z]$/.test(suffix)) {
        kpiByCode.set(
          displayKpiCode(task.taskCode, suffix).toLowerCase(),
          kpi,
        );
      }
    }
    const storedTargets = await manager.find(IrSpKpiTarget, {
      where: { year: input.year },
    });
    const planTargetByCode = new Map(
      storedTargets.map((row) => [row.kpiCode, row.targetValue]),
    );

    const seenStrategy = new Set<string>();
    const textPatches: YearTextPatch[] = [];
    const textSeen = new Set<string>();
    const newDepartments = new Set<string>();
    let textNoted = 0;
    const [strategyVersions, taskVersions, subtaskVersions, kpiVersions, offices] =
      await Promise.all([
        this.structure.versionsFor('strategy'),
        this.structure.versionsFor('task'),
        this.structure.versionsFor('subtask'),
        this.structure.versionsFor('kpi'),
        this.officeOrg.listSelectable(input.year),
      ]);
    const deptLabel = (stored: unknown) => {
      const code = typeof stored === 'string' ? stored.trim() : '';
      if (!code) return '';
      return offices.find((row) => row.officeCode === code)?.deptName ?? code;
    };
    const resolveDept = (text: string) => {
      const hit = offices.find(
        (row) => row.officeCode === text || row.deptName === text,
      );
      return hit?.officeCode ?? text;
    };
    const shownPayload = (
      versions: Awaited<ReturnType<SpStructureService['versionsFor']>>,
      lineageId: string,
    ) => {
      const rows = versions.get(lineageId);
      if (!rows?.length) return null;
      const hit = [...rows]
        .sort(
          (a, b) =>
            b.effectiveFrom - a.effectiveFrom || b.versionId - a.versionId,
        )
        .find(
          (row) =>
            row.effectiveFrom <= input.year &&
            (row.effectiveTo == null || input.year <= row.effectiveTo),
        );
      return hit?.payload ?? null;
    };
    const queueText = (row: YearTextPatch & {
      versions: Awaited<ReturnType<SpStructureService['versionsFor']>>;
      fileName: string;
      nameKey: string;
      fileDept: string;
    }) => {
      const base = shownPayload(row.versions, row.lineageId) ?? row.live;
      const patch: Record<string, unknown> = {};
      const visibleName = String(base[row.nameKey] ?? '');
      if (row.fileName && compactName(row.fileName) !== compactName(visibleName)) {
        patch[row.nameKey] = row.fileName;
      }
      const deptKey = row.kind === 'task' || row.kind === 'kpi' ? 'primaryDept' : '';
      if (deptKey && row.fileDept) {
        const visibleDept = deptLabel(base[deptKey]);
        const visibleCode =
          typeof base[deptKey] === 'string' ? base[deptKey].trim() : '';
        if (
          compactName(row.fileDept) !== compactName(visibleDept) &&
          row.fileDept !== visibleCode
        ) {
          const resolved = resolveDept(row.fileDept);
          patch[deptKey] = resolved;
          const known = offices.some(
            (office) =>
              office.officeCode === resolved || office.deptName === row.fileDept,
          );
          if (!known) newDepartments.add(row.fileDept);
        }
      }
      if (Object.keys(patch).length === 0) return;
      const key = `${row.kind}:${row.lineageId}`;
      if (textSeen.has(key)) return;
      textSeen.add(key);
      textPatches.push({
        kind: row.kind,
        lineageId: row.lineageId,
        displayCode: row.displayCode,
        live: row.live,
        patch,
      });
      textNoted += 1;
      if (textNoted <= 5) {
        const bits: string[] = [];
        if (typeof patch[row.nameKey] === 'string') {
          bits.push(`이름 「${visibleName}」→「${row.fileName}」`);
        }
        if (deptKey && patch[deptKey] !== undefined) {
          bits.push(
            `책임부서 「${deptLabel(base[deptKey]) || '없음'}」→「${row.fileDept}」`,
          );
        }
        if (typeof patch.hangulCode === 'string') {
          bits.push(
            `한글 코드 「${String(base.hangulCode ?? '') || '없음'}」→「${patch.hangulCode}」`,
          );
        }
        pushIssue(
          parsed.issues,
          'warn',
          row.displayCode,
          `${row.displayCode}는 ${input.year}학년도 변경이력에 JSON 기준으로 남습니다. ${bits.join(', ')}. 다른 연도의 최신 체계는 그대로입니다.`,
        );
      }
    };
    const historicalNodes = await this.placeHistorical(manager, input, parsed, {
      strategies: strategyById,
      tasks,
      subtasks,
      kpis,
      taskByAny,
      subtaskByAny,
      kpiByCode,
      subtaskCountByTask,
    });

    for (const raw of input.strategies) {
      if (!isRecord(raw)) continue;
      const code = readNodeCode(raw);
      if (!code || seenStrategy.has(code)) continue;
      seenStrategy.add(code);
      const stored = strategyById.get(code);
      if (!stored) {
        pushIssue(
          parsed.issues,
          'warn',
          code,
          `전략과제 ${code}가 발전계획에 없습니다. 하위 코드가 맞으면 금액과 지표는 넣습니다.`,
        );
        continue;
      }
      queueText({
        kind: 'strategy',
        lineageId: stored.strategyId,
        displayCode: displayStrategy(stored.strategyId),
        live: this.structure.strategyPayload(stored),
        versions: strategyVersions,
        fileName: readNodeName(raw),
        nameKey: 'strategyName',
        fileDept: readDept(raw),
        patch: {},
      });
    }
    for (const item of parsed.names) {
      if (item.kind === 'task') {
        const stored = taskByAny.get(item.code);
        if (!stored) continue;
        const fileHangul = parseTaskCode(item.code).hangulCode;
        const patch: Record<string, unknown> = {};
        if (fileHangul && fileHangul !== (stored.hangulCode ?? '').trim()) {
          patch.hangulCode = fileHangul;
        }
        queueText({
          kind: 'task',
          lineageId: stored.taskCode,
          displayCode: patch.hangulCode
            ? item.code
            : displayTask(stored.taskCode, stored.hangulCode),
          live: this.structure.taskPayload(stored),
          versions: taskVersions,
          fileName: item.name,
          nameKey: 'taskName',
          fileDept: item.dept,
          patch,
        });
      } else if (item.kind === 'subtask') {
        const stored = subtaskByAny.get(item.code);
        if (!stored) continue;
        const fileSub = parseSeedSubtask(item.code);
        const patch: Record<string, unknown> = {};
        if (fileSub?.hangul && fileSub.hangul !== (stored.hangulCode ?? '').trim()) {
          patch.hangulCode = fileSub.hangul;
        }
        queueText({
          kind: 'subtask',
          lineageId: stored.subtaskCode,
          displayCode: patch.hangulCode
            ? item.code
            : displaySubtask(stored.taskCode, stored.seqNo, stored.hangulCode),
          live: this.structure.subtaskPayload(stored),
          versions: subtaskVersions,
          fileName: item.name,
          nameKey: 'subtaskName',
          fileDept: item.dept,
          patch,
        });
      } else if (item.kind === 'kpi') {
        const stored = kpiByCode.get(item.code.toLowerCase());
        if (!stored) continue;
        const task = stored.taskCode ? taskByAny.get(stored.taskCode) : undefined;
        const suffix = stored.suffix ?? stored.kpiCode.slice(-1);
        const display =
          task && /^[a-z]$/.test(suffix)
            ? displayKpiCode(task.taskCode, suffix)
            : stored.kpiCode;
        queueText({
          kind: 'kpi',
          lineageId: stored.kpiCode,
          displayCode: display,
          live: this.structure.kpiPayload(stored),
          versions: kpiVersions,
          fileName: item.name,
          nameKey: 'kpiName',
          fileDept: item.dept,
          patch: {},
        });
      }
    }
    if (textNoted > 5) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        `이름·책임부서·한글 코드가 다른 항목이 ${textNoted}건입니다. ${input.year}학년도 변경이력에 남고, 다른 연도의 최신 체계는 그대로입니다.`,
      );
    }
    if (newDepartments.size > 0) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        `책임부서 ${[...newDepartments].join(', ')}는 ${input.year}학년도 조직에 없습니다. 반영하면 행정부서로 만들고 조직 변경이력에 남깁니다.`,
      );
    }

    const matchedBudgets: MatchedBudget[] = [];
    let budgetUnmatched = 0;
    const toWon = (value: number | null) =>
      value === null ? null : thousandToWon(value);
    const labelOf = (code: string, name: string) =>
      name ? `${code} ${name}` : code;
    const subtaskNameByFileCode = new Map<string, string>();
    for (const item of parsed.names) {
      if (item.kind === 'subtask') subtaskNameByFileCode.set(item.code, item.name);
    }
    const fileCodeAlias = new Map<string, { taskCode: string; stored: string }>();
    const renameNoted = new Set<string>();
    const matchSubtask = (fileCode: string, executionCode: string, explicitName = '') => {
      const direct = subtaskByAny.get(fileCode);
      if (direct) {
        return { taskCode: direct.taskCode, stored: direct.subtaskCode, viaName: false };
      }
      const aliased = fileCodeAlias.get(fileCode);
      if (aliased) return { ...aliased, viaName: false };
      const name = explicitName || subtaskNameByFileCode.get(fileCode) || '';
      const wanted = compactName(name);
      if (!wanted) return null;
      const parent = taskByAny.get(executionCode);
      const sameParent = parent
        ? subtasks.filter((row) => row.taskCode === parent.taskCode)
        : [];
      const hitsOf = (rows: IrSpSubtask[]) =>
        rows.filter((row) => compactName(row.subtaskName) === wanted);
      const hits = hitsOf(sameParent);
      const hit = hits.length === 1 ? hits[0] : hits.length === 0 ? hitsOf(subtasks) : [];
      const chosen = Array.isArray(hit) ? (hit.length === 1 ? hit[0] : null) : hit;
      if (!chosen) return null;
      const resolved = { taskCode: chosen.taskCode, stored: chosen.subtaskCode };
      fileCodeAlias.set(fileCode, resolved);
      if (!renameNoted.has(fileCode)) {
        renameNoted.add(fileCode);
        pushIssue(
          parsed.issues,
          'warn',
          fileCode,
          `${labelOf(fileCode, name)}의 code_id가 코드표에 없습니다. 이름이 같은 ${displaySubtask(chosen.taskCode, chosen.seqNo, chosen.hangulCode)}에 넣습니다.`,
        );
      }
      return { ...resolved, viaName: true };
    };
    const normalizeFund = (label: string) =>
      canonicalFundName(label.trim()) ?? label.trim();
    const fundsToCreate = new Set<string>();
    const catalogFundId = (label: string) => {
      const name = normalizeFund(label);
      if (!name) return undefined;
      const fund = fundByName.get(name);
      if (fund && fundOpenInYear(fund, input.year)) return fund.fundSourceId;
      fundsToCreate.add(name);
      return null;
    };
    for (const row of parsed.budgets) {
      let fundSourceId: number | null = null;
      if (row.fundSourceName && row.fundSourceName !== SP_SEED_FUND_SOURCE_NAME) {
        row.fundSourceName = normalizeFund(row.fundSourceName);
        const resolved = catalogFundId(row.fundSourceName);
        if (resolved === undefined) {
          budgetUnmatched += 1;
          pushIssue(
            parsed.issues,
            'miss',
            row.subtaskCode,
            `${labelOf(row.subtaskCode, row.name)}의 재원 이름이 비어 있습니다.`,
          );
          continue;
        }
        fundSourceId = resolved;
      }
      const subtask = matchSubtask(row.subtaskCode, row.executionCode, row.name);
      const task = taskByAny.get(row.executionCode);
      if (subtask) {
        const parent = taskByAny.get(subtask.taskCode);
        const parentLabel = parent
          ? displayTask(parent.taskCode, parent.hangulCode)
          : subtask.taskCode;
        if (task && task.taskCode !== subtask.taskCode) {
          pushIssue(
            parsed.issues,
            'warn',
            row.subtaskCode,
            `${row.subtaskCode}의 상위 실행과제는 ${parentLabel}입니다. JSON의 ${row.executionCode} 대신 저장된 상위에 넣습니다.`,
          );
        }
        matchedBudgets.push({
          ...row,
          taskCode: subtask.taskCode,
          storedSubtaskCode: subtask.stored,
          fundSourceId,
          budgetWon: toWon(row.budgetThousand),
          executedWon: toWon(row.executedThousand),
        });
        continue;
      }
      const bareTask =
        task && (subtaskCountByTask.get(task.taskCode) ?? 0) === 0
          ? task
          : undefined;
      const bareLabel = bareTask
        ? displayTask(bareTask.taskCode, bareTask.hangulCode)
        : '';
      if (
        bareTask &&
        (row.subtaskCode === bareTask.taskCode || row.subtaskCode === bareLabel)
      ) {
        matchedBudgets.push({
          ...row,
          taskCode: bareTask.taskCode,
          storedSubtaskCode: bareTask.taskCode,
          fundSourceId,
          budgetWon: toWon(row.budgetThousand),
          executedWon: toWon(row.executedThousand),
        });
        continue;
      }
      budgetUnmatched += 1;
      pushIssue(
        parsed.issues,
        'miss',
        row.subtaskCode,
        `${labelOf(row.subtaskCode, row.name)} 세부TASK를 찾지 못했습니다.`,
      );
    }

    const matchedIndicators: MatchedIndicator[] = [];
    let indicatorUnmatched = 0;
    let rateMismatch = 0;
    let rateSum = 0;
    let rateCount = 0;
    let unitMismatch = 0;
    let targetKept = 0;
    for (const row of parsed.indicators) {
      const kpi = kpiByCode.get(row.code.toLowerCase());
      if (!kpi) {
        indicatorUnmatched += 1;
        pushIssue(
          parsed.issues,
          'miss',
          row.code,
          `${row.code} 성과지표를 찾지 못했습니다.`,
        );
        continue;
      }
      if (row.actual === null) {
        pushIssue(
          parsed.issues,
          'warn',
          row.code,
          `${row.code}는 실적이 없어 자체평가에 넣지 않습니다. 목표는 바꾸지 않습니다.`,
        );
        continue;
      }
      const planTarget = planTargetByCode.get(kpi.kpiCode) ?? null;
      if (
        row.target !== null &&
        (planTarget === null || Math.abs(row.target - planTarget) > 0.0001)
      ) {
        targetKept += 1;
        if (targetKept <= 5) {
          pushIssue(
            parsed.issues,
            'warn',
            row.code,
            planTarget === null
              ? `${row.code} 파일 목표 ${row.target}는 넣지 않습니다. 실적만 자체평가에 넣습니다.`
              : `${row.code} 파일 목표 ${row.target}는 넣지 않습니다. 발전계획 목표 ${planTarget}를 유지합니다.`,
          );
        }
      }
      if (row.unit && row.unit !== (kpi.unit ?? '').trim()) {
        unitMismatch += 1;
        if (unitMismatch <= 5) {
          pushIssue(
            parsed.issues,
            'warn',
            row.code,
            `${row.code} 단위가 다릅니다. 단위는 유지합니다. (저장 ${kpi.unit ?? '–'} / 파일 ${row.unit})`,
          );
        }
      }
      const fileTask = taskByAny.get(row.executionCode);
      const linkedTask = kpi.taskCode ? taskByAny.get(kpi.taskCode) : undefined;
      const linkedLabel = linkedTask
        ? displayTask(linkedTask.taskCode, linkedTask.hangulCode)
        : (kpi.taskCode ?? '');
      if (
        kpi.taskCode &&
        row.executionCode &&
        kpi.taskCode !== (fileTask?.taskCode ?? row.executionCode) &&
        linkedLabel !== row.executionCode
      ) {
        pushIssue(
          parsed.issues,
          'warn',
          row.code,
          `${row.code}는 실행과제 ${linkedLabel}에 연결되어 있습니다. JSON의 ${row.executionCode}와 달라도 값은 이 지표에 넣습니다.`,
        );
      }
      if (planTarget !== null && planTarget !== 0) {
        const computed = (row.actual / planTarget) * 100;
        rateSum += computed;
        rateCount += 1;
        if (row.rate !== null && Math.abs(computed - row.rate) > RATE_TOLERANCE) {
          rateMismatch += 1;
          pushIssue(
            parsed.issues,
            'warn',
            row.code,
            `${row.code} 파일 달성률은 ${row.rate}%이고, 실적÷발전계획 목표는 ${computed.toFixed(1)}%입니다. 성과지표 조회는 발전계획 목표로 계산합니다.`,
          );
        }
      }
      matchedIndicators.push({ ...row, kpiCode: kpi.kpiCode });
    }
    if (unitMismatch > 5) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        `단위가 다른 성과지표가 ${unitMismatch}건입니다. 단위는 바꾸지 않습니다.`,
      );
    }
    if (targetKept > 5) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        `파일 목표가 발전계획과 다른 지표가 ${targetKept}건입니다. 목표는 바꾸지 않습니다.`,
      );
    }

    const matchedReports = new Map<string, MatchedReport>();
    const ensureReport = (taskCode: string) => {
      let row = matchedReports.get(taskCode);
      if (!row) {
        row = { taskCode, activities: [], kpiNotes: [] };
        matchedReports.set(taskCode, row);
      }
      return row;
    };
    const resolveUnit = (subtaskCode: string, executionCode: string) => {
      const subtask = matchSubtask(subtaskCode, executionCode);
      if (subtask) {
        return { taskCode: subtask.taskCode, stored: subtask.stored };
      }
      const task = taskByAny.get(executionCode);
      const bare =
        task && (subtaskCountByTask.get(task.taskCode) ?? 0) === 0
          ? task
          : undefined;
      const bareLabel = bare ? displayTask(bare.taskCode, bare.hangulCode) : '';
      if (
        bare &&
        (subtaskCode === bare.taskCode || subtaskCode === bareLabel)
      ) {
        return { taskCode: bare.taskCode, stored: bare.taskCode };
      }
      return null;
    };
    let reportUnmatched = 0;
    const narrativeKeys = [
      'deptSummary',
      'deptAnalysis',
      'budgetAdequacy',
      'budgetAdequacyGrade',
      'processAdequacy',
      'processAdequacyGrade',
      'kpiAdequacy',
      'kpiAdequacyGrade',
      'surveyItemsNa',
      'surveyPlansNa',
      'surveyItems',
      'surveyPlans',
    ] as const;
    for (const report of parsed.reports) {
      const task = taskByAny.get(report.executionCode);
      if (reportHasNarrative(report)) {
        if (!task) {
          reportUnmatched += 1;
          pushIssue(
            parsed.issues,
            'miss',
            report.executionCode,
            `${labelOf(report.executionCode, report.executionName)} 실행과제를 찾지 못해 ③④⑤를 넣지 못했습니다.`,
          );
        } else {
          const target = ensureReport(task.taskCode);
          for (const key of narrativeKeys) {
            if (report[key] !== undefined) {
              (target as unknown as Record<string, unknown>)[key] = report[key];
            }
          }
        }
      }
      for (const activity of report.activities) {
        const unit = resolveUnit(activity.subtaskCode, report.executionCode);
        if (!unit) {
          pushIssue(
            parsed.issues,
            'miss',
            activity.subtaskCode,
            `${activity.subtaskCode} 사업 「${activity.activityName || '이름 없음'}」의 세부TASK를 찾지 못했습니다.`,
          );
          continue;
        }
        let fundSourceId: number | null = null;
        let useSeedFund = false;
        if (activity.fundSourceName) {
          if (activity.fundSourceName === SP_SEED_FUND_SOURCE_NAME) {
            useSeedFund = true;
          } else {
            activity.fundSourceName = normalizeFund(activity.fundSourceName);
            const resolved = catalogFundId(activity.fundSourceName);
            if (resolved === undefined) {
              pushIssue(
                parsed.issues,
                'warn',
                activity.subtaskCode,
                `${activity.subtaskCode} 사업 「${activity.activityName || '이름 없음'}」의 재원 이름이 비어 있습니다. 재원 칸은 비우고 나머지 칸은 넣습니다.`,
              );
            } else {
              fundSourceId = resolved;
            }
          }
        }
        ensureReport(unit.taskCode).activities.push({
          ...activity,
          taskCode: unit.taskCode,
          storedSubtaskCode: unit.stored,
          fundSourceId,
          useSeedFund,
        });
      }
      for (const note of report.kpiNotes) {
        const kpi = kpiByCode.get(note.code.toLowerCase());
        if (!kpi) {
          pushIssue(
            parsed.issues,
            'miss',
            note.code,
            `${labelOf(note.code, note.name)} 성과지표를 찾지 못해 자체평가 서술을 넣지 못했습니다.`,
          );
          continue;
        }
        const owner = kpi.taskCode ?? task?.taskCode ?? '';
        if (!owner) {
          pushIssue(
            parsed.issues,
            'miss',
            note.code,
            `${note.code} 성과지표에 연결된 실행과제가 없어 자체평가 서술을 넣지 못했습니다.`,
          );
          continue;
        }
        const bucket = ensureReport(owner);
        const prev = bucket.kpiNotes.findIndex((row) => row.kpiCode === kpi.kpiCode);
        if (prev >= 0) {
          pushIssue(
            parsed.issues,
            'warn',
            note.code,
            `${note.code} 자체평가 서술이 중복되어 마지막 내용을 씁니다.`,
          );
          bucket.kpiNotes.splice(prev, 1);
        }
        bucket.kpiNotes.push({ ...note, kpiCode: kpi.kpiCode });
      }
    }
    const reportRows = [...matchedReports.values()];
    let activityCount = 0;
    let kpiNoteCount = 0;
    let sectionCount = 0;
    for (const row of reportRows) {
      activityCount += row.activities.length;
      kpiNoteCount += row.kpiNotes.length;
      if (
        row.deptSummary !== undefined ||
        row.deptAnalysis !== undefined ||
        row.budgetAdequacy !== undefined ||
        row.budgetAdequacyGrade !== undefined ||
        row.processAdequacy !== undefined ||
        row.processAdequacyGrade !== undefined ||
        row.kpiAdequacy !== undefined ||
        row.kpiAdequacyGrade !== undefined ||
        row.surveyItemsNa !== undefined ||
        row.surveyPlansNa !== undefined ||
        row.surveyItems !== undefined ||
        row.surveyPlans !== undefined
      ) {
        sectionCount += 1;
      }
    }

    const blocked = input.replaceMissing && budgetUnmatched > 0;
    const replace =
      input.replaceMissing && budgetUnmatched === 0 && matchedBudgets.length > 0;
    if (input.replaceMissing && matchedBudgets.length === 0) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        '맞는 예산이 없어 기존 초기시딩 합계는 그대로 둡니다.',
      );
    }
    if (blocked) {
      pushIssue(
        parsed.issues,
        'miss',
        '',
        '코드가 맞지 않는 세부TASK가 있어 없는 항목 삭제는 하지 않습니다. 코드를 고치거나 체크를 해제하세요.',
      );
    }
    if (!input.dryRun && blocked) {
      throw new BadRequestException(
        '코드가 맞지 않는 세부TASK가 있어 통째 교체는 하지 않습니다. 코드를 고치거나, 맞는 항목만 반영을 선택하세요.',
      );
    }
    if (
      !input.dryRun &&
      matchedBudgets.length === 0 &&
      matchedIndicators.length === 0 &&
      reportRows.length === 0
    ) {
      throw new BadRequestException(
        '반영할 예결산 금액이나 자체평가 내용이 없습니다.',
      );
    }

    const namedBudgetRows = matchedBudgets.filter(
      (row) =>
        row.fundSourceName !== null &&
        row.fundSourceName !== SP_SEED_FUND_SOURCE_NAME,
    ).length;
    const usesSeedFund =
      matchedBudgets.some(
        (row) =>
          row.fundSourceName === null ||
          row.fundSourceName === SP_SEED_FUND_SOURCE_NAME,
      ) || reportRows.some((row) => row.activities.some((act) => act.useSeedFund));
    const existingFund = usesSeedFund
      ? await manager.findOne(IrSpFundSource, {
          where: { fundSourceName: SP_SEED_FUND_SOURCE_NAME },
        })
      : null;
    const fund = !usesSeedFund
      ? { fundSourceId: null as number | null, created: false }
      : input.dryRun
        ? {
            fundSourceId: existingFund?.fundSourceId ?? null,
            created: !existingFund,
          }
        : await this.ensureFund(manager, input.year);
    if (fund.fundSourceId) {
      for (const row of matchedBudgets) {
        if (
          row.fundSourceName === null ||
          row.fundSourceName === SP_SEED_FUND_SOURCE_NAME
        ) {
          row.fundSourceId = fund.fundSourceId;
        }
      }
      for (const report of reportRows) {
        for (const activity of report.activities) {
          if (activity.useSeedFund) activity.fundSourceId = fund.fundSourceId;
        }
      }
    }
    if (fundsToCreate.size > 0) {
      const names = [...fundsToCreate];
      if (input.dryRun) {
        pushIssue(
          parsed.issues,
          'warn',
          '',
          `반영하면 재원 ${names.join(', ')}를 ${input.year}학년도 예결산 화면에 만듭니다. 그 해에만 있는 이름은 다른 연도에 나오지 않습니다.`,
        );
      } else {
        for (const name of names) {
          const saved = await this.ensureNamedFund(
            manager,
            name,
            input.year,
            input.userId,
          );
          fundByName.set(saved.fundSourceName, saved);
        }
        for (const row of matchedBudgets) {
          if (
            row.fundSourceId == null &&
            row.fundSourceName &&
            fundsToCreate.has(row.fundSourceName)
          ) {
            row.fundSourceId =
              fundByName.get(row.fundSourceName)?.fundSourceId ?? null;
          }
        }
        for (const report of reportRows) {
          for (const activity of report.activities) {
            if (
              activity.fundSourceId == null &&
              !activity.useSeedFund &&
              fundsToCreate.has(activity.fundSourceName)
            ) {
              activity.fundSourceId =
                fundByName.get(activity.fundSourceName)?.fundSourceId ?? null;
            }
          }
        }
      }
    }
    const existingEvaluations =
      reportRows.length === 0
        ? []
        : await manager.find(IrSpEvaluation, {
            where: {
              year: input.year,
              taskCode: In(reportRows.map((row) => row.taskCode)),
            },
          });
    const existingJson = countExistingJson(reportRows, existingEvaluations);

    const existingBudgets = fund.fundSourceId
      ? await manager.find(IrSpTaskBudget, {
          where: { year: input.year, fundSourceId: fund.fundSourceId },
        })
      : [];
    const namedFundIds = [
      ...new Set(
        matchedBudgets
          .map((row) => row.fundSourceId)
          .filter((id): id is number => id !== null && id !== fund.fundSourceId),
      ),
    ];
    const existingNamed =
      namedFundIds.length === 0
        ? []
        : await manager.find(IrSpTaskBudget, {
            where: { year: input.year, fundSourceId: In(namedFundIds) },
          });

    if (!input.dryRun) {
      const budgetRows = matchedBudgets.filter((row) => row.fundSourceId !== null);
      if (budgetRows.length > 0) {
        await this.writeBudgets(manager, {
          year: input.year,
          replaceFundSourceId: replace ? fund.fundSourceId : null,
          rows: budgetRows,
          userId: input.userId,
          existing: [...existingBudgets, ...existingNamed],
        });
      }
      await this.writeIndicators(manager, {
        year: input.year,
        rows: matchedIndicators,
        userId: input.userId,
      });
      await this.writeEvaluations(manager, {
        year: input.year,
        rows: reportRows,
        userId: input.userId,
        jsonMode: input.jsonMode,
        existing: existingEvaluations,
      });
      const officeCodeByName = new Map<string, string>();
      for (const name of newDepartments) {
        const code = await this.officeOrg.ensureOffice(
          name,
          input.year,
          input.userId,
        );
        officeCodeByName.set(name, code);
      }
      for (const row of textPatches) {
        const dept = row.patch.primaryDept;
        if (typeof dept === 'string') {
          const created = officeCodeByName.get(dept);
          if (created) row.patch.primaryDept = created;
        }
        await this.structure.pinYearPayload({
          kind: row.kind,
          lineageId: row.lineageId,
          displayCode: row.displayCode,
          year: input.year,
          live: row.live,
          patch: row.patch,
          userId: input.userId,
        });
      }
      const budgetWon = matchedBudgets.reduce(
        (sum, row) => sum + (row.budgetWon ?? 0),
        0,
      );
      const executedWon = matchedBudgets.reduce(
        (sum, row) => sum + (row.executedWon ?? 0),
        0,
      );
      await manager.getRepository(IrUpdateLog).save({
        updateType: 'SP_SEED_IMPORT',
        logText: `초기시딩(임시) ${input.year}학년도: 예결산 ${matchedBudgets.length}건 ${budgetWon.toLocaleString('ko-KR')}원, 결산 ${executedWon.toLocaleString('ko-KR')}원, 자체평가 실적 ${matchedIndicators.length}건, 본문 ${reportRows.length}건${replace ? ' · 초기시딩 합계 교체' : ''}${jsonModeLabel(input.jsonMode)}`,
        detail: null,
      });
    }

    let budgetTenths = 0;
    let executedTenths = 0;
    let budgetWon = 0;
    let executedWon = 0;
    for (const row of matchedBudgets) {
      if (row.budgetThousand !== null) {
        budgetTenths = addTenths(budgetTenths, row.budgetThousand);
      }
      if (row.executedThousand !== null) {
        executedTenths = addTenths(executedTenths, row.executedThousand);
      }
      budgetWon += row.budgetWon ?? 0;
      executedWon += row.executedWon ?? 0;
    }

    const orderedIssues = [...parsed.issues].sort((a, b) => {
      if (a.kind === b.kind) return 0;
      return a.kind === 'miss' ? -1 : 1;
    });
    const issues = orderedIssues.slice(0, ISSUE_LIMIT);
    return {
      dryRun: input.dryRun,
      year: input.year,
      fundSourceName: SP_SEED_FUND_SOURCE_NAME,
      fundSourceCreated: fund.created,
      replaceMissing: input.replaceMissing,
      jsonMode: input.jsonMode,
      blocked,
      budget: {
        matched: matchedBudgets.length,
        unmatched: budgetUnmatched,
        budgetThousand: budgetTenths / 10,
        executedThousand: executedTenths / 10,
        budgetWon,
        executedWon,
        existingRows: existingBudgets.length,
        replace,
        namedRows: namedBudgetRows,
      },
      indicators: {
        matched: matchedIndicators.length,
        unmatched: indicatorUnmatched,
        rateMismatch,
        averageRate:
          rateCount === 0 ? null : Math.round((rateSum / rateCount) * 100) / 100,
      },
      reports: {
        matched: reportRows.length,
        unmatched: reportUnmatched,
        activities: activityCount,
        kpiNotes: kpiNoteCount,
        sections: sectionCount,
        existingJson,
      },
      usesSeedFund,
      textRevisions: textPatches.length,
      newDepartments: [...newDepartments],
      historicalNodes,
      issues,
      issueCount: parsed.issues.length,
    };
  }

  /** 나열 순서에서 이 코드가 들어갈 칸. 뒤 항목은 한 칸씩 민다. */
  private async slotDisplayOrder<T extends { displayOrder: number }>(
    manager: EntityManager,
    rows: T[],
    codeOf: (row: T) => string,
    code: string,
    table: 'ir_sp_task' | 'ir_sp_kpi',
    dryRun: boolean,
  ): Promise<number> {
    const sorted = [...rows].sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || codeOf(a).localeCompare(codeOf(b)),
    );
    const next = sorted.find((row) => codeOf(row).localeCompare(code) > 0);
    if (!next) return (sorted.at(-1)?.displayOrder ?? -1) + 1;
    const order = next.displayOrder;
    for (const row of rows) {
      if (row.displayOrder >= order) row.displayOrder += 1;
    }
    if (!dryRun) {
      await manager.query(
        `UPDATE ${table} SET display_order = display_order + 1 WHERE display_order >= $1`,
        [order],
      );
    }
    return order;
  }

  /** 한글만 바뀐 코드는 기존 항목에 붙이고, 개정으로 없어진 코드는 그 해에만 만든다. */
  private async placeHistorical(
    manager: EntityManager,
    input: { year: number; dryRun: boolean; userId: string },
    parsed: { names: ParsedName[]; indicators: ParsedIndicator[]; issues: SpSeedImportIssue[] },
    ctx: {
      strategies: Map<string, IrSpStrategy>;
      tasks: IrSpTask[];
      subtasks: IrSpSubtask[];
      kpis: IrSpKpi[];
      taskByAny: Map<string, IrSpTask>;
      subtaskByAny: Map<string, IrSpSubtask>;
      kpiByCode: Map<string, IrSpKpi>;
      subtaskCountByTask: Map<string, number>;
    },
  ): Promise<string[]> {
    const created: string[] = [];
    const note = (code: string, label: string) => {
      created.push(label);
      if (created.length <= 8) {
        const verb = input.dryRun ? '반영하면 그 학년도에만 만들어' : '그 학년도에만 만들어';
        pushIssue(
          parsed.issues,
          'warn',
          code,
          `「${label}」는 지금 발전계획에 없습니다. ${verb} ${input.year}학년도 예결산과 자체평가에 넣습니다. 다른 연도에는 나오지 않습니다.`,
        );
      }
    };
    const seenTask = new Set<string>();
    for (const item of parsed.names) {
      if (item.kind !== 'task' || seenTask.has(item.code)) continue;
      seenTask.add(item.code);
      if (ctx.taskByAny.has(item.code)) continue;
      const parsedCode = parseTaskCode(item.code);
      const alpha = parsedCode.alphaCode;
      if (!/^[A-Z]\d+$/.test(alpha)) continue;
      const existing = ctx.taskByAny.get(alpha);
      if (existing) {
        ctx.taskByAny.set(item.code, existing);
        if (parsedCode.hangulCode) {
          const label = displayTask(alpha, parsedCode.hangulCode);
          const occupied = ctx.taskByAny.get(label);
          if (!occupied || occupied.taskCode === existing.taskCode) {
            ctx.taskByAny.set(label, existing);
          }
        }
        continue;
      }
      const strategy = ctx.strategies.get(item.parent);
      if (!strategy) {
        pushIssue(
          parsed.issues,
          'warn',
          item.code,
          `실행과제 ${item.code}의 전략과제 ${item.parent || '없음'}가 없어 그 해 항목을 만들지 못했습니다.`,
        );
        continue;
      }
      const row = manager.create(IrSpTask, {
        taskCode: alpha,
        hangulCode: parsedCode.hangulCode,
        taskName: item.name || alpha,
        strategyId: strategy.strategyId,
        goalId: strategy.goalId,
        isSpecialized: false,
        primaryDept: null,
        relatedDepts: [],
        displayOrder: await this.slotDisplayOrder(
          manager,
          ctx.tasks,
          (task) => task.taskCode,
          alpha,
          'ir_sp_task',
          input.dryRun,
        ),
        effectiveFrom: input.year,
        abolishedFrom: input.year + 1,
      });
      const saved = input.dryRun ? row : await manager.save(row);
      if (!input.dryRun) {
        const display = displayTask(saved.taskCode, saved.hangulCode);
        await this.structure.recordChange({
          year: input.year,
          kind: 'task',
          lineageId: saved.taskCode,
          displayCode: display,
          changeType: 'create',
          summary: `${display} 신설 (${input.year}학년도만)`,
          before: null,
          after: this.structure.taskPayload(saved),
          userId: input.userId,
        });
      }
      ctx.tasks.push(saved);
      ctx.taskByAny.set(alpha, saved);
      ctx.taskByAny.set(item.code, saved);
      ctx.taskByAny.set(displayTask(alpha, saved.hangulCode), saved);
      note(item.code, displayTask(alpha, saved.hangulCode));
    }

    const seenSub = new Set<string>();
    for (const item of parsed.names) {
      if (item.kind !== 'subtask' || seenSub.has(item.code)) continue;
      seenSub.add(item.code);
      if (ctx.subtaskByAny.has(item.code)) continue;
      const stable = parseSeedSubtask(item.code);
      if (!stable) continue;
      const existing = ctx.subtaskByAny.get(stable.stable);
      if (existing) {
        ctx.subtaskByAny.set(item.code, existing);
        if (stable.hangul) {
          const label = displaySubtask(existing.taskCode, existing.seqNo, stable.hangul);
          const occupied = ctx.subtaskByAny.get(label);
          if (!occupied || occupied.subtaskCode === existing.subtaskCode) {
            ctx.subtaskByAny.set(label, existing);
          }
        }
        continue;
      }
      const owner =
        ctx.taskByAny.get(stable.taskAlpha) ?? ctx.taskByAny.get(item.parent);
      if (!owner || owner.taskCode !== stable.taskAlpha) {
        pushIssue(
          parsed.issues,
          'warn',
          item.code,
          `세부TASK ${item.code}의 실행과제 ${stable.taskAlpha}가 없어 그 해 항목을 만들지 못했습니다.`,
        );
        continue;
      }
      const row = manager.create(IrSpSubtask, {
        taskCode: owner.taskCode,
        subtaskCode: stable.stable,
        hangulCode: stable.hangul,
        seqNo: stable.seq,
        subtaskName: item.name || stable.stable,
        purpose: null,
        method: null,
        displayOrder: ctx.subtasks.filter((sub) => sub.taskCode === owner.taskCode).length,
        effectiveFrom: input.year,
        abolishedFrom: input.year + 1,
      });
      const saved = input.dryRun ? row : await manager.save(row);
      const display = displaySubtask(saved.taskCode, saved.seqNo, saved.hangulCode);
      if (!input.dryRun) {
        await this.structure.recordChange({
          year: input.year,
          kind: 'subtask',
          lineageId: saved.subtaskCode,
          displayCode: display,
          changeType: 'create',
          summary: `${display} 신설 (${input.year}학년도만)`,
          before: null,
          after: this.structure.subtaskPayload(saved),
          userId: input.userId,
        });
      }
      ctx.subtasks.push(saved);
      ctx.subtaskCountByTask.set(
        saved.taskCode,
        (ctx.subtaskCountByTask.get(saved.taskCode) ?? 0) + 1,
      );
      ctx.subtaskByAny.set(saved.subtaskCode, saved);
      ctx.subtaskByAny.set(item.code, saved);
      ctx.subtaskByAny.set(display, saved);
      note(item.code, display);
    }

    const seenKpi = new Set<string>();
    for (const item of parsed.names) {
      if (item.kind !== 'kpi' || seenKpi.has(item.code.toLowerCase())) continue;
      seenKpi.add(item.code.toLowerCase());
      if (ctx.kpiByCode.has(item.code.toLowerCase())) continue;
      const parsedKpi = parseKpiCode(item.code);
      const alpha = parsedKpi.alphaCode;
      if (!/^[A-Z]\d+[a-z]$/.test(alpha)) continue;
      const existing = ctx.kpiByCode.get(alpha.toLowerCase());
      if (existing) {
        ctx.kpiByCode.set(item.code.toLowerCase(), existing);
        continue;
      }
      const owner =
        ctx.taskByAny.get(parsedKpi.taskAlpha) ?? ctx.taskByAny.get(item.parent);
      if (!owner || owner.taskCode !== parsedKpi.taskAlpha) {
        pushIssue(
          parsed.issues,
          'warn',
          item.code,
          `성과지표 ${item.code}의 실행과제 ${parsedKpi.taskAlpha}가 없어 그 해 항목을 만들지 못했습니다.`,
        );
        continue;
      }
      const indicator = parsed.indicators.find((row) => row.code === item.code);
      const row = manager.create(IrSpKpi, {
        kpiCode: alpha,
        kpiName: item.name || alpha,
        unit: indicator?.unit || null,
        taskCode: owner.taskCode,
        strategyId: owner.strategyId,
        goalId: owner.goalId,
        primaryDept: null,
        baseline: null,
        baselineRef: null,
        formula: null,
        source: null,
        displayOrder: await this.slotDisplayOrder(
          manager,
          ctx.kpis,
          (kpi) => kpi.kpiCode,
          alpha,
          'ir_sp_kpi',
          input.dryRun,
        ),
        suffix: kpiSuffixOf(alpha),
        effectiveFrom: input.year,
        abolishedFrom: input.year + 1,
      });
      const saved = input.dryRun ? row : await manager.save(row);
      if (!input.dryRun) {
        await this.structure.recordChange({
          year: input.year,
          kind: 'kpi',
          lineageId: saved.kpiCode,
          displayCode: saved.kpiCode,
          changeType: 'create',
          summary: `${saved.kpiCode} 신설 (${input.year}학년도만)`,
          before: null,
          after: this.structure.kpiPayload(saved),
          userId: input.userId,
        });
      }
      ctx.kpis.push(saved);
      ctx.kpiByCode.set(alpha.toLowerCase(), saved);
      ctx.kpiByCode.set(item.code.toLowerCase(), saved);
      note(item.code, saved.kpiCode);
    }
    if (created.length > 8) {
      pushIssue(
        parsed.issues,
        'warn',
        '',
        `개정으로 빠진 코드 ${created.length}개를 ${input.year}학년도에만 만듭니다. 다른 연도 발전계획에는 나오지 않습니다.`,
      );
    }
    return created;
  }

  private async ensureFund(
    manager: EntityManager,
    year: number,
  ): Promise<{ fundSourceId: number | null; created: boolean }> {
    const existing = await manager.findOne(IrSpFundSource, {
      where: { fundSourceName: SP_SEED_FUND_SOURCE_NAME },
    });
    if (!existing) {
      const max = await manager
        .createQueryBuilder(IrSpFundSource, 'f')
        .select('MAX(f.displayOrder)', 'max')
        .getRawOne<{ max: string | number | null }>();
      const saved = await manager.save(
        manager.create(IrSpFundSource, {
          fundSourceName: SP_SEED_FUND_SOURCE_NAME,
          displayOrder: Number(max?.max ?? -1) + 1,
          isActive: true,
          effectiveFrom: year,
          abolishedFrom: year + 1,
        }),
      );
      return { fundSourceId: saved.fundSourceId, created: true };
    }

    existing.effectiveFrom = Math.min(existing.effectiveFrom, year);
    if (existing.abolishedFrom != null) {
      existing.abolishedFrom = Math.max(existing.abolishedFrom, year + 1);
    }
    existing.isActive = true;
    const saved = await manager.save(existing);
    return { fundSourceId: saved.fundSourceId, created: false };
  }

  private async ensureNamedFund(
    manager: EntityManager,
    name: string,
    year: number,
    userId: string,
  ): Promise<IrSpFundSource> {
    const existing = await manager.findOne(IrSpFundSource, {
      where: { fundSourceName: name },
    });
    if (!existing) {
      const max = await manager
        .createQueryBuilder(IrSpFundSource, 'f')
        .select('MAX(f.displayOrder)', 'max')
        .getRawOne<{ max: string | number | null }>();
      const standing = canonicalFundName(name) === name;
      const saved = await manager.save(
        manager.create(IrSpFundSource, {
          fundSourceName: name,
          displayOrder: Number(max?.max ?? -1) + 1,
          isActive: true,
          effectiveFrom: year,
          abolishedFrom: standing ? null : year + 1,
        }),
      );
      await this.structure.recordChange({
        year,
        kind: 'fund',
        lineageId: String(saved.fundSourceId),
        displayCode: saved.fundSourceName,
        changeType: 'create',
        summary: `${saved.fundSourceName} 신설`,
        before: null,
        after: {
          fundSourceName: saved.fundSourceName,
          effectiveFrom: saved.effectiveFrom,
          abolishedFrom: saved.abolishedFrom,
          isActive: true,
        },
        userId,
      });
      return saved;
    }
    const beforeFrom = existing.effectiveFrom;
    const beforeTo = existing.abolishedFrom;
    existing.effectiveFrom = Math.min(existing.effectiveFrom, year);
    if (existing.abolishedFrom != null && existing.abolishedFrom <= year) {
      existing.abolishedFrom = year + 1;
    }
    existing.isActive = true;
    const saved = await manager.save(existing);
    if (beforeFrom !== saved.effectiveFrom || beforeTo !== saved.abolishedFrom) {
      await this.structure.recordChange({
        year,
        kind: 'fund',
        lineageId: String(saved.fundSourceId),
        displayCode: saved.fundSourceName,
        changeType: 'update',
        summary: `${saved.fundSourceName}를 ${year}학년도에 사용`,
        before: { effectiveFrom: beforeFrom, abolishedFrom: beforeTo },
        after: {
          effectiveFrom: saved.effectiveFrom,
          abolishedFrom: saved.abolishedFrom,
        },
        userId,
      });
    }
    return saved;
  }

  private async writeBudgets(
    manager: EntityManager,
    input: {
      year: number;
      replaceFundSourceId: number | null;
      rows: MatchedBudget[];
      userId: string;
      existing: IrSpTaskBudget[];
    },
  ) {
    const repo = manager.getRepository(IrSpTaskBudget);
    if (input.replaceFundSourceId !== null) {
      await repo.delete({
        year: input.year,
        fundSourceId: input.replaceFundSourceId,
      });
    }
    const existingByKey = new Map(
      input.existing.map((row) => [
        `${row.taskCode}\0${row.subtaskCode}\0${row.fundSourceId}`,
        row,
      ]),
    );
    const entities = input.rows.flatMap((row) => {
      if (row.fundSourceId === null) return [];
      const replaced = row.fundSourceId === input.replaceFundSourceId;
      const previous = replaced
        ? undefined
        : existingByKey.get(
            `${row.taskCode}\0${row.storedSubtaskCode}\0${row.fundSourceId}`,
          );
      return [
        repo.create({
          ...(previous?.budgetId ? { budgetId: previous.budgetId } : {}),
          taskCode: row.taskCode,
          subtaskCode: row.storedSubtaskCode,
          year: input.year,
          fundSourceId: row.fundSourceId,
          budgetAmount: row.budgetWon,
          settlementAmount: row.executedWon,
          updatedBy: input.userId.slice(0, 50),
        }),
      ];
    });
    if (entities.length > 0) await repo.save(entities);
  }

  private async writeEvaluations(
    manager: EntityManager,
    input: {
      year: number;
      rows: MatchedReport[];
      userId: string;
      jsonMode: SpSeedJsonMode;
      existing?: IrSpEvaluation[];
    },
  ) {
    if (input.rows.length === 0) return;
    const repo = manager.getRepository(IrSpEvaluation);
    const existingRows =
      input.existing ??
      (await repo.find({
        where: {
          year: input.year,
          taskCode: In(input.rows.map((row) => row.taskCode)),
        },
      }));
    const existingByCode = new Map(existingRows.map((row) => [row.taskCode, row]));
    const textKeys = [
      'deptSummary',
      'deptAnalysis',
      'budgetAdequacy',
      'budgetAdequacyGrade',
      'processAdequacy',
      'processAdequacyGrade',
      'kpiAdequacy',
      'kpiAdequacyGrade',
    ] as const;
    const entities = input.rows.map((report) => {
      const existing = existingByCode.get(report.taskCode);
      const row = repo.create({
        ...(existing ?? {}),
        taskCode: report.taskCode,
        year: input.year,
        updatedBy: input.userId.slice(0, 50),
      });
      for (const key of textKeys) {
        if (report[key] !== undefined) row[key] = report[key];
      }
      if (report.activities.length > 0) {
        const grouped: Record<string, Array<Record<string, unknown>>> = {};
        for (const activity of report.activities) {
          const list = grouped[activity.storedSubtaskCode] ?? [];
          list.push({
            id: `a-${list.length + 1}`,
            activityName: activity.activityName,
            performance: activity.performance,
            fundSourceId: activity.fundSourceId,
            executionAmount: activity.executionWon,
            selfCheck: activity.selfCheck,
            nextYearFeedback: activity.nextYearFeedback,
          });
          grouped[activity.storedSubtaskCode] = list;
        }
        const sanitized = sanitizeTaskActivities(grouped);
        if (input.jsonMode === 'sync') {
          row.taskActivities = sanitized;
        } else if (sanitized) {
          row.taskActivities = mergeKeyedJson(
            input.jsonMode,
            existing?.taskActivities,
            sanitized,
          );
        }
      }
      if (report.kpiNotes.length > 0) {
        const grades: Record<string, string> = {};
        const comments: Record<string, string> = {};
        for (const note of report.kpiNotes) {
          if (note.grade) grades[note.kpiCode] = note.grade;
          if (note.comment) comments[note.kpiCode] = note.comment;
        }
        const sanitizedGrades = sanitizeKpiPoEvals(grades);
        const sanitizedComments = sanitizeKpiPoComments(comments);
        if (input.jsonMode === 'sync') {
          row.kpiPoEvals = sanitizedGrades;
          row.kpiPoComments = sanitizedComments;
        } else {
          if (sanitizedGrades) {
            row.kpiPoEvals = mergeKeyedJson(
              input.jsonMode,
              existing?.kpiPoEvals,
              sanitizedGrades,
            );
          }
          if (sanitizedComments) {
            row.kpiPoComments = mergeKeyedJson(
              input.jsonMode,
              existing?.kpiPoComments,
              sanitizedComments,
            );
          }
        }
      }
      if (report.surveyItems !== undefined) {
        row.surveyItems = sanitizeSurveyItems(
          report.surveyItems.map((item, index) => ({
            id: `s-${index + 1}`,
            name: item.name,
            prevValue: item.prevValue,
            thisValue: item.thisValue,
            selfEval: item.selfEval,
          })),
        );
      }
      if (report.surveyPlans !== undefined) {
        row.surveyPlans = sanitizeSurveyPlans(
          report.surveyPlans.map((item, index) => ({
            id: `p-${index + 1}`,
            category: item.category,
            area: item.area,
            request: item.request,
            planGrade: item.planGrade,
            planText: item.planText,
          })),
        );
      }
      if (report.surveyItemsNa !== undefined) {
        row.surveyItemsNa = report.surveyItemsNa;
      }
      if (report.surveyPlansNa !== undefined) {
        row.surveyPlansNa = report.surveyPlansNa;
      }
      return row;
    });
    await repo.save(entities);
  }

  private async writeIndicators(
    manager: EntityManager,
    input: { year: number; rows: MatchedIndicator[]; userId: string },
  ) {
    if (input.rows.length === 0) return;
    const codes = input.rows.map((row) => row.kpiCode);
    const results = await manager.find(IrSpKpiResult, {
      where: { year: input.year, kpiCode: In(codes) },
    });
    const resultByCode = new Map(results.map((row) => [row.kpiCode, row]));
    const resultRepo = manager.getRepository(IrSpKpiResult);
    const resultRows = input.rows
      .filter((row) => row.actual !== null)
      .map((row) =>
        resultRepo.create({
          ...(resultByCode.get(row.kpiCode)?.resultId
            ? { resultId: resultByCode.get(row.kpiCode)?.resultId }
            : {}),
          kpiCode: row.kpiCode,
          year: input.year,
          actualValue: row.actual,
          updatedBy: input.userId.slice(0, 50),
        }),
      );
    if (resultRows.length > 0) await resultRepo.save(resultRows);
  }

  async extractionCatalog() {
    const [strategies, tasks, subtasks, kpis] = await Promise.all([
      this.dataSource.getRepository(IrSpStrategy).find(),
      this.dataSource.getRepository(IrSpTask).find(),
      this.dataSource.getRepository(IrSpSubtask).find(),
      this.dataSource.getRepository(IrSpKpi).find(),
    ]);
    const live = <T extends { abolishedFrom: number | null }>(row: T) =>
      row.abolishedFrom == null;
    const taskByCode = new Map(
      tasks.filter(live).map((row) => [row.taskCode, row]),
    );
    return {
      지시: SEED_EXTRACT_RULES,
      금액단위: '천원',
      재원_코드표: SP_FUND_CATALOG,
      등급_코드표: SP_DEPT_GRADE_CATALOG,
      환류등급_코드표: SP_PLAN_GRADE_CATALOG,
      코드표: {
        strategies: strategies.filter(live).map((row) => ({
          code_id: row.strategyId,
          name: row.strategyName,
        })),
        executionTasks: tasks.filter(live).map((row) => ({
          code_id: displayTask(row.taskCode, row.hangulCode),
          name: row.taskName,
          strategy_code_id: row.strategyId,
        })),
        tasks: subtasks
          .filter((row) => row.abolishedFrom == null && taskByCode.has(row.taskCode))
          .map((row) => {
            const parent = taskByCode.get(row.taskCode);
            return {
              code_id: displaySubtask(row.taskCode, row.seqNo, row.hangulCode),
              name: row.subtaskName,
              execution_code_id: parent
                ? displayTask(parent.taskCode, parent.hangulCode)
                : row.taskCode,
            };
          }),
        indicators: kpis.filter(live).map((row) => {
          const parent = row.taskCode ? taskByCode.get(row.taskCode) : undefined;
          const suffix = row.suffix ?? row.kpiCode.slice(-1);
          const codeId =
            parent && /^[a-z]$/.test(suffix)
              ? displayKpiCode(parent.taskCode, suffix)
              : row.kpiCode;
          return {
            code_id: codeId,
            name: row.kpiName,
            execution_code_id: parent
              ? displayTask(parent.taskCode, parent.hangulCode)
              : '',
            단위: row.unit ?? '',
          };
        }),
      },
    };
  }
}
