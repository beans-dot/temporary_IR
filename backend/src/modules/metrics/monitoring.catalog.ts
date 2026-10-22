export interface MonitoringSeedMetric {
  /**
   * 지표 고유 코드. 지표명을 바꿔도 이 코드로 시드를 다시 찾으므로
   * 이름 변경 후에도 중복 생성되지 않고 monitoring 화면 매칭이 유지된다.
   * 절대 바꾸지 말 것.
   */
  code: string;
  name: string;
  unit: string | null;
  children?: MonitoringSeedMetric[];
}

export interface MonitoringSeedCategory {
  /** 카테고리 고유 코드. 카테고리명을 바꿔도 유지된다. 절대 바꾸지 말 것. */
  code: string;
  categoryName: string;
  displayOrder: number;
  metrics: MonitoringSeedMetric[];
}

/**
 * 모니터링 대학 전체값(_ALL_)에 우선 적용할 대학알리미 지표.
 *
 * 대학알리미 비교 API는 대부분 대학 단위 값만 제공한다. 따라서 이 매핑은
 * 대학 전체 시계열에만 사용하고, 학과별 값은 MONITORING 엑셀 업로드 값을
 * 그대로 유지한다. 이름이 비슷해도 산식이 다른 지표는 연결하지 않는다.
 */
export interface MonitoringAlimiLink {
  monitoringMetricCode: string;
  alimiMetricNames: string[];
}

export const MONITORING_ALIMI_LINKS: MonitoringAlimiLink[] = [
  { monitoringMetricCode: 'student-count', alimiMetricNames: ['재학생 수'] },
  {
    monitoringMetricCode: 'student-count.leave',
    alimiMetricNames: ['휴학생 현황'],
  },
  {
    monitoringMetricCode: 'foreign-student-count',
    alimiMetricNames: ['외국인 학생'],
  },
  {
    monitoringMetricCode: 'freshman-fill-inner',
    alimiMetricNames: ['신입생 충원율'],
  },
  {
    monitoringMetricCode: 'admission-competition',
    alimiMetricNames: ['신입생 경쟁률'],
  },
  {
    monitoringMetricCode: 'enrolled-fill-all',
    alimiMetricNames: ['재학생 충원율'],
  },
  { monitoringMetricCode: 'dropout-rate', alimiMetricNames: ['중도탈락률'] },
  {
    monitoringMetricCode: 'employment-rate',
    alimiMetricNames: ['졸업생 취업률'],
  },
  {
    monitoringMetricCode: 'faculty-secure-rate',
    alimiMetricNames: ['전임교원 확보율'],
  },
  {
    monitoringMetricCode: 'students-per-faculty',
    alimiMetricNames: ['전임교원 1인당 학생수(재학생)'],
  },
];

/** 회계 지표(상위 → 수입/지출 → 세부 항목) 코드 규칙: `<회계코드>.income.<항목>` */
function accountingSeed(
  code: string,
  name: string,
  income: Array<[string, string]>,
  expense: Array<[string, string]>,
): MonitoringSeedMetric {
  const line = (group: 'income' | 'expense') =>
    (group === 'income' ? income : expense).map(([slug, lineName]) => ({
      code: `${code}.${group}.${slug}`,
      name: lineName,
      unit: '원',
    }));

  return {
    code,
    name,
    unit: '원',
    children: [
      {
        code: `${code}.income`,
        name: '수입',
        unit: '원',
        children: line('income'),
      },
      {
        code: `${code}.expense`,
        name: '지출',
        unit: '원',
        children: line('expense'),
      },
    ],
  };
}

const TUITION_ACCOUNTING = accountingSeed(
  'tuition-accounting',
  '교비 회계 현황',
  [
    ['registration', '등록금수입'],
    ['transfer-in', '전입금'],
    ['donation', '기부금'],
    ['government-subsidy', '국고보조금'],
    ['iacf-revenue', '산학협력수입'],
    ['education-side', '교육부대수입'],
    ['interest', '이자수입'],
    ['other', '기타수입'],
  ],
  [
    ['payroll', '보수지출'],
    ['admin', '관리운영비'],
    ['research-student', '연구학생경비'],
    ['non-education', '교육외비용'],
    ['transfer-out', '전출금'],
    ['facility', '시설비'],
    ['reserve', '예비비'],
    ['other', '기타지출'],
  ],
);

const CORPORATE_ACCOUNTING = accountingSeed(
  'corporate-accounting',
  '법인회계 예·결산 현황',
  [
    ['contribution', '출연금'],
    ['donation', '기부금'],
    ['interest', '이자수입'],
    ['other', '기타수입'],
  ],
  [
    ['operation', '운영비'],
    ['project', '사업비'],
    ['transfer-out', '전출금'],
    ['other', '기타지출'],
  ],
);

const IACF_ACCOUNTING = accountingSeed(
  'iacf-accounting',
  '산학협력단 회계 현황',
  [
    ['iacf-revenue', '산학협력수익'],
    ['grant', '지원금수익'],
    ['transfer-in', '전입금'],
    ['other', '기타수익'],
  ],
  [
    ['iacf-cost', '산학협력비'],
    ['admin', '일반관리비'],
    ['non-operating', '운영외비용'],
    ['other', '기타지출'],
  ],
);

export const MONITORING_SEED_CATALOG: MonitoringSeedCategory[] = [
  {
    code: 'foundation',
    categoryName: '기초 데이터',
    displayOrder: 0,
    metrics: [
      {
        code: 'student-count',
        name: '재학생 수',
        unit: '명',
        children: [
          { code: 'student-count.inner', name: '재학생 수(정원 내)', unit: '명' },
          { code: 'student-count.outer', name: '재학생 수(정원 외)', unit: '명' },
          { code: 'student-count.leave', name: '휴학생 수', unit: '명' },
          {
            code: 'student-count.deferred',
            name: '학사학위취득유예학생 수',
            unit: '명',
          },
        ],
      },
      { code: 'foreign-student-count', name: '외국인 유학생 수', unit: '명' },
    ],
  },
  {
    code: 'freshman',
    categoryName: '신입생 유치력',
    displayOrder: 1,
    metrics: [
      {
        code: 'freshman-fill-inner',
        name: '신입생 충원율(정원 내)',
        unit: '%',
      },
      {
        code: 'freshman-fill-outer',
        name: '신입생 충원율(정원 외)',
        unit: '%',
      },
      { code: 'admission-competition', name: '입시경쟁률', unit: '배수' },
    ],
  },
  {
    code: 'retention',
    categoryName: '재학생 유지력',
    displayOrder: 2,
    metrics: [
      {
        code: 'enrolled-fill-inner',
        name: '재학생 충원율(정원 내)',
        unit: '%',
      },
      { code: 'enrolled-fill-all', name: '재학생 충원율(전체)', unit: '%' },
      { code: 'dropout-rate', name: '중도탈락률', unit: '%' },
    ],
  },
  {
    code: 'outcome',
    categoryName: '성과 창출력',
    displayOrder: 3,
    metrics: [
      { code: 'employment-rate', name: '취업률', unit: '%' },
      { code: 'startup-count', name: '창업자 수', unit: '명' },
    ],
  },
  {
    code: 'finance',
    categoryName: '재정 및 자원 효율',
    displayOrder: 4,
    metrics: [
      { code: 'faculty-secure-rate', name: '전임교원 확보율', unit: '%' },
      {
        code: 'students-per-faculty',
        name: '전임교원 1인당 학생 수',
        unit: '명',
      },
      TUITION_ACCOUNTING,
      CORPORATE_ACCOUNTING,
      IACF_ACCOUNTING,
    ],
  },
];
