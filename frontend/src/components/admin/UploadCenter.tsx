'use client';

import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  School,
  Search,
  Upload,
} from 'lucide-react';
import * as XLSX from 'xlsx';
import {
  api,
  type MetricCodebook,
  type MetricCodebookEntry,
  type UniversityCodebook,
} from '@/lib/api';
import { logDataExport } from '@/lib/exportLog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

type UploadResult =
  | {
      status: 'SUCCESS';
      inserted: number;
      updated: number;
      skipped: number;
      metricsCreated?: number;
      rowSummary: string;
    }
  | { status: 'NEED_CONFIRM_LOCKED'; message: string; lockedYears: number[] };

type CodebookTab =
  | 'ysu'
  | 'univ'
  | 'dept'
  | 'metric-internal'
  | 'metric-monitoring';
type TemplateKind =
  | 'internal-competitiveness'
  | 'monitoring-general'
  | 'monitoring-accounting'
  | 'monitoring-all';
type UploadMode = 'internal' | 'monitoring';

const FRIENDLY_TEMPLATE_HEADERS = [
  'year',
  '입력 대상(안내)',
  '업무 구분(안내)',
  'metric_name',
  'metric_value',
  '단위(안내)',
  '반영 화면(안내)',
  '입력 안내(업로드 미인식)',
  'univ_code',
  'dept_code',
  'metric_id',
  '_template_optional',
] as const;

const ACCOUNTING_ROOT_CODES = [
  'tuition-accounting',
  'corporate-accounting',
  'iacf-accounting',
] as const;

function isAccountingMetricCode(metricCode?: string | null): boolean {
  if (!metricCode) return false;
  return ACCOUNTING_ROOT_CODES.some(
    (rootCode) =>
      metricCode === rootCode || metricCode.startsWith(`${rootCode}.`),
  );
}

function isAccountingLeafCode(metricCode?: string | null): boolean {
  if (!metricCode) return false;
  return ACCOUNTING_ROOT_CODES.some(
    (rootCode) =>
      metricCode.startsWith(`${rootCode}.income.`) ||
      metricCode.startsWith(`${rootCode}.expense.`),
  );
}

function accountingGroupLabel(metricCode?: string | null): string {
  if (metricCode?.includes('.income.')) return '수입';
  if (metricCode?.includes('.expense.')) return '지출';
  return '';
}

const COLUMN_GUIDE: Array<{
  header: string;
  required: string;
  meaning: string;
  example: string;
}> = [
  {
    header: 'year',
    required: '필수',
    meaning: '실적 연도(정수). 해당 지표 값의 기준 연도입니다.',
    example: '2026',
  },
  {
    header: 'univ_code',
    required: '자동 입력·숨김',
    meaning:
      '연성대학교 코드입니다. 시스템이 미리 입력하며 사용자는 수정하지 않습니다.',
    example: '0002651',
  },
  {
    header: 'dept_code',
    required: '자동 입력·숨김',
    meaning:
      '입력 대상 코드입니다. 시스템이 대학 전체(_ALL_) 또는 학과 코드를 미리 결정합니다.',
    example: '_ALL_',
  },
  {
    header: 'metric_id',
    required: '자동 입력·숨김',
    meaning:
      '기존 지표를 정확히 연결하는 ID입니다. 동명 지표를 구분하므로 수정하지 않습니다.',
    example: '123',
  },
  {
    header: 'metric_name',
    required: '자동 입력',
    meaning:
      '기존 지표명입니다. 수정하지 마세요. 띄어쓰기·오타가 있으면 신규 지표를 만들지 않고 업로드를 중단합니다.',
    example: '재학생 수',
  },
  {
    header: 'metric_value',
    required: '사용자 입력',
    meaning:
      '지표 값. 필요한 행만 입력하며 미입력 행은 건너뜁니다. 실제 0은 숫자 0을 입력하고, 명시적인 결측은 NULL을 입력합니다.',
    example: '12.5 또는 NULL 또는 0',
  },
];

async function fetchUnivCodebook(): Promise<UniversityCodebook> {
  const { data } = await api.get<UniversityCodebook>('/universities/codebook');
  return data;
}

async function fetchMetricCodebook(): Promise<MetricCodebook> {
  const { data } = await api.get<MetricCodebook>('/metrics/codebook');
  return data;
}

