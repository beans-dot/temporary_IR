import {
  api,
  excludeHiddenFromTree,
  fetchMonitoringYears,
  type CategoryTreeNode,
  type PivotResult,
  type PivotRow,
  type TargetTreeNode,
} from '@/lib/api';
import { hasHierarchyData, readYearValue } from './aggregate';
import {
  MONITORING_KPI_MAP,
  STUDENT_COUNT_COMPONENT_CODES,
  STUDENT_COUNT_COMPONENT_SHORT_LABELS,
} from './catalog';
import {
  ACCOUNTING_YEAR_LAG,
  composeAccountingHierarchy,
  projectAccountingDeptMaps,
  projectAccountingYearMap,
} from './composeAccounting';
import {
  composeFormulaHierarchy,
  composeAdditiveHierarchy,
  formulaChildHierarchies,
} from './composeFormula';
import {
  composeStudentCountHierarchy,
  emptyYearMap,
  selectedComponentKeys,
} from './composeStudentCount';
import { allDeptCodes, parseOrgTree } from './orgTree';
import {
  resolveCategoryTitles,
  resolveMonitoringMetrics,
} from './resolveMetrics';
import type {
  FormulaEvalNode,
  HierarchyValues,
  MonitoringCategoryDef,
  MonitoringKpiDef,
  MonitoringKpiId,
  MonitoringValueSource,
  OrgStructure,
  StudentCountBreakdown,
  StudentCountComponentKey,
  StudentCountToggles,
  StackBreakdown,
  ComponentToggleItem,
  YearValueMap,
  YoySnapshot,
} from './types';

interface MonitoringOfficialLinksResponse {
  years: number[];
  links: Array<{
    monitoringMetricCode: string;
    alimiMetricId: number;
    alimiMetricName: string;
  }>;
}
import { computeYoy, trendYearWindow } from './yoy';
import { analyzeFormula } from './formula';

export interface MonitoringBundle {
  /** 피벗에 요청한 전체 연도 (추이 창 포함) */
  years: number[];
  /** 모니터링 입력값 또는 자동연결 정보공시값이 있는 연도 */
  availableYears: number[];
  org: OrgStructure;
  /** 시드 카테고리 코드 → 현재 카테고리명 (지표 DB 빌더에서 바꾼 이름) */
  categoryTitles: Record<string, string>;
  /** DB 트리에 실제로 존재하는 섹션·KPI만 (삭제·숨김 제외) */
  sections: MonitoringCategoryDef[];
  directs: Record<
    string,
    {
      kpi: MonitoringKpiDef;
      label: string;
      unit: string | null;
      found: boolean;
      values: HierarchyValues;
      /** 대학알리미 대학 전체값을 사용한 연도 */
      officialYears: number[];
    }
  >;
  studentComponents: Record<StudentCountComponentKey, HierarchyValues>;
  /** 재학생 총계(정원 내+외) 대학알리미 값 */
  studentOfficialTotal: YearValueMap;
  studentOfficialTotalYears: number[];
  studentComponentOfficialYears: Partial<
    Record<StudentCountComponentKey, number[]>
  >;
  studentMeta: {
    kpi: MonitoringKpiDef;
    label: string;
    unit: string | null;
    found: boolean;
  };
  accountings: Record<
    string,
    {
      kpi: MonitoringKpiDef;
      label: string;
      unit: string | null;
      found: boolean;
      income: HierarchyValues;
      expense: HierarchyValues;
      net: HierarchyValues;
      incomeLines: { name: string; values: HierarchyValues }[];
      expenseLines: { name: string; values: HierarchyValues }[];
    }
  >;
  formulas: Record<
    string,
    {
      kpi: MonitoringKpiDef;
      label: string;
      unit: string | null;
      found: boolean;
      formulaLabel: string;
      node: FormulaEvalNode;
      values: HierarchyValues;
      /** 계산식 구성항목 전체 선택 시 우선 사용할 대학알리미 대학 총계 */
      officialUniv: YearValueMap;
      officialYears: number[];
      childLines: {
        metricId: number;
        name: string;
        values: HierarchyValues;
      }[];
    }
  >;
}

