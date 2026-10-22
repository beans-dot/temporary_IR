import axios from 'axios';
import { clearAuthCookies, readTokenFromDocument } from '@/lib/auth';

// 브라우저에서는 Next rewrite(/api/backend/*)를 경유, 서버 컴포넌트에서는 직접 백엔드 호출
const isServer = typeof window === 'undefined';
const serverBase =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: isServer ? serverBase : '/api/backend',
  timeout: 30000,
});

api.interceptors.request.use((config) => {
  if (!isServer) {
    const token = readTokenFromDocument();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (error) => {
    if (!isServer && error?.response?.status === 401) {
      const url = String(error?.config?.url || '');
      // 로그인/회원가입 실패는 세션 정리하지 않음
      if (
        !url.includes('/auth/login') &&
        !url.includes('/auth/register') &&
        !url.includes('/auth/affiliation-options')
      ) {
        clearAuthCookies();
      }
    }
    return Promise.reject(error);
  },
);

export type MetricSourceType = 'ALIMI' | 'INTERNAL' | 'MONITORING';

export interface MetricNode {
  metricId: number;
  /** 시드 지표 고유 코드(모니터링). 지표명을 바꿔도 유지되는 매칭 기준 */
  metricCode?: string | null;
  metricName: string;
  metricUnit: string | null;
  sourceType: MetricSourceType;
  displayOrder: number;
  parentMetricId?: number | null;
  isHidden?: boolean;
  /** `{#metricId}` 사칙연산식. computeEnabled 일 때 조회에 사용 */
  computeFormula?: string | null;
  computeEnabled?: boolean;
  /** 이 지표 행 자체에 업로드된 원본 값이 있는지 */
  hasRawData?: boolean;
  children?: MetricNode[];
}

export interface CategoryTreeNode {
  categoryId: number;
  /** 시드 카테고리 고유 코드(모니터링). 카테고리명을 바꿔도 유지 */
  categoryCode?: string | null;
  categoryName: string;
  displayOrder: number;
  sourceType?: MetricSourceType;
  isHidden?: boolean;
  metrics: MetricNode[];
}

/** 조회·지표선택용: 숨김 카테고리/지표를 트리에서 제거 */
export function excludeHiddenFromTree(
  tree: CategoryTreeNode[],
): CategoryTreeNode[] {
  const walk = (metrics: MetricNode[]): MetricNode[] =>
    (metrics ?? [])
      .filter((m) => !m.isHidden)
      .map((m) => ({ ...m, children: walk(m.children ?? []) }));
  return tree
    .filter((c) => !c.isHidden)
    .map((c) => ({ ...c, metrics: walk(c.metrics) }))
    .filter((c) => c.metrics.length > 0);
}

export type TargetTreeLevel =
  | 'section'
  | 'root'
  | 'schoolType'
  | 'region'
  | 'regionCity'
  | 'univ'
  | 'series'
  | 'dept';

export interface TargetTreeNode {
  id: string;
  label: string;
  level: TargetTreeLevel | string;
  univCode?: string;
  deptCode?: string;
  isYeonsung?: boolean;
  selectable: boolean;
  memberDeptCodes?: string[];
  periodDepts?: Array<{ deptCode: string; deptName: string }>;
  children?: TargetTreeNode[];
}

export interface PivotRow {
  targetKey: string;
  targetLabel: string;
  univCode: string;
  deptCode: string | null;
  isYeonsung: boolean;
  metricId: number;
  metricName: string;
  metricUnit: string | null;
  aggregationType: string;
  values: Record<number, number | null>;
}

export interface PivotResult {
  years: number[];
  rows: PivotRow[];
}

export interface UpdateLogMetricDetail {
  metricName: string;
  isNew: boolean;
  sampleDept: string | null;
  deptCount: number;
}

export interface UpdateLogDetail {
  metrics: UpdateLogMetricDetail[];
}

export interface UpdateLog {
  logId: number;
  updateDate: string;
  updateType: string;
  logText: string;
  detail?: UpdateLogDetail | null;
}

/** YSU = [연성대학교], EXTERNAL = [대학 외] */
export type AnnualEventCategory = 'YSU' | 'EXTERNAL';

export interface AnnualEvent {
  eventId: number;
  year: number;
  category: AnnualEventCategory;
  content: string;
  createdAt?: string;
  updatedAt?: string;
}

export const ANNUAL_EVENT_CATEGORY_LABEL: Record<AnnualEventCategory, string> =
  {
    YSU: '연성대학교',
    EXTERNAL: '대학 외',
  };

export interface UniversityCodebook {
  generatedAt: string;
  referenceYear: number;
  yeonsung: {
    univCode: string;
    univName: string;
    departments: Array<{
      deptCode: string;
      deptName: string;
      seriesLg: string | null;
    }>;
  };
  universities: Array<{
    univCode: string;
    univName: string;
    schoolType: string | null;
    regionType: string | null;
    regionCity: string | null;
  }>;
  departments: Array<{
    univCode: string;
    univName: string;
    deptCode: string;
    deptName: string;
    seriesLg: string | null;
  }>;
}

export interface MetricCodebookEntry {
  metricId: number;
  metricCode?: string | null;
  metricName: string;
  sourceType: MetricSourceType;
  sourceLabel: string;
  categoryName: string;
  metricUnit: string | null;
  parentMetricId?: number | null;
  parentMetricName?: string | null;
  /** 기존 값에 대학 전체(_ALL_) 데이터가 있는지 */
  hasUniversityData?: boolean;
  /** 기존 값에 학과 데이터가 있는지 */
  hasDepartmentData?: boolean;
  /** 대학 전체값(_ALL_)이 대학알리미 정보공시와 자동 연결되는지 */
  officialAllLinked?: boolean;
  /** 자동 연결된 대학알리미 지표명 */
  officialMetricName?: string | null;
}

export interface MetricCodebook {
  generatedAt: string;
  metrics: MetricCodebookEntry[];
}

export type MemberStatus = 'pending' | 'approved' | 'rejected';

export type AffiliationType = '학과' | '부서' | '기타';

export interface AffiliationMajorOption {
  deptCode: string;
  deptName: string;
  seriesName: string;
}

export interface AffiliationOfficeOption {
  officeCode: string;
  deptName: string;
  categoryName: string | null;
}

export interface AffiliationOptions {
  majors: AffiliationMajorOption[];
  offices: AffiliationOfficeOption[];
}

export async function fetchAffiliationOptions() {
  const { data } = await api.get<AffiliationOptions>(
    '/auth/affiliation-options',
  );
  return data;
}

export function formatAffiliation(
  affiliationType: AffiliationType | null | undefined,
  department: string,
  options?: AffiliationOptions | null,
) {
  if (!affiliationType) return department;
  const label = affiliationLabel(affiliationType, department, options);
  return `${affiliationType} · ${label}`;
}

function affiliationLabel(
  type: AffiliationType,
  department: string,
  options?: AffiliationOptions | null,
) {
  if (!options) return department;
  if (type === '학과') {
    const hit = options.majors.find(
      (m) => m.deptCode === department || m.deptName === department,
    );
    return hit?.deptName ?? department;
  }
  if (type === '부서') {
    const hit = options.offices.find(
      (o) => o.officeCode === department || o.deptName === department,
    );
    return hit?.deptName ?? department;
  }
  return department;
}

export function inferAffiliationType(
  savedType: AffiliationType | null | undefined,
  department: string,
  options: AffiliationOptions,
): AffiliationType | '' {
  const inMajors = options.majors.some(
    (m) => m.deptCode === department || m.deptName === department,
  );
  const inOffices = options.offices.some(
    (o) => o.officeCode === department || o.deptName === department,
  );

  if (savedType === '학과') return inMajors ? '학과' : department ? '기타' : '학과';
  if (savedType === '부서') return inOffices ? '부서' : department ? '기타' : '부서';
  if (savedType === '기타') return '기타';

  if (inMajors) return '학과';
  if (inOffices) return '부서';
  if (department) return '기타';
  return '';
}

export interface MemberSummary {
  id: string;
  name: string;
  email: string;
  affiliationType: AffiliationType | null;
  department: string;
  extension: string;
  role: 'admin' | 'user';
  status: MemberStatus;
  createdAt: string;
  approvedAt: string | null;
  approvedBy: string | null;
}

export interface LoginLogEntry {
  logId: number;
  userId: string;
  success: boolean;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface RawCorrectionItem {
  rawId: number;
  year: number;
  univCode: string;
  univName: string;
  deptCode: string;
  deptName: string;
  metricId: number;
  metricName: string;
  metricValue: string;
  isLocked: boolean;
}

export interface RawCorrectionListResult {
  total: number;
  items: RawCorrectionItem[];
}

export type RawCorrectionSourceType = Extract<
  MetricSourceType,
  'INTERNAL' | 'MONITORING'
>;

export type RawCorrectionListParams = {
  year: number;
  sourceType?: RawCorrectionSourceType;
  univCode?: string;
  deptCode?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export async function fetchRawCorrectionYears(
  sourceType: RawCorrectionSourceType = 'INTERNAL',
) {
  const { data } = await api.get<number[]>('/raw-correction/years', {
    params: { sourceType },
  });
  return data;
}

export async function fetchMonitoringYears() {
  const { data } = await api.get<number[]>('/metrics/monitoring/years');
  return Array.isArray(data)
    ? data.map(Number).filter((y) => Number.isFinite(y))
    : [];
}

export async function fetchRawCorrectionList(params: RawCorrectionListParams) {
  const { data } = await api.get<RawCorrectionListResult>('/raw-correction', {
    params: {
      year: params.year,
      sourceType: params.sourceType ?? 'INTERNAL',
      univCode: params.univCode || undefined,
      deptCode: params.deptCode || undefined,
      q: params.q || undefined,
      page: params.page ?? 1,
      pageSize: params.pageSize ?? 100,
    },
  });
  return data;
}

export async function patchRawCorrectionValue(
  rawId: number,
  metricValue: string,
) {
  const { data } = await api.patch<RawCorrectionItem>(
    `/raw-correction/${rawId}`,
    { metricValue },
  );
  return data;
}

export async function deleteRawCorrection(rawIds: number[]) {
  const { data } = await api.delete<{ deleted: number }>('/raw-correction', {
    data: { rawIds },
  });
  return data;
}

export interface InternalDeptNode {
  deptPk: number;
  deptCode: string;
  deptName: string;
  displayOrder: number;
  rawCount: number;
  effectiveFrom?: number;
  abolishedFrom?: number | null;
}

export interface InternalSeriesNode {
  seriesId: number;
  seriesCode?: string | null;
  seriesName: string;
  displayOrder: number;
  isUncategorized: boolean;
  departments: InternalDeptNode[];
  effectiveFrom?: number;
  abolishedFrom?: number | null;
}
