import { ConflictException, Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { XMLParser } from 'fast-xml-parser';
import { DataSource, QueryRunner } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  IrDepartment,
  IrMetricCategory,
  IrMetricRegistry,
  IrRawData,
  IrUniversityMaster,
  IrUpdateLog,
} from '../../entities';
import {
  classifyRegionType,
  classifySchoolType,
  isPlaceholderDepartment,
  normalizeSeriesLg,
} from '../universities/yeonsung.data';
import {
  hasDeptLevelMetricSuffix,
  metricNameLookupCandidates,
  syncDeptLevelMetricNames,
  withDeptLevelMetricSuffix,
} from '../metrics/metric-labels';
import {
  AlimiFetchResult,
  AlimiBatchStatus,
  CoreCategory,
  NormalizedUniversity,
  StatsApiGroup,
  StatsOperation,
} from './alimi.types';

/**
 * 대학알리미 OpenAPI (data.go.kr / B340014) 연동 서비스.
 *
 * - 5개 API(재정/교육여건/교원·연구/학생/산학협력) 응답의 수치형 태그를
 *   Object.keys 로 동적 순회하여 ir_metric_registry / ir_raw_data 적재.
 * - XML에 학과 태그가 있으면 dept_code 매핑, 없으면 _ALL_ (대학 단위).
 * - numOfRows=9999, serviceKey 이중인코딩 방지, Upsert 정정공시 반영.
 */