export interface KpiViewModel {
  id: MonitoringKpiId;
  label: string;
  unit: string | null;
  found: boolean;
  hasHierarchy: boolean;
  selectedYear: number;
  years: number[];
  univ: YearValueMap;
  depts: Record<string, YearValueMap>;
  yoy: YoySnapshot;
  kpi: MonitoringKpiDef;
  /** 선택 연도의 대학 전체값 출처 */
  valueSource: MonitoringValueSource | null;
  /** 재학생 수·가감 계산식: 켠 구성 항목별 학과 값 (비교 누적 차트용) */
  stackBreakdown?: StackBreakdown;
  studentBreakdown?: StudentCountBreakdown;
  componentToggles?: ComponentToggleItem[];
  accounting?: {
    income: YearValueMap;
    expense: YearValueMap;
    incomeDepts: Record<string, YearValueMap>;
    expenseDepts: Record<string, YearValueMap>;
    incomeYoy: YoySnapshot;
    expenseYoy: YoySnapshot;
    incomeLines: { name: string; univ: YearValueMap }[];
    expenseLines: { name: string; univ: YearValueMap }[];
  };
  formula?: {
    expressionLabel: string;
    kind: 'additive' | 'other';
    lines: { name: string; univ: YearValueMap }[];
  };
}

function fallbackCalendarYears(): number[] {
  return trendYearWindow(new Date().getFullYear());
}

function uniqueSortedYears(years: number[]): number[] {
  return [...new Set(years)].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
}

/** 선택 가능한 연도마다 직전 2년이 피벗에 포함되도록 확장 */
function pivotYearsFor(availableYears: number[]): number[] {
  if (availableYears.length === 0) return fallbackCalendarYears();
  const min = Math.min(...availableYears);
  const max = Math.max(...availableYears);
  const years: number[] = [];
  for (let y = min - 2; y <= max; y++) years.push(y);
  return years;
}

function extractHierarchy(
  rows: PivotRow[],
  metricIds: number[],
  years: number[],
  univCode: string,
  deptCodes: string[],
): HierarchyValues {
  const idSet = new Set(metricIds);
  const relevant = rows.filter((r) => idSet.has(r.metricId));

  const yearMapFrom = (row: PivotRow | undefined): YearValueMap => {
    const map = emptyYearMap(years);
    if (!row) return map;
    for (const year of years) {
      map[year] = readYearValue(row.values, year);
    }
    return map;
  };

  const univRow = relevant.find((r) => r.univCode === univCode && !r.deptCode);
  const depts: Record<string, YearValueMap> = {};
  for (const code of deptCodes) {
    const row = relevant.find(
      (r) => r.univCode === univCode && r.deptCode === code,
    );
    depts[code] = yearMapFrom(row);
  }
  return { univ: yearMapFrom(univRow), depts };
}

function yearsWithValues(values: YearValueMap, years: number[]): number[] {
  return years.filter((year) => values[year] != null);
}

/** 대학 전체값만 대학알리미 우선. 학과값은 엑셀 업로드 값을 보존한다. */
function preferOfficialUniversity(
  monitoring: HierarchyValues,
  official: HierarchyValues | undefined,
  years: number[],
): { values: HierarchyValues; officialYears: number[] } {
  if (!official) return { values: monitoring, officialYears: [] };
  const officialYears = yearsWithValues(official.univ, years);
  const officialSet = new Set(officialYears);
  return {
    values: {
      univ: Object.fromEntries(
        years.map((year) => [
          year,
          officialSet.has(year)
            ? official.univ[year]
            : (monitoring.univ[year] ?? null),
        ]),
      ),
      depts: monitoring.depts,
    },
    officialYears,
  };
}

function valueSourceAt(
  value: number | null | undefined,
  officialYears: number[],
  year: number,
): MonitoringValueSource | null {
  if (value == null) return null;
  return officialYears.includes(year) ? 'ALIMI' : 'MONITORING';
}

function emptyHierarchy(
  years: number[],
  deptCodes: string[],
): HierarchyValues {
  return {
    univ: emptyYearMap(years),
    depts: Object.fromEntries(deptCodes.map((c) => [c, emptyYearMap(years)])),
  };
}

