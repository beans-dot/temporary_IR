/**
 * 학과단위 raw가 있는 지표명에 (학과별) 접미사를 일괄 반영.
 *   npx ts-node -r tsconfig-paths/register src/seed/apply-dept-level-labels.ts
 *
 * 정기 배치·엑셀 업로드 시에도 동일 로직이 실행되며, 기존 데이터 보수용.
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrUpdateLog } from '../entities';
import { syncDeptLevelMetricNames } from '../modules/metrics/metric-labels';

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const ds = app.get<DataSource>(getDataSourceToken());
    const n = await syncDeptLevelMetricNames(ds);
    await ds.getRepository(IrUpdateLog).save({
      updateType: 'REPAIR',
      logText: `학과별 지표명 라벨 반영: ${n}건`,
    });
    // eslint-disable-next-line no-console
    console.log(`[APPLY-DEPT-LABEL] ${n}건 지표명에 (학과별) 반영 완료`);
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
