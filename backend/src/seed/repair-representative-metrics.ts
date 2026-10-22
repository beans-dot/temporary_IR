/**
 * ALIMI 지표를 대표값만 남기도록 정리 후 재적재.
 *   npx ts-node -r tsconfig-paths/register src/seed/repair-representative-metrics.ts
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrUniversityMaster, IrUpdateLog } from '../entities';
import { AlimiService } from '../modules/alimi/alimi.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);

    // ALIMI 지표·raw 전량 제거 (부가 indctVal / 오적재 포함)
    await ds.query(`
      DELETE FROM ir_raw_data
      WHERE metric_id IN (
        SELECT metric_id FROM ir_metric_registry WHERE source_type = 'ALIMI'
      )
    `);
    await ds.query(`DELETE FROM ir_metric_registry WHERE source_type = 'ALIMI'`);
    // eslint-disable-next-line no-console
    console.log('[REPAIR] 기존 ALIMI 지표/raw 삭제 완료');

    const years = [2025, 2024, 2023];
    const limit = alimi.parseUnivLimit(process.env.ALIMI_STATS_UNIV_LIMIT);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    const master = await ds.getRepository(IrUniversityMaster).find();
    const codes = alimi.selectUnivCodes(master, ysu, limit);

    let total = 0;
    for (const year of years) {
      // eslint-disable-next-line no-console
      console.log(`[REPAIR] ${year}년 대표값 재적재 (univ=${codes.length})`);
      const n = await alimi.ingestStats(year, codes);
      total += n;
      // eslint-disable-next-line no-console
      console.log(`[REPAIR]   -> ${n}건`);
    }

    await ds.getRepository(IrUpdateLog).save({
      updateType: 'REPAIR',
      logText: `대표값 재적재 완료: 2023~2025, ${total}건 (부가 indctVal 제외)`,
    });
    // eslint-disable-next-line no-console
    console.log(`[REPAIR] 완료. 총 ${total}건`);
  } finally {
    await app.close();
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
