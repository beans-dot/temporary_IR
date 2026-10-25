/** KPI 목표 연차 및 자체평가·예산 입력 연도 */
export const SP_YEARS = [2022, 2023, 2024, 2025, 2026, 2027] as const;

export const SP_MIN_YEAR = SP_YEARS[0];
export const SP_MAX_YEAR = SP_YEARS[SP_YEARS.length - 1];

/** 부서 자체점검 척도 (부서자체평가보고서 원문) */
export const SP_DEPT_GRADES = ['미흡', '보통', '우수'] as const;

/** IR센터 평가 척도 (원문) */
export const SP_IR_GRADES = ['우수', '보통', '미흡'] as const;

/** 만족도조사 환류계획 반영 구분 */
export const SP_SURVEY_PLAN_GRADES = [
  '신속반영',
  '점진반영',
  '반영불가',
] as const;

/** 재원 유형 초기값. 이후에는 관리자가 화면에서 수정한다. */
export const SP_DEFAULT_FUND_SOURCES = [
  '교비',
  '재정지원사업(혁신)',
  '재정지원사업(RISE)',
  '재정지원사업(앵커)',
  '재정지원사업(AID)',
  '재정지원사업 기타',
  '신산업',
  '지자체 사업',
  '기타',
] as const;

/**
 * 보고서 합계를 재원 구분 없이 넣을 때 쓰는 임시 재원.
 * 해당 연도 예결산·결산조회에만 보이고, 다른 재원 금액은 건드리지 않는다.
 */
export const SP_SEED_FUND_SOURCE_NAME = '초기시딩 합계';