function buildUploadTemplateWorkbook(
  codebook: UniversityCodebook,
  metrics: MetricCodebookEntry[],
  kind: TemplateKind,
  mode: UploadMode = 'internal',
) {
  const year = codebook.referenceYear;
  const { univCode, univName, departments } = codebook.yeonsung;
  const campusUnivName = univName || '연성대학교';
  const sourceType = mode === 'monitoring' ? 'MONITORING' : 'INTERNAL';
  const targetPage =
    mode === 'monitoring'
      ? '대학 주요 현황 모니터링'
      : '학과별 자체 경쟁력 분석 지표';

  const makeInputSheet = (rows: Array<Array<string | number>>) => {
    const sheet = XLSX.utils.aoa_to_sheet([
      [...FRIENDLY_TEMPLATE_HEADERS],
      ...rows,
    ]);
    sheet['!cols'] = [
      { wch: 10 },
      { wch: 28 },
      { wch: 24 },
      { wch: 34 },
      { wch: 16 },
      { wch: 12 },
      { wch: 72 },
      { wch: 76 },
      { hidden: true },
      { hidden: true },
      { hidden: true },
      { hidden: true },
    ];
    sheet['!autofilter'] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: 7 } }),
    };
    const valueHeader = sheet['E1'];
    if (valueHeader) {
      valueHeader.c = [
        {
          a: 'IR 시스템',
          t: '이 열에만 값을 입력하세요. 미입력 행은 업로드에서 자동으로 제외됩니다.',
        },
      ];
    }
    return sheet;
  };

  const ysuSheet = XLSX.utils.aoa_to_sheet([
    ['univ_code', 'univ_name', 'dept_code', 'dept_name', 'series_lg', '비고'],
    [univCode, univName, '_ALL_', '대학 전체', '', '학과 구분 없는 대학 단위 지표'],
    ...departments.map((d) => [
      univCode,
      univName,
      d.deptCode,
      d.deptName,
      d.seriesLg ?? '',
      '조회 대상(활성) 학과',
    ]),
  ]);
  ysuSheet['!cols'] = [
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
    { wch: 28 },
  ];

  const internalMetrics = metrics.filter((m) => m.sourceType === 'INTERNAL');
  const monitoringMetrics = metrics.filter(
    (m) => m.sourceType === 'MONITORING',
  );
  const monitoringById = new Map(
    monitoringMetrics.map((metric) => [metric.metricId, metric]),
  );
  const monitoringParentMetricIds = new Set(
    monitoringMetrics
      .map((metric) => metric.parentMetricId)
      .filter((id): id is number => typeof id === 'number'),
  );
  const metricTrail = (metric: MetricCodebookEntry) => {
    const trail = [metric.metricName];
    let parent =
      metric.parentMetricId != null
        ? monitoringById.get(metric.parentMetricId)
        : undefined;
    const visited = new Set<number>([metric.metricId]);
    while (parent && !visited.has(parent.metricId)) {
      visited.add(parent.metricId);
      trail.unshift(parent.metricName);
      parent =
        parent.parentMetricId != null
          ? monitoringById.get(parent.parentMetricId)
          : undefined;
    }
    return trail;
  };
  const monitoringPageMatch = (metric: MetricCodebookEntry) =>
    `대학 주요 현황 모니터링 > ${metric.categoryName} > ${metricTrail(metric).join(' > ')}`;
  const generalInputMetrics = monitoringMetrics
    .filter(
      (metric) =>
        !isAccountingMetricCode(metric.metricCode) &&
        !monitoringParentMetricIds.has(metric.metricId),
    )
    .sort((a, b) =>
      monitoringPageMatch(a).localeCompare(monitoringPageMatch(b), 'ko'),
    );
  const accountingInputMetrics = monitoringMetrics
    .filter(
      (metric) =>
        isAccountingLeafCode(metric.metricCode) &&
        !monitoringParentMetricIds.has(metric.metricId),
    )
    .sort((a, b) => {
      const rootOrder = (metric: MetricCodebookEntry) =>
        ACCOUNTING_ROOT_CODES.findIndex((root) =>
          metric.metricCode?.startsWith(root),
        );
      const rootDiff = rootOrder(a) - rootOrder(b);
      if (rootDiff !== 0) return rootDiff;
      const groupDiff =
        (accountingGroupLabel(a.metricCode) === '수입' ? 0 : 1) -
        (accountingGroupLabel(b.metricCode) === '수입' ? 0 : 1);
      if (groupDiff !== 0) return groupDiff;
      return a.metricId - b.metricId;
    });

  const internalById = new Map(
    internalMetrics.map((metric) => [metric.metricId, metric]),
  );
  const internalParentMetricIds = new Set(
    internalMetrics
      .map((metric) => metric.parentMetricId)
      .filter((id): id is number => typeof id === 'number'),
  );
  const internalMetricTrail = (metric: MetricCodebookEntry) => {
    const trail = [metric.metricName];
    let parent =
      metric.parentMetricId != null
        ? internalById.get(metric.parentMetricId)
        : undefined;
    const visited = new Set<number>([metric.metricId]);
    while (parent && !visited.has(parent.metricId)) {
      visited.add(parent.metricId);
      trail.unshift(parent.metricName);
      parent =
        parent.parentMetricId != null
          ? internalById.get(parent.parentMetricId)
          : undefined;
    }
    return trail;
  };
  const internalInputMetrics = internalMetrics
    .filter((metric) => !internalParentMetricIds.has(metric.metricId))
    .sort((a, b) => {
      const categoryDiff = a.categoryName.localeCompare(b.categoryName, 'ko');
      return categoryDiff !== 0
        ? categoryDiff
        : a.metricName.localeCompare(b.metricName, 'ko');
    });
  const departmentScopes = departments.map((department) => ({
    deptCode: department.deptCode,
    targetName: department.deptName,
  }));
  const internalRows = internalInputMetrics.flatMap((metric) => {
    const scopes: Array<{ deptCode: string; targetName: string }> = [];
    if (metric.hasUniversityData) {
      scopes.push({ deptCode: '_ALL_', targetName: '대학 전체' });
    }
    if (metric.hasDepartmentData || !metric.hasUniversityData) {
      scopes.push(...departmentScopes);
    }
    const path = `학과별 자체 경쟁력 분석 지표 > ${metric.categoryName} > ${internalMetricTrail(metric).join(' > ')}`;
    return scopes.map((scope) => [
      year,
      scope.targetName,
      metric.categoryName,
      metric.metricName,
      '',
      metric.metricUnit ?? '',
      path,
      scope.deptCode === '_ALL_'
        ? '대학 전체 값입니다. metric_value에 값만 입력하세요.'
        : `${scope.targetName}의 학과별 값입니다. metric_value에 값만 입력하세요.`,
      univCode,
      scope.deptCode,
      metric.metricId,
      'Y',
    ]);
  });
  const internalInputSheet = makeInputSheet(internalRows);

  const monitoringScopes = [
    { deptCode: '_ALL_', deptName: '대학 전체' },
    ...departments.map((department) => ({
      deptCode: department.deptCode,
      deptName: department.deptName,
    })),
  ];
  const generalRows: Array<Array<string | number>> = generalInputMetrics.flatMap(
    (metric) =>
      monitoringScopes.map((scope) => [
        year,
        scope.deptName,
        metric.categoryName,
        metric.metricName,
        '',
        metric.metricUnit ?? '',
        monitoringPageMatch(metric),
        scope.deptCode === '_ALL_'
          ? metric.officialAllLinked
            ? '대학 전체 값입니다. 정보공시값이 우선하며, 해당 연도 공시값이 없을 때만 입력값이 사용됩니다.'
            : '대학 전체 값입니다. metric_value에 해당 연도의 값을 입력하세요.'
          : `${scope.deptName}의 학과별 값입니다. metric_value에 해당 연도의 값을 입력하세요.`,
        univCode,
        scope.deptCode,
        metric.metricId,
        'Y',
      ]),
  );
  const generalSheet = makeInputSheet(generalRows);

  const accountingRows: Array<Array<string | number>> =
    accountingInputMetrics.map((metric) => {
      const trail = metricTrail(metric);
      const accountingName = trail[0] ?? '';
      const group = accountingGroupLabel(metric.metricCode);
      return [
        year,
        '대학 전체',
        `${accountingName} · ${group}`,
        metric.metricName,
        '',
        metric.metricUnit ?? '원',
        monitoringPageMatch(metric),
        `${accountingName}의 ${group} 세부항목 금액을 metric_value에 입력하세요. ${group} 합계와 회계 차액은 모니터링 화면에서 자동 계산되므로 수입·지출 부모 행은 별도로 입력하지 않습니다.`,
        univCode,
        '_ALL_',
        metric.metricId,
        'Y',
      ];
    });
  const accountingSheet = makeInputSheet(accountingRows);
  const metricHeaders = [
    'metric_id',
    'metric_name',
    'source',
    'category_name',
    'parent_metric_name',
    'metric_unit',
  ];
  const toMetricRow = (m: MetricCodebookEntry) => [
    m.metricId,
    m.metricName,
    m.sourceLabel,
    m.categoryName,
    m.parentMetricName ?? '',
    m.metricUnit ?? '',
  ];
  const monitoringMetricHeaders = [
    ...metricHeaders,
    '_ALL_ 자동연결',
    '_ALL_ 값 처리',
    '연결 정보공시 지표',
    '학과값 처리',
  ];
  const toMonitoringMetricRow = (m: MetricCodebookEntry) => [
    ...toMetricRow(m),
    m.officialAllLinked ? '예' : '아니오',
    m.officialAllLinked ? '정보공시 우선 (없으면 업로드값)' : '엑셀 입력',
    m.officialMetricName ?? '',
    '엑셀 입력',
  ];

  const internalSheet = XLSX.utils.aoa_to_sheet([
    metricHeaders,
    ...internalMetrics.map(toMetricRow),
  ]);
  internalSheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 8 },
    { wch: 20 },
    { wch: 24 },
    { wch: 12 },
  ];

  const monitoringSheet = XLSX.utils.aoa_to_sheet([
    monitoringMetricHeaders,
    ...monitoringMetrics.map(toMonitoringMetricRow),
  ]);
  monitoringSheet['!cols'] = [
    ...internalSheet['!cols']!,
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 16 },
  ];

  const monitoringLinkSheet = XLSX.utils.aoa_to_sheet([
    [
      'metric_id',
      '모니터링 지표',
      '카테고리',
      '상위 지표',
      '_ALL_ 자동연결',
      '_ALL_ 값 처리',
      '연결 정보공시 지표',
      '학과값 처리',
    ],
    ...monitoringMetrics.map((m) => [
      m.metricId,
      m.metricName,
      m.categoryName,
      m.parentMetricName ?? '',
      m.officialAllLinked ? '예' : '아니오',
      m.officialAllLinked ? '정보공시 우선 (없으면 업로드값)' : '엑셀 입력',
      m.officialMetricName ?? '',
      '엑셀 입력',
    ]),
  ]);
  monitoringLinkSheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 22 },
    { wch: 28 },
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 16 },
  ];

  const templateLabel =
    kind === 'internal-competitiveness'
      ? '학과별 자체 경쟁력 분석 자료'
      : kind === 'monitoring-general'
        ? '대학 주요 현황 자료'
        : kind === 'monitoring-accounting'
          ? '회계 현황 자료'
          : '모니터링 통합 자료';
  const templateType = kind.replaceAll('-', '_').toUpperCase();
  const guideSheet = XLSX.utils.aoa_to_sheet([
    [`${templateLabel} 입력 방법`],
    ['반영 화면', targetPage],
    ['기준 대학', `${campusUnivName} (${univCode})`],
    ['기준 연도', year],
    [],
    ['순서', '사용 방법'],
    ['1', '업로드양식 시트에서 year가 입력하려는 실적 연도인지 확인하세요.'],
    [
      '2',
      'metric_value 열에만 값을 입력하세요. 미입력 행은 업로드에서 자동으로 제외됩니다.',
    ],
    [
      '3',
      '입력 대상·업무 구분·단위·반영 화면·입력 안내 열을 보고 해당 행의 의미를 확인하세요.',
    ],
    [
      '4',
      '숨겨진 univ_code·dept_code·metric_id 열과 metric_name은 수정하지 마세요.',
    ],
    [
      '5',
      '일반 업로드에서는 신규 지표를 만들지 않습니다. 지표가 없으면 지표 DB 관리에서 먼저 등록한 뒤 최신 양식을 다시 받으세요.',
    ],
    [
      '6',
      '파일을 내려받은 시스템관리의 같은 업로드 영역에 올리세요. 다른 영역의 양식은 자동으로 거부됩니다.',
    ],
    [],
    ['중요', '정보공시(ALIMI)는 개별 수정 및 엑셀 업로드가 불가합니다.'],
    [
      '값 입력',
      '숫자 0은 실제 0으로 저장됩니다. 명시적인 결측은 NULL을 입력하세요. 쉼표가 있는 숫자도 허용됩니다.',
    ],
    [
      '지표명',
      '띄어쓰기·오타가 있어도 신규 지표로 생성하지 않으며, 유사한 기존 지표를 안내하고 업로드를 중단합니다.',
    ],
    ...(mode === 'monitoring'
      ? [
          [
            '자동연결',
            '대학 전체값은 정보공시 자동연결 여부를 확인하세요. 공시값이 있는 연도는 공시값이 우선합니다.',
          ],
          [
            '자동계산',
            '재학생 수·회계의 부모 합계는 하위 항목으로 자동 계산되므로 부모 행을 직접 입력하지 않습니다.',
          ],
        ]
      : []),
    [],
    ['컬럼명', '구분', '설명', '예시'],
    ...COLUMN_GUIDE.map((column) => [
      column.header,
      column.required,
      column.meaning,
      column.example,
    ]),
  ]);
  guideSheet['!cols'] = [{ wch: 18 }, { wch: 96 }, { wch: 18 }, { wch: 28 }];

  const metadataSheet = XLSX.utils.aoa_to_sheet([
    ['template_type', templateType],
    ['source_type', sourceType],
    ['target_page', targetPage],
    ['reference_year', year],
    ['generated_at', new Date().toISOString()],
    ['university_code', univCode],
  ]);

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, guideSheet, '사용방법');
  if (mode === 'internal') {
    XLSX.utils.book_append_sheet(
      workbook,
      internalInputSheet,
      '업로드양식_자체경쟁력',
    );
  } else {
    if (kind === 'monitoring-general' || kind === 'monitoring-all') {
      XLSX.utils.book_append_sheet(
        workbook,
        generalSheet,
        '업로드양식1_일반현황',
      );
    }
    if (kind === 'monitoring-accounting' || kind === 'monitoring-all') {
      XLSX.utils.book_append_sheet(
        workbook,
        accountingSheet,
        '업로드양식2_회계',
      );
    }
  }
  XLSX.utils.book_append_sheet(workbook, ysuSheet, '연성대학과목록');
  if (mode === 'monitoring') {
    XLSX.utils.book_append_sheet(workbook, monitoringLinkSheet, 'ALL자동연결');
    XLSX.utils.book_append_sheet(workbook, monitoringSheet, '지표코드(모니터링)');
  } else {
    XLSX.utils.book_append_sheet(workbook, internalSheet, '지표코드(자체)');
  }
  XLSX.utils.book_append_sheet(workbook, metadataSheet, '양식정보');
  workbook.Workbook = {
    Sheets: workbook.SheetNames.map((name) => ({
      Hidden: name === '양식정보' ? 1 : 0,
    })),
  };
  return workbook;
}

