import {
  SP_DEPT_GRADES,
  SP_SURVEY_PLAN_GRADES,
} from './strategic-plan.constants';
import {
  canonicalDeptGrade,
  canonicalPlanGrade,
  resolveFundList,
} from './sp-seed-codes';

export interface SeedIssue {
  kind: 'miss' | 'warn';
  code: string;
  message: string;
}

/** 예결산 재원별 한 줄. 숫자는 천원. */
export interface ParsedFundSplit {
  fundSourceName: string;
  budgetThousand: number | null;
  executedThousand: number | null;
}

export interface ParsedActivity {
  subtaskCode: string;
  activityName: string;
  performance: string;
  fundSourceName: string;
  /** 화면 집행액 칸에 넣을 원 단위 문자열. 비어 있으면 금액 없음. */
  executionWon: string;
  selfCheck: string;
  nextYearFeedback: string;
}

export interface ParsedKpiNote {
  code: string;
  name: string;
  grade: string;
  comment: string;
}

export interface ParsedSurveyItem {
  name: string;
  prevValue: string;
  thisValue: string;
  selfEval: string;
}

export interface ParsedSurveyPlan {
  category: string;
  area: string;
  request: string;
  planGrade: string;
  planText: string;
}

/** 실행과제 하나분의 자체평가 본문. 키를 안 적은 칸은 undefined. */
export interface ParsedReport {
  executionCode: string;
  executionName: string;
  activities: ParsedActivity[];
  kpiNotes: ParsedKpiNote[];
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
  surveyItems?: ParsedSurveyItem[];
  surveyPlans?: ParsedSurveyPlan[];
}

const DEPT_GRADES: readonly string[] = SP_DEPT_GRADES;
const PLAN_GRADES: readonly string[] = SP_SURVEY_PLAN_GRADES;
const MAX_TEXT = 8000;
const MAX_NAME = 400;
const MAX_ROWS = 50;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function cleanCode(value: unknown): string {
  let text = String(value ?? '').trim();
  if (text.startsWith('[') && text.endsWith(']') && text.length > 2) {
    text = text.slice(1, -1).trim();
  }
  return text;
}

export function readNumber(
  value: unknown,
): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, value: null };
  }
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.replace(/,/g, '').trim())
        : Number.NaN;
  if (!Number.isFinite(numeric)) return { ok: false };
  return { ok: true, value: numeric };
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

export function readNodeCode(obj: Record<string, unknown>): string {
  for (const key of ['code_id', 'code', '코드']) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    const text = cleanCode(obj[key]);
    if (text) return text;
  }
  return '';
}

export function readNodeName(obj: Record<string, unknown>): string {
  for (const key of ['name', '이름', '항목명']) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (typeof obj[key] !== 'string') continue;
    const text = obj[key].trim();
    if (text) return text.slice(0, MAX_NAME);
  }
  return '';
}

export function readDept(obj: Record<string, unknown>): string {
  for (const key of ['책임부서', '부서', 'primaryDept', 'dept']) {
    if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
    if (typeof obj[key] !== 'string') continue;
    const text = obj[key].trim();
    if (text) return text.slice(0, 80);
  }
  return '';
}

function pushIssue(
  issues: SeedIssue[],
  kind: SeedIssue['kind'],
  code: string,
  message: string,
) {
  issues.push({ kind, code, message });
}

function readText(value: unknown, max = MAX_TEXT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (!text) return undefined;
  return text.slice(0, max);
}

function readCell(value: unknown, max = 40): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function readBool(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;
  const text = value.trim();
  if (text === 'true' || text === '해당없음' || text === '해당 없음') return true;
  if (text === 'false') return false;
  return undefined;
}

function readGrade(
  value: unknown,
  allowed: readonly string[],
  issues: SeedIssue[],
  code: string,
  label: string,
): string {
  const text = readText(value, 40);
  if (!text) return '';
  const canonical =
    allowed === DEPT_GRADES
      ? canonicalDeptGrade(text)
      : allowed === PLAN_GRADES
        ? canonicalPlanGrade(text)
        : null;
  if (canonical && allowed.includes(canonical)) return canonical;
  if (allowed.includes(text)) return text;
  const hint =
    allowed === DEPT_GRADES
      ? '등급_code_id는 GRADE_HIGH·GRADE_MID·GRADE_LOW만 씁니다. '
      : allowed === PLAN_GRADES
        ? '환류계획_등급_code_id는 PLAN_NOW·PLAN_STEP·PLAN_NO만 씁니다. '
        : '';
  pushIssue(
    issues,
    'warn',
    code,
    `${code} ${label} 등급 「${text}」은 코드표 값이 아니라 등급은 비웁니다. ${hint}`,
  );
  return '';
}

