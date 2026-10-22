import type {
  MonitoringCategoryDef,
  MonitoringKpiDef,
  StudentCountComponentKey,
  StudentCountToggles,
} from './types';

export const DEFAULT_STUDENT_COUNT_TOGGLES: StudentCountToggles = {
  includeInner: true,
  // 대학 전체 기본값은 대학알리미의 재학생 총계(정원 내+외)와 맞춘다.
  includeOuter: true,
  includeLeave: false,
  includeDeferred: false,
};

/** 재학생 수 구성 항목의 시드 코드 (지표명 변경과 무관한 매칭 기준) */
export const STUDENT_COUNT_COMPONENT_CODES: Record<
  StudentCountComponentKey,
  string
> = {
  inner: 'student-count.inner',
  outer: 'student-count.outer',
  leave: 'student-count.leave',
  deferred: 'student-count.deferred',
};

/** 코드가 없는 과거 데이터를 위한 이름 폴백 */
export const STUDENT_COUNT_COMPONENT_NAMES: Record<
  StudentCountComponentKey,
  string
> = {
  inner: '재학생 수(정원 내)',
  outer: '재학생 수(정원 외)',
  leave: '휴학생 수',
  deferred: '학사학위취득유예학생 수',
};

/** 토글·누적 차트용 짧은 구성 항목명 */
export const STUDENT_COUNT_COMPONENT_SHORT_LABELS: Record<
  StudentCountComponentKey,
  string
> = {
  inner: '정원 내',
  outer: '정원 외',
  leave: '휴학생',
  deferred: '학위유예',
};

const KPI_DEFS: Array<Omit<MonitoringKpiDef, 'metricCode'>> = [
  {
    id: 'student-count',
    categoryId: 'foundation',
    label: '재학생 수',
    kind: 'composite',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '명',
  },
  {
    id: 'foreign-student-count',
    categoryId: 'foundation',
    label: '외국인 유학생 수',
    kind: 'direct',
    metricName: '외국인 유학생 수',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '명',
  },
  {
    id: 'freshman-fill-inner',
    categoryId: 'freshman',
    label: '신입생 충원율(정원 내)',
    kind: 'direct',
    metricName: '신입생 충원율(정원 내)',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'freshman-fill-outer',
    categoryId: 'freshman',
    label: '신입생 충원율(정원 외)',
    kind: 'direct',
    metricName: '신입생 충원율(정원 외)',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'admission-competition',
    categoryId: 'freshman',
    label: '입시경쟁률',
    kind: 'direct',
    metricName: '입시경쟁률',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '배수',
  },
  {
    id: 'enrolled-fill-inner',
    categoryId: 'retention',
    label: '재학생 충원율(정원 내)',
    kind: 'direct',
    metricName: '재학생 충원율(정원 내)',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'enrolled-fill-all',
    categoryId: 'retention',
    label: '재학생 충원율(전체)',
    kind: 'direct',
    metricName: '재학생 충원율(전체)',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'dropout-rate',
    categoryId: 'retention',
    label: '중도탈락률',
    kind: 'direct',
    metricName: '중도탈락률',
    direction: 'lower-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'employment-rate',
    categoryId: 'outcome',
    label: '취업률',
    kind: 'direct',
    metricName: '취업률',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'startup-count',
    categoryId: 'outcome',
    label: '창업자 수',
    kind: 'direct',
    metricName: '창업자 수',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '명',
  },
  {
    id: 'faculty-secure-rate',
    categoryId: 'finance',
    label: '전임교원 확보율',
    kind: 'direct',
    metricName: '전임교원 확보율',
    direction: 'higher-better',
    seriesAggregation: 'avg',
    fallbackUnit: '%',
  },
  {
    id: 'students-per-faculty',
    categoryId: 'finance',
    label: '전임교원 1인당 학생 수',
    kind: 'direct',
    metricName: '전임교원 1인당 학생 수',
    direction: 'lower-better',
    seriesAggregation: 'avg',
    fallbackUnit: '명',
  },
  {
    id: 'tuition-accounting',
    categoryId: 'finance',
    label: '교비 회계 현황',
    kind: 'accounting',
    metricName: '교비 회계 현황',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '원',
  },
  {
    id: 'corporate-accounting',
    categoryId: 'finance',
    label: '법인회계 예·결산 현황',
    kind: 'accounting',
    metricName: '법인회계 예·결산 현황',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '원',
  },
  {
    id: 'iacf-accounting',
    categoryId: 'finance',
    label: '산학협력단 회계 현황',
    kind: 'accounting',
    metricName: '산학협력단 회계 현황',
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: '원',
  },
];

