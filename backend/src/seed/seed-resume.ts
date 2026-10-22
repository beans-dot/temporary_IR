/**
 * 끊긴 시딩 이어하기.
 * - seed-fill.log 기준: 2025·2024 완료, 2023은 '학생' 시작 직후 중단 → 학생+산학협력만 재수집
 * - 2022: 대학 마스터 totalCount=0 이면 스킵 (공시 없음)
 *
 *   npm run seed:resume
 */
import 'reflect-metadata';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { IrUniversityMaster, IrUpdateLog } from '../entities';
import { AlimiService } from '../modules/alimi/alimi.service';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function resume() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    const alimi = app.get(AlimiService);
    const limit = alimi.parseUnivLimit(process.env.ALIMI_STATS_UNIV_LIMIT);
    const ysu = process.env.YSU_UNIV_CODE || '0002651';
    let totalStats = 0;

    // ---- 2023: 학생·산학협력만 (로그상 교원·연구까지 시작 후 학생에서 끊김) ----
    {
      const year = 2023;
      // eslint-disable-next-line no-console
      console.log(`[RESUME] ===== ${year}년 이어하기 (학생 + 산학협력) =====`);
      const univs = await alimi.syncUniversities(year).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[RESUME] 대학 마스터 실패: ${(e as Error).message}`);
        return [] as IrUniversityMaster[];
      });
      if (univs.length === 0) {
        // eslint-disable-next-line no-console
        console.log(`[RESUME]   -> ${year}년 공시 없음, 스킵`);
      } else {
        const codes = alimi.selectUnivCodes(univs, ysu, limit);
        // eslint-disable-next-line no-console
        console.log(
          `[RESUME]   -> ${year}년 통계 (대상 ${codes.length}개, 그룹=학생·산학협력)`,
        );
        const n = await alimi.ingestStats(year, codes, {
          onlyServiceLabels: ['학생', '산학협력'],
        });
        totalStats += n;
        // eslint-disable-next-line no-console
        console.log(`[RESUME]   -> ${year}년 ${n}건 적재`);
      }
      await sleep(1500);
    }

    // ---- 2022: 공시 있으면 전체 통계, 없으면 스킵 ----
    {
      const year = 2022;
      // eslint-disable-next-line no-console
      console.log(`[RESUME] ===== ${year}년 공시 유무 확인 =====`);
      const univs = await alimi.syncUniversities(year).catch((e) => {
        // eslint-disable-next-line no-console
        console.error(`[RESUME] 대학 마스터 실패: ${(e as Error).message}`);
        return [] as IrUniversityMaster[];
      });
      if (univs.length === 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[RESUME]   -> ${year}년 대학 마스터 0건 → 공시 없음, 통계 스킵`,
        );
      } else {
        const codes = alimi.selectUnivCodes(univs, ysu, limit);
        // eslint-disable-next-line no-console
        console.log(
          `[RESUME]   -> ${year}년 통계 전체 수집 (대상 ${codes.length}개)`,
        );
        const n = await alimi.ingestStats(year, codes);
        totalStats += n;
        // eslint-disable-next-line no-console
        console.log(`[RESUME]   -> ${year}년 ${n}건 적재`);
      }
    }

    await dataSource.getRepository(IrUpdateLog).save({
      updateType: 'SEED_RESUME',
      logText: `시딩 이어하기 완료: 2023(학생·산학)+2022 확인, 통계 ${totalStats}건`,
    });
    // eslint-disable-next-line no-console
    console.log(`[RESUME] 완료. 추가 적재 ${totalStats}건.`);
  } finally {
    await app.close();
  }
}

resume()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[RESUME] 치명적 오류:', err);
    process.exit(1);
  });