export function emptyReport(executionCode: string, executionName: string): ParsedReport {
  return {
    executionCode,
    executionName,
    activities: [],
    kpiNotes: [],
  };
}

export function reportHasContent(report: ParsedReport): boolean {
  return (
    report.activities.length > 0 ||
    report.kpiNotes.length > 0 ||
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

function readDiagnosis(
  raw: unknown,
  issues: SeedIssue[],
  code: string,
  label: string,
): { grade?: string; text?: string } | null {
  if (raw === undefined) return null;
  if (!isRecord(raw)) {
    pushIssue(
      issues,
      'warn',
      code,
      `${code} ${label}은 등급·내용 객체여야 해서 건너뜁니다.`,
    );
    return null;
  }
  const grade = readGrade(
    pick(raw, ['등급_code_id', '등급', 'grade']),
    DEPT_GRADES,
    issues,
    code,
    label,
  );
  const text = readText(pick(raw, ['내용', 'text']));
  if (!grade && !text) return null;
  return {
    ...(grade ? { grade } : {}),
    ...(text ? { text } : {}),
  };
}

/** 실행과제에 달린 ③④⑤. 없는 키는 그대로 둔다. */
export function fillExecutionNarrative(
  report: ParsedReport,
  raw: Record<string, unknown>,
  issues: SeedIssue[],
) {
  const code = report.executionCode;
  const summary = readText(pick(raw, ['주요성과', 'deptSummary']));
  const analysis = readText(
    pick(raw, ['자체분석_및_개선방향', 'deptAnalysis']),
  );
  if (summary) report.deptSummary = summary;
  if (analysis) report.deptAnalysis = analysis;

  const check = pick(raw, ['자체점검']);
  if (check !== undefined) {
    if (!isRecord(check)) {
      pushIssue(
        issues,
        'warn',
        code,
        `${code} 자체점검은 예결산의_적절성·절차상_적절성·성과지표_적절성 객체여야 합니다.`,
      );
    } else {
      const budget = readDiagnosis(
        pick(check, ['예결산의_적절성']),
        issues,
        code,
        '예결산의 적절성',
      );
      const process = readDiagnosis(
        pick(check, ['절차상_적절성']),
        issues,
        code,
        '절차상 적절성',
      );
      const kpi = readDiagnosis(
        pick(check, ['성과지표_적절성']),
        issues,
        code,
        '성과지표 적절성',
      );
      if (budget?.text) report.budgetAdequacy = budget.text;
      if (budget?.grade) report.budgetAdequacyGrade = budget.grade;
      if (process?.text) report.processAdequacy = process.text;
      if (process?.grade) report.processAdequacyGrade = process.grade;
      if (kpi?.text) report.kpiAdequacy = kpi.text;
      if (kpi?.grade) report.kpiAdequacyGrade = kpi.grade;
    }
  }

  const survey = pick(raw, ['만족도']);
  if (survey === undefined) return;
  if (!isRecord(survey)) {
    pushIssue(
      issues,
      'warn',
      code,
      `${code} 만족도는 객체여야 해서 건너뜁니다.`,
    );
    return;
  }
  const itemsNa = readBool(pick(survey, ['세부항목_해당없음']));
  const plansNa = readBool(
    pick(survey, ['외부조사_해당없음', '대학만족도조사_외_조사_해당없음']),
  );
  if (itemsNa !== undefined) report.surveyItemsNa = itemsNa;
  if (plansNa !== undefined) report.surveyPlansNa = plansNa;

  const items = pick(survey, ['세부항목']);
  if (items !== undefined) {
    const parsed = parseSurveyItems(items, issues, code);
    if (parsed) report.surveyItems = parsed;
  }
  const plans = pick(survey, ['외부조사', '대학만족도조사_외_조사']);
  if (plans !== undefined) {
    const parsed = parseSurveyPlans(plans, issues, code);
    if (parsed) report.surveyPlans = parsed;
  }
}

function parseSurveyItems(
  raw: unknown,
  issues: SeedIssue[],
  code: string,
): ParsedSurveyItem[] | null {
  if (!Array.isArray(raw)) {
    pushIssue(issues, 'warn', code, `${code} 만족도 세부항목이 배열이 아닙니다.`);
    return null;
  }
  if (raw.length > MAX_ROWS) {
    pushIssue(
      issues,
      'warn',
      code,
      `${code} 만족도 세부항목이 ${MAX_ROWS}행을 넘어 앞부분만 넣습니다.`,
    );
  }
  const rows: ParsedSurveyItem[] = [];
  for (const item of raw.slice(0, MAX_ROWS)) {
    if (!isRecord(item)) continue;
    const name = readNodeName(item) || readCell(pick(item, ['만족도세부항목명']), MAX_NAME);
    const prevValue = readCell(pick(item, ['전년도_달성값', 'prevValue']));
    const thisValue = readCell(pick(item, ['올해_달성값', 'thisValue']));
    const selfEval = readGrade(
      pick(item, ['등급_code_id', '자체평가_등급_code_id', '자체평가', 'selfEval']),
      DEPT_GRADES,
      issues,
      code,
      `만족도 「${name || '이름 없음'}」`,
    );
    if (!name && !prevValue && !thisValue && !selfEval) continue;
    rows.push({ name, prevValue, thisValue, selfEval });
  }
  return rows;
}

function parseSurveyPlans(
  raw: unknown,
  issues: SeedIssue[],
  code: string,
): ParsedSurveyPlan[] | null {
  if (!Array.isArray(raw)) {
    pushIssue(issues, 'warn', code, `${code} 만족도 외부조사가 배열이 아닙니다.`);
    return null;
  }
  if (raw.length > MAX_ROWS) {
    pushIssue(
      issues,
      'warn',
      code,
      `${code} 만족도 외부조사가 ${MAX_ROWS}행을 넘어 앞부분만 넣습니다.`,
    );
  }
  const rows: ParsedSurveyPlan[] = [];
  for (const item of raw.slice(0, MAX_ROWS)) {
    if (!isRecord(item)) continue;
    const category = readCell(pick(item, ['구분', 'category']), MAX_NAME);
    const area = readCell(pick(item, ['영역', 'area']), MAX_NAME);
    const request = readText(pick(item, ['조사_및_요구사항', 'request'])) ?? '';
    const planGrade = readGrade(
      pick(item, ['환류계획_등급_code_id', '환류계획_등급', 'planGrade']),
      PLAN_GRADES,
      issues,
      code,
      `외부조사 「${category || area || '구분 없음'}」`,
    );
    const planText = readText(pick(item, ['환류계획', 'planText'])) ?? '';
    if (!category && !area && !request && !planGrade && !planText) continue;
    rows.push({ category, area, request, planGrade, planText });
  }
  return rows;
}

export function parseKpiNote(
  raw: Record<string, unknown>,
  code: string,
  name: string,
  issues: SeedIssue[],
): ParsedKpiNote | null {
  const grade = readGrade(
    pick(raw, ['자체평가_등급_code_id', '등급_code_id', '자체평가_등급']),
    DEPT_GRADES,
    issues,
    code,
    '성과지표 자체평가',
  );
  const comment = readText(pick(raw, ['자체평가'])) ?? '';
  if (!grade && !comment) return null;
  return { code, name, grade, comment };
}

/**
 * 재원별이 있으면 합계 예산·결산은 저장하지 않는다.
 * 키가 없으면 total.
 */
export function parseFundSplit(
  raw: Record<string, unknown>,
  subtaskCode: string,
  issues: SeedIssue[],
): { mode: 'split'; rows: ParsedFundSplit[] } | { mode: 'total' } {
  const value = pick(raw, ['재원별', 'funds']);
  if (value === undefined) return { mode: 'total' };
  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      'warn',
      subtaskCode,
      `${subtaskCode}의 재원별이 배열이 아닙니다. 합계 금액만 봅니다.`,
    );
    return { mode: 'total' };
  }
  const rows: ParsedFundSplit[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      pushIssue(
        issues,
        'warn',
        subtaskCode,
        `${subtaskCode} 재원별에 객체가 아닌 항목이 있습니다.`,
      );
      continue;
    }
    const rawFund = readCell(
      pick(item, ['재원_code_id', 'fund_code_id', '재원명', 'fundSourceName', 'name']),
      100,
    );
    const fundNames = resolveFundList(rawFund);
    const budgetRead = readNumber(pick(item, ['예산_천원', 'budget', '예산']));
    const executedRead = readNumber(
      pick(item, ['결산_천원', 'executed', 'settlement', '결산', '집행']),
    );
    if (!budgetRead.ok || !executedRead.ok) {
      pushIssue(
        issues,
        'miss',
        subtaskCode,
        `${subtaskCode} 「${rawFund || '재원 없음'}」의 예산 또는 결산이 숫자가 아닙니다.`,
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
        `${subtaskCode} 「${rawFund || '재원 없음'}」의 예산 또는 결산이 음수입니다.`,
      );
      continue;
    }
    if (budgetRead.value === null && executedRead.value === null) continue;
    if (fundNames.length === 0) {
      pushIssue(
        issues,
        'miss',
        subtaskCode,
        `${subtaskCode} 재원별 행에 재원_code_id가 없습니다.`,
      );
      continue;
    }
    if (fundNames.length > 1) {
      pushIssue(
        issues,
        'warn',
        subtaskCode,
        `${subtaskCode} 재원 「${rawFund}」은 ${fundNames.join(', ')}로 나눴습니다. 금액은 첫 재원 ${fundNames[0]}에만 넣습니다.`,
      );
    }
    fundNames.forEach((fundSourceName, index) => {
      rows.push({
        fundSourceName,
        budgetThousand: index === 0 ? budgetRead.value : 0,
        executedThousand: index === 0 ? executedRead.value : 0,
      });
    });
  }
  return { mode: 'split', rows };
}

