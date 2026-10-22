import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrMetricCategory, IrUniversityMaster, IrUpdateLog } from '../entities';
import { AlimiService } from '../modules/alimi/alimi.service';
import { CORE_CATEGORY_NAMES } from '../modules/alimi/alimi.types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);

    // 1) 4대 카테고리 INSERT (모집 / 학생·취창업 / 교육·교원 / 재정·교육여건)
    const catRepo = dataSource.getRepository(IrMetricCategory);
    let order = 1;
    for (const name of CORE_CATEGORY_NAMES) {
      const exists = await catRepo.findOne({ where: { categoryName: name } });
      if (!exists) {
        await catRepo.save(catRepo.create({ categoryName: name, displayOrder: order }));
        // eslint-disable-next-line no-console
        console.log(`[SEED] 카테고리 생성: ${name}`);
      }
      order++;
    }

    // 2) 과거 5개년(2022~2026) Loop
    const currentYear = new Date().getFullYear();
    const years = [0, 1, 2, 3, 4].map((o) => currentYear - o);

    const limit = alimi.parseUnivLimit(process.env.ALIMI_STATS_UNIV_LIMIT);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    let totalStats = 0;
    let deptsSynced = false;

    for (const year of years) {
      // eslint-disable-next-line no-console
      console.log(`[SEED] ===== ${year}년 수집 =====`);

      // 2-a) 대학 마스터 (트리 소스)
      const univs = await alimi.syncUniversities(year).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[SEED] 대학 마스터 실패: ${(e as Error).message}`);
        return [] as IrUniversityMaster[];
      });
      await sleep(1500);

      // 공시 미제공 연도(마스터 0건)는 통계 API 호출 스킵
      if (univs.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[SEED]   -> ${year}년 공시 데이터 없음, 통계 스킵`);
        continue;
      }

      // 2-b) 학과정보: 최신 공시연도 1회만 (대계열→학과 트리 소스, 폐과 제외)
      if (!deptsSynced) {
        const deptCount = await alimi.syncDepartments(year).catch((e) => {
          // eslint-disable-next-line no-console
          console.error(`[SEED] 학과 동기화 실패: ${(e as Error).message}`);
          return 0;
        });
        // eslint-disable-next-line no-console
        console.log(`[SEED]   -> ${year}년 학과 ${deptCount}건 동기화 (폐과 제외)`);
        deptsSynced = true;
        await sleep(1500);
      }

      // 2-c) 통계 지표 (전체 대학, ALIMI_STATS_UNIV_LIMIT>0 이면 샘플)
      const codes = alimi.selectUnivCodes(univs, ysu, limit);
      // eslint-disable-next-line no-console
      console.log(
        `[SEED]   -> ${year}년 통계 수집 시작 (대상 ${codes.length}개 대학${limit > 0 ? `, limit=${limit}` : ', 무제한'}, 5개 API 동적 파싱)`,
      );
      const upserted = await alimi.ingestStats(year, codes);
      totalStats += upserted;
      // eslint-disable-next-line no-console
      console.log(`[SEED]   -> ${year}년 통계 ${upserted}건 적재`);
      await sleep(1000);
    }

    await dataSource.getRepository(IrUpdateLog).save({
      updateType: 'SEED',
      logText: `초기 시딩 완료: ${years[years.length - 1]}~${years[0]}년, 통계 총 ${totalStats}건 적재`,
    });

    // eslint-disable-next-line no-console
    console.log(`[SEED] 완료. 통계 총 ${totalStats}건 적재.`);
  } finally {
    await app.close();
  }
}

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[SEED] 치명적 오류:', err);
    process.exit(1);
  });
