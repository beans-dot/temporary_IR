/**
 * 학과 단위 적재 복구: 학과 동기화(편제정원·졸업자 수) + 통계 재적재.
 *   npx ts-node -r tsconfig-paths/register src/seed/repair-dept-level-metrics.ts
 *
 * 기본: 연성대(YSU) 2023~2025. ALIMI_REPAIR_UNIV_CODES=코드1,코드2 로 확장 가능.
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrUpdateLog } from '../entities';
import { AlimiService } from '../modules/alimi/alimi.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    const fromEnv = (process.env.ALIMI_REPAIR_UNIV_CODES || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const codes = fromEnv.length > 0 ? fromEnv : [ysu];
    const years = [2025, 2024, 2023];

    let total = 0;
    for (const year of years) {
      // eslint-disable-next-line no-console
      console.log(`[REPAIR-DEPT] ${year} 학과 동기화(+학과 수치)`);
      const deptN = await alimi.syncDepartments(year, codes);
      // eslint-disable-next-line no-console
      console.log(`[REPAIR-DEPT]   학과 활성 ${deptN}건`);

      // eslint-disable-next-line no-console
      console.log(
        `[REPAIR-DEPT] ${year} 통계 재적재 (univ=${codes.join(',')})`,
      );
      const n = await alimi.ingestStats(year, codes);
      total += n;
      // eslint-disable-next-line no-console
      console.log(`[REPAIR-DEPT]   -> ${n}건`);
    }

    await ds.getRepository(IrUpdateLog).save({
      updateType: 'REPAIR',
      logText: `학과단위 적재 복구: 2023~2025, univ=${codes.join(',')}, stats ${total}건`,
    });
    // eslint-disable-next-line no-console
    console.log(`[REPAIR-DEPT] 완료. stats ${total}건`);
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
