/**
 * 완결성 검사 + 빈칸 채우기
 * - 2023~2025: 마스터에 있으나 raw 없거나 건수 부족 대학만 재수집
 * - 2022·2026: API 대학 마스터 존재 시에만 전체 통계 수집
 *
 *   npm run seed:completeness
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrRawData, IrUniversityMaster, IrUpdateLog } from '../entities';
import { AlimiService } from '../modules/alimi/alimi.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 대학당 이 건수 미만이면 불완전으로 재수집 */
const MIN_ROWS_PER_UNIV = Number(process.env.SEED_MIN_ROWS_PER_UNIV || 20);

async function probeYearHasMaster(
  alimi: AlimiService,
  year: number,
): Promise<IrUniversityMaster[]> {
  const univs = await alimi.syncUniversities(year).catch((e) => {
    // eslint-disable-next-line no-console
    console.error(`[AUDIT] ${year} 대학 마스터 실패: ${(e as Error).message}`);
    return [] as IrUniversityMaster[];
  });
  return univs;
}

async function findGapUnivCodes(
  ds: DataSource,
  year: number,
  ysuCode: string,
): Promise<string[]> {
  const rows: Array<{ univ_code: string }> = await ds.query(
    `
    SELECT u.univ_code
    FROM ir_university_master u
    LEFT JOIN (
      SELECT univ_code, COUNT(*) AS cnt
      FROM ir_raw_data
      WHERE year = $1
      GROUP BY univ_code
    ) r ON r.univ_code = u.univ_code
    WHERE r.univ_code IS NULL OR r.cnt < $2
    ORDER BY u.univ_code
    `,
    [year, MIN_ROWS_PER_UNIV],
  );
  const codes = new Set(rows.map((r) => r.univ_code));
  if (ysuCode) codes.add(ysuCode);
  return Array.from(codes);
}

async function yearSummary(ds: DataSource, year: number) {
  const [row] = await ds.query(
    `
    SELECT
      COUNT(DISTINCT univ_code)::int AS univs,
      COUNT(*)::int AS rows,
      COUNT(DISTINCT metric_id)::int AS metrics
    FROM ir_raw_data WHERE year = $1
    `,
    [year],
  );
  return {
    univs: row?.univs ?? 0,
    rows: row?.rows ?? 0,
    metrics: row?.metrics ?? 0,
  };
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const ds = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    let filled = 0;

    // eslint-disable-next-line no-console
    console.log('[AUDIT] ===== API 연도 가용성 (대학 마스터) =====');
    for (const year of [2026, 2025, 2024, 2023, 2022]) {
      const univs = await probeYearHasMaster(alimi, year);
      // eslint-disable-next-line no-console
      console.log(
        `[AUDIT] ${year}: 마스터 ${univs.length}건${univs.length === 0 ? ' → 공시 없음' : ''}`,
      );
      await sleep(800);
    }

    // ---- 2023~2025 갭 채우기 ----
    for (const year of [2025, 2024, 2023]) {
      const before = await yearSummary(ds, year);
      const gapCodes = await findGapUnivCodes(ds, year, ysu);
      // eslint-disable-next-line no-console
      console.log(
        `[AUDIT] ${year} 현재 univ=${before.univs} rows=${before.rows} metrics=${before.metrics} / 재수집 대상 ${gapCodes.length}개 (raw없음 또는 <${MIN_ROWS_PER_UNIV}건)`,
      );

      if (gapCodes.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[AUDIT] ${year} 갭 없음, 스킵`);
        continue;
      }

      // 최신 마스터로 코드 유효성 보정 (해당 연도 마스터에 있는 것만)
      const master = await probeYearHasMaster(alimi, year);
      const masterSet = new Set(master.map((u) => u.univCode));
      const codes = gapCodes.filter(
        (c) => c === ysu || masterSet.has(c) || master.length === 0,
      );
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] ${year} 통계 갭필 시작 (${codes.length}개 대학)`);
      const n = await alimi.ingestStats(year, codes);
      filled += n;
      const after = await yearSummary(ds, year);
      // eslint-disable-next-line no-console
      console.log(
        `[AUDIT] ${year} 갭필 ${n}건 → univ=${after.univs} rows=${after.rows} metrics=${after.metrics}`,
      );
      await sleep(1500);
    }

    // ---- 2022·2026: API에 있으면 전체 수집 ----
    for (const year of [2026, 2022]) {
      const univs = await probeYearHasMaster(alimi, year);
      if (univs.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[AUDIT] ${year}: API 공시 없음 → 적재 불가(스킵)`);
        continue;
      }
      const limit = alimi.parseUnivLimit(process.env.ALIMI_STATS_UNIV_LIMIT);
      const codes = alimi.selectUnivCodes(univs, ysu, limit);
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] ${year}: API 있음 → 전체 통계 ${codes.length}개`);
      const n = await alimi.ingestStats(year, codes);
      filled += n;
      // eslint-disable-next-line no-console
      console.log(`[AUDIT] ${year} ${n}건 적재`);
      await sleep(1500);
    }

    // 최종 요약
    // eslint-disable-next-line no-console
    console.log('[AUDIT] ===== 최종 커버리지 =====');
    for (const year of [2026, 2025, 2024, 2023, 2022]) {
      const s = await yearSummary(ds, year);
      const gaps = await findGapUnivCodes(ds, year, '');
      // eslint-disable-next-line no-console
      console.log(
        `[AUDIT] ${year}: univ=${s.univs} rows=${s.rows} metrics=${s.metrics} remaining_gap≈${gaps.length}`,
      );
    }

    await ds.getRepository(IrUpdateLog).save({
      updateType: 'SEED_AUDIT',
      logText: `완결성 검사·갭필 완료: 추가 ${filled}건 (minRows=${MIN_ROWS_PER_UNIV})`,
    });
    // eslint-disable-next-line no-console
    console.log(`[AUDIT] 완료. 추가 적재 ${filled}건.`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[AUDIT] 치명적 오류:', err);
    process.exit(1);
  });