/**
 * 시드 지표 코드(ir_metric_registry.metric_code)는 KPI id와 동일하게 유지한다.
 * backend/src/modules/metrics/monitoring.catalog.ts 와 짝을 이룬다.
 * 이 코드로 매칭하므로 트리 빌더에서 지표명을 바꿔도 카드가 끊기지 않는다.
 */
export const MONITORING_KPIS: MonitoringKpiDef[] = KPI_DEFS.map((def) => ({
  ...def,
  metricCode: def.id,
}));

/**
 * 섹션 id는 시드 카테고리 코드(ir_metric_category.category_code)와 동일하다.
 * 카테고리명을 바꾸면 DB 이름이 제목으로 쓰인다.
 */
export const MONITORING_CATEGORIES: MonitoringCategoryDef[] = [
  {
    id: 'foundation',
    title: '기초 데이터',
    description:
      '재학생 수는 정원 내·외, 휴학, 학위유예를 켜고 끄며 합산합니다. 외국인 유학생 수는 정원 내·외에 걸쳐 있어 별도 지표입니다.',
    kpiIds: ['student-count', 'foreign-student-count'],
  },
  {
    id: 'freshman',
    title: '신입생 유치력',
    description: '충원·경쟁 지표로 신입생 유치 경쟁력을 봅니다.',
    kpiIds: [
      'freshman-fill-inner',
      'freshman-fill-outer',
      'admission-competition',
    ],
  },
  {
    id: 'retention',
    title: '재학생 유지력',
    description: '충원과 중도탈락으로 재학 유지력을 봅니다.',
    kpiIds: ['enrolled-fill-inner', 'enrolled-fill-all', 'dropout-rate'],
  },
  {
    id: 'outcome',
    title: '성과 창출력',
    description: '취업·창업 성과를 한눈에 확인합니다.',
    kpiIds: ['employment-rate', 'startup-count'],
  },
  {
    id: 'finance',
    title: '재정 및 자원 효율',
    description: '교원 확보와 회계 효율을 모니터링합니다.',
    kpiIds: [
      'faculty-secure-rate',
      'students-per-faculty',
      'tuition-accounting',
      'corporate-accounting',
      'iacf-accounting',
    ],
  },
];

export const MONITORING_KPI_MAP = Object.fromEntries(
  MONITORING_KPIS.map((k) => [k.id, k]),
) as Record<string, MonitoringKpiDef>;

/** 지표 DB 빌더 전용. 조회 화면에는 쓰지 않는다. */
export type MonitoringComputeRole = 'computed' | 'component';

/**
 * 하위 지표로 화면에서 합산되는 부모(자동계산)와
 * 그 입력 항목(구성항목)을 metric_code로 구분한다.
 */
export function monitoringComputeRole(
  metricCode?: string | null,
): MonitoringComputeRole | null {
  if (!metricCode) return null;
  const kpi = MONITORING_KPI_MAP[metricCode];
  if (kpi?.kind === 'composite' || kpi?.kind === 'accounting') {
    return 'computed';
  }
  if (metricCode.endsWith('.income') || metricCode.endsWith('.expense')) {
    return 'computed';
  }
  const parentCodes = MONITORING_KPIS.filter(
    (k) => k.kind === 'composite' || k.kind === 'accounting',
  ).map((k) => k.metricCode);
  if (parentCodes.some((code) => metricCode.startsWith(`${code}.`))) {
    return 'component';
  }
  return null;
}

/** 재학생·회계처럼 조회 화면 계산이 고정된 시드 지표 */
export function isLockedAutoComputeMetric(
  metricCode?: string | null,
): boolean {
  return monitoringComputeRole(metricCode) === 'computed';
}
