/**
 * 연성대 학과·대계열만 공시 API로 재동기화.
 *   npx ts-node -r tsconfig-paths/register src/seed/resync-ysu-departments.ts
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { AlimiService } from '../modules/alimi/alimi.service';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const alimi = app.get(AlimiService);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    // 당해 연도 공시가 아직 없으면 직전 연도로 폴백
    const year = Number(
      process.env.ALIMI_RESYNC_YEAR || new Date().getFullYear() - 1,
    );
    // eslint-disable-next-line no-console
    console.log(`[RESYNC-YSU] ${year} 학과 동기화 univ=${ysu}`);
    const n = await alimi.syncDepartments(year, [ysu]);
    // eslint-disable-next-line no-console
    console.log(`[RESYNC-YSU] 완료. 활성 학과 ${n}건`);
  } finally {
    await app.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