function buildCodebookWorkbook(
  codebook: UniversityCodebook,
  metricCodebook: MetricCodebook,
  mode: UploadMode = 'internal',
) {
  const internalMetrics = metricCodebook.metrics.filter(
    (m) => m.sourceType === 'INTERNAL',
  );
  const monitoringMetrics = metricCodebook.metrics.filter(
    (m) => m.sourceType === 'MONITORING',
  );
  const metricHeaders = [
    'metric_id',
    'metric_name',
    'source',
    'category_name',
    'parent_metric_name',
    'metric_unit',
  ];
  const toMetricRow = (m: MetricCodebookEntry) => [
    m.metricId,
    m.metricName,
    m.sourceLabel,
    m.categoryName,
    m.parentMetricName ?? '',
    m.metricUnit ?? '',
  ];
  const monitoringMetricHeaders = [
    ...metricHeaders,
    '_ALL_ 자동연결',
    '_ALL_ 값 처리',
    '연결 정보공시 지표',
    '학과값 처리',
  ];
  const toMonitoringMetricRow = (m: MetricCodebookEntry) => [
    ...toMetricRow(m),
    m.officialAllLinked ? '예' : '아니오',
    m.officialAllLinked ? '정보공시 우선 (없으면 업로드값)' : '엑셀 입력',
    m.officialMetricName ?? '',
    '엑셀 입력',
  ];

  const internalSheet = XLSX.utils.aoa_to_sheet([
    metricHeaders,
    ...internalMetrics.map(toMetricRow),
  ]);
  internalSheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 8 },
    { wch: 20 },
    { wch: 24 },
    { wch: 12 },
  ];

  const monitoringSheet = XLSX.utils.aoa_to_sheet([
    monitoringMetricHeaders,
    ...monitoringMetrics.map(toMonitoringMetricRow),
  ]);
  monitoringSheet['!cols'] = [
    ...internalSheet['!cols']!,
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 16 },
  ];

  const monitoringLinkSheet = XLSX.utils.aoa_to_sheet([
    [
      'metric_id',
      '모니터링 지표',
      '카테고리',
      '상위 지표',
      '_ALL_ 자동연결',
      '_ALL_ 값 처리',
      '연결 정보공시 지표',
      '학과값 처리',
    ],
    ...monitoringMetrics.map((m) => [
      m.metricId,
      m.metricName,
      m.categoryName,
      m.parentMetricName ?? '',
      m.officialAllLinked ? '예' : '아니오',
      m.officialAllLinked ? '정보공시 우선 (없으면 업로드값)' : '엑셀 입력',
      m.officialMetricName ?? '',
      '엑셀 입력',
    ]),
  ]);
  monitoringLinkSheet['!cols'] = [
    { wch: 12 },
    { wch: 36 },
    { wch: 22 },
    { wch: 28 },
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 16 },
  ];

  const metaSheet = XLSX.utils.aoa_to_sheet(
    mode === 'monitoring'
      ? [
          ['항목', '값'],
          ['생성시각(UTC)', codebook.generatedAt],
          ['기준연도', codebook.referenceYear],
          ['모니터링 지표 수', monitoringMetrics.length],
          [
            '_ALL_ 자동연결 지표 수',
            monitoringMetrics.filter((m) => m.officialAllLinked).length,
          ],
          [
            '연성대',
            `${codebook.yeonsung.univName} (${codebook.yeonsung.univCode}) / 학과 ${codebook.yeonsung.departments.length}개`,
          ],
          [],
          [
            '안내',
            '「ALL자동연결」시트에서 대학 전체(_ALL_) 정보공시 자동연결 여부를 확인할 수 있습니다. 자동연결 지표는 정보공시값 우선, 공시값이 없는 연도만 업로드값을 사용합니다. 학과값은 모두 엑셀 입력 대상입니다.',
          ],
          [
            '지표명 안내',
            '지표 코드북은 현재 DB의 metric_id–metric_name입니다. 지표 DB 빌더에서 이름을 바꾼 뒤에도 이 파일을 다시 받으면 최신 매핑이 들어갑니다. 업로드 시 현재 metric_name을 쓰고, 이름이 겹치면 metric_id를 함께 넣으세요.',
          ],
        ]
      : [
          ['항목', '값'],
          ['생성시각(UTC)', codebook.generatedAt],
          ['기준연도', codebook.referenceYear],
          ['자체 지표 수', internalMetrics.length],
          [
            '연성대',
            `${codebook.yeonsung.univName} (${codebook.yeonsung.univCode}) / 학과 ${codebook.yeonsung.departments.length}개`,
          ],
          [],
          [
            '안내',
            '연성대학교 학과와 자체 지표만 포함합니다. 지표 DB 관리에서 지표명을 바꾼 뒤에는 최신 파일을 다시 받으세요.',
          ],
          [
            '정보공시',
            '정보공시(ALIMI)는 개별 수정 및 엑셀 업로드가 불가하므로 이 코드북에서 제외합니다.',
          ],
        ],
  );
  metaSheet['!cols'] = [{ wch: 28 }, { wch: 90 }];

  const ysuDeptSheet = XLSX.utils.aoa_to_sheet([
    ['univ_code', 'univ_name', 'dept_code', 'dept_name', 'series_lg'],
    [
      codebook.yeonsung.univCode,
      codebook.yeonsung.univName,
      '_ALL_',
      '대학 전체',
      '',
    ],
    ...codebook.yeonsung.departments.map((d) => [
      codebook.yeonsung.univCode,
      codebook.yeonsung.univName,
      d.deptCode,
      d.deptName,
      d.seriesLg ?? '',
    ]),
  ]);
  ysuDeptSheet['!cols'] = [
    { wch: 12 },
    { wch: 24 },
    { wch: 14 },
    { wch: 28 },
    { wch: 14 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, metaSheet, '안내');
  if (mode === 'monitoring') {
    XLSX.utils.book_append_sheet(workbook, ysuDeptSheet, '연성대학과목록');
    XLSX.utils.book_append_sheet(workbook, monitoringLinkSheet, 'ALL자동연결');
    XLSX.utils.book_append_sheet(workbook, monitoringSheet, '지표코드(모니터링)');
  } else {
    XLSX.utils.book_append_sheet(workbook, ysuDeptSheet, '연성대학과목록');
    XLSX.utils.book_append_sheet(workbook, internalSheet, '지표코드(자체)');
  }
  return workbook;
}

