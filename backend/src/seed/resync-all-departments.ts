/**
 * 전체 대학 학과·대계열 공시 재동기화 (기본: 직전 연도).
 *   node dist/seed/resync-all-departments.js
 *
 * ALIMI_RESYNC_YEAR=2025
 * ALIMI_DEPT_CONCURRENCY=3
 * ALIMI_CALL_DELAY_MS=800
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { AlimiService } from '../modules/alimi/alimi.service';
import { IrUpdateLog } from '../entities';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);
    const year = Number(
      process.env.ALIMI_RESYNC_YEAR || new Date().getFullYear() - 1,
    );

    // 1) 대계열명 정규화 + 자리표시 학과 비활성 (즉시 반영)
    const norm = await ds.query(`
      UPDATE ir_department SET series_lg = CASE
        WHEN series_lg IS NULL OR btrim(series_lg) = '' OR btrim(series_lg) = '기타' THEN NULL
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('인문사회', '인문사회계열') THEN '인문사회계열'
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('예체능', '예체능계열') THEN '예체능계열'
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('자연과학', '자연과학계열') THEN '자연과학계열'
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('공학', '공학계열') THEN '공학계열'
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('의학', '의학계열') THEN '의학계열'
        WHEN replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '') IN ('광역', '광역계열') THEN '광역계열'
        ELSE replace(replace(replace(btrim(series_lg), 'ㆍ', ''), '·', ''), ' ', '')
      END
      WHERE series_lg IS NOT NULL
        AND (
          series_lg ~ '[ㆍ·]'
          OR btrim(series_lg) = '기타'
          OR series_lg <> btrim(series_lg)
        )
    `);
    const placeholder = await ds.query(`
      UPDATE ir_department
      SET is_active = false
      WHERE is_active = true
        AND (
          replace(dept_name, ' ', '') LIKE '%소속학과없음%'
          OR replace(dept_name, ' ', '') LIKE '기타%'
        )
    `);
    // eslint-disable-next-line no-console
    console.log(
      `[RESYNC-ALL] 사전정리: series 정규화 rowCount=${norm?.[1] ?? norm}, placeholder 비활성 rowCount=${placeholder?.[1] ?? placeholder}`,
    );

    // 2) 공시 학과 전수 동기화
    // eslint-disable-next-line no-console
    console.log(`[RESYNC-ALL] ${year} 전체 대학 학과 동기화 시작`);
    const n = await alimi.syncDepartments(year);
    // eslint-disable-next-line no-console
    console.log(`[RESYNC-ALL] 완료. 활성 학과 ${n}건`);

    await ds.getRepository(IrUpdateLog).save({
      updateType: 'REPAIR',
      logText: `전체 대학 학과·대계열 재동기화 ${year}, 활성 ${n}건`,
    });
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