export async function fetchMonitoringBundle(): Promise<MonitoringBundle> {
  const [rawYears, metricRes, officialRes] = await Promise.all([
    fetchMonitoringYears().catch(() => [] as number[]),
    api.get<CategoryTreeNode[]>('/metrics/tree', {
      params: { sourceType: 'MONITORING' },
    }),
    // 이 요청이 실패했는데 조용히 직접입력값으로 폴백하면 공시 연결 지표가
    // 직접입력 지표처럼 보인다. 연결 정보를 못 받으면 화면도 오류로 처리한다.
    api.get<MonitoringOfficialLinksResponse>(
      '/metrics/monitoring/official-links',
    ),
  ]);

  let availableYears = uniqueSortedYears([
    ...rawYears,
    ...(officialRes.data.years ?? []),
  ]).reverse();
  if (availableYears.length === 0) {
    availableYears = [...fallbackCalendarYears()].reverse();
  }
  const years = pivotYearsFor([...availableYears].sort((a, b) => a - b));
  const catalogYear = years.length ? Math.max(...years) : undefined;
  const treeRes = await api.get<TargetTreeNode[]>('/universities/tree', {
    params: {
      scope: 'internal',
      ...(catalogYear
        ? { year: catalogYear, years: years.join(',') }
        : {}),
    },
  });

  const visibleTree = excludeHiddenFromTree(metricRes.data);
  const resolved = resolveMonitoringMetrics(visibleTree);
  const officialLinks = new Map(
    (officialRes.data.links ?? []).map((link) => [
      link.monitoringMetricCode,
      link,
    ]),
  );
  const officialMetricIds = [...officialLinks.values()].map(
    (link) => link.alimiMetricId,
  );
  const requestedMetricIds = [
    ...new Set([...resolved.allMetricIds, ...officialMetricIds]),
  ];
  const categoryTitles = resolveCategoryTitles(visibleTree);
  const org = parseOrgTree(treeRes.data);
  if (!org) {
    throw new Error('내부 편제(대학) 정보를 찾을 수 없습니다.');
  }

  const deptCodes = allDeptCodes(org);
  const studentKpi =
    resolved.composite?.kpi ?? MONITORING_KPI_MAP['student-count'];
  const studentMeta = {
    kpi: studentKpi,
    label: resolved.composite?.label ?? studentKpi.label,
    unit: resolved.composite?.unit ?? studentKpi.fallbackUnit,
    found: resolved.composite?.found ?? false,
  };

  const studentComponents = {
    inner: emptyHierarchy(years, deptCodes),
    outer: emptyHierarchy(years, deptCodes),
    leave: emptyHierarchy(years, deptCodes),
    deferred: emptyHierarchy(years, deptCodes),
  } as Record<StudentCountComponentKey, HierarchyValues>;
  const studentOfficialTotal = emptyYearMap(years);
  let studentOfficialTotalYears: number[] = [];
  const studentComponentOfficialYears: Partial<
    Record<StudentCountComponentKey, number[]>
  > = {};

  const directs: MonitoringBundle['directs'] = {};
  const accountings: MonitoringBundle['accountings'] = {};
  const formulas: MonitoringBundle['formulas'] = {};

  const emptyAccounting = () => {
    for (const a of resolved.accountings) {
      accountings[a.kpi.id] = {
        kpi: a.kpi,
        label: a.label,
        unit: a.unit,
        found: false,
        income: emptyHierarchy(years, deptCodes),
        expense: emptyHierarchy(years, deptCodes),
        net: emptyHierarchy(years, deptCodes),
        incomeLines: [],
        expenseLines: [],
      };
    }
  };

  const emptyFormulas = () => {
    for (const f of resolved.formulas) {
      formulas[f.kpi.id] = {
        kpi: f.kpi,
        label: f.label,
        unit: f.unit,
        found: f.found,
        formulaLabel: f.formulaLabel,
        node: f.node,
        values: emptyHierarchy(years, deptCodes),
        officialUniv: emptyYearMap(years),
        officialYears: [],
        childLines: f.node.children.map((c) => ({
          metricId: c.metricId,
          name: c.name,
          values: emptyHierarchy(years, deptCodes),
        })),
      };
    }
  };

  if (requestedMetricIds.length === 0) {
    for (const d of resolved.directs) {
      directs[d.kpi.id] = {
        kpi: d.kpi,
        label: d.label,
        unit: d.unit,
        found: false,
        values: emptyHierarchy(years, deptCodes),
        officialYears: [],
      };
    }
    emptyAccounting();
    emptyFormulas();
    return {
      years,
      availableYears,
      org,
      categoryTitles,
      sections: resolved.sections,
      directs,
      studentComponents,
      studentOfficialTotal,
      studentOfficialTotalYears,
      studentComponentOfficialYears,
      studentMeta,
      accountings,
      formulas,
    };
  }

  const targets = [
    { univCode: org.univCode },
    ...deptCodes.map((deptCode) => ({ univCode: org.univCode, deptCode })),
  ];

  const { data: pivot } = await api.post<PivotResult>('/pivot', {
    targets,
    metricIds: requestedMetricIds,
    years,
    hierarchyIntegrate: false,
  });

  const rows = pivot.rows ?? [];

  const officialHierarchy = (monitoringMetricCode: string) => {
    const link = officialLinks.get(monitoringMetricCode);
    return link
      ? extractHierarchy(
          rows,
          [link.alimiMetricId],
          years,
          org.univCode,
          deptCodes,
        )
      : undefined;
  };

  const studentTotalOfficial = officialHierarchy('student-count');
  if (studentTotalOfficial) {
    Object.assign(studentOfficialTotal, studentTotalOfficial.univ);
    studentOfficialTotalYears = yearsWithValues(
      studentTotalOfficial.univ,
      years,
    );
  }

  for (const d of resolved.directs) {
    const preferred = preferOfficialUniversity(
      extractHierarchy(
        rows,
        d.metricIds,
        years,
        org.univCode,
        deptCodes,
      ),
      officialHierarchy(d.kpi.metricCode),
      years,
    );
    directs[d.kpi.id] = {
      kpi: d.kpi,
      label: d.label,
      unit: d.unit,
      found: d.found,
      values: preferred.values,
      officialYears: preferred.officialYears,
    };
  }

  if (resolved.composite) {
    (Object.keys(resolved.composite.components) as StudentCountComponentKey[]).forEach(
      (key) => {
        const comp = resolved.composite!.components[key];
        const preferred = preferOfficialUniversity(
          extractHierarchy(
            rows,
            comp.metricIds,
            years,
            org.univCode,
            deptCodes,
          ),
          officialHierarchy(STUDENT_COUNT_COMPONENT_CODES[key]),
          years,
        );
        studentComponents[key] = preferred.values;
        studentComponentOfficialYears[key] = preferred.officialYears;
      },
    );
  }

  for (const a of resolved.accountings) {
    const incomeLines = a.incomeLines.map((line) => ({
      name: line.name,
      values: extractHierarchy(
        rows,
        line.metricIds,
        years,
        org.univCode,
        deptCodes,
      ),
    }));
    const expenseLines = a.expenseLines.map((line) => ({
      name: line.name,
      values: extractHierarchy(
        rows,
        line.metricIds,
        years,
        org.univCode,
        deptCodes,
      ),
    }));
    const composed = composeAccountingHierarchy(
      incomeLines.map((l) => l.values),
      expenseLines.map((l) => l.values),
      years,
      deptCodes,
    );
    accountings[a.kpi.id] = {
      kpi: a.kpi,
      label: a.label,
      unit: a.unit,
      found: a.found,
      income: composed.income,
      expense: composed.expense,
      net: composed.net,
      incomeLines,
      expenseLines,
    };
  }

  const rawById = new Map<number, HierarchyValues>();
  for (const id of resolved.allMetricIds) {
    rawById.set(
      id,
      extractHierarchy(rows, [id], years, org.univCode, deptCodes),
    );
  }

  for (const f of resolved.formulas) {
    const official = officialHierarchy(f.kpi.metricCode);
    formulas[f.kpi.id] = {
      kpi: f.kpi,
      label: f.label,
      unit: f.unit,
      found: f.found,
      formulaLabel: f.formulaLabel,
      node: f.node,
      values: composeFormulaHierarchy(f.node, rawById, years, deptCodes),
      officialUniv: official?.univ ?? emptyYearMap(years),
      officialYears: official
        ? yearsWithValues(official.univ, years)
        : [],
      childLines: formulaChildHierarchies(f.node, rawById, years, deptCodes),
    };
  }

  return {
    years,
    availableYears,
    org,
    categoryTitles,
    sections: resolved.sections,
    directs,
    studentComponents,
    studentOfficialTotal,
    studentOfficialTotalYears,
    studentComponentOfficialYears,
    studentMeta,
    accountings,
    formulas,
  };
}

