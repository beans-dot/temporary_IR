import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import * as ExcelJS from 'exceljs';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  IrDepartment,
  IrInternalDepartment,
  IrMetricRegistry,
  IrRawData,
  IrUpdateLog,
  type MetricSourceType,
  type UpdateLogDetail,
  type UpdateLogMetricDetail,
} from '../../entities';
import {
  metricNameLookupCandidates,
  syncDeptLevelMetricNames,
} from '../metrics/metric-labels';

export interface UploadOptions {
  /** 켜면 중복(year+univ+dept+metric)을 엑셀 값으로 덮어쓴다. 끄면 중복만 건너뛴다. */
  overwriteExisting?: boolean;
  confirmLocked?: boolean;
  sourceType?: Extract<MetricSourceType, 'INTERNAL' | 'MONITORING'>;
}

/** 양식에서 인식하는 헤더. univ_name·dept_name 등 표시용 더미 열은 무시한다. */
const KNOWN_HEADERS = [
  'year',
  'univ_code',
  'dept_code',
  'metric_name',
  'metric_value',
  'metric_id',
  '_template_optional',
] as const;

type KnownHeader = (typeof KNOWN_HEADERS)[number];

interface ParsedRowInput {
  sheetName: string;
  rowNumber: number;
  year: number;
  univCode: string;
  deptCode: string;
  metricName: string;
  metricValue: string;
  metricIdHint?: number;
}

interface ParsedRow extends ParsedRowInput {
  metricId: number;
}

interface TemplateMetadata {
  templateType?: string;
  sourceType?: string;
  targetPage?: string;
}

export type UploadResult =
  | {
      status: 'SUCCESS';
      inserted: number;
      updated: number;
      skipped: number;
      metricsCreated: number;
      /** 예: "1~78, 80~100행 받음, 79행 받지않음 (기존 데이터와 중복)" */
      rowSummary: string;
    }
  | {
      status: 'NEED_CONFIRM_LOCKED';
      message: string;
      lockedYears: number[];
    };

