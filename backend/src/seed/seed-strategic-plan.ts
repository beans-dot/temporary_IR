import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import '../config/load-env';
import { NestFactory } from '@nestjs/core';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import {
  IrSpCompareData,
  IrSpDepartment,
  IrSpFundSource,
  IrSpGoal,
  IrSpKpi,
  IrSpKpiTarget,
  IrSpStrategy,
  IrSpSubtask,
  IrSpTask,
  IrSpVision,
  IrUpdateLog,
  type SpCompareAlt,
  type SpComparePayload,
} from '../entities';
import { SP_DEFAULT_FUND_SOURCES } from '../modules/strategic-plan/strategic-plan.constants';

interface PlanFile {
  plan: {
    official_name?: string;
    period?: string;
    structure?: string;
  };
  vision: Record<string, unknown>;
  goals: Array<{ id: string; no: number; name: string }>;
  strategies: Array<{ id: string; goal_id: string; name: string }>;
  tasks: Array<{
    code: string;
    name: string;
    strategy_id: string;
    goal_id: string;
    특성화연계?: boolean;
    책임부서?: string;
    연관부서?: string[] | null;
    kpi_codes?: string[];
    subtasks?: Array<{ code: string; name: string }>;
  }>;
  kpis: Array<{
    code: string;
    name: string;
    unit?: string | null;
    task_code: string;
    strategy_id: string;
    goal_id: string;
    baseline?: number | null;
    baseline_ref?: string | null;
    targets?: Record<string, number | null>;
    formula?: string | null;
    source?: string | null;
  }>;
}

interface CompareFile {
  years: number[];
  indicators: Array<{
    id: string;
    name: string;
    src?: string;
    srcLabel?: string;
    priv?: boolean;
    years: Record<string, SpComparePayload>;
    alt?: { label: string; years: Record<string, SpCompareAlt['value']> };
  }>;
}

function readJson<T>(fileName: string): T {
  const filePath = path.join(__dirname, fileName);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
}