export const STUDENT_TOGGLE_IDS: Record<
  StudentCountComponentKey,
  keyof StudentCountToggles
> = {
  inner: 'includeInner',
  outer: 'includeOuter',
  leave: 'includeLeave',
  deferred: 'includeDeferred',
};

function preferOfficialStudentTotal(
  values: HierarchyValues,
  bundle: MonitoringBundle,
  toggles: StudentCountToggles,
  years: number[],
): HierarchyValues {
  // 대학알리미 재학생 수는 정원 내·외 합계만 제공한다. 두 항목이 모두
  // 선택됐을 때만 공시 총계로 바꾸고 학과별 합계는 업로드 값을 유지한다.
  if (!toggles.includeInner || !toggles.includeOuter) return values;

  const univ = { ...values.univ };
  for (const year of years) {
    const officialTotal = bundle.studentOfficialTotal[year];
    if (officialTotal == null) continue;
    let total = officialTotal;
    if (toggles.includeLeave) {
      total += bundle.studentComponents.leave.univ[year] ?? 0;
    }
    if (toggles.includeDeferred) {
      total += bundle.studentComponents.deferred.univ[year] ?? 0;
    }
    univ[year] = total;
  }
  return { univ, depts: values.depts };
}

function studentValueSourceAt(
  bundle: MonitoringBundle,
  toggles: StudentCountToggles,
  selectedYear: number,
  value: number | null | undefined,
): MonitoringValueSource | null {
  if (value == null) return null;
  let official = false;
  let monitoring = false;

  if (toggles.includeInner || toggles.includeOuter) {
    if (
      toggles.includeInner &&
      toggles.includeOuter &&
      bundle.studentOfficialTotalYears.includes(selectedYear)
    ) {
      official = true;
    } else {
      monitoring = true;
    }
  }

  for (const key of ['leave', 'deferred'] as StudentCountComponentKey[]) {
    if (!toggles[STUDENT_TOGGLE_IDS[key]]) continue;
    if (bundle.studentComponents[key].univ[selectedYear] == null) continue;
    if ((bundle.studentComponentOfficialYears[key] ?? []).includes(selectedYear)) {
      official = true;
    } else {
      monitoring = true;
    }
  }

  if (official && monitoring) return 'MIXED';
  if (official) return 'ALIMI';
  return 'MONITORING';
}