/** 행 번호 배열을 "1~78, 80, 82~100" 형태로 압축 */
export function formatRowRanges(rowNumbers: number[]): string {
  if (rowNumbers.length === 0) return '';
  const sorted = [...new Set(rowNumbers)].sort((a, b) => a - b);
  const parts: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    parts.push(start === prev ? `${start}` : `${start}~${prev}`);
    start = prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}~${prev}`);
  return parts.join(', ');
}

function formatSheetRowRanges(rows: ParsedRowInput[]): string {
  const bySheet = new Map<string, number[]>();
  for (const row of rows) {
    const list = bySheet.get(row.sheetName) ?? [];
    list.push(row.rowNumber);
    bySheet.set(row.sheetName, list);
  }
  return Array.from(bySheet.entries())
    .map(([sheetName, rowNumbers]) =>
      bySheet.size === 1
        ? `${formatRowRanges(rowNumbers)}행`
        : `${sheetName} ${formatRowRanges(rowNumbers)}행`,
    )
    .join(', ');
}

function buildRowSummary(
  acceptedRows: ParsedRowInput[],
  skippedRows: ParsedRowInput[],
): string {
  const parts: string[] = [];
  if (acceptedRows.length > 0) {
    parts.push(`${formatSheetRowRanges(acceptedRows)} 받음`);
  }
  if (skippedRows.length > 0) {
    parts.push(
      `${formatSheetRowRanges(skippedRows)} 받지않음 (기존 데이터와 중복)`,
    );
  }
  return parts.join(', ');
}

function formatRowLocation(row: ParsedRowInput): string {
  return `${row.sheetName} ${row.rowNumber}행`;
}

function normalizeMetricName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('ko');
}

function editDistance(left: string, right: string): number {
  const a = Array.from(left);
  const b = Array.from(right);
  const prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      next[j] = Math.min(
        next[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    for (let j = 0; j < next.length; j++) prev[j] = next[j];
  }
  return prev[b.length];
}

@Injectable()
export class UploadService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** ExcelJS 셀 값 → 문자열 (숫자·리치텍스트·수식 결과 대응) */
  private cellToString(rawCell: unknown): string {
    if (rawCell === undefined || rawCell === null) return '';
    if (typeof rawCell === 'string' || typeof rawCell === 'number') {
      return String(rawCell).trim();
    }
    if (typeof rawCell === 'boolean') return rawCell ? 'TRUE' : 'FALSE';
    if (typeof rawCell === 'object') {
      const o = rawCell as Record<string, unknown>;
      if ('result' in o && o.result !== undefined && o.result !== null) {
        return this.cellToString(o.result);
      }
      if (typeof o.text === 'string') return o.text.trim();
      if (Array.isArray(o.richText)) {
        return (o.richText as Array<{ text?: string }>)
          .map((t) => t.text ?? '')
          .join('')
          .trim();
      }
    }
    return String(rawCell).trim();
  }

  /**
   * 값 유효성: 빈칸/undefined는 즉시 Throw. 문자열 'NULL'과 숫자 0만 허용.
   */
  private validateValue(
    rawCell: unknown,
    rowLocation: string,
  ): string {
    const asString = this.cellToString(rawCell);
    if (asString === '') {
      throw new BadRequestException(
        `[${rowLocation}] 결측치 발견: metric_value가 비어 있습니다. (허용: 'NULL' 또는 숫자)`,
      );
    }
    if (asString.toUpperCase() === 'NULL') return 'NULL';
    const num = Number(asString.replace(/,/g, ''));
    if (!Number.isFinite(num)) {
      throw new BadRequestException(
        `[${rowLocation}] 유효하지 않은 값 '${asString}'. (허용: 'NULL' 또는 숫자)`,
      );
    }
    return asString;
  }

  private requireCell(
    rawCell: unknown,
    field: string,
    rowLocation: string,
  ): string {
    const value = this.cellToString(rawCell);
    if (value === '') {
      throw new BadRequestException(
        `[${rowLocation}] 결측치 발견: '${field}' 값이 비어 있습니다.`,
      );
    }
    return value;
  }

  private readTemplateMetadata(workbook: ExcelJS.Workbook): TemplateMetadata {
    const sheet = workbook.worksheets.find(
      (candidate) => candidate.name.trim() === '양식정보',
    );
    if (!sheet) return {};

    const values = new Map<string, string>();
    for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber++) {
      const row = sheet.getRow(rowNumber);
      const key = this.cellToString(row.getCell(1).value).toLowerCase();
      if (!key) continue;
      values.set(key, this.cellToString(row.getCell(2).value));
    }
    return {
      templateType: values.get('template_type'),
      sourceType: values.get('source_type')?.toUpperCase(),
      targetPage: values.get('target_page'),
    };
  }

  private async parseWorkbook(
    buffer: Buffer,
    expectedSourceType: Extract<MetricSourceType, 'INTERNAL' | 'MONITORING'>,
  ): Promise<ParsedRowInput[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) {
      throw new BadRequestException('엑셀 시트를 찾을 수 없습니다.');
    }
    const metadata = this.readTemplateMetadata(workbook);
    if (metadata.sourceType === 'ALIMI') {
      throw new BadRequestException(
        '정보공시(ALIMI)는 개별 수정 및 엑셀 업로드가 불가합니다. 대학알리미 연동으로만 갱신하세요.',
      );
    }
    if (
      metadata.sourceType &&
      metadata.sourceType !== expectedSourceType
    ) {
      const expectedLabel =
        expectedSourceType === 'MONITORING'
          ? '모니터링 데이터 업로드'
          : '자체 데이터 엑셀 업로드';
      const actualLabel =
        metadata.sourceType === 'MONITORING'
          ? '모니터링'
          : metadata.sourceType === 'INTERNAL'
            ? '자체 데이터'
            : metadata.sourceType;
      throw new BadRequestException(
        `이 파일은 ${actualLabel}용 양식입니다${metadata.targetPage ? ` (${metadata.targetPage})` : ''}. ${expectedLabel} 영역에는 등록할 수 없습니다.`,
      );
    }
    const namedUploadSheets = workbook.worksheets.filter((sheet) =>
      sheet.name.trim().startsWith('업로드양식'),
    );
    // 새 모니터링 양식은 일반현황·회계 탭을 함께 처리한다. 이름이 다른 기존
    // 사용자 파일은 이전처럼 첫 번째 시트만 읽는다.
    const uploadSheets =
      namedUploadSheets.length > 0 ? namedUploadSheets : [firstSheet];
    const rows: ParsedRowInput[] = [];
    for (const sheet of uploadSheets) {
      const headerRow = sheet.getRow(1);
      const headerIndex: Partial<Record<KnownHeader, number>> = {};
      headerRow.eachCell((cell, colNumber) => {
        const key = this.cellToString(cell.value).toLowerCase();
        // 양식 헤더만 인식. univ_name·dept_name·안내 열 등은 무시.
        if ((KNOWN_HEADERS as readonly string[]).includes(key)) {
          headerIndex[key as KnownHeader] = colNumber;
        }
      });

      const required: KnownHeader[] = [
        'year',
        'univ_code',
        'metric_name',
        'metric_value',
      ];
      for (const col of required) {
        if (!headerIndex[col]) {
          throw new BadRequestException(
            `[${sheet.name}] 필수 헤더 누락: '${col}'. (필요 헤더: year, univ_code, dept_code, metric_name, metric_value)`,
          );
        }
      }

      for (let i = 2; i <= sheet.rowCount; i++) {
        const row = sheet.getRow(i);
        if (row.actualCellCount === 0) continue;

        const rowLocation = `${sheet.name} ${i}행`;
        const metricNameCell = row.getCell(headerIndex['metric_name']!).value;
        const metricValueCell = row.getCell(headerIndex['metric_value']!).value;
        const metricNameBlank = this.cellToString(metricNameCell) === '';
        const metricValueBlank = this.cellToString(metricValueCell) === '';
        const templateOptional = headerIndex['_template_optional']
          ? ['y', 'yes', 'true', '1'].includes(
              this.cellToString(
                row.getCell(headerIndex['_template_optional']).value,
              ).toLowerCase(),
            )
          : false;
        // 생성 양식의 미작성 행과 기존 샘플 양식의 빈 자리는 스킵한다.
        if (
          (templateOptional && metricValueBlank) ||
          (metricNameBlank && metricValueBlank)
        ) {
          continue;
        }

        const yearRaw = this.requireCell(
          row.getCell(headerIndex['year']!).value,
          'year',
          rowLocation,
        );
        const univCode = this.requireCell(
          row.getCell(headerIndex['univ_code']!).value,
          'univ_code',
          rowLocation,
        );
        const deptCode = headerIndex['dept_code']
          ? this.cellToString(row.getCell(headerIndex['dept_code']).value) ||
            '_ALL_'
          : '_ALL_';
        const metricName = this.requireCell(
          metricNameCell,
          'metric_name',
          rowLocation,
        );
        const metricValue = this.validateValue(metricValueCell, rowLocation);

        const year = parseInt(yearRaw, 10);
        if (!Number.isInteger(year)) {
          throw new BadRequestException(
            `[${rowLocation}] year는 정수여야 합니다.`,
          );
        }

        let metricIdHint: number | undefined;
        if (headerIndex['metric_id']) {
          const rawId = this.cellToString(
            row.getCell(headerIndex['metric_id']).value,
          );
          if (rawId) {
            const parsed = Number.parseInt(rawId, 10);
            if (!Number.isInteger(parsed)) {
              throw new BadRequestException(
                `[${rowLocation}] metric_id는 정수여야 합니다.`,
              );
            }
            metricIdHint = parsed;
          }
        }

        rows.push({
          sheetName: sheet.name,
          rowNumber: i,
          year,
          univCode,
          deptCode,
          metricName,
          metricValue,
          metricIdHint,
        });
      }
    }

    if (rows.length === 0) {
      throw new BadRequestException('처리할 데이터 행이 없습니다.');
    }
    return rows;
  }

  /**
   * metric_name → metric_id 해석.
   * 업로드 출처와 동일한 기존 지표만 매칭한다. 알 수 없는 이름은 신규 생성하지 않는다.
   */
  private async resolveMetricIds(
    manager: EntityManager,
    inputs: ParsedRowInput[],
    sourceType: Extract<MetricSourceType, 'INTERNAL' | 'MONITORING'>,
  ): Promise<{
    rows: ParsedRow[];
    metricsCreated: number;
    createdMetricIds: number[];
  }> {
    const metricRepo = manager.getRepository(IrMetricRegistry);

    const uniqueNames = Array.from(
      new Set(
        inputs.filter((r) => r.metricIdHint == null).map((r) => r.metricName),
      ),
    );
    const sourceMetrics = await metricRepo.find({ where: { sourceType } });

    const hintedIds = Array.from(
      new Set(
        inputs
          .map((r) => r.metricIdHint)
          .filter((id): id is number => typeof id === 'number'),
      ),
    );
    const hinted =
      hintedIds.length > 0
        ? await metricRepo.find({ where: { metricId: In(hintedIds) } })
        : [];
    const hintMap = new Map(hinted.map((m) => [m.metricId, m]));

    const findMatch = (inputName: string): IrMetricRegistry | undefined => {
      const candidates = metricNameLookupCandidates(inputName);
      const matches = sourceMetrics.filter((m) =>
        candidates.includes(m.metricName),
      );
      if (matches.length === 0) return undefined;
      const exact = matches.filter((m) => m.metricName === inputName);
      const pool = exact.length > 0 ? exact : matches;
      if (pool.length > 1) {
        throw new BadRequestException(
          `지표명 '${inputName}'이(가) 여러 개 있습니다. 최신 양식의 숨김 metric_id로 구분해 주세요.`,
        );
      }
      return pool[0];
    };

    const suggestMetrics = (inputName: string): string[] => {
      const normalized = normalizeMetricName(inputName);
      return sourceMetrics
        .map((metric) => {
          const candidate = normalizeMetricName(metric.metricName);
          return {
            name: metric.metricName,
            distance: editDistance(normalized, candidate),
            spacingMatch: candidate === normalized,
          };
        })
        .filter(
          (candidate) =>
            candidate.spacingMatch ||
            candidate.distance <= Math.max(2, Math.floor(normalized.length / 4)),
        )
        .sort((a, b) =>
          a.spacingMatch === b.spacingMatch
            ? a.distance - b.distance
            : a.spacingMatch
              ? -1
              : 1,
        )
        .slice(0, 3)
        .map((candidate) => candidate.name);
    };

    const nameToId = new Map<string, number>();

    for (const name of uniqueNames) {
      const found = findMatch(name);
      if (found) {
        nameToId.set(name, found.metricId);
        continue;
      }
      const row = inputs.find(
        (input) => input.metricIdHint == null && input.metricName === name,
      );
      const suggestions = suggestMetrics(name);
      throw new BadRequestException(
        `[${row ? formatRowLocation(row) : '업로드 파일'}] 지표명 '${name}'을(를) 찾을 수 없습니다. 띄어쓰기·오타로 신규 지표를 자동 생성하지 않습니다.${suggestions.length > 0 ? ` 유사한 기존 지표: ${suggestions.map((suggestion) => `'${suggestion}'`).join(', ')}.` : ''} 최신 양식을 다시 받거나 지표 DB 관리에서 먼저 등록해 주세요.`,
      );
    }

    const rows: ParsedRow[] = inputs.map((r) => {
      if (r.metricIdHint != null) {
        const hintedMetric = hintMap.get(r.metricIdHint);
        if (!hintedMetric) {
          throw new BadRequestException(
            `[${formatRowLocation(r)}] metric_id ${r.metricIdHint}를 찾을 수 없습니다.`,
          );
        }
        if (hintedMetric.sourceType === 'ALIMI') {
          throw new BadRequestException(
            `[${formatRowLocation(r)}] 정보공시(ALIMI) 지표는 개별 수정 및 엑셀 업로드가 불가합니다.`,
          );
        }
        if (hintedMetric.sourceType !== sourceType) {
          const expectedLabel =
            sourceType === 'MONITORING' ? '모니터링' : '자체 데이터';
          throw new BadRequestException(
            `[${formatRowLocation(r)}] metric_id ${r.metricIdHint}는 ${expectedLabel} 지표가 아닙니다. 올바른 업로드 영역을 이용하세요.`,
          );
        }
        if (
          !metricNameLookupCandidates(r.metricName).includes(
            hintedMetric.metricName,
          )
        ) {
          throw new BadRequestException(
            `[${formatRowLocation(r)}] metric_id ${r.metricIdHint}는 '${hintedMetric.metricName}' 지표입니다. 입력된 지표명 '${r.metricName}'과 일치하지 않습니다. 최신 양식을 다시 받아 주세요.`,
          );
        }
        return { ...r, metricId: hintedMetric.metricId };
      }
      return { ...r, metricId: nameToId.get(r.metricName)! };
    });

    return { rows, metricsCreated: 0, createdMetricIds: [] };
  }

  private deptKey(univCode: string, deptCode: string): string {
    return `${univCode}::${deptCode}`;
  }

  private async resolveDeptNameMap(
    manager: EntityManager,
    rows: ParsedRow[],
  ): Promise<Map<string, string>> {
    const pairs = Array.from(
      new Map(
        rows
          .filter((r) => r.deptCode && r.deptCode !== '_ALL_')
          .map((r) => [
            this.deptKey(r.univCode, r.deptCode),
            { univCode: r.univCode, deptCode: r.deptCode },
          ]),
      ).values(),
    );
    if (pairs.length === 0) return new Map();

    const univCodes = Array.from(new Set(pairs.map((p) => p.univCode)));
    const deptCodes = Array.from(new Set(pairs.map((p) => p.deptCode)));

    const [publicDepts, internalDepts] = await Promise.all([
      manager.getRepository(IrDepartment).find({
        where: { univCode: In(univCodes), deptCode: In(deptCodes) },
      }),
      manager.getRepository(IrInternalDepartment).find({
        where: { univCode: In(univCodes), deptCode: In(deptCodes) },
      }),
    ]);

    const map = new Map<string, string>();
    for (const d of publicDepts) {
      map.set(this.deptKey(d.univCode, d.deptCode), d.deptName);
    }
    for (const d of internalDepts) {
      map.set(this.deptKey(d.univCode, d.deptCode), d.deptName);
    }
    return map;
  }

  private async buildUploadDetail(
    manager: EntityManager,
    rows: ParsedRow[],
    createdMetricIds: Set<number>,
  ): Promise<UpdateLogDetail> {
    const metricIds = Array.from(new Set(rows.map((r) => r.metricId)));
    const metrics =
      metricIds.length > 0
        ? await manager.getRepository(IrMetricRegistry).find({
            where: { metricId: In(metricIds) },
          })
        : [];
    const nameById = new Map(metrics.map((m) => [m.metricId, m.metricName]));
    const deptNameMap = await this.resolveDeptNameMap(manager, rows);

    const deptsByMetric = new Map<number, Set<string>>();
    for (const r of rows) {
      if (!r.deptCode || r.deptCode === '_ALL_') continue;
      let set = deptsByMetric.get(r.metricId);
      if (!set) {
        set = new Set();
        deptsByMetric.set(r.metricId, set);
      }
      set.add(
        deptNameMap.get(this.deptKey(r.univCode, r.deptCode)) ?? r.deptCode,
      );
    }

    const details: UpdateLogMetricDetail[] = metricIds.map((id) => {
      const deptNames = Array.from(deptsByMetric.get(id) ?? []).sort((a, b) =>
        a.localeCompare(b, 'ko'),
      );
      return {
        metricName: nameById.get(id) ?? '(알 수 없음)',
        isNew: createdMetricIds.has(id),
        sampleDept: deptNames[0] ?? null,
        deptCount: deptNames.length,
      };
    });

    details.sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? -1 : 1;
      return a.metricName.localeCompare(b.metricName, 'ko');
    });

    return { metrics: details };
  }

  /**
   * 엑셀 적재. 검증 실패 시 전체 Rollback.
   * 중복(year+univ+dept+metric)은 overwriteExisting이면 덮어쓰고, 아니면 해당 행만 건너뛴다.
   */
  async processUpload(
    buffer: Buffer,
    options: UploadOptions,
  ): Promise<UploadResult> {
    const sourceType =
      options.sourceType === 'MONITORING' ? 'MONITORING' : 'INTERNAL';
    const inputs = await this.parseWorkbook(buffer, sourceType);

    return this.dataSource
      .transaction(async (manager) => {
        const rawRepo = manager.getRepository(IrRawData);
        const { rows, metricsCreated, createdMetricIds } =
          await this.resolveMetricIds(manager, inputs, sourceType);

        const existing = await rawRepo
          .createQueryBuilder('r')
          .where('r.year IN (:...years)', {
            years: Array.from(new Set(rows.map((r) => r.year))),
          })
          .getMany();

        const existKey = (
          year: number,
          univ: string,
          dept: string,
          metric: number,
        ) => `${year}|${univ}|${dept}|${metric}`;
        const existingMap = new Map<string, IrRawData>();
        existing.forEach((e) =>
          existingMap.set(
            existKey(e.year, e.univCode, e.deptCode, e.metricId),
            e,
          ),
        );

        const overwriteExisting = !!options.overwriteExisting;
        const toApply: ParsedRow[] = [];
        const skipped: ParsedRow[] = [];
        for (const r of rows) {
          const isDup = existingMap.has(
            existKey(r.year, r.univCode, r.deptCode, r.metricId),
          );
          if (isDup && !overwriteExisting) skipped.push(r);
          else toApply.push(r);
        }

        if (overwriteExisting) {
          const lockedYears = new Set<number>();
          for (const r of toApply) {
            const found = existingMap.get(
              existKey(r.year, r.univCode, r.deptCode, r.metricId),
            );
            if (found?.isLocked) lockedYears.add(r.year);
          }
          if (lockedYears.size > 0 && !options.confirmLocked) {
            throw new UploadInterrupt({
              status: 'NEED_CONFIRM_LOCKED',
              message: `마감(잠금)된 연도 데이터가 포함되어 있습니다: ${Array.from(
                lockedYears,
              ).join(', ')}. 그래도 수정하시겠습니까?`,
              lockedYears: Array.from(lockedYears),
            });
          }
        }

        let inserted = 0;
        let updated = 0;
        for (const r of toApply) {
          const key = existKey(r.year, r.univCode, r.deptCode, r.metricId);
          const isUpdate = existingMap.has(key);
          await manager
            .createQueryBuilder()
            .insert()
            .into(IrRawData)
            .values({
              year: r.year,
              univCode: r.univCode,
              deptCode: r.deptCode,
              metricId: r.metricId,
              metricValue: r.metricValue,
            })
            .orUpdate(
              ['metric_value'],
              ['year', 'univ_code', 'dept_code', 'metric_id'],
            )
            .execute();
          if (isUpdate) updated++;
          else inserted++;
        }

        // 학과단위(_ALL_ 아님) raw가 있는 지표 → 지표명에 (학과별) 보장
        await syncDeptLevelMetricNames(manager);

        const detail = await this.buildUploadDetail(
          manager,
          toApply,
          new Set(createdMetricIds),
        );

        const rowSummary = buildRowSummary(
          toApply,
          skipped,
        );
        const sourceLabel =
          sourceType === 'MONITORING' ? '모니터링' : '자체';
        const skipNote =
          skipped.length > 0 ? `, 건너뜀 ${skipped.length}건` : '';

        await manager.getRepository(IrUpdateLog).save({
          updateType: 'EXCEL_UPLOAD',
          logText: `${sourceLabel} 데이터 엑셀 업로드 (신규 ${inserted}건, 갱신 ${updated}건${skipNote})`,
          detail,
        });

        return {
          status: 'SUCCESS',
          inserted,
          updated,
          skipped: skipped.length,
          metricsCreated,
          rowSummary,
        } as UploadResult;
      })
      .catch((err) => {
        if (err instanceof UploadInterrupt) {
          return err.payload;
        }
        throw err;
      });
  }
}

class UploadInterrupt extends Error {
  constructor(public readonly payload: UploadResult) {
    super('UPLOAD_INTERRUPT');
  }
}