async function seedStrategicPlan() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const dataSource = app.get<DataSource>(getDataSourceToken());
    const plan = readJson<PlanFile>('strategic-plan-data.json');
    const compare = readJson<CompareFile>('strategic-plan-compare.json');

    // 1) 비전 체계 (단일 레코드)
    const visionRepo = dataSource.getRepository(IrSpVision);
    const v = plan.vision as Record<string, any>;
    const existingVision = await visionRepo.find({ order: { visionId: 'ASC' } });
    const visionRow = visionRepo.create({
      visionId: existingVision[0]?.visionId,
      officialName: plan.plan?.official_name ?? null,
      planPeriod: plan.plan?.period ?? null,
      structureSummary: plan.plan?.structure ?? null,
      visionStatement: v.vision_statement ?? null,
      visionGoal: v.vision_goal ?? null,
      mission: v['사명'] ?? null,
      keyIndicators: v.vision_key_indicators ?? [],
      foundingPhilosophy: v['건학이념'] ?? [],
      mottoPairs: (v['교훈_인재상'] ?? []).map((p: Record<string, string>) => ({
        motto: p['교훈'],
        talent: p['인재상'],
      })),
      talent3c: v['인재상_3C']
        ? {
            name: v['인재상_3C']['명칭'] ?? '3C형 인재',
            items: v['인재상_3C']['요소'] ?? [],
          }
        : null,
      contentHtml: existingVision[0]?.contentHtml ?? null,
    });
    await visionRepo.save(visionRow);

    // 2) 발전전략 → 전략과제 → 실행과제 → 세부과제
    const goalRepo = dataSource.getRepository(IrSpGoal);
    await goalRepo.save(
      plan.goals.map((g) =>
        goalRepo.create({ goalId: g.id, goalNo: g.no, goalName: g.name }),
      ),
    );

    const strategyRepo = dataSource.getRepository(IrSpStrategy);
    await strategyRepo.save(
      plan.strategies.map((s, index) =>
        strategyRepo.create({
          strategyId: s.id,
          goalId: s.goal_id,
          strategyName: s.name,
          displayOrder: index,
        }),
      ),
    );

    const taskRepo = dataSource.getRepository(IrSpTask);
    await taskRepo.save(
      plan.tasks.map((t, index) =>
        taskRepo.create({
          taskCode: t.code,
          taskName: t.name,
          strategyId: t.strategy_id,
          goalId: t.goal_id,
          isSpecialized: Boolean(t['특성화연계']),
          primaryDept: t['책임부서'] ?? null,
          relatedDepts: t['연관부서'] ?? [],
          displayOrder: index,
        }),
      ),
    );

    const deptNames = new Set<string>();
    for (const t of plan.tasks) {
      const primary = t['책임부서']?.trim();
      if (primary) deptNames.add(primary);
      for (const related of t['연관부서'] ?? []) {
        const name = related?.trim();
        if (name) deptNames.add(name);
      }
    }
    const deptRepo = dataSource.getRepository(IrSpDepartment);
    const sortedDepts = [...deptNames].sort((a, b) => a.localeCompare(b, 'ko'));
    for (let i = 0; i < sortedDepts.length; i++) {
      const deptName = sortedDepts[i];
      const existing = await deptRepo.findOne({ where: { deptName } });
      if (existing) continue;
      await deptRepo.save(
        deptRepo.create({ deptName, displayOrder: i }),
      );
    }

    // 세부과제는 실행과제 단위로 통째로 교체 (프로토타입 JSON이 원본)
    const subtaskRepo = dataSource.getRepository(IrSpSubtask);
    for (const t of plan.tasks) {
      await subtaskRepo.delete({ taskCode: t.code });
      const subs = t.subtasks ?? [];
      if (subs.length === 0) continue;
      await subtaskRepo.save(
        subs.map((s, index) =>
          subtaskRepo.create({
            taskCode: t.code,
            subtaskCode: s.code,
            subtaskName: s.name,
            displayOrder: index,
          }),
        ),
      );
    }

    // 3) KPI: JSON의 task_code는 접두어(A11)라 실제 실행과제 코드(A11-혁신)로 환원
    const taskCodeByPrefix = new Map<string, string>();
    for (const t of plan.tasks) {
      taskCodeByPrefix.set(t.code.split('-')[0], t.code);
    }
    const orphanKpis = plan.kpis.filter(
      (k) => !taskCodeByPrefix.has(k.task_code),
    );
    if (orphanKpis.length > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[SEED:SP] 실행과제를 찾지 못한 KPI ${orphanKpis.length}건: ${orphanKpis
          .map((k) => k.code)
          .join(', ')}`,
      );
    }

    const kpiRepo = dataSource.getRepository(IrSpKpi);
    await kpiRepo.save(
      plan.kpis.map((k, index) =>
        kpiRepo.create({
          kpiCode: k.code,
          kpiName: k.name,
          unit: k.unit ?? null,
          taskCode: taskCodeByPrefix.get(k.task_code) ?? null,
          strategyId: k.strategy_id ?? null,
          goalId: k.goal_id ?? null,
          baseline: k.baseline ?? null,
          baselineRef: k.baseline_ref ?? null,
          formula: k.formula ?? null,
          source: k.source ?? null,
          displayOrder: index,
        }),
      ),
    );

    const targetRepo = dataSource.getRepository(IrSpKpiTarget);
    for (const k of plan.kpis) {
      const targets = k.targets ?? {};
      for (const [yearKey, value] of Object.entries(targets)) {
        const year = Number(yearKey);
        if (!Number.isFinite(year)) continue;
        const existing = await targetRepo.findOne({
          where: { kpiCode: k.code, year },
        });
        await targetRepo.save(
          targetRepo.create({
            targetId: existing?.targetId,
            kpiCode: k.code,
            year,
            targetValue: value ?? null,
          }),
        );
      }
    }

    // 4) 대학알리미 비교 데이터
    const compareRepo = dataSource.getRepository(IrSpCompareData);
    let indicatorOrder = 0;
    for (const ind of compare.indicators) {
      for (const year of compare.years) {
        const payload = ind.years[String(year)];
        if (!payload) continue;
        const altValue = ind.alt?.years?.[String(year)];
        const existing = await compareRepo.findOne({
          where: { indicatorId: ind.id, year },
        });
        await compareRepo.save(
          compareRepo.create({
            compareId: existing?.compareId,
            indicatorId: ind.id,
            indicatorName: ind.name,
            src: ind.src ?? null,
            srcLabel: ind.srcLabel ?? null,
            isPrivateBasis: Boolean(ind.priv),
            year,
            payload,
            altPayload:
              ind.alt && altValue
                ? { label: ind.alt.label, value: altValue }
                : null,
            displayOrder: indicatorOrder,
          }),
        );
      }
      indicatorOrder++;
    }

    // 5) 재원 유형 기본값 (금액은 사용자가 대시보드에서 입력)
    const fundRepo = dataSource.getRepository(IrSpFundSource);
    for (let i = 0; i < SP_DEFAULT_FUND_SOURCES.length; i++) {
      const name = SP_DEFAULT_FUND_SOURCES[i];
      const existing = await fundRepo.findOne({
        where: { fundSourceName: name },
      });
      if (existing) continue;
      await fundRepo.save(
        fundRepo.create({
          fundSourceName: name,
          displayOrder: i,
          isActive: true,
        }),
      );
    }

    const summary = `중장기발전계획 시딩 완료: 발전전략 ${plan.goals.length} · 전략과제 ${plan.strategies.length} · 실행과제 ${plan.tasks.length} · KPI ${plan.kpis.length} · 비교지표 ${compare.indicators.length}`;
    await dataSource.getRepository(IrUpdateLog).save({
      updateType: 'SEED',
      logText: summary,
    });

    // eslint-disable-next-line no-console
    console.log(`[SEED:SP] ${summary}`);
  } finally {
    await app.close();
  }
}

seedStrategicPlan()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[SEED:SP] 치명적 오류:', err);
    process.exit(1);
  });