@Injectable()
export class AlimiService {
  private readonly logger = new Logger(AlimiService.name);
  private readonly xmlParser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  });

  private readonly baseUrl =
    process.env.DATA_GO_KR_BASE_URL || 'https://apis.data.go.kr/B340014';
  private readonly serviceKey = decodeURIComponent(
    process.env.DATA_GO_KR_KEY || '',
  );

  private readonly univService =
    process.env.ALIMI_UNIV_SERVICE || 'BasicInformationService_2';
  private readonly univOperation =
    process.env.ALIMI_UNIV_OPERATION || 'getUniversityCode';

  private readonly deptService =
    process.env.ALIMI_DEPT_SERVICE || 'BasicInformationService_1';
  private readonly deptOperation =
    process.env.ALIMI_DEPT_OPERATION || 'getUniversityMajorCode';

  /** 대계열 코드표 (cdid → cdnm). 비우면 학과 응답의 korSrsLclftNm 만 사용 */
  private readonly seriesService =
    process.env.ALIMI_SERIES_SERVICE || 'BasicInformationService_1';
  private readonly seriesOperation =
    process.env.ALIMI_SERIES_OPERATION || 'getCodeByLargeSeries';

  private readonly statsGroups: StatsApiGroup[] = this.loadStatsGroups();

  private readonly batchLockKey = 1_903_402_651;
  private activeBatch: Promise<void> | null = null;
  private batchStatus: AlimiBatchStatus = {
    state: 'idle',
    phase: 'idle',
    runId: null,
    trigger: null,
    startedBy: null,
    requestedYear: null,
    year: null,
    message: '실행 대기 중',
    processed: 0,
    total: 0,
    upserted: 0,
    departments: 0,
    warnings: 0,
    startedAt: null,
    updatedAt: new Date().toISOString(),
    finishedAt: null,
    schedule: {
      cron: process.env.ALIMI_BATCH_CRON || '0 0 3 1 * *',
      timeZone: process.env.ALIMI_BATCH_TIME_ZONE || 'Asia/Seoul',
    },
  };

  /** 메타/식별 필드 — 지표값으로 취급하지 않음 */
  private readonly META_KEYS = new Set([
    'schlId',
    'univCode',
    'schlKrnNm',
    'schlFullNm',
    'univNm',
    'schlDivNm',
    'schlDivCd',
    'schlEstbNm',
    'svyYr',
    'indctId',
    'indctYr',
    'indctImg',
    'indctNm',
    'indctName',
    'metricNm',
    'itemNm',
    'indctKrnNm',
    'resultCode',
    'resultMsg',
    'numOfRows',
    'pageNo',
    'totalCount',
  ]);

  private readonly DEPT_CODE_KEYS = [
    'mjrId',
    'schlMjrId',
    'deptCd',
    'majorCd',
    'facmjCd',
    'subjCd',
    'ugajCd',
    'umajrCd',
    'deptCode',
    'majorCode',
    'Majorcode',
    'MajorCode',
  ];

  private readonly DEPT_NAME_KEYS = [
    'korMjrNm',
    'MajorNm',
    'deptNm',
    'majorNm',
    'facmjNm',
    'subjNm',
    'ugajNm',
    'umajrNm',
    'deptName',
    'majorName',
    '학과명',
  ];

  /** 학과정보 API 수치 필드 → 대시보드 지표 */
  private readonly MAJOR_NUMERIC_METRICS: Array<{
    key: string;
    metricName: string;
    category: CoreCategory;
    unit: string;
  }> = [
    {
      key: 'eschlPscpNum',
      metricName: '편제정원',
      category: '모집',
      unit: '명',
    },
    {
      key: 'grdtNum',
      metricName: '졸업자 수',
      category: '학생·취창업',
      unit: '명',
    },
  ];

  private readonly SERIES_KEYS = [
    'lclsNm',
    'seriesLgNm',
    'lSeriesNm',
  ];

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  private get currentYear(): number {
    return new Date().getFullYear();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * 5개 통계 API 그룹. ALIMI_STATS_GROUPS(JSON) 로 오버라이드 가능.
   * 지표명은 하드코딩하지 않고 응답 XML 키에서 동적 추출한다.
   */
  private loadStatsGroups(): StatsApiGroup[] {
    const fromEnv = process.env.ALIMI_STATS_GROUPS;
    if (fromEnv) {
      try {
        return JSON.parse(fromEnv) as StatsApiGroup[];
      } catch {
        this.logger.warn('ALIMI_STATS_GROUPS JSON 파싱 실패, 기본값 사용');
      }
    }

    return [
      {
        service: 'FinancesService',
        serviceLabel: '재정',
        category: '재정·교육여건',
        perSchool: true,
        operations: [
          { operation: 'getComparisonTuitionCrntSt', label: '평균 등록금' },
          {
            operation: 'getComparisonScholarshipBenefitCrntSt',
            label: '장학금 수혜',
          },
          {
            operation: 'getComparisonEducationalExpensesReductionCrntSt',
            label: '학생 1인당 교육비 환원',
          },
          {
            operation: 'getComparisonEducationExpensesLoanCrntSt',
            label: '학자금 대출',
          },
          {
            operation: 'getComparisonEducationExpensesLoanUseStudentRatioTuition',
            label: '학자금대출 이용학생비율',
          },
        ],
      },
      {
        service: 'EducationConditionService',
        serviceLabel: '교육여건',
        category: '재정·교육여건',
        perSchool: true,
        operations: [
          {
            operation: 'getComparisonDormitoryAcceptanceCrntSt',
            label: '기숙사 수용률',
          },
          {
            operation: 'getComparisonLibraryBudgetCrntSt',
            label: '도서관 예산',
          },
          {
            operation: 'getComparisonSchoolGroundsAndBdsEnsureRate',
            label: '교지·교사 확보율',
          },
          {
            operation: 'getComparisonStudentForPersonDataPurchasePrice',
            label: '학생 1인당 자료구입비',
          },
          {
            operation: 'getComparisonBasicPropertiesForprofitCrntSt',
            label: '수익용기본재산',
          },
          {
            operation: 'getComparisonBasicPropertiesForProfitBurdenRate',
            label: '수익용기본재산 부담률',
          },
        ],
      },
      {
        service: 'EducationResearchService',
        serviceLabel: '교원·연구',
        category: '교육·교원',
        perSchool: true,
        operations: [
          {
            operation: 'getComparisonFullTimeFacultyEnsureCrntSt',
            label: '전임교원 확보',
          },
          {
            operation: 'getNoticeFullTimeFacultyEnsureRate',
            label: '전임교원 확보율',
          },
          {
            operation:
              'getComparisonFullTimeFacultyForPersonStudentNumberEnrolledStudent',
            label: '전임교원 1인당 학생수(재학생)',
          },
          {
            operation:
              'getComparisonFullTimeFacultyForPersonStudentNumberFixedNumber',
            label: '전임교원 1인당 학생수(정원)',
          },
          {
            operation: 'getComparisonLectureChargeRatio',
            label: '강의 담당 비율',
          },
          {
            operation: 'getComparisonGypsyScholarFacultyLectureChargeRatio',
            label: '비전임교원 강의 담당 비율',
          },
          {
            operation: 'getComparisonFullTimeFacultyResearchCrntSt',
            label: '전임교원 연구실적',
          },
          {
            operation: 'getNoticeFullTimeFacultyResearchCrntSt',
            label: '전임교원 연구실적(공시)',
          },
          {
            operation:
              'getComparisonFullTimeFacultyInsideOfSchoolForPersonResearchGrant',
            label: '전임교원 1인당 교내 연구비',
          },
          {
            operation:
              'getComparisonFullTimeFacultyOutsideOfSchoolForPersonResearchGrant',
            label: '전임교원 1인당 교외 연구비',
          },
          {
            operation: 'getComparisonFullTimeFacultyForPersonBookTranslatedBook',
            label: '전임교원 1인당 저·역서',
          },
          {
            operation: 'getComparisonForeignFullTimeFacultyCrntSt',
            label: '외국인 전임교원',
          },
        ],
      },
      {
        service: 'StudentService',
        serviceLabel: '학생',
        category: '학생·취창업',
        perSchool: true,
        operations: [
          {
            operation: 'getComparisonFreshmanEnsureCrntSt',
            label: '신입생 충원율',
            category: '모집',
          },
          {
            operation: 'getComparisonInsideFixedNumberFreshmanCompetitionRate',
            label: '신입생 경쟁률',
            category: '모집',
          },
          {
            operation: 'getComparisonFreshmanChanceBalanceSelectionRatio',
            label: '기회균형선발 비율',
            category: '모집',
          },
          {
            operation: 'getComparisonEntranceModelLastRegistrationRatio',
            label: '입학전형 최종등록률',
            category: '모집',
          },
          {
            operation: 'getComparisonDropOutStudentCrntSt',
            label: '중도탈락률',
          },
          {
            operation: 'getNoticeGraduateEmploymentRate',
            label: '졸업생 취업률',
          },
          {
            operation: 'getComparisonEnrolledStudentEnsureRate',
            label: '재학생 충원율',
          },
          {
            operation: 'getComparisonEnrolledStudent',
            label: '재학생 수',
          },
          {
            operation: 'getComparisonEnrolledStudentCrntSt',
            label: '재적생 수',
          },
          {
            operation: 'getComparisonStudentOnALeaveOfAbsence',
            label: '휴학생 현황',
          },
          {
            operation: 'getComparisonForeignStudentCrntSt',
            label: '외국인 학생',
          },
          {
            operation: 'getComparisonForeignDropOutCrntSt',
            label: '외국인 중도탈락',
          },
        ],
      },
      {
        service: 'IndustryAcademicCooperationService',
        serviceLabel: '산학협력',
        category: '학생·취창업',
        perSchool: true,
        operations: [
          {
            operation: 'getCntrctmjrInstOperCstt',
            label: '계약학과 설치·운영',
            mode: 'count',
          },
          {
            operation: 'getOrdmthEdcCrseInstOper',
            label: '주문식교육과정 설치·운영',
            mode: 'count',
          },
          {
            operation: 'getGrndsPrcOperCstt',
            label: '현장실습 운영',
            mode: 'count',
          },
          {
            operation: 'getCsptDsgnOperCstt',
            label: '캡스톤디자인 운영',
            mode: 'count',
          },
          {
            operation: 'getTcherStupSuptCstt',
            label: '교원 창업·창업지원',
            mode: 'count',
          },
          {
            operation: 'getStdnStupSuptCstt',
            label: '학생 창업·창업지원',
            mode: 'count',
          },
          {
            operation: 'getStupEdcSuptCstt',
            label: '창업교육 지원',
            mode: 'count',
          },
        ],
      },
    ];
  }

  // ---- HTTP ----

  private paramsSerializer = (params: Record<string, unknown>): string =>
    Object.entries(params)
      .map(([k, v]) =>
        k === 'serviceKey'
          ? `${k}=${v}`
          : `${k}=${encodeURIComponent(String(v))}`,
      )
      .join('&');

  private parseBody(raw: unknown): {
    items: Record<string, unknown>[];
    totalCount: number;
  } {
    let parsed: any = raw;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      parsed = trimmed.startsWith('<')
        ? this.xmlParser.parse(trimmed)
        : JSON.parse(trimmed || '{}');
    }
    const commonError = parsed?.OpenAPI_ServiceResponse?.cmmMsgHeader;
    if (commonError) {
      const code = String(commonError?.returnReasonCode ?? '').trim();
      const message = String(
        commonError?.returnAuthMsg ?? commonError?.errMsg ?? '',
      ).trim();
      throw new Error(
        `대학알리미 API 오류${code ? ` ${code}` : ''}${message ? `: ${message}` : ''}`,
      );
    }
    const response = parsed?.response ?? parsed;
    const header = response?.header ?? {};
    const resultCode = String(header?.resultCode ?? '').trim();
    const resultMsg = String(header?.resultMsg ?? '').trim();
    if (resultCode && resultCode !== '00' && resultCode !== '0') {
      throw new Error(
        `대학알리미 API 오류 ${resultCode}${resultMsg ? `: ${resultMsg}` : ''}`,
      );
    }

    const body = response?.body;
    if (!body || typeof body !== 'object') {
      throw new Error('대학알리미 API 응답 형식이 올바르지 않습니다.');
    }
    const rawItems = body?.items?.item ?? [];
    const items: Record<string, unknown>[] = Array.isArray(rawItems)
      ? rawItems
      : rawItems
        ? [rawItems]
        : [];
    const totalCount = parseInt(String(body?.totalCount ?? items.length), 10);
    return {
      items,
      totalCount: Number.isFinite(totalCount) ? totalCount : items.length,
    };
  }

  /** 429/5xx 시 지수 백오프 재시도 */
  private async getWithRetry(
    url: string,
    params: Record<string, unknown>,
    maxAttempts = 5,
  ): Promise<string> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await axios.get(url, {
          params,
          paramsSerializer: { serialize: this.paramsSerializer },
          timeout: 30000,
          transformResponse: [(d) => d],
        });
        return res.data as string;
      } catch (err) {
        lastErr = err;
        const status = (err as { response?: { status?: number } })?.response
          ?.status;
        const retryable = status === 429 || (status != null && status >= 500);
        if (!retryable || attempt === maxAttempts) throw err;
        const waitMs = Math.min(30_000, 1_500 * 2 ** (attempt - 1));
        this.logger.warn(
          `[ALIMI] HTTP ${status} → ${waitMs}ms 후 재시도 (${attempt}/${maxAttempts}) ${url}`,
        );
        await this.sleep(waitMs);
      }
    }
    throw lastErr;
  }

  async fetch(
    service: string,
    operation: string,
    extraParams: Record<string, unknown>,
  ): Promise<AlimiFetchResult> {
    const url = `${this.baseUrl}/${service}/${operation}`;
    const params = {
      serviceKey: this.serviceKey,
      pageNo: 1,
      numOfRows: 9999,
      ...extraParams,
    };
    const first = this.parseBody(await this.getWithRetry(url, params));
    const items = [...first.items];

    if (first.totalCount > items.length && items.length > 0) {
      const totalPages = Math.ceil(first.totalCount / 9999);
      for (let page = 2; page <= totalPages; page++) {
        const pageData = await this.getWithRetry(url, {
          ...params,
          pageNo: page,
        });
        items.push(...this.parseBody(pageData).items);
        await this.sleep(500);
      }
    }
    return {
      operation,
      year: Number(extraParams.svyYr) || this.currentYear,
      totalCount: first.totalCount,
      items,
    };
  }

  private pick(obj: Record<string, unknown>, keys: string[]): string {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && String(obj[k]) !== '') {
        return String(obj[k]);
      }
    }
    return '';
  }

  private unescapeXml(s: string): string {
    return s
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  /** 수치형 값 판별 (콤마 포함 숫자, 소수) */
  private parseNumericString(raw: unknown): string | null {
    if (raw === undefined || raw === null) return null;
    const s = String(raw).trim();
    if (s === '' || s.toUpperCase() === 'NULL' || s === 'X' || s === '-') {
      return null;
    }
    const cleaned = s.replace(/,/g, '');
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return cleaned;
  }

  private isYearLike(key: string, value: string, svyYr: number): boolean {
    if (key === 'svyYr' || key === 'indctYr') return true;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n)) return false;
    // 공시연도와 동일한 정수만 연도 메타필드로 간주 (재학생 수 2000 등 오인 방지)
    return Math.abs(n - svyYr) < 0.001;
  }

  private looksLikeDeptName(s: string): boolean {
    const v = this.unescapeXml(s).trim();
    if (!v || v === 'X' || v === '-' || v === '해당없음') return false;
    if (/^\d+(\.\d+)?$/.test(v)) return false;
    // 현장실습 기간·주야 구분 등 오인 방지: 학과명 형태만 허용
    return /과$|학과|전공$|학부$/.test(v);
  }

  /**
   * XML 노드에서 학과 식별.
   * 명시적 학과 태그 우선, 산학협력 목록의 학과명 슬롯 폴백.
   * 학과 정보가 없으면 null → 호출측에서 _ALL_ 사용.
   */
  private extractDept(
    item: Record<string, unknown>,
  ): { deptCode: string; deptName: string; seriesLg: string | null } | null {
    const deptCode = this.pick(item, this.DEPT_CODE_KEYS);
    const deptNameRaw = this.pick(item, this.DEPT_NAME_KEYS);
    let seriesLg = this.pick(item, this.SERIES_KEYS) || null;
    // 산학협력 목록: indctVal4 가 'OO계열' 형태일 때만 대계열로 사용
    // (공시 API의 indctVal4 는 학교 비율(%)이므로 계열로 쓰지 않음)
    if (!seriesLg) {
      const v4 = item['indctVal4'] != null ? String(item['indctVal4']) : '';
      if (/계열/.test(v4)) seriesLg = this.unescapeXml(v4);
    }

    if (deptCode || deptNameRaw) {
      const deptName = this.unescapeXml(deptNameRaw || deptCode);
      // 코드가 학과명과 동일(이름 폴백)이거나 숫자형 코드면 그대로 사용
      return {
        deptCode: deptCode || deptName,
        deptName,
        seriesLg: seriesLg ? this.unescapeXml(seriesLg) : null,
      };
    }

    // 산학협력 목록형 슬롯: 현장실습 indctVal3, 일부 목록 indctVal5/7
    for (const key of ['indctVal3', 'indctVal5', 'indctVal2', 'indctVal7']) {
      const raw = item[key] != null ? String(item[key]) : '';
      if (!this.looksLikeDeptName(raw)) continue;
      const name = this.unescapeXml(raw);
      return {
        deptCode: name,
        deptName: name,
        seriesLg: seriesLg ? this.unescapeXml(seriesLg) : null,
      };
    }

    return null;
  }

  /**
   * 트리(mjrId)와 통계 응답(학과명) 코드를 맞춘다.
   * 코드 일치 → 학과명 일치 → 부분 일치 순.
   */
  private resolveDeptCode(
    index: { byCode: Map<string, string>; byName: Map<string, string> },
    deptCode: string,
    deptName: string,
  ): string {
    if (deptCode && index.byCode.has(deptCode)) return deptCode;
    const name = (deptName || deptCode || '').trim();
    if (name && index.byName.has(name)) return index.byName.get(name)!;
    if (name) {
      for (const [dn, code] of index.byName) {
        if (dn.includes(name) || name.includes(dn)) return code;
      }
    }
    return deptCode || deptName;
  }

  private async loadDeptIndex(
    univCode: string,
  ): Promise<{ byCode: Map<string, string>; byName: Map<string, string> }> {
    const rows = await this.dataSource.getRepository(IrDepartment).find({
      where: { univCode },
    });
    const byCode = new Map<string, string>();
    const byName = new Map<string, string>();
    for (const r of rows) {
      byCode.set(r.deptCode, r.deptCode);
      if (r.deptName) byName.set(r.deptName.trim(), r.deptCode);
    }
    return { byCode, byName };
  }

  private isRateLabel(label: string): boolean {
    return /율|비율|률/.test(label);
  }

  /**
   * 항목당 대표 수치 1개만 추출.
   * - 공시(Notice)형: indctVal1~3=인원, indctVal4=학교 비율(%), indctAvg=비교평균
   *   → 학교 대표값은 indctVal4
   * - 대학비교형: indctVal1 이 대표값
   * - 목록 상세( indctVal 다수, 비율 슬롯 없음 ): null (count 모드에서 건수로 처리)
   */
  private extractRepresentativeMetric(
    item: Record<string, unknown>,
    op: StatsOperation,
    svyYr: number,
  ): { metricName: string; value: string; unit: string | null } | null {
    const named = this.pick(item, [
      'indctNm',
      'indctName',
      'metricNm',
      'itemNm',
      'indctKrnNm',
    ]);

    const byKey = new Map<string, string>();
    for (const key of Object.keys(item)) {
      if (this.META_KEYS.has(key)) continue;
      if (this.DEPT_CODE_KEYS.includes(key)) continue;
      if (this.DEPT_NAME_KEYS.includes(key)) continue;
      if (this.SERIES_KEYS.includes(key)) continue;
      if (/^fieldType\d+$/i.test(key) || /^fieldVal\d+$/i.test(key)) continue;
      const raw = item[key];
      if (raw !== null && typeof raw === 'object') continue;
      const value = this.parseNumericString(raw);
      if (value === null) continue;
      if (this.isYearLike(key, value, svyYr)) continue;
      byKey.set(key, value);
    }
    if (byKey.size === 0) return null;

    const metricName = named || op.label;
    const indctKeys = [...byKey.keys()].filter((k) => /^indctVal\d+$/i.test(k));
    const hasAvg = byKey.has('indctAvg');
    const hasVal4 = byKey.has('indctVal4');
    const rateOp = this.isRateLabel(op.label) || this.isRateLabel(metricName);

    // 공시형: 학교 실측 대표값은 indctVal4 (인원 필드 indctVal1~3 제외)
    if (hasVal4 && (hasAvg || rateOp)) {
      const value = byKey.get('indctVal4')!;
      return {
        metricName,
        value,
        unit: rateOp ? '%' : this.guessUnit(metricName, value),
      };
    }

    // 목록 상세행(부가 수치 다수) — 대표 단일지표로 쓰지 않음
    if (indctKeys.length >= 3 && !hasVal4) {
      return null;
    }

    if (byKey.has('indctVal1')) {
      const value = byKey.get('indctVal1')!;
      const unit = rateOp ? '%' : this.guessUnit(metricName, value);
      return { metricName, value, unit };
    }

    if (byKey.size === 1) {
      const [[, value]] = [...byKey.entries()];
      return {
        metricName,
        value,
        unit: rateOp ? '%' : this.guessUnit(metricName, value),
      };
    }

    return null;
  }

  // ---- 대학 마스터 동기화 ----

  async syncUniversities(
    year: number,
    prefetched?: AlimiFetchResult,
  ): Promise<IrUniversityMaster[]> {
    const result =
      prefetched ??
      (await this.fetch(this.univService, this.univOperation, {
        svyYr: year,
      }));
    const seen = new Map<string, NormalizedUniversity>();
    for (const item of result.items) {
      const univCode = this.pick(item, ['schlId', 'univCode']);
      const univName = this.pick(item, ['schlKrnNm', 'schlFullNm', 'univNm']);
      if (!univCode || !univName) continue;
      if (!seen.has(univCode)) {
        seen.set(univCode, {
          univCode,
          univName,
          schoolTypeRaw: this.pick(item, ['schlKndNm', 'schlKnd']) || null,
          regionCity: this.pick(item, ['znNm', 'zoneNm', 'region']) || null,
        });
      }
    }

    const repo = this.dataSource.getRepository(IrUniversityMaster);
    const saved: IrUniversityMaster[] = [];
    for (const u of seen.values()) {
      const regionCity = u.regionCity;
      await repo
        .createQueryBuilder()
        .insert()
        .into(IrUniversityMaster)
        .values({
          univCode: u.univCode,
          univName: u.univName,
          schoolType: classifySchoolType(u.schoolTypeRaw),
          regionType: classifyRegionType(regionCity),
          regionCity,
        })
        .orUpdate(
          ['univ_name', 'school_type', 'region_type', 'region_city'],
          ['univ_code'],
        )
        .execute();
      saved.push({
        univCode: u.univCode,
        univName: u.univName,
        schoolType: classifySchoolType(u.schoolTypeRaw),
        regionType: classifyRegionType(regionCity),
        regionCity,
      } as IrUniversityMaster);
    }
    this.logger.log(`[ALIMI] ${year} 대학 마스터 ${saved.length}건 동기화`);
    return saved;
  }

  // ---- 학과정보 동기화 (BasicInformationService_1/getUniversityMajorCode) ----

  /**
   * [치명적] MajorStatus / schlMjrStatNm 이 폐과·폐지 등이면 비활성.
   * '통합'은 유지(동일 mjrId에 주야·통합/폐과 행이 섞여도 활성 우선 병합).
   * 활성만 DB 적재·트리에 사용.
   */
  private isDeptActive(item: Record<string, unknown>): boolean {
    const statusCd = this.pick(item, [
      'schlMjrStatCd',
      'MajorStatusCd',
      'mjrStatCd',
    ]);
    // 대학알리미 학과상태코드: 2=폐과 등 (1=신설, 3=기존, 4=변경 등은 활성)
    if (statusCd && /^[2]$/.test(statusCd.trim())) return false;

    const status = this.pick(item, [
      'MajorStatus',
      'majorStatus',
      'schlMjrStatNm',
      'mjrStatNm',
      'operStat',
      'operYn',
      'useYn',
      'deptStat',
      'statNm',
      'oprnSttus',
      'closeYn',
    ]);
    if (!status) return true;
    // '통합'은 제외하지 않음. 폐과·폐지 등만 비활성.
    const closedKeywords = [
      '폐과',
      '폐지',
      '통폐합',
      '미운영',
      '중지',
      '폐쇄',
    ];
    if (closedKeywords.some((k) => status.includes(k))) return false;
    // 코드형: N / 2(폐과) 등 — 명칭에 폐과가 없고 '기존'·'운영'이면 활성
    if (/^[Nn]$/.test(status.trim())) return false;
    return true;
  }

  /**
   * 학과 upsert. series_lg 가 null 이면 기존 값을 유지한다
   * (통계 API 적재가 공시 대계열을 지우지 않도록).
   */
  private async upsertDepartment(
    univCode: string,
    deptCode: string,
    deptName: string,
    seriesLg: string | null,
    isActive = true,
  ): Promise<void> {
    const normalized = normalizeSeriesLg(seriesLg);
    await this.dataSource.query(
      `INSERT INTO ir_department (univ_code, dept_code, dept_name, series_lg, is_active)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (univ_code, dept_code) DO UPDATE SET
         dept_name = EXCLUDED.dept_name,
         series_lg = COALESCE(EXCLUDED.series_lg, ir_department.series_lg),
         is_active = EXCLUDED.is_active`,
      [univCode, deptCode, deptName, normalized, isActive],
    );
  }

  /** getCodeByLargeSeries → 대계열 코드(cdid) → 명칭(cdnm) */
  async fetchLargeSeriesMap(year: number): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!this.seriesService || !this.seriesOperation) return map;
    try {
      const result = await this.fetch(this.seriesService, this.seriesOperation, {
        svyYr: year,
      });
      for (const item of result.items) {
        const id = this.pick(item, ['cdid', 'srsLclftCd', 'LargeSeries', 'lclsCd']);
        const nm = this.pick(item, [
          'cdnm',
          'korSrsLclftNm',
          'LargeSeriesNm',
          'lclsNm',
        ]);
        if (id && nm) map.set(id, this.unescapeXml(nm));
      }
      this.logger.log(
        `[ALIMI] ${year} 대계열 코드 ${map.size}건 (${this.seriesOperation})`,
      );
    } catch (err) {
      this.logger.warn(
        `[ALIMI] 대계열 코드 동기화 실패: ${(err as Error).message}`,
      );
    }
    return map;
  }

  /**
   * 대학별 학과정보 동기화.
   * - getUniversityMajorCode 는 schlId 필수 → 대학 마스터 전수 호출
   * - LargeSeries(korSrsLclftNm / srsLclftCd) 상위, Major(korMjrNm/mjrId) 하위
   * - 폐과(schlMjrStatNm 등)는 적재하지 않고 is_active=false 처리
   */
  async syncDepartments(
    year: number,
    onlyUnivCodes?: string[],
    hooks?: {
      onProgress?: (processed: number, total: number) => void;
      onFailure?: (message: string) => void;
    },
  ): Promise<number> {
    if (!this.deptService || !this.deptOperation) {
      this.logger.warn(
        '[ALIMI] 학과정보 API 미설정(ALIMI_DEPT_SERVICE/OPERATION). 학과 동기화 스킵.',
      );
      return 0;
    }

    const seriesMap = await this.fetchLargeSeriesMap(year);
    await this.sleep(Number(process.env.ALIMI_CALL_DELAY_MS || 800));

    const univRepo = this.dataSource.getRepository(IrUniversityMaster);
    let univs = await univRepo.find();
    if (onlyUnivCodes && onlyUnivCodes.length > 0) {
      const allow = new Set(onlyUnivCodes);
      univs = univs.filter((u) => allow.has(u.univCode));
    }
    if (univs.length === 0) {
      this.logger.warn(`[ALIMI] ${year} 학과 동기화: 대학 마스터 없음`);
      return 0;
    }

    const delay = Number(process.env.ALIMI_CALL_DELAY_MS || 800);
    const concurrency = Math.max(
      1,
      Number(process.env.ALIMI_DEPT_CONCURRENCY || 2),
    );
    let activeCount = 0;
    let closedCount = 0;
    const categoryCache = new Map<string, number>();
    const metricCache = new Map<string, number>();
    const metricLocks = new Map<string, Promise<number>>();

    const getMajorMetricId = async (
      category: CoreCategory,
      metricName: string,
      unit: string,
    ): Promise<number> => {
      const cacheKey = `${category}::${metricName}`;
      if (metricCache.has(cacheKey)) return metricCache.get(cacheKey)!;
      if (!metricLocks.has(cacheKey)) {
        metricLocks.set(
          cacheKey,
          (async () => {
            if (!categoryCache.has(category)) {
              categoryCache.set(category, await this.ensureCategory(category));
            }
            const id = await this.ensureMetric(
              categoryCache.get(category)!,
              metricName,
              unit,
              { isDeptLevel: true },
            );
            metricCache.set(cacheKey, id);
            return id;
          })(),
        );
      }
      return metricLocks.get(cacheKey)!;
    };

    const syncOne = async (
      univ: IrUniversityMaster,
    ): Promise<{ active: number; closed: number }> => {
      let localActive = 0;
      let localClosed = 0;
      try {
        const result = await this.fetch(this.deptService, this.deptOperation, {
          svyYr: year,
          schlId: univ.univCode,
        });

        // 동일 mjrId 가 주간/야간·기존/폐과로 중복될 수 있음 → 활성 우선 병합
        type MergedDept = {
          univCode: string;
          deptCode: string;
          deptName: string;
          seriesLg: string | null;
          active: boolean;
          items: Record<string, unknown>[];
        };
        const byCode = new Map<string, MergedDept>();

        for (const item of result.items) {
          const univCode =
            this.pick(item, ['schlId', 'univCode']) || univ.univCode;
          const deptNameRaw = this.pick(item, [
            'korMjrNm',
            'MajorNm',
            'majorNm',
            'deptNm',
            'facmjNm',
            'subjNm',
          ]);
          const deptCode =
            this.pick(item, [
              'mjrId',
              'schlMjrId',
              'Majorcode',
              'MajorCode',
              'majorCd',
              'deptCd',
              'facmjCd',
            ]) || deptNameRaw;
          if (!univCode || !deptNameRaw || !deptCode) continue;

          const deptName = this.unescapeXml(deptNameRaw);
          const seriesCd = this.pick(item, [
            'srsLclftCd',
            'onsfSrsClftCd',
            'LargeSeries',
            'cdid',
          ]);
          const seriesLgRaw =
            this.pick(item, [
              'korSrsLclftNm',
              'onsfSrsClftNm',
              'LargeSeriesNm',
              'lclsNm',
              'seriesLgNm',
              'lSeriesNm',
            ]) ||
            (seriesCd ? seriesMap.get(seriesCd) || '' : '');
          const seriesLg = seriesLgRaw
            ? this.unescapeXml(seriesLgRaw)
            : null;

          // 자리표시 학과·폐과는 비활성
          const active =
            !isPlaceholderDepartment(deptName) && this.isDeptActive(item);
          const prev = byCode.get(deptCode);
          if (!prev) {
            byCode.set(deptCode, {
              univCode,
              deptCode,
              deptName,
              seriesLg,
              active,
              items: [item],
            });
            continue;
          }
          prev.items.push(item);
          if (seriesLg && !prev.seriesLg) prev.seriesLg = seriesLg;
          if (active && !prev.active) {
            prev.active = true;
            prev.deptName = deptName;
            if (seriesLg) prev.seriesLg = seriesLg;
          }
        }

        const activeCodes = new Set<string>();
        for (const d of byCode.values()) {
          if (!d.active) {
            await this.upsertDepartment(
              d.univCode,
              d.deptCode,
              d.deptName,
              d.seriesLg,
              false,
            );
            localClosed++;
            continue;
          }

          await this.upsertDepartment(
            d.univCode,
            d.deptCode,
            d.deptName,
            d.seriesLg,
            true,
          );
          activeCodes.add(d.deptCode);
          localActive++;

          // 학과정보 API 수치 — 활성 레코드 중 마지막 유효값(동일 mjrId 주야 중복 시)
          for (const spec of this.MAJOR_NUMERIC_METRICS) {
            let value: string | null = null;
            for (const item of d.items) {
              if (!this.isDeptActive(item)) continue;
              const parsed = this.parseNumericString(item[spec.key]);
              if (parsed !== null) value = parsed;
            }
            if (value === null) continue;
            const metricId = await getMajorMetricId(
              spec.category,
              spec.metricName,
              spec.unit,
            );
            await this.upsertRaw(year, d.univCode, d.deptCode, metricId, value);
          }
        }

        if (activeCodes.size > 0) {
          await this.dataSource
            .createQueryBuilder()
            .update(IrDepartment)
            .set({ isActive: false })
            .where('univ_code = :univCode', { univCode: univ.univCode })
            .andWhere('dept_code NOT IN (:...codes)', {
              codes: Array.from(activeCodes),
            })
            .execute();
        }
      } catch (err) {
        const message = (err as Error).message;
        this.logger.warn(
          `[ALIMI] 학과 (${year}, ${univ.univCode}) 실패: ${message}`,
        );
        hooks?.onFailure?.(message);
      }
      return { active: localActive, closed: localClosed };
    };

    this.logger.log(
      `[ALIMI] ${year} 학과 동기화 시작 (${univs.length}개 대학, concurrency=${concurrency})`,
    );

    for (let i = 0; i < univs.length; i += concurrency) {
      const chunk = univs.slice(i, i + concurrency);
      const results = await Promise.all(chunk.map(syncOne));
      for (const r of results) {
        activeCount += r.active;
        closedCount += r.closed;
      }
      hooks?.onProgress?.(
        Math.min(i + concurrency, univs.length),
        univs.length,
      );
      if (i + concurrency < univs.length) await this.sleep(delay);
      if ((i + concurrency) % 40 < concurrency) {
        this.logger.log(
          `[ALIMI] ${year} 학과 진행 ${Math.min(i + concurrency, univs.length)}/${univs.length} (활성 누적 ${activeCount})`,
        );
      }
    }

    this.logger.log(
      `[ALIMI] ${year} 학과 ${activeCount}건 활성 동기화 (폐과/제외 처리 ${closedCount}건)`,
    );
    // 학과정보 API 수치(편제정원·졸업자 수 등)는 학과단위 → 지표명 (학과별)
    const labeled = await syncDeptLevelMetricNames(this.dataSource);
    if (labeled > 0) {
      this.logger.log(`[ALIMI] 학과별 지표명 라벨 ${labeled}건 반영`);
    }
    return activeCount;
  }

  // ---- 통계 지표 적재 ----

  private async ensureCategory(name: string): Promise<number> {
    const repo = this.dataSource.getRepository(IrMetricCategory);
    let cat = await repo.findOne({ where: { categoryName: name } });
    if (!cat) cat = await repo.save(repo.create({ categoryName: name }));
    return cat.categoryId;
  }

  /**
   * 지표 레지스트리 find-or-create.
   * 동일 기본명의 (학과별)/(학과) 표기를 하나로 취급하고,
   * isDeptLevel이면 metric_name에 (학과별)을 보장한다.
   */
  private async ensureMetric(
    categoryId: number,
    metricName: string,
    unit: string | null,
    opts?: { isDeptLevel?: boolean },
  ): Promise<number> {
    const repo = this.dataSource.getRepository(IrMetricRegistry);
    const candidates = metricNameLookupCandidates(metricName);
    let metric = await repo.findOne({
      where: candidates.map((name) => ({ categoryId, metricName: name })),
    });

    const nameToStore = opts?.isDeptLevel
      ? withDeptLevelMetricSuffix(metricName)
      : metricName;

    if (!metric) {
      metric = await repo.save(
        repo.create({
          categoryId,
          sourceType: 'ALIMI',
          metricName: nameToStore,
          metricUnit: unit,
          aggregationType: 'AVG',
        }),
      );
    } else if (
      opts?.isDeptLevel &&
      !hasDeptLevelMetricSuffix(metric.metricName)
    ) {
      await repo.update(metric.metricId, {
        metricName: withDeptLevelMetricSuffix(metric.metricName),
      });
      metric.metricName = withDeptLevelMetricSuffix(metric.metricName);
    }
    return metric.metricId;
  }

  private async upsertRaw(
    year: number,
    univCode: string,
    deptCode: string,
    metricId: number,
    value: string,
  ): Promise<void> {
    await this.dataSource
      .createQueryBuilder()
      .insert()
      .into(IrRawData)
      .values({
        year,
        univCode,
        deptCode: deptCode || '_ALL_',
        metricId,
        metricValue: value,
      })
      .orUpdate(
        ['metric_value'],
        ['year', 'univ_code', 'dept_code', 'metric_id'],
      )
      .execute();
  }

  private guessUnit(metricName: string, value: string): string | null {
    if (/율|비율|률/.test(metricName)) return '%';
    if (/등록금|장학금|연구비|예산|구입비|대출/.test(metricName)) return '원';
    if (/학생수|재학생|재적|휴학|교원/.test(metricName) && !/\./.test(value)) {
      return '명';
    }
    if (/건수|운영/.test(metricName)) return '건';
    return null;
  }

  /**
   * 특정 연도의 통계 지표를 지정된 대학 목록에 대해 수집/Upsert.
   * 응답 XML의 모든 수치형 태그를 동적 등록한다.
   * @param opts.onlyServiceLabels 지정 시 해당 serviceLabel 그룹만 수집 (이어하기용)
   */
  async ingestStats(
    year: number,
    univCodes: string[],
    opts?: {
      onlyServiceLabels?: string[];
      onProgress?: (processed: number, total: number) => void;
      onFailure?: (message: string) => void;
    },
  ): Promise<number> {
    let upserted = 0;
    const delay = Number(process.env.ALIMI_CALL_DELAY_MS || 250);
    const concurrency = Math.max(
      1,
      Number(process.env.ALIMI_STATS_CONCURRENCY || 4),
    );
    const labelFilter = (opts?.onlyServiceLabels ?? [])
      .map((s) => s.trim())
      .filter(Boolean);
    const operationFilter = (process.env.ALIMI_OP_FILTER || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const selectedOperationCount = this.statsGroups
      .filter(
        (group) =>
          labelFilter.length === 0 || labelFilter.includes(group.serviceLabel),
      )
      .reduce(
        (sum, group) =>
          sum +
          group.operations.filter(
            (op) =>
              operationFilter.length === 0 ||
              operationFilter.includes(op.operation),
          ).length,
        0,
      );
    const totalRequests = selectedOperationCount * univCodes.length;
    let processedRequests = 0;
    opts?.onProgress?.(0, totalRequests);
    const categoryCache = new Map<string, number>();
    const metricCache = new Map<string, number>();
    const metricLocks = new Map<string, Promise<number>>();

    const getCategoryId = async (name: CoreCategory): Promise<number> => {
      if (!categoryCache.has(name)) {
        categoryCache.set(name, await this.ensureCategory(name));
      }
      return categoryCache.get(name)!;
    };

    const getMetricId = async (
      category: CoreCategory,
      metricName: string,
      unit: string | null,
      isDeptLevel = false,
    ): Promise<number> => {
      const cacheKey = `${category}::${metricName}`;
      if (metricCache.has(cacheKey)) return metricCache.get(cacheKey)!;
      // 병렬 적재 시 find-or-create 레이스 방지
      // (학과별) 접미사는 ingest 종료 시 syncDeptLevelMetricNames로 일괄 보장
      if (!metricLocks.has(cacheKey)) {
        metricLocks.set(
          cacheKey,
          (async () => {
            const categoryId = await getCategoryId(category);
            const id = await this.ensureMetric(categoryId, metricName, unit, {
              isDeptLevel,
            });
            metricCache.set(cacheKey, id);
            return id;
          })(),
        );
      }
      return metricLocks.get(cacheKey)!;
    };

    const deptIndexCache = new Map<
      string,
      { byCode: Map<string, string>; byName: Map<string, string> }
    >();
    const getDeptIndex = async (univCode: string) => {
      if (!deptIndexCache.has(univCode)) {
        deptIndexCache.set(univCode, await this.loadDeptIndex(univCode));
      }
      return deptIndexCache.get(univCode)!;
    };

    const ingestOne = async (
      group: StatsApiGroup,
      op: StatsOperation,
      code: string,
    ): Promise<number> => {
      const category = (op.category || group.category) as CoreCategory;
      let local = 0;
      try {
        const result = await this.fetch(group.service, op.operation, {
          svyYr: year,
          schlId: code,
        });

        const mode = op.mode || 'representative';
        const deptCounts = new Map<string, number>();

        for (const item of result.items) {
          const schlId = this.pick(item, ['schlId', 'univCode']) || code;
          const deptInfo = this.extractDept(item);
          let resolvedDept: string | null = null;

          if (deptInfo) {
            const index = await getDeptIndex(schlId);
            const resolved = this.resolveDeptCode(
              index,
              deptInfo.deptCode,
              deptInfo.deptName,
            );
            // 통계 응답으로 학과를 신규 생성하지 않음(이름코드·기타 계열 오염 방지).
            // 공시 학과정보(syncDepartments)에 있는 코드만 매핑한다.
            if (
              index.byCode.has(resolved) &&
              !isPlaceholderDepartment(deptInfo.deptName)
            ) {
              resolvedDept = resolved;
              if (deptInfo.seriesLg) {
                await this.upsertDepartment(
                  schlId,
                  resolvedDept,
                  deptInfo.deptName,
                  deptInfo.seriesLg,
                );
              }
            }
          }

          if (mode === 'count') {
            if (resolvedDept) {
              deptCounts.set(
                resolvedDept,
                (deptCounts.get(resolvedDept) || 0) + 1,
              );
            }
            continue;
          }

          const m = this.extractRepresentativeMetric(item, op, year);
          if (!m) continue;
          // 학과 태그가 있으면 학과 단위, 없으면 대학 단위(_ALL_)
          const deptCode = resolvedDept || '_ALL_';
          const metricId = await getMetricId(
            category,
            m.metricName,
            m.unit,
            !!resolvedDept,
          );
          await this.upsertRaw(year, schlId, deptCode, metricId, m.value);
          local++;
        }

        if (mode === 'count' && result.items.length > 0) {
          const metricId = await getMetricId(
            category,
            op.label,
            '건',
            deptCounts.size > 0,
          );
          await this.upsertRaw(
            year,
            code,
            '_ALL_',
            metricId,
            String(result.totalCount || result.items.length),
          );
          local++;
          for (const [deptCode, cnt] of deptCounts) {
            await this.upsertRaw(
              year,
              code,
              deptCode,
              metricId,
              String(cnt),
            );
            local++;
          }
        }
      } catch (err) {
        const message = (err as Error).message;
        this.logger.warn(
          `[ALIMI] ${group.service}/${op.operation} (${year}, ${code}) 실패: ${message}`,
        );
        opts?.onFailure?.(message);
      } finally {
        processedRequests += 1;
        opts?.onProgress?.(processedRequests, totalRequests);
      }
      return local;
    };

    /** 대학 목록을 concurrency 단위로 병렬 호출 */
    const mapPool = async <T, R>(
      items: T[],
      limit: number,
      fn: (item: T) => Promise<R>,
    ): Promise<R[]> => {
      const results: R[] = [];
      for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        const chunkResults = await Promise.all(chunk.map(fn));
        results.push(...chunkResults);
        if (i + limit < items.length) await this.sleep(delay);
      }
      return results;
    };

    for (const group of this.statsGroups) {
      if (
        labelFilter.length > 0 &&
        !labelFilter.includes(group.serviceLabel)
      ) {
        this.logger.log(
          `[ALIMI] ${year} ${group.serviceLabel} 스킵 (이어하기 필터)`,
        );
        continue;
      }
      this.logger.log(
        `[ALIMI] ${year} ${group.serviceLabel} (${group.operations.length} ops × ${univCodes.length} univ, concurrency=${concurrency})`,
      );
      for (const op of group.operations) {
        if (
          operationFilter.length > 0 &&
          !operationFilter.includes(op.operation)
        ) {
          continue;
        }

        const counts = await mapPool(univCodes, concurrency, (code) =>
          ingestOne(group, op, code),
        );
        upserted += counts.reduce((a, b) => a + b, 0);
        await this.sleep(delay);
      }
    }

    // 학과단위 raw가 있는 지표는 지표명 뒤에 (학과별) 고정
    const labeled = await syncDeptLevelMetricNames(this.dataSource);
    if (labeled > 0) {
      this.logger.log(`[ALIMI] 학과별 지표명 라벨 ${labeled}건 반영`);
    }
    return upserted;
  }

  async listBatches(limit = 50) {
    const take = Math.min(Math.max(limit, 1), 200);
    return this.dataSource.getRepository(IrUpdateLog).find({
      where: { updateType: 'ALIMI_BATCH' },
      order: { updateDate: 'DESC', logId: 'DESC' },
      take,
    });
  }

  getBatchStatus(): AlimiBatchStatus {
    return {
      ...this.batchStatus,
      schedule: { ...this.batchStatus.schedule },
    };
  }

  private updateBatchStatus(
    patch: Partial<Omit<AlimiBatchStatus, 'schedule'>>,
  ): void {
    this.batchStatus = {
      ...this.batchStatus,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  }

  private async saveBatchLog(logText: string): Promise<void> {
    try {
      await this.dataSource.getRepository(IrUpdateLog).save({
        updateType: 'ALIMI_BATCH',
        logText,
      });
    } catch (err) {
      this.logger.error(
        `[ALIMI] 배치 이력 저장 실패: ${(err as Error).message}`,
      );
    }
  }

  private async acquireBatchLock(): Promise<QueryRunner> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const rows = (await runner.query(
        'SELECT pg_try_advisory_lock($1) AS locked',
        [this.batchLockKey],
      )) as Array<{ locked: boolean }>;
      if (!rows[0]?.locked) {
        throw new ConflictException('대학알리미 배치가 이미 실행 중입니다.');
      }
      return runner;
    } catch (err) {
      await runner.release();
      throw err;
    }
  }

  private async releaseBatchLock(runner: QueryRunner): Promise<void> {
    try {
      await runner.query('SELECT pg_advisory_unlock($1)', [
        this.batchLockKey,
      ]);
    } finally {
      await runner.release();
    }
  }

  async startBatch(
    startedBy?: string,
    trigger: 'manual' | 'scheduled' = 'manual',
  ): Promise<AlimiBatchStatus> {
    if (this.activeBatch) {
      throw new ConflictException('대학알리미 배치가 이미 실행 중입니다.');
    }

    const runner = await this.acquireBatchLock();
    const now = new Date().toISOString();
    this.batchStatus = {
      ...this.batchStatus,
      state: 'running',
      phase: 'checking',
      runId: randomUUID(),
      trigger,
      startedBy: startedBy ?? null,
      requestedYear: this.currentYear,
      year: null,
      message: '대학알리미 최신 공개연도를 확인하고 있습니다.',
      processed: 0,
      total: 0,
      upserted: 0,
      departments: 0,
      warnings: 0,
      startedAt: now,
      updatedAt: now,
      finishedAt: null,
    };

    const task = this.executeLatestAvailableBatch(startedBy, trigger).finally(
      async () => {
        try {
          await this.releaseBatchLock(runner);
        } catch (err) {
          this.logger.error(
            `[ALIMI] 배치 잠금 해제 실패: ${(err as Error).message}`,
          );
        } finally {
          this.activeBatch = null;
        }
      },
    );
    this.activeBatch = task;
    void task;

    return this.getBatchStatus();
  }

  private async executeLatestAvailableBatch(
    startedBy?: string,
    trigger: 'manual' | 'scheduled' = 'manual',
  ): Promise<void> {
    const requestedYear = this.currentYear;
    const who = startedBy
      ? ` · 실행 ${startedBy}`
      : trigger === 'scheduled'
        ? ' · 자동 실행'
        : '';
    let selectedYear: number | null = null;

    try {
      const rawLookback = Number(process.env.ALIMI_YEAR_LOOKBACK || 3);
      const lookback = Number.isFinite(rawLookback)
        ? Math.min(Math.max(Math.floor(rawLookback), 0), 10)
        : 3;
      let universityResult: AlimiFetchResult | null = null;

      for (let offset = 0; offset <= lookback; offset++) {
        const candidateYear = requestedYear - offset;
        this.updateBatchStatus({
          phase: 'checking',
          message: `${candidateYear}년 대학알리미 공개 여부를 확인하고 있습니다.`,
          processed: offset,
          total: lookback + 1,
        });
        const result = await this.fetch(
          this.univService,
          this.univOperation,
          { svyYr: candidateYear },
        );
        if (result.totalCount > 0 && result.items.length > 0) {
          selectedYear = candidateYear;
          universityResult = result;
          break;
        }
      }

      if (!selectedYear || !universityResult) {
        const message = `${requestedYear}년부터 ${requestedYear - lookback}년까지 공개된 대학알리미 데이터가 없습니다.`;
        this.updateBatchStatus({
          state: 'no_data',
          phase: 'done',
          message,
          processed: lookback + 1,
          total: lookback + 1,
          finishedAt: new Date().toISOString(),
        });
        await this.saveBatchLog(`대학알리미 정기 배치 미실행: ${message}${who}`);
        return;
      }

      const fallbackText =
        selectedYear === requestedYear
          ? `${selectedYear}년`
          : `요청 ${requestedYear}년 → 최신 공개 ${selectedYear}년`;
      this.updateBatchStatus({
        phase: 'universities',
        year: selectedYear,
        message: `${fallbackText} 대학 목록을 반영하고 있습니다.`,
        processed: 0,
        total: universityResult.totalCount,
      });
      const univs = await this.syncUniversities(
        selectedYear,
        universityResult,
      );
      if (univs.length === 0) {
        throw new Error(
          `${selectedYear}년 대학 목록 응답을 데이터로 변환하지 못했습니다.`,
        );
      }
      this.updateBatchStatus({
        processed: univs.length,
        total: univs.length,
      });

      await this.sleep(1500);
      let warnings = 0;
      const allUniversityCodes = univs.map((univ) => univ.univCode);
      this.updateBatchStatus({
        phase: 'departments',
        message: `${selectedYear}년 학과 정보를 동기화하고 있습니다.`,
        processed: 0,
        total: allUniversityCodes.length,
      });
      const departments = await this.syncDepartments(
        selectedYear,
        allUniversityCodes,
        {
          onProgress: (processed, total) =>
            this.updateBatchStatus({ processed, total }),
          onFailure: () => {
            warnings += 1;
            this.updateBatchStatus({ warnings });
          },
        },
      );

      await this.sleep(1500);
      const limit = this.parseUnivLimit(process.env.ALIMI_STATS_UNIV_LIMIT);
      const ysu = process.env.YSU_UNIV_CODE || '';
      const codes = this.selectUnivCodes(univs, ysu, limit);
      let statsFailures = 0;
      this.updateBatchStatus({
        phase: 'statistics',
        message: `${selectedYear}년 통계 지표를 동기화하고 있습니다.`,
        processed: 0,
        total: 0,
        departments,
      });
      const upserted = await this.ingestStats(selectedYear, codes, {
        onProgress: (processed, total) =>
          this.updateBatchStatus({ processed, total }),
        onFailure: () => {
          warnings += 1;
          statsFailures += 1;
          this.updateBatchStatus({ warnings });
        },
      });

      if (this.batchStatus.total > 0 && statsFailures >= this.batchStatus.total) {
        throw new Error('모든 대학알리미 통계 API 호출이 실패했습니다.');
      }

      this.updateBatchStatus({
        phase: 'finalizing',
        message: '지표명과 배치 이력을 정리하고 있습니다.',
        upserted,
        departments,
      });
      await syncDeptLevelMetricNames(this.dataSource);

      const state = warnings > 0 ? 'completed_with_warnings' : 'completed';
      const message = `${fallbackText}, 지표 ${upserted}건·학과 ${departments}건 반영${warnings > 0 ? `, 경고 ${warnings}건` : ''}`;
      this.updateBatchStatus({
        state,
        phase: 'done',
        message,
        upserted,
        departments,
        warnings,
        finishedAt: new Date().toISOString(),
      });
      await this.saveBatchLog(
        `대학알리미 정기 배치 ${warnings > 0 ? '부분 완료' : '완료'} (${message})${who}`,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.updateBatchStatus({
        state: 'failed',
        phase: 'done',
        year: selectedYear,
        message,
        finishedAt: new Date().toISOString(),
      });
      await this.saveBatchLog(
        `대학알리미 정기 배치 실패 (${selectedYear ?? requestedYear}년)${who}: ${message}`,
      );
      this.logger.error(`[ALIMI] 정기 배치 실패: ${message}`);
    }
  }

  async runCurrentYearBatch(
    startedBy?: string,
  ): Promise<{ year: number; upserted: number }> {
    await this.startBatch(startedBy, 'manual');
    const task = this.activeBatch;
    if (task) await task;
    const status = this.getBatchStatus();
    if (status.state === 'failed' || status.state === 'no_data') {
      throw new Error(status.message);
    }
    return {
      year: status.year ?? this.currentYear,
      upserted: status.upserted,
    };
  }

  /** 미설정·0 이하면 무제한(전체 대학). */
  parseUnivLimit(raw?: string | null): number {
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return 0;
    }
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  selectUnivCodes(
    univs: IrUniversityMaster[],
    ysuCode: string,
    limit: number,
  ): string[] {
    const codes = univs.map((u) => u.univCode);
    const set = new Set<string>();
    if (ysuCode && codes.includes(ysuCode)) set.add(ysuCode);
    for (const c of codes) {
      if (limit > 0 && set.size >= limit) break;
      set.add(c);
    }
    return Array.from(set);
  }
}
