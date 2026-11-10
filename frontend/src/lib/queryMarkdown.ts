import type { PivotResult, PivotRow } from '@/lib/api';
import {
  descriptiveSeriesName,
  descriptiveStatsFromPivot,
  type DescriptiveStats,
} from '@/lib/descriptiveStats';
import type { RelativeMetricGroup } from '@/lib/relativeCompare';

export type QueryMarkdownScreen = 'disclosure' | 'internal';

export interface QueryMarkdownTarget {
  label: string;
  isYeonsung: boolean;
  mode: 'individual' | 'group';
  univCode?: string;
  deptCode?: string;
  memberUnivCount: number;
  memberDeptCount: number;
}

export interface QueryMarkdownMetric {
  metricName: string;
  unit: string | null;
  sourceType: 'ALIMI' | 'INTERNAL' | 'MONITORING';
}

export interface QueryMarkdownInput {
  screen: QueryMarkdownScreen;
  generatedAt: Date;
  hierarchyIntegrate: boolean;
  relativeExpand: { allSeries: boolean; allDepts: boolean };
  targets: QueryMarkdownTarget[];
  metrics: QueryMarkdownMetric[];
  pivot: PivotResult;
  relativeScales: RelativeMetricGroup[];
}

const SCREEN_TITLE: Record<QueryMarkdownScreen, string> = {
  disclosure: '대학정보공시 데이터 검색 및 조회',
  internal: '학과별 자체 경쟁력 분석 지표',
};

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '결측';
  const abs = Math.abs(value);
  if (abs !== 0 && (abs >= 1e12 || abs < 1e-6)) return value.toExponential(6);
  const text = value.toFixed(6).replace(/\.?0+$/, '');
  return text === '-0' ? '0' : text;
}

function formatStat(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '계산불가';
  return formatQty(value);
}

function yesNo(value: boolean): string {
  return value ? '예' : '아니오';
}

function onOff(value: boolean): string {
  return value ? '켜짐' : '꺼짐';
}

function sourceLabel(source: QueryMarkdownMetric['sourceType']): string {
  if (source === 'ALIMI') return '대학정보공시';
  if (source === 'INTERNAL') return '자체 경쟁력';
  return '모니터링';
}

function aggregationLabel(value: string): string {
  const key = value.trim().toUpperCase();
  if (key === 'AVG' || key === 'AVERAGE' || key === 'MEAN') return '평균';
  if (key === 'SUM') return '합계';
  if (key === 'COUNT') return '개수';
  if (key === 'MAX') return '최댓값';
  if (key === 'MIN') return '최솟값';
  return value.trim() || '알 수 없음';
}

function unitLabel(unit: string | null | undefined): string {
  const text = unit?.trim();
  return text ? text : '없음';
}