export function buildKpiViews(
  bundle: MonitoringBundle,
  toggles: StudentCountToggles,
  formulaToggles: Record<string, Record<string, boolean>>,
  selectedYear: number,
): KpiViewModel[] {
  const org = bundle.org;
  const years = trendYearWindow(selectedYear);
  const deptCodes = allDeptCodes(org);
  const views: KpiViewModel[] = [];

  const studentValues = preferOfficialStudentTotal(
    composeStudentCountHierarchy(
      bundle.studentComponents,
      toggles,
      years,
      deptCodes,
    ),
    bundle,
    toggles,
    years,
  );
  const studentKeys = selectedComponentKeys(toggles);
  if (bundle.studentMeta.found) {
    const studentBreakdown: StudentCountBreakdown | undefined =
      studentKeys.length > 0
        ? {
            keys: studentKeys,
            labels: STUDENT_COUNT_COMPONENT_SHORT_LABELS,
            depts: Object.fromEntries(
              studentKeys.map((key) => [
                key,
                bundle.studentComponents[key]?.depts ?? {},
              ]),
            ) as StudentCountBreakdown['depts'],
          }
        : undefined;
    const stackBreakdown: StackBreakdown | undefined = studentBreakdown
      ? {
          keys: [...studentBreakdown.keys],
          labels: { ...studentBreakdown.labels },
          depts: { ...studentBreakdown.depts },
        }
      : undefined;
    views.push({
      id: 'student-count',
      label: bundle.studentMeta.label,
      unit: bundle.studentMeta.unit,
      found: bundle.studentMeta.found,
      hasHierarchy: hasHierarchyData(
        studentValues.depts,
        selectedYear,
        studentValues.univ,
      ),
      selectedYear,
      years,
      univ: studentValues.univ,
      depts: studentValues.depts,
      yoy: computeYoy(
        studentValues.univ,
        years,
        bundle.studentMeta.kpi.direction,
        selectedYear,
      ),
      kpi: bundle.studentMeta.kpi,
      valueSource: studentValueSourceAt(
        bundle,
        toggles,
        selectedYear,
        studentValues.univ[selectedYear],
      ),
      studentBreakdown,
      stackBreakdown,
      componentToggles: (
        Object.keys(STUDENT_COUNT_COMPONENT_SHORT_LABELS) as StudentCountComponentKey[]
      ).map((key) => ({
        id: key,
        label: STUDENT_COUNT_COMPONENT_SHORT_LABELS[key],
        on: toggles[STUDENT_TOGGLE_IDS[key]],
        value: bundle.studentComponents[key]?.univ[selectedYear] ?? null,
        sign: 1,
      })),
    });
  }

  for (const [id, entry] of Object.entries(bundle.directs)) {
    if (!entry.found) continue;
    views.push({
      id: id as MonitoringKpiId,
      label: entry.label,
      unit: entry.unit,
      found: entry.found,
      hasHierarchy: hasHierarchyData(
        entry.values.depts,
        selectedYear,
        entry.values.univ,
      ),
      selectedYear,
      years,
      univ: entry.values.univ,
      depts: entry.values.depts,
      yoy: computeYoy(entry.values.univ, years, entry.kpi.direction, selectedYear),
      kpi: entry.kpi,
      valueSource: valueSourceAt(
        entry.values.univ[selectedYear],
        entry.officialYears,
        selectedYear,
      ),
    });
  }

  for (const [id, entry] of Object.entries(bundle.accountings)) {
    if (!entry.found) continue;
    // 조회 연도 행은 직전 연도 결산이므로 표시 연도를 1년 당긴다.
    const accountingYear = selectedYear - ACCOUNTING_YEAR_LAG;
    const accountingYears = trendYearWindow(accountingYear);
    const income = projectAccountingYearMap(entry.income.univ, accountingYears);
    const expense = projectAccountingYearMap(
      entry.expense.univ,
      accountingYears,
    );
    const incomeDepts = projectAccountingDeptMaps(
      entry.income.depts,
      accountingYears,
    );
    const expenseDepts = projectAccountingDeptMaps(
      entry.expense.depts,
      accountingYears,
    );
    views.push({
      id: id as MonitoringKpiId,
      label: entry.label,
      unit: entry.unit,
      found: entry.found,
      hasHierarchy:
        hasHierarchyData(incomeDepts, accountingYear, income) ||
        hasHierarchyData(expenseDepts, accountingYear, expense),
      selectedYear: accountingYear,
      years: accountingYears,
      univ: income,
      depts: incomeDepts,
      yoy: computeYoy(
        income,
        accountingYears,
        entry.kpi.direction,
        accountingYear,
      ),
      kpi: entry.kpi,
      valueSource:
        income[accountingYear] != null || expense[accountingYear] != null
          ? 'MONITORING'
          : null,
      accounting: {
        income,
        expense,
        incomeDepts,
        expenseDepts,
        incomeYoy: computeYoy(
          income,
          accountingYears,
          entry.kpi.direction,
          accountingYear,
        ),
        expenseYoy: computeYoy(
          expense,
          accountingYears,
          entry.kpi.direction,
          accountingYear,
        ),
        incomeLines: entry.incomeLines.map((l) => ({
          name: l.name,
          univ: projectAccountingYearMap(l.values.univ, accountingYears),
        })),
        expenseLines: entry.expenseLines.map((l) => ({
          name: l.name,
          univ: projectAccountingYearMap(l.values.univ, accountingYears),
        })),
      },
    });
  }

  for (const [id, entry] of Object.entries(bundle.formulas)) {
    if (!entry.found) continue;
    const analysis = analyzeFormula(entry.node.computeFormula);
    const childMap = new Map(
      entry.childLines.map((c) => [c.metricId, c.values]),
    );
    const kpiToggles = formulaToggles[id] ?? {};
    const enabledTerms =
      analysis.kind === 'additive'
        ? analysis.terms.filter((t) => kpiToggles[String(t.metricId)] !== false)
        : [];
    const computedValues =
      analysis.kind === 'additive'
        ? composeAdditiveHierarchy(
            enabledTerms,
            analysis.constant,
            childMap,
            years,
            deptCodes,
          )
        : entry.values;
    const allFormulaTermsEnabled =
      analysis.kind !== 'additive' ||
      analysis.terms.every(
        (term) => kpiToggles[String(term.metricId)] !== false,
      );
    const values = allFormulaTermsEnabled
      ? preferOfficialUniversity(
          computedValues,
          {
            univ: entry.officialUniv,
            // 공시 대학 총계가 학과값으로 복제돼도 학과 비교에는 사용하지 않는다.
            depts: {},
          },
          years,
        ).values
      : computedValues;

    const stackBreakdown: StackBreakdown | undefined =
      analysis.kind === 'additive' && enabledTerms.length > 0
        ? {
            keys: enabledTerms.map((t) => String(t.metricId)),
            labels: Object.fromEntries(
              enabledTerms.map((t) => {
                const child = entry.childLines.find(
                  (c) => c.metricId === t.metricId,
                );
                const name = child?.name ?? String(t.metricId);
                return [String(t.metricId), t.coef < 0 ? `− ${name}` : name];
              }),
            ),
            depts: Object.fromEntries(
              enabledTerms.map((t) => {
                const rawDepts = childMap.get(t.metricId)?.depts ?? {};
                if (t.coef === 1) return [String(t.metricId), rawDepts];
                const scaled: Record<string, YearValueMap> = {};
                for (const [code, map] of Object.entries(rawDepts)) {
                  scaled[code] = Object.fromEntries(
                    Object.entries(map).map(([y, v]) => [
                      y,
                      v == null ? null : v * t.coef,
                    ]),
                  );
                }
                return [String(t.metricId), scaled];
              }),
            ),
          }
        : undefined;

    views.push({
      id: id as MonitoringKpiId,
      label: entry.label,
      unit: entry.unit,
      found: entry.found,
      hasHierarchy: hasHierarchyData(values.depts, selectedYear, values.univ),
      selectedYear,
      years,
      univ: values.univ,
      depts: values.depts,
      yoy: computeYoy(values.univ, years, entry.kpi.direction, selectedYear),
      kpi: entry.kpi,
      valueSource: valueSourceAt(
        values.univ[selectedYear],
        allFormulaTermsEnabled ? entry.officialYears : [],
        selectedYear,
      ),
      stackBreakdown,
      componentToggles:
        analysis.kind === 'additive'
          ? analysis.terms.map((t) => {
              const child = entry.childLines.find((c) => c.metricId === t.metricId);
              return {
                id: String(t.metricId),
                label: child?.name ?? String(t.metricId),
                on: kpiToggles[String(t.metricId)] !== false,
                value: child?.values.univ[selectedYear] ?? null,
                sign: t.coef < 0 ? (-1 as const) : (1 as const),
              };
            })
          : undefined,
      formula: {
        expressionLabel: entry.formulaLabel,
        kind: analysis.kind,
        lines: entry.childLines.map((l) => ({
          name: l.name,
          univ: l.values.univ,
        })),
      },
    });
  }

  return views;
}