export function warnFundSumGap(
  issues: SeedIssue[],
  subtaskCode: string,
  label: string,
  total: number | null,
  parts: Array<number | null>,
) {
  if (total === null) return;
  const nums = parts.filter((value): value is number => value !== null);
  if (nums.length === 0) return;
  const sum = nums.reduce((a, b) => a + b, 0);
  if (Math.abs(sum - total) <= 0.05) return;
  pushIssue(
    issues,
    'warn',
    subtaskCode,
    `${subtaskCode} ${label} 합계 ${total}천원과 재원별 합 ${sum}천원이 다릅니다. 재원별 금액을 넣습니다.`,
  );
}

export function parseActivities(
  raw: Record<string, unknown>,
  subtaskCode: string,
  issues: SeedIssue[],
): ParsedActivity[] {
  const value = pick(raw, ['사업프로그램', 'activities']);
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    pushIssue(
      issues,
      'warn',
      subtaskCode,
      `${subtaskCode}의 사업프로그램이 배열이 아닙니다.`,
    );
    return [];
  }
  if (value.length > MAX_ROWS) {
    pushIssue(
      issues,
      'warn',
      subtaskCode,
      `${subtaskCode} 사업프로그램이 ${MAX_ROWS}행을 넘어 앞부분만 넣습니다.`,
    );
  }
  const rows: ParsedActivity[] = [];
  for (const item of value.slice(0, MAX_ROWS)) {
    if (!isRecord(item)) continue;
    const activityName =
      readCell(pick(item, ['사업명', 'activityName']), MAX_NAME);
    const performance = readText(pick(item, ['추진실적', 'performance'])) ?? '';
    const rawFund = readCell(
      pick(item, ['재원_code_id', 'fund_code_id', '재원명', 'fundSourceName']),
      100,
    );
    const fundNames = resolveFundList(rawFund);
    const fundSourceName = fundNames[0] ?? '';
    const feedback =
      readText(pick(item, ['차년도_환류사항', 'nextYearFeedback'])) ?? '';
    const selfCheck = readGrade(
      pick(item, ['등급_code_id', '자체점검', 'selfCheck']),
      DEPT_GRADES,
      issues,
      subtaskCode,
      `사업 「${activityName || '이름 없음'}」`,
    );
    const won = readExecutionWon(item, subtaskCode, activityName, issues);
    if (
      !activityName &&
      !performance &&
      !fundSourceName &&
      !feedback &&
      !selfCheck &&
      !won.amount &&
      won.ok
    ) {
      continue;
    }
    const amount = won.ok ? won.amount : '';
    if (fundNames.length > 1) {
      pushIssue(
        issues,
        'warn',
        subtaskCode,
        `${subtaskCode} 사업 「${activityName || '이름 없음'}」 재원 「${rawFund}」은 ${fundNames.join(', ')}로 나눴습니다. 집행액은 첫 재원 ${fundNames[0]}에만 넣습니다.`,
      );
    }
    const funds = fundNames.length > 0 ? fundNames : [''];
    funds.forEach((name, index) => {
      rows.push({
        subtaskCode,
        activityName,
        performance,
        fundSourceName: name,
        executionWon: index === 0 ? amount : '0',
        selfCheck,
        nextYearFeedback: feedback,
      });
    });
  }
  return rows;
}

function readExecutionWon(
  item: Record<string, unknown>,
  subtaskCode: string,
  activityName: string,
  issues: SeedIssue[],
): { ok: boolean; amount: string } {
  const thousand = readNumber(pick(item, ['집행액_천원']));
  const won = readNumber(pick(item, ['집행액_원', 'executionAmount', '집행액']));
  const label = `${subtaskCode} 사업 「${activityName || '이름 없음'}」`;
  if (!thousand.ok || !won.ok) {
    pushIssue(issues, 'miss', subtaskCode, `${label}의 집행액이 숫자가 아닙니다.`);
    return { ok: false, amount: '' };
  }
  const chosen = thousand.value !== null ? thousand.value * 1000 : won.value;
  if (chosen === null) return { ok: true, amount: '' };
  if (chosen < 0) {
    pushIssue(issues, 'miss', subtaskCode, `${label}의 집행액이 음수입니다.`);
    return { ok: false, amount: '' };
  }
  return { ok: true, amount: String(Math.round(chosen)) };
}