export function UploadCenter() {
  return (
    <div className="space-y-6">
      <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          정보공시(ALIMI)는 개별 수정 및 엑셀 업로드가 불가하며 대학알리미
          연동으로만 갱신됩니다. 아래 자체 데이터와 모니터링 업로드 영역은 서로
          분리되어 있습니다.
        </p>
      </div>
      <ExcelUploadPanel mode="internal" />
      <ExcelUploadPanel mode="monitoring" />
    </div>
  );
}

function ExcelUploadPanel({ mode }: { mode: UploadMode }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [downloading, setDownloading] = useState<'template' | 'codebook' | null>(
    null,
  );
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [codebookOpen, setCodebookOpen] = useState(false);
  const [codebook, setCodebook] = useState<UniversityCodebook | null>(null);
  const [metricCodebook, setMetricCodebook] = useState<MetricCodebook | null>(
    null,
  );
  const [codebookLoading, setCodebookLoading] = useState(false);
  const [codebookError, setCodebookError] = useState<string | null>(null);
  const [codebookQuery, setCodebookQuery] = useState('');
  const [codebookTab, setCodebookTab] = useState<CodebookTab>('ysu');

  const doUpload = async (opts: { confirmLocked: boolean }) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data } = await api.post<UploadResult>('/upload/excel', form, {
        params: {
          overwriteExisting: overwriteExisting ? 'true' : 'false',
          confirmLocked: opts.confirmLocked ? 'true' : 'false',
          sourceType: mode === 'monitoring' ? 'MONITORING' : 'INTERNAL',
        },
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setResult(data);
      if (data.status === 'SUCCESS') {
        window.dispatchEvent(new Event('ir-metrics-changed'));
      }
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setError(err.response?.data?.message ?? '업로드 실패');
      setResult(null);
    } finally {
      setBusy(false);
    }
  };

  const handleInitialUpload = () => {
    doUpload({ confirmLocked: false });
  };

  const handleDownloadTemplate = async (kind: TemplateKind) => {
    setTemplatePickerOpen(false);
    setDownloading('template');
    setError(null);
    try {
      const [univ, metrics] = await Promise.all([
        fetchUnivCodebook(),
        fetchMetricCodebook(),
      ]);
      const wb = buildUploadTemplateWorkbook(
        univ,
        metrics.metrics,
        kind,
        mode,
      );
      const filenameByKind: Record<TemplateKind, string> = {
        'internal-competitiveness': `ysu-ir-competitiveness-${univ.referenceYear}.xlsx`,
        'monitoring-general': `ysu-ir-monitoring-general-${univ.referenceYear}.xlsx`,
        'monitoring-accounting': `ysu-ir-monitoring-accounting-${univ.referenceYear}.xlsx`,
        'monitoring-all': `ysu-ir-monitoring-all-${univ.referenceYear}.xlsx`,
      };
      const summaryByKind: Record<TemplateKind, string> = {
        'internal-competitiveness': '학과별 자체 경쟁력 분석 자료 양식',
        'monitoring-general': '대학 주요 현황 자료 양식',
        'monitoring-accounting': '회계 현황 자료 양식',
        'monitoring-all': '모니터링 통합 자료 양식',
      };
      const filename = filenameByKind[kind];
      XLSX.writeFile(wb, filename);
      logDataExport({
        format: 'xlsx',
        source: 'upload-template',
        filename,
        summary: summaryByKind[kind],
      });
    } catch {
      setError('샘플 양식 생성 실패 (코드 조회 오류)');
    } finally {
      setDownloading(null);
    }
  };

  const handleDownloadCodebook = async () => {
    setDownloading('codebook');
    setError(null);
    try {
      const [univ, metrics] = await Promise.all([
        fetchUnivCodebook(),
        fetchMetricCodebook(),
      ]);
      const wb = buildCodebookWorkbook(univ, metrics, mode);
      const filename =
        mode === 'monitoring'
          ? `ysu-ir-monitoring-codebook-${univ.referenceYear}.xlsx`
          : `ysu-ir-codebook-${univ.referenceYear}.xlsx`;
      XLSX.writeFile(wb, filename);
      logDataExport({
        format: 'xlsx',
        source: 'upload-codebook',
        filename,
        summary:
          mode === 'monitoring' ? '모니터링 코드북' : '자체 데이터 코드북',
      });
    } catch {
      setError('코드북 다운로드 실패');
    } finally {
      setDownloading(null);
    }
  };

  const openCodebook = async () => {
    setCodebookOpen(true);
    setCodebookLoading(true);
    setCodebookError(null);
    setCodebookQuery('');
    try {
      const [univ, metrics] = await Promise.all([
        fetchUnivCodebook(),
        fetchMetricCodebook(),
      ]);
      setCodebook(univ);
      setMetricCodebook(metrics);
    } catch {
      setCodebook(null);
      setMetricCodebook(null);
      setCodebookError('코드북을 불러오지 못했습니다.');
    } finally {
      setCodebookLoading(false);
    }
  };

  const filteredUnivs = useMemo(() => {
    if (!codebook) return [];
    const q = codebookQuery.trim().toLowerCase();
    if (!q) return codebook.universities.slice(0, 200);
    return codebook.universities
      .filter(
        (u) =>
          u.univCode.toLowerCase().includes(q) ||
          u.univName.toLowerCase().includes(q) ||
          (u.regionCity ?? '').toLowerCase().includes(q),
      )
      .slice(0, 200);
  }, [codebook, codebookQuery]);

  const filteredDepts = useMemo(() => {
    if (!codebook) return [];
    const q = codebookQuery.trim().toLowerCase();
    const source =
      codebookTab === 'ysu'
        ? codebook.departments.filter(
            (d) => d.univCode === codebook.yeonsung.univCode,
          )
        : codebook.departments;
    if (!q) return source.slice(0, 300);
    return source
      .filter(
        (d) =>
          d.univCode.toLowerCase().includes(q) ||
          d.univName.toLowerCase().includes(q) ||
          d.deptCode.toLowerCase().includes(q) ||
          d.deptName.toLowerCase().includes(q) ||
          (d.seriesLg ?? '').toLowerCase().includes(q),
      )
      .slice(0, 300);
  }, [codebook, codebookQuery, codebookTab]);

  const filteredMetrics = useMemo(() => {
    if (!metricCodebook) return [];
    const sourceType =
      codebookTab === 'metric-monitoring' ? 'MONITORING' : 'INTERNAL';
    const source = metricCodebook.metrics.filter(
      (m) => m.sourceType === sourceType,
    );
    const q = codebookQuery.trim().toLowerCase();
    if (!q) return source.slice(0, 400);
    return source
      .filter(
        (m) =>
          String(m.metricId).includes(q) ||
          m.metricName.toLowerCase().includes(q) ||
          m.categoryName.toLowerCase().includes(q) ||
          (m.officialMetricName ?? '').toLowerCase().includes(q) ||
          (m.metricUnit ?? '').toLowerCase().includes(q),
      )
      .slice(0, 400);
  }, [metricCodebook, codebookQuery, codebookTab]);

  const internalCount =
    metricCodebook?.metrics.filter((m) => m.sourceType === 'INTERNAL').length ??
    0;

  const monitoringCount =
    metricCodebook?.metrics.filter((m) => m.sourceType === 'MONITORING')
      .length ?? 0;
  const monitoringOfficialCount =
    metricCodebook?.metrics.filter(
      (m) => m.sourceType === 'MONITORING' && m.officialAllLinked,
    ).length ?? 0;
  const isMonitoring = mode === 'monitoring';

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {isMonitoring
            ? '모니터링 데이터 업로드'
            : '자체 데이터 엑셀 업로드'}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            헤더:{' '}
            <code>
              year, univ_code, dept_code, metric_name, metric_value
            </code>
          </p>
          {isMonitoring ? (
            <>
              <p>
                대학 주요 현황 모니터링 전용입니다. 이 영역에서 받은 파일은{' '}
                <code>MONITORING</code> 데이터만 등록하며 competitiveness의 자체
                데이터와 섞이지 않습니다.
              </p>
              <p>
                양식 다운로드에서 <strong>대학 주요 현황</strong>,{' '}
                <strong>회계 현황</strong>, <strong>통합 양식</strong> 중 업무를
                선택하세요. 시스템이 대학 전체·학과별 입력 행을 미리 구성합니다.
              </p>
              <p>
                사용자는 <code>metric_value</code>만 입력합니다. 지표명 오타나
                띄어쓰기 차이는 신규 지표로 생성하지 않으며 업로드를 중단하고
                유사한 기존 지표를 안내합니다.
              </p>
              <p>
                다운로드 양식의 <strong>ALL자동연결</strong> 시트와{' '}
                <strong>지표코드(모니터링)</strong> 시트에서 대학 전체값의
                정보공시 자동연결 여부를 확인할 수 있습니다. 자동연결 항목도
                학과값은 엑셀로 입력해야 합니다.
              </p>
            </>
          ) : (
            <>
              <p>
                competitiveness의 학과별 자체 경쟁력 분석 전용입니다. 이 영역에서
                받은 파일은 <code>INTERNAL</code> 데이터만 등록하며 모니터링
                데이터와 섞이지 않습니다.
              </p>
              <p>
                시스템이 현재 지표와 학과를 양식에 미리 채웁니다. 사용자는{' '}
                <code>metric_value</code>만 입력하세요. 신규 지표는 엑셀에서 만들지
                않으며, 지표 DB 관리에서 먼저 등록한 뒤 최신 양식을 받아야 합니다.
              </p>
            </>
          )}
        </div>

        <div className="rounded-md border bg-muted/30 p-3">
          <div className="mb-2 text-sm font-bold text-foreground">컬럼 안내</div>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            {COLUMN_GUIDE.map((c) => (
              <li key={c.header}>
                <span className="font-bold text-foreground">{c.header}</span>
                <span className="mx-1">({c.required})</span>— {c.meaning}
              </li>
            ))}
            <li>
              <span className="font-bold text-foreground">입력 대상</span>
              <span className="mx-1">(표시용)</span>— 다운로드 양식에서
              대학 전체 또는 실제 학과명을 보여줍니다. 업로드 시 저장되지 않습니다.
            </li>
            <li>
              <span className="font-bold text-foreground">시스템 코드</span>
              <span className="mx-1">(숨김)</span>— univ_code, dept_code,
              metric_id는 시스템이 미리 설정하며 수정하지 않습니다.
            </li>
            <li>
              <span className="font-bold text-foreground">metric_id</span>
              <span className="mx-1">(자동 입력)</span>— 기존 지표를 정확히
              연결합니다. 내려받은 값을 바꾸지 마세요.
            </li>
            {isMonitoring && (
              <>
                <li>
                  <span className="font-bold text-foreground">
                    안내 열
                  </span>
                  <span className="mx-1">(표시용)</span>— 단위, 회계 구분,
                  모니터링 화면 매칭, 입력 안내는 업로드 시 저장되지 않습니다.
                </li>
              </>
            )}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setTemplatePickerOpen(true)}
            disabled={!!downloading}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading === 'template' ? '양식 생성 중…' : '양식 다운로드'}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={handleDownloadCodebook}
            disabled={!!downloading}
          >
            <Download className="mr-1 h-4 w-4" />
            {downloading === 'codebook' ? '코드북 생성 중…' : '코드북 다운로드'}
          </Button>
          <Button type="button" variant="secondary" onClick={openCodebook}>
            <BookOpen className="mr-1 h-4 w-4" /> 코드북 조회
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setResult(null);
              setError(null);
            }}
            className="text-sm"
          />
          <Button onClick={handleInitialUpload} disabled={!file || busy}>
            <Upload className="mr-1 h-4 w-4" /> 업로드
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              id={`${mode}-overwrite`}
              checked={overwriteExisting}
              onCheckedChange={setOverwriteExisting}
              disabled={busy}
            />
            <Label htmlFor={`${mode}-overwrite`}>기존 데이터 수정</Label>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {overwriteExisting
            ? '켜짐: 연도·대학·학과·지표명이 같은 기존 값을 엑셀 값으로 바꿉니다.'
            : '꺼짐: 중복은 건너뛰고, 아직 없는 데이터만 넣습니다.'}
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result?.status === 'NEED_CONFIRM_LOCKED' && (
          <div className="space-y-2 rounded-md bg-red-50 p-3 text-sm text-red-900">
            <div className="flex items-center gap-2 font-bold">
              <AlertTriangle className="h-4 w-4" /> 마감(잠금) 데이터 경고
            </div>
            <p>{result.message}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => {
                  doUpload({ confirmLocked: true });
                }}
              >
                잠금 무시하고 수정
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setResult(null)}
              >
                취소
              </Button>
            </div>
          </div>
        )}

        {result?.status === 'SUCCESS' && (
          <div
            className={`space-y-1 rounded-md p-3 text-sm ${
              result.skipped > 0
                ? 'bg-amber-50 text-amber-900'
                : 'bg-emerald-50 text-emerald-900'
            }`}
          >
            <div className="flex items-start gap-2">
              {result.skipped > 0 ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              ) : (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              )}
              <div className="space-y-1">
                <p>
                  업로드 완료: 신규 {result.inserted}건, 갱신 {result.updated}건
                  {result.skipped > 0 ? `, 받지 않음 ${result.skipped}건` : ''}
                  .
                </p>
                {result.rowSummary ? <p>{result.rowSummary}</p> : null}
              </div>
            </div>
          </div>
        )}
      </CardContent>

      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>양식 다운로드</DialogTitle>
            <DialogDescription>
              입력하려는 업무를 선택하세요. 대학·학과 범위와 시스템 코드는
              양식이 자동으로 구성합니다.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {!isMonitoring ? (
              <button
                type="button"
                className="flex items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent"
                disabled={!!downloading}
                onClick={() =>
                  void handleDownloadTemplate('internal-competitiveness')
                }
              >
                <School className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                <span>
                  <span className="block font-bold text-foreground">
                    학과별 자체 경쟁력 분석 자료
                  </span>
                  <span className="mt-1 block text-sm text-muted-foreground">
                    competitiveness 화면에 반영됩니다. 현재 자체 지표와 연성대
                    학과를 미리 채우며 값만 입력합니다.
                  </span>
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="flex items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent"
                  disabled={!!downloading}
                  onClick={() =>
                    void handleDownloadTemplate('monitoring-general')
                  }
                >
                  <School className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-bold text-foreground">
                      대학 주요 현황 자료
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      학생·입학·취업·교원 등 회계를 제외한 monitoring 항목을
                      입력합니다.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent"
                  disabled={!!downloading}
                  onClick={() =>
                    void handleDownloadTemplate('monitoring-accounting')
                  }
                >
                  <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-bold text-foreground">
                      회계 현황 자료
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      교비·법인·산학협력단 회계의 수입·지출 세부항목 금액을
                      입력합니다.
                    </span>
                  </span>
                </button>
                <button
                  type="button"
                  className="flex items-start gap-3 rounded-md border p-4 text-left transition-colors hover:bg-accent"
                  disabled={!!downloading}
                  onClick={() => void handleDownloadTemplate('monitoring-all')}
                >
                  <FileSpreadsheet className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
                  <span>
                    <span className="block font-bold text-foreground">
                      모니터링 통합 양식
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">
                      일반현황과 회계를 한 파일의 두 입력 탭에서 함께 작성합니다.
                    </span>
                  </span>
                </button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={codebookOpen} onOpenChange={setCodebookOpen}>
        <DialogContent className="max-h-[85vh] max-w-4xl overflow-hidden">
          <DialogHeader>
            <DialogTitle>
              {isMonitoring
                ? '연성대 모니터링 코드북'
                : '연성대 자체 데이터 코드북'}
            </DialogTitle>
            <DialogDescription>
              {isMonitoring
                ? '연성대학교 학과와 모니터링 지표만 보여 줍니다. 실제 입력 양식에는 지표가 자동으로 들어갑니다.'
                : '연성대학교 학과와 자체 지표만 보여 줍니다. 정보공시 지표는 업로드 대상에서 제외됩니다.'}
              {codebook && metricCodebook && (
                <>
                  {' '}
                  {isMonitoring
                    ? `기준연도 ${codebook.referenceYear} · 연성대 학과 ${codebook.yeonsung.departments.length} · 모니터링 ${monitoringCount} · _ALL_ 자동연결 ${monitoringOfficialCount}`
                    : `기준연도 ${codebook.referenceYear} · 연성대 학과 ${codebook.yeonsung.departments.length} · 자체 ${internalCount}`}
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={codebookTab === 'ysu' ? 'default' : 'outline'}
              onClick={() => setCodebookTab('ysu')}
            >
              연성대 학과
            </Button>
            {!isMonitoring && (
              <Button
                size="sm"
                variant={
                  codebookTab === 'metric-internal' ? 'default' : 'outline'
                }
                onClick={() => setCodebookTab('metric-internal')}
              >
                지표(자체)
              </Button>
            )}
            {isMonitoring && (
              <Button
                size="sm"
                variant={
                  codebookTab === 'metric-monitoring' ? 'default' : 'outline'
                }
                onClick={() => setCodebookTab('metric-monitoring')}
              >
                지표(모니터링)
              </Button>
            )}
            <div className="relative min-w-[200px] flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="h-9 pl-8"
                placeholder="코드/이름 검색"
                value={codebookQuery}
                onChange={(e) => setCodebookQuery(e.target.value)}
              />
            </div>
          </div>

          <div className="max-h-[50vh] overflow-auto rounded-md border">
            {codebookLoading && (
              <p className="p-4 text-sm text-muted-foreground">불러오는 중…</p>
            )}
            {codebookError && (
              <p className="p-4 text-sm text-destructive">{codebookError}</p>
            )}
            {!codebookLoading && codebook && codebookTab === 'univ' && (
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-2 py-1.5">univ_code</th>
                    <th className="px-2 py-1.5">univ_name</th>
                    <th className="px-2 py-1.5">학교종류</th>
                    <th className="px-2 py-1.5">권역</th>
                    <th className="px-2 py-1.5">지역</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUnivs.map((u) => (
                    <tr key={u.univCode} className="border-t">
                      <td className="px-2 py-1 font-mono">{u.univCode}</td>
                      <td className="px-2 py-1">{u.univName}</td>
                      <td className="px-2 py-1">{u.schoolType}</td>
                      <td className="px-2 py-1">{u.regionType}</td>
                      <td className="px-2 py-1">{u.regionCity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!codebookLoading &&
              codebook &&
              (codebookTab === 'dept' || codebookTab === 'ysu') && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5">univ_code</th>
                      <th className="px-2 py-1.5">univ_name</th>
                      <th className="px-2 py-1.5">dept_code</th>
                      <th className="px-2 py-1.5">dept_name</th>
                      <th className="px-2 py-1.5">대계열</th>
                    </tr>
                  </thead>
                  <tbody>
                    {codebookTab === 'ysu' && (
                      <tr className="border-t bg-amber-50/50">
                        <td className="px-2 py-1 font-mono">
                          {codebook.yeonsung.univCode}
                        </td>
                        <td className="px-2 py-1">
                          {codebook.yeonsung.univName}
                        </td>
                        <td className="px-2 py-1 font-mono">_ALL_</td>
                        <td className="px-2 py-1">대학 전체</td>
                        <td className="px-2 py-1">—</td>
                      </tr>
                    )}
                    {filteredDepts.map((d) => (
                      <tr
                        key={`${d.univCode}:${d.deptCode}`}
                        className="border-t"
                      >
                        <td className="px-2 py-1 font-mono">{d.univCode}</td>
                        <td className="px-2 py-1">{d.univName}</td>
                        <td className="px-2 py-1 font-mono">{d.deptCode}</td>
                        <td className="px-2 py-1">{d.deptName}</td>
                        <td className="px-2 py-1">{d.seriesLg}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            {!codebookLoading &&
              metricCodebook &&
              (codebookTab === 'metric-internal' ||
                codebookTab === 'metric-monitoring') && (
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-muted">
                    <tr>
                      <th className="px-2 py-1.5">metric_id</th>
                      <th className="px-2 py-1.5">metric_name</th>
                      <th className="px-2 py-1.5">구분</th>
                      <th className="px-2 py-1.5">카테고리</th>
                      <th className="px-2 py-1.5">상위 지표</th>
                      <th className="px-2 py-1.5">단위</th>
                      {codebookTab === 'metric-monitoring' && (
                        <>
                          <th className="px-2 py-1.5">_ALL_ 자동연결</th>
                          <th className="px-2 py-1.5">_ALL_ 값 처리</th>
                          <th className="px-2 py-1.5">연결 공시지표</th>
                          <th className="px-2 py-1.5">학과값</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredMetrics.map((m) => (
                      <tr key={m.metricId} className="border-t">
                        <td className="px-2 py-1 font-mono">{m.metricId}</td>
                        <td className="px-2 py-1">{m.metricName}</td>
                        <td className="px-2 py-1">{m.sourceLabel}</td>
                        <td className="px-2 py-1">{m.categoryName}</td>
                        <td className="px-2 py-1">{m.parentMetricName ?? '—'}</td>
                        <td className="px-2 py-1">{m.metricUnit ?? '—'}</td>
                        {codebookTab === 'metric-monitoring' && (
                          <>
                            <td className="px-2 py-1 font-bold">
                              {m.officialAllLinked ? '예' : '아니오'}
                            </td>
                            <td className="px-2 py-1">
                              {m.officialAllLinked
                                ? '정보공시 우선 (없으면 업로드값)'
                                : '엑셀 입력'}
                            </td>
                            <td className="px-2 py-1">
                              {m.officialMetricName ?? '—'}
                            </td>
                            <td className="px-2 py-1">엑셀 입력</td>
                          </>
                        )}
                      </tr>
                    ))}
                    {filteredMetrics.length === 0 && (
                      <tr>
                        <td
                          colSpan={codebookTab === 'metric-monitoring' ? 10 : 6}
                          className="px-2 py-4 text-center text-muted-foreground"
                        >
                          해당 지표가 없습니다.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