function slopePerYear(
  points: Array<{ year: number; value: number }>,
): number | null {
  if (points.length < 2) return null;
  const n = points.length;
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (const point of points) {
    sumX += point.year;
    sumY += point.value;
    sumXY += point.year * point.value;
    sumXX += point.year * point.year;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function observedPoints(
  years: number[],
  values: Record<number, number | null | undefined>,
): Array<{ year: number; value: number }> {
  const points: Array<{ year: number; value: number }> = [];
  for (const year of years) {
    const value = values[year];
    if (typeof value === 'number' && Number.isFinite(value)) {
      points.push({ year, value });
    }
  }
  return points;
}

function periodChange(points: Array<{ year: number; value: number }>): {
  delta: number | null;
  rate: number | null;
  first: { year: number; value: number } | null;
  last: { year: number; value: number } | null;
} {
  if (points.length === 0) {
    return { delta: null, rate: null, first: null, last: null };
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 2) {
    return { delta: null, rate: null, first, last };
  }
  const delta = last.value - first.value;
  const rate = first.value === 0 ? null : (delta / first.value) * 100;
  return { delta, rate, first, last };
}

function modesText(stats: DescriptiveStats): string {
  if (!stats.modes || stats.modes.length === 0) {
    return stats.count > 0 ? '없음' : '계산불가';
  }
  return stats.modes.map((mode) => formatQty(mode)).join(', ');
}

function pushTable(lines: string[], headers: string[], rows: string[][]) {
  lines.push(`| ${headers.map(cell).join(' | ')} |`);
  lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
  for (const row of rows) {
    lines.push(`| ${row.map(cell).join(' | ')} |`);
  }
  lines.push('');
}

interface TargetBlock {
  targetKey: string;
  targetLabel: string;
  isYeonsung: boolean;
  rows: PivotRow[];
}

function groupPivotRows(rows: PivotRow[]): TargetBlock[] {
  const order: TargetBlock[] = [];
  const byKey = new Map<string, TargetBlock>();
  for (const row of rows) {
    let block = byKey.get(row.targetKey);
    if (!block) {
      block = {
        targetKey: row.targetKey,
        targetLabel: row.targetLabel,
        isYeonsung: row.isYeonsung,
        rows: [],
      };
      byKey.set(row.targetKey, block);
      order.push(block);
    }
    block.rows.push(row);
  }
  return order;
}

function appendTrend(
  lines: string[],
  years: number[],
  values: Record<number, number | null | undefined>,
) {
  const sortedYears = [...years].sort((a, b) => a - b);
  const tableRows: string[][] = [];
  let previousYear: number | null = null;
  let previousValue: number | null = null;
  for (const year of sortedYears) {
    const raw = values[year];
    const current =
      typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
    let delta = '—';
    let rate = '—';
    let previousLabel = '—';
    if (previousYear !== null) {
      previousLabel = String(previousYear);
      if (current === null || previousValue === null) {
        delta = '결측';
        rate = '결측';
      } else {
        const diff = current - previousValue;
        delta = formatQty(diff);
        rate = previousValue === 0 ? '계산불가' : formatQty((diff / previousValue) * 100);
      }
    }
    tableRows.push([
      String(year),
      formatQty(current),
      previousLabel,
      delta,
      rate,
    ]);
    if (current !== null) {
      previousYear = year;
      previousValue = current;
    }
  }
  pushTable(
    lines,
    ['연도', '값', '이전 관측연도', '증감', '증감률(%)'],
    tableRows,
  );

  const points = observedPoints(sortedYears, values);
  const change = periodChange(points);
  const slope = slopePerYear(points);
  lines.push(`- 관측 수: ${points.length}`);
  if (change.first && change.last) {
    lines.push(
      `- 기간 첫 값(${change.first.year}): ${formatQty(change.first.value)}`,
    );
    lines.push(
      `- 기간 마지막 값(${change.last.year}): ${formatQty(change.last.value)}`,
    );
  }
  lines.push(`- 기간 증감: ${formatStat(change.delta)}`);
  lines.push(`- 기간 증감률(%): ${formatStat(change.rate)}`);
  lines.push(`- 선형 추세 기울기(값/연): ${formatStat(slope)}`);
  lines.push('');
}

function appendStatsTable(lines: string[], block: TargetBlock, pivot: PivotResult) {
  const statsByKey = new Map(
    descriptiveStatsFromPivot(pivot).map((row) => [row.key, row]),
  );
  const rows = block.rows.map((row) => {
    const stats = statsByKey.get(`${row.targetKey}-${row.metricId}`)?.stats;
    return [
      descriptiveSeriesName(row),
      stats ? String(stats.count) : '0',
      formatStat(stats?.mean),
      formatStat(stats?.median),
      stats ? modesText(stats) : '계산불가',
      formatStat(stats?.variance),
      formatStat(stats?.standardDeviation),
      formatStat(stats?.range),
      formatStat(stats?.iqr),
      formatStat(stats?.skewness),
      formatStat(stats?.kurtosis),
    ];
  });
  pushTable(
    lines,
    [
      '데이터명',
      '관측수',
      '평균',
      '중앙값',
      '최빈값',
      '분산',
      '표준편차',
      '범위',
      '사분위수(IQR)',
      '왜도',
      '첨도',
    ],
    rows,
  );
}

interface RelativeEntity {
  id: string;
  label: string;
  highlight: boolean;
  byYear: Map<number, { value: number; position: number }>;
}

function relativeEntities(group: RelativeMetricGroup): RelativeEntity[] {
  const byId = new Map<string, RelativeEntity>();
  for (const scale of group.scales) {
    for (const univ of scale.universities) {
      let entity = byId.get(univ.univCode);
      if (!entity) {
        entity = {
          id: univ.univCode,
          label: univ.label,
          highlight: univ.isYeonsung,
          byYear: new Map(),
        };
        byId.set(univ.univCode, entity);
      }
      if (univ.isYeonsung) entity.highlight = true;
      entity.byYear.set(scale.year, {
        value: univ.value,
        position: univ.position,
      });
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (a.highlight !== b.highlight) return a.highlight ? -1 : 1;
    return a.label.localeCompare(b.label, 'ko');
  });
}

function appendRelative(lines: string[], input: QueryMarkdownInput) {
  lines.push('## 상대비교');
  lines.push('');
  if (input.screen === 'internal') {
    const parts = ['대학 평균은 항상 포함됩니다.'];
    parts.push(
      input.relativeExpand.allSeries
        ? '전체 계열 비교 보기가 켜져 있어 계열 평균 원값이 포함됩니다.'
        : '전체 계열 비교 보기는 꺼져 있어 계열 전체는 포함되지 않습니다.',
    );
    parts.push(
      input.relativeExpand.allDepts
        ? '전체 학과 보기가 켜져 있어 학과 원값이 포함됩니다.'
        : '전체 학과 보기는 꺼져 있어 학과 전체는 포함되지 않습니다.',
    );
    lines.push(parts.join(' '));
  } else {
    lines.push(
      '공시 상대비교는 선택한 대학의 대학 단위 값입니다. 학과·계열 원값은 위의 조회 대상별 데이터에 있습니다.',
    );
  }
  lines.push(
    '화면 강조는 공시에서는 연성대학교 대학 단위, 자체 경쟁력에서는 대학 평균입니다. 순위는 그 연도 원값이 큰 순서이고 동점은 같은 순위입니다.',
  );
  lines.push('');

  if (input.relativeScales.length === 0) {
    lines.push('이번 조회에는 상대비교 결과가 없습니다.');
    lines.push('');
    return;
  }

  for (const group of input.relativeScales) {
    lines.push(`### ${group.metricName}`);
    lines.push('');
    lines.push(`- 단위: ${unitLabel(group.metricUnit)}`);
    const entities = relativeEntities(group);
    const years = [...group.scales.map((scale) => scale.year)].sort((a, b) => a - b);
    lines.push(`- 비교 대상 수: ${entities.length}`);
    lines.push('');

    lines.push('#### 연도별 원값');
    lines.push('');
    pushTable(
      lines,
      [
        '대상',
        ...years.map(String),
        '기간 증감',
        '기간 증감률(%)',
        '선형 추세 기울기(값/연)',
        '화면 강조',
      ],
      entities.map((entity) => {
        const valueMap: Record<number, number | null> = {};
        for (const year of years) {
          valueMap[year] = entity.byYear.get(year)?.value ?? null;
        }
        const points = observedPoints(years, valueMap);
        const change = periodChange(points);
        return [
          entity.label,
          ...years.map((year) => formatQty(entity.byYear.get(year)?.value)),
          formatStat(change.delta),
          formatStat(change.rate),
          formatStat(slopePerYear(points)),
          yesNo(entity.highlight),
        ];
      }),
    );

    lines.push('#### 연도별 상대위치');
    lines.push('');
    lines.push('0은 그 연도 최솟값, 50은 비교군 평균, 100은 그 연도 최댓값입니다.');
    lines.push('');
    pushTable(
      lines,
      ['대상', ...years.map(String), '화면 강조'],
      entities.map((entity) => [
        entity.label,
        ...years.map((year) => formatQty(entity.byYear.get(year)?.position)),
        yesNo(entity.highlight),
      ]),
    );

    const scalesDesc = [...group.scales].sort((a, b) => b.year - a.year);
    for (const scale of scalesDesc) {
      const ranked = [...scale.universities].sort((a, b) => b.value - a.value);
      let rank = 0;
      let seen = 0;
      let last: number | null = null;
      const rows = ranked.map((univ) => {
        seen += 1;
        if (last === null || univ.value !== last) {
          rank = seen;
          last = univ.value;
        }
        return [
          String(rank),
          univ.label,
          formatQty(univ.value),
          formatQty(univ.value - scale.mean),
          formatQty(univ.position),
          yesNo(univ.isYeonsung),
        ];
      });
      const values = ranked.map((univ) => univ.value);
      lines.push(`#### ${scale.year}년 순위`);
      lines.push('');
      lines.push(`- 비교군 평균: ${formatQty(scale.mean)}`);
      lines.push(`- 최솟값: ${formatQty(Math.min(...values))}`);
      lines.push(`- 최댓값: ${formatQty(Math.max(...values))}`);
      lines.push(`- 비교 대상 수: ${ranked.length}`);
      lines.push('');
      pushTable(
        lines,
        ['순위', '대상', '원값', '평균 대비 증감', '상대위치', '화면 강조'],
        rows,
      );
    }
  }
}

export function buildQueryMarkdown(input: QueryMarkdownInput): string {
  const years = [...input.pivot.years].sort((a, b) => a - b);
  const lines: string[] = [];
  lines.push(`# ${SCREEN_TITLE[input.screen]} 조회 데이터`);
  lines.push('');
  lines.push(
    '이 문서는 조회 화면에 나온 정량 데이터를 분석용으로 옮긴 것입니다. 조회 대상별 원값, 추이, 기초 기술통계, 상대비교를 함께 읽으면 됩니다.',
  );
  lines.push('');
  lines.push('## 계산 기준');
  lines.push('');
  lines.push('- 기초 기술통계는 조회 기간의 연도별 값으로 계산하며, 결측 연도는 제외합니다.');
  lines.push('- 분산과 표준편차는 표본(n−1)입니다.');
  lines.push('- 왜도와 첨도는 Excel SKEW, KURT와 같으며 첨도는 초과첨도입니다. 정규분포의 첨도는 0입니다.');
  lines.push('- 사분위수(IQR)는 PERCENTILE.INC 기준 Q3−Q1입니다.');
  lines.push('- 관측이 부족하거나 이전 값이 0이면 해당 항목은 계산불가입니다.');
  lines.push('- 추이의 증감은 값이 있는 이전 조회연도 대비입니다.');
  lines.push('- 선형 추세 기울기는 조회 연도를 x, 값을 y로 둔 최소자승 직선의 기울기이며 단위는 값/연입니다.');
  lines.push('- 상대위치는 그 연도 비교군에서 평균 50, 최솟값 0, 최댓값 100으로 둔 선형 위치입니다. 비교 대상이 2개 미만인 연도는 빠집니다.');
  lines.push('- 값이 클수록 좋은지는 지표마다 다르며, 이 문서에는 지표 방향이 없습니다.');
  lines.push('');
  lines.push('## 조회 조건');
  lines.push('');
  lines.push(`- 화면: ${SCREEN_TITLE[input.screen]}`);
  lines.push(
    `- 생성 시각: ${input.generatedAt.toLocaleString('ko-KR', { hour12: false })}`,
  );
  lines.push(`- 조회 기간: ${years.length ? years.join(', ') : '없음'}`);
  lines.push(`- 하위 위계를 상위 평균으로 통합: ${yesNo(input.hierarchyIntegrate)}`);
  if (input.screen === 'internal') {
    lines.push(`- 전체 계열 비교 보기: ${onOff(input.relativeExpand.allSeries)}`);
    lines.push(`- 전체 학과 보기: ${onOff(input.relativeExpand.allDepts)}`);
  }
  lines.push('');
  lines.push('### 조회 대상');
  lines.push('');
  if (input.targets.length === 0) {
    lines.push('선택된 조회 대상이 없습니다.');
    lines.push('');
  } else {
    for (const target of input.targets) {
      const kind = target.mode === 'group' ? '그룹 평균' : '개별';
      const codes = [
        target.univCode ? `대학코드 ${target.univCode}` : '',
        target.deptCode ? `학과코드 ${target.deptCode}` : '',
        target.memberUnivCount > 0 ? `소속 대학 ${target.memberUnivCount}개` : '',
        target.memberDeptCount > 0 ? `소속 학과 ${target.memberDeptCount}개` : '',
      ].filter(Boolean);
      const extra = codes.length ? ` (${codes.join(', ')})` : '';
      lines.push(
        `- ${target.label} / ${kind} / 연성대학교 ${yesNo(target.isYeonsung)}${extra}`,
      );
    }
    lines.push('');
  }

  lines.push('### 조회 지표');
  lines.push('');
  if (input.metrics.length === 0) {
    lines.push('선택된 조회 지표가 없습니다.');
    lines.push('');
  } else {
    for (const metric of input.metrics) {
      lines.push(
        `- ${metric.metricName} / 단위 ${unitLabel(metric.unit)} / ${sourceLabel(metric.sourceType)}`,
      );
    }
    lines.push('');
  }

  lines.push('## 조회 대상별 데이터');
  lines.push('');
  const blocks = groupPivotRows(input.pivot.rows);
  if (blocks.length === 0) {
    lines.push('조회된 원 단위 데이터가 없습니다.');
    lines.push('');
  }

  for (const block of blocks) {
    lines.push(`### ${block.targetLabel}`);
    lines.push('');
    lines.push(`- 연성대학교: ${yesNo(block.isYeonsung)}`);
    lines.push('');
    for (const row of block.rows) {
      lines.push(`#### ${row.metricName}`);
      lines.push('');
      lines.push(`- 단위: ${unitLabel(row.metricUnit)}`);
      lines.push(`- 집계: ${aggregationLabel(row.aggregationType)}`);
      lines.push('');
      lines.push('##### 원 단위 데이터와 추이');
      lines.push('');
      appendTrend(lines, years, row.values);
    }
    lines.push('#### 기초 기술통계');
    lines.push('');
    appendStatsTable(lines, block, input.pivot);
  }

  appendRelative(lines, input);
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

export function queryMarkdownFilename(
  screen: QueryMarkdownScreen,
  generatedAt: Date,
): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${generatedAt.getFullYear()}${pad(generatedAt.getMonth() + 1)}${pad(generatedAt.getDate())}-${pad(generatedAt.getHours())}${pad(generatedAt.getMinutes())}`;
  const scope = screen === 'internal' ? 'competitiveness' : 'disclosure';
  return `ysu-ir-${scope}-data-${stamp}.md`;
}
