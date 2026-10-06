// 4대 대시보드 카테고리
export const CORE_CATEGORY_NAMES = [
  '모집',
  '학생·취창업',
  '교육·교원',
  '재정·교육여건',
] as const;
export type CoreCategory = (typeof CORE_CATEGORY_NAMES)[number];

/** 통계 API 그룹 — 지표명은 XML 응답에서 동적 추출 (하드코딩 금지) */
export interface StatsApiGroup {
  service: string;
  category: CoreCategory;
  /** 로그/지표명 prefix 용 한글 서비스 라벨 */
  serviceLabel: string;
  perSchool: boolean;
  operations: StatsOperation[];
}

export interface StatsOperation {
  operation: string;
  /** 지표명에 indctNm 없을 때 사용하는 operation 한글 라벨 */
  label: string;
  /** 지정 시 개별 operation 카테고리 오버라이드 */
  category?: CoreCategory;
  /**
   * representative: 응답 항목당 대표 수치 1개만 적재 (기본)
   * count: 목록형 공시 — 레코드 수를 대학단위 지표로 적재
   */
  mode?: 'representative' | 'count';
}

export interface AlimiFetchResult {
  operation: string;
  year: number;
  totalCount: number;
  items: Record<string, unknown>[];
}

export type AlimiBatchState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'completed_with_warnings'
  | 'no_data'
  | 'failed';

export type AlimiBatchPhase =
  | 'idle'
  | 'checking'
  | 'universities'
  | 'departments'
  | 'statistics'
  | 'finalizing'
  | 'done';

export interface AlimiBatchStatus {
  state: AlimiBatchState;
  phase: AlimiBatchPhase;
  runId: string | null;
  trigger: 'manual' | 'scheduled' | null;
  startedBy: string | null;
  requestedYear: number | null;
  year: number | null;
  message: string;
  processed: number;
  total: number;
  upserted: number;
  departments: number;
  warnings: number;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  schedule: {
    cron: string;
    timeZone: string;
  };
}

// 정규화된 대학 마스터 레코드
export interface NormalizedUniversity {
  univCode: string;
  univName: string;
  schoolTypeRaw: string | null;
  regionCity: string | null;
}

/** @deprecated 하위 호환 — ALIMI_STATS_SOURCES env 레거시 파싱용 */
export interface StatsSource {
  service: string;
  operation: string;
  category: CoreCategory;
  metricName: string;
  unit: string | null;
  perSchool: boolean;
  mode: 'value' | 'count';
  valueFields: string[];
}
