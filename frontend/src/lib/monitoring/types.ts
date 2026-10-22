export type MetricDirection = 'higher-better' | 'lower-better';

/** 카드의 선택 연도 대학 전체값 출처 */
export type MonitoringValueSource = 'ALIMI' | 'MONITORING' | 'MIXED';

export type SeriesAggregation = 'sum' | 'avg';

/** 시드 KPI id 또는 지표 DB 빌더에서 추가한 지표의 동적 id */
export type MonitoringKpiId = string;

export type StudentCountComponentKey =
  | 'inner'
  | 'outer'
  | 'leave'
  | 'deferred';

export interface StudentCountToggles {
  includeInner: boolean;
  includeOuter: boolean;
  includeLeave: boolean;
  includeDeferred: boolean;
}

/** 시드 카테고리 코드 또는 DB 카테고리의 동적 id */
export type MonitoringCategoryId = string;

export interface MonitoringKpiDef {
  id: MonitoringKpiId;
  categoryId: MonitoringCategoryId;
  /** 기본 표기명. 지표 DB 빌더에서 지표명을 바꾸면 DB 이름이 우선한다. */
  label: string;
  kind: 'direct' | 'composite' | 'accounting' | 'formula';
  /**
   * 백엔드 시드 지표 코드(ir_metric_registry.metric_code).
   * 지표명 변경과 무관하게 KPI를 찾는 기준. 사용자 추가 지표는 metric-{id}.
   */
  metricCode: string;
  metricName?: string;
  direction: MetricDirection;
  seriesAggregation: SeriesAggregation;
  fallbackUnit: string | null;
}

export interface MonitoringCategoryDef {
  id: MonitoringCategoryId;
  title: string;
  description: string;
  kpiIds: MonitoringKpiId[];
}

export type YearValueMap = Record<number, number | null>;

export interface OrgDepartment {
  deptCode: string;
  deptName: string;
  displayOrder: number;
}

export interface OrgSeries {
  id: string;
  name: string;
  displayOrder: number;
  departments: OrgDepartment[];
}

export interface OrgStructure {
  univCode: string;
  univName: string;
  series: OrgSeries[];
}

export interface HierarchyValues {
  univ: YearValueMap;
  depts: Record<string, YearValueMap>;
}

/** 재학생 수 토글로 켠 구성 항목의 학과별 값 */
export interface StudentCountBreakdown {
  keys: StudentCountComponentKey[];
  labels: Record<StudentCountComponentKey, string>;
  depts: Record<StudentCountComponentKey, Record<string, YearValueMap>>;
}

/** 누적 가로 막대용 구성 항목 (재학생·가감 계산식) */
export interface StackBreakdown {
  keys: string[];
  labels: Record<string, string>;
  depts: Record<string, Record<string, YearValueMap>>;
}

export interface ComponentToggleItem {
  id: string;
  label: string;
  on: boolean;
  value: number | null;
  /** 계산식에서 빼는 항목이면 -1 */
  sign: 1 | -1;
}

export interface ResolvedDirectKpi {
  kpi: MonitoringKpiDef;
  /** 지표 DB 빌더에서 바꾼 지표명(없으면 kpi.label) */
  label: string;
  metricIds: number[];
  unit: string | null;
  found: boolean;
}

export interface FormulaEvalNode {
  metricId: number;
  name: string;
  computeEnabled: boolean;
  computeFormula: string | null;
  children: FormulaEvalNode[];
}

export interface ResolvedFormulaKpi {
  kpi: MonitoringKpiDef;
  label: string;
  unit: string | null;
  found: boolean;
  node: FormulaEvalNode;
  formulaLabel: string;
  metricIds: number[];
}

export interface ResolvedCompositeKpi {
  kpi: MonitoringKpiDef;
  label: string;
  components: Record<
    StudentCountComponentKey,
    { metricIds: number[]; found: boolean }
  >;
  unit: string | null;
  found: boolean;
}

export interface AccountingLineRef {
  name: string;
  metricIds: number[];
  found: boolean;
}

export interface ResolvedAccountingKpi {
  kpi: MonitoringKpiDef;
  label: string;
  incomeLines: AccountingLineRef[];
  expenseLines: AccountingLineRef[];
  unit: string | null;
  found: boolean;
}

export type HighlightBand = 'top' | 'bottom' | 'none';

export interface YoySnapshot {
  currentYear: number | null;
  currentValue: number | null;
  previousYear: number | null;
  previousValue: number | null;
  delta: number | null;
  isImprovement: boolean | null;
}
