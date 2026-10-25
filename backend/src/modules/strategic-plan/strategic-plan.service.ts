import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream, existsSync, mkdirSync, writeFileSync } from 'fs';
import { extname, join } from 'path';
import { IsNull, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import {
  IrSpCompareData,
  IrSpDepartment,
  IrSpEvaluation,
  IrSpFundSource,
  IrSpGoal,
  IrSpKpi,
  IrSpKpiResult,
  IrSpKpiTarget,
  IrSpStrategy,
  IrSpSubtask,
  IrSpTask,
  IrSpTaskBudget,
  IrSpFullRevision,
  IrSpVision,
  IrSpWriteLock,
  type SpCompareAlt,
  type SpComparePayload,
} from '../../entities';
import {
  CreateDepartmentDto,
  CreateFullRevisionDto,
  CreateFundSourceDto,
  CreateSubtaskDto,
  ReplaceSubtasksDto,
  UpsertWriteLockDto,
  UpdateDepartmentDto,
  UpdateFundSourceDto,
  UpdateGoalDto,
  UpdateKpiDto,
  UpdateStrategyDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
  UpdateVisionDto,
  UpsertBudgetDto,
  UpsertEvaluationDto,
  UpsertGoalDto,
  UpsertKpiDto,
  UpsertStrategyDto,
  UpsertTaskDto,
} from './dto/strategic-plan.dto';
import { sanitizeVisionHtml } from './sanitize-vision-html';
import {
  sanitizeIrEval,
  sanitizeKpiPoComments,
  sanitizeKpiPoEvals,
  sanitizeSurveyItems,
  sanitizeSurveyPlans,
  sanitizeTaskActivities,
} from './sanitize-evaluation';
import {
  SP_DEPT_GRADES,
  SP_IR_GRADES,
  SP_SURVEY_PLAN_GRADES,
  SP_YEARS,
} from './strategic-plan.constants';
import {
  displayGoal,
  displayKpiCode,
  displayStrategy,
  displaySubtask,
  displayTask,
  kpiSuffixOf,
  kpiTaskPrefix,
  parseKpiCode,
  parseTaskCode,
} from './sp-codes';
import { SpStructureService } from './sp-structure.service';
import { OfficeOrgService } from '../internal-org/office-org.service';
import { defaultOrgYear } from '../internal-org/org.constants';

const VISION_IMAGE_DIR = join(process.cwd(), 'uploads', 'sp-vision');
const VISION_IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};
const VISION_IMAGE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|gif|webp)$/i;

function mimeToExt(mime: string): string | null {
  if (mime === 'image/jpeg') return '.jpg';
  if (mime === 'image/png') return '.png';
  if (mime === 'image/gif') return '.gif';
  if (mime === 'image/webp') return '.webp';
  return null;
}

export interface SpSubtaskNode {
  subtaskId: number;
  subtaskCode: string;
  hangulCode: string;
  seqNo: number;
  displayCode: string;
  subtaskName: string;
  purpose: string | null;
  method: string | null;
}

export interface SpTaskNode {
  taskCode: string;
  hangulCode: string;
  displayCode: string;
  taskName: string;
  strategyId: string;
  goalId: string;
  isSpecialized: boolean;
  primaryDept: string | null;
  relatedDepts: string[];
  subtasks: SpSubtaskNode[];
  kpiCodes: string[];
}

export interface SpStrategyNode {
  strategyId: string;
  displayCode: string;
  strategyName: string;
  goalId: string;
  tasks: SpTaskNode[];
}

export interface SpGoalNode {
  goalId: string;
  displayCode: string;
  goalNo: number;
  goalName: string;
  strategies: SpStrategyNode[];
}

export interface SpKpiNode {
  kpiCode: string;
  displayCode: string;
  kpiName: string;
  unit: string | null;
  taskCode: string | null;
  strategyId: string | null;
  goalId: string | null;
  primaryDept: string | null;
  baseline: number | null;
  baselineRef: string | null;
  formula: string | null;
  source: string | null;
  targets: Record<number, number | null>;
  results: Record<number, number | null>;
}

export interface SpCompareIndicator {
  id: string;
  name: string;
  src: string | null;
  srcLabel: string | null;
  priv: boolean;
  years: Record<number, SpComparePayload>;
  alt: { label: string; years: Record<number, SpCompareAlt['value']> } | null;
}

@Injectable()
export class StrategicPlanService implements OnModuleInit {
  constructor(
    @InjectRepository(IrSpVision)
    private readonly visionRepo: Repository<IrSpVision>,
    @InjectRepository(IrSpGoal)
    private readonly goalRepo: Repository<IrSpGoal>,
    @InjectRepository(IrSpStrategy)
    private readonly strategyRepo: Repository<IrSpStrategy>,
    @InjectRepository(IrSpTask)
    private readonly taskRepo: Repository<IrSpTask>,
    @InjectRepository(IrSpSubtask)
    private readonly subtaskRepo: Repository<IrSpSubtask>,
    @InjectRepository(IrSpKpi)
    private readonly kpiRepo: Repository<IrSpKpi>,
    @InjectRepository(IrSpKpiTarget)
    private readonly targetRepo: Repository<IrSpKpiTarget>,
    @InjectRepository(IrSpKpiResult)
    private readonly resultRepo: Repository<IrSpKpiResult>,
    @InjectRepository(IrSpEvaluation)
    private readonly evaluationRepo: Repository<IrSpEvaluation>,
    @InjectRepository(IrSpCompareData)
    private readonly compareRepo: Repository<IrSpCompareData>,
    @InjectRepository(IrSpFundSource)
    private readonly fundSourceRepo: Repository<IrSpFundSource>,
    @InjectRepository(IrSpDepartment)
    private readonly departmentRepo: Repository<IrSpDepartment>,
    @InjectRepository(IrSpTaskBudget)
    private readonly budgetRepo: Repository<IrSpTaskBudget>,
    @InjectRepository(IrSpWriteLock)
    private readonly writeLockRepo: Repository<IrSpWriteLock>,
    @InjectRepository(IrSpFullRevision)
    private readonly revisionRepo: Repository<IrSpFullRevision>,
    private readonly structure: SpStructureService,
    private readonly officeOrg: OfficeOrgService,
  ) {}

  async onModuleInit() {
    try {
      await this.budgetRepo.query(`
        DO $$
        DECLARE r RECORD;
        BEGIN
          IF to_regclass('ir_sp_task_budget') IS NULL THEN
            RETURN;
          END IF;
          FOR r IN
            SELECT conname
            FROM pg_constraint
            WHERE conrelid = 'ir_sp_task_budget'::regclass
              AND contype = 'u'
              AND conname <> 'uq_sp_subtask_budget'
          LOOP
            EXECUTE format(
              'ALTER TABLE ir_sp_task_budget DROP CONSTRAINT %I',
              r.conname
            );
          END LOOP;
        END $$;
      `);
    } catch {
      // 최초 기동 등 테이블이 아직 없으면 synchronize가 생성한다.
    }
    try {
      await this.structure.migrateLegacyCodes();
    } catch {
      // 컬럼 추가 전 기동이면 synchronize 이후 다음 기동에서 처리
    }
    try {
      await this.structure.syncFundLiveIntervals();
    } catch {
      // 버전 테이블이 아직 없으면 건너뛴다.
    }
  }

  /* ── 대시보드 조회 ── */

  async getTree(year?: number) {
    const asOf = year ?? SP_YEARS[SP_YEARS.length - 1];
    const latest = year == null;
    const [vision, goals, strategies, tasks, subtasks, kpis, targets, results] =
      await Promise.all([
        this.visionRepo.find({ order: { visionId: 'ASC' }, take: 1 }),
        this.goalRepo.find({ order: { goalNo: 'ASC', goalId: 'ASC' } }),
        this.strategyRepo.find({
          order: { displayOrder: 'ASC', strategyId: 'ASC' },
        }),
        this.taskRepo.find({ order: { displayOrder: 'ASC', taskCode: 'ASC' } }),
        this.subtaskRepo.find({
          order: { displayOrder: 'ASC', subtaskId: 'ASC' },
        }),
        this.kpiRepo.find({ order: { displayOrder: 'ASC', kpiCode: 'ASC' } }),
        this.targetRepo.find(),
        this.resultRepo.find(),
      ]);

    const [goalVersions, strategyVersions, taskVersions, subtaskVersions, kpiVersions] =
      latest
        ? [null, null, null, null, null]
        : await Promise.all([
            this.structure.versionsFor('goal'),
            this.structure.versionsFor('strategy'),
            this.structure.versionsFor('task'),
            this.structure.versionsFor('subtask'),
            this.structure.versionsFor('kpi'),
          ]);

    const liveGoals = goals.filter((g) =>
      latest
        ? g.abolishedFrom == null
        : this.structure.activeInYear(
            goalVersions?.get(g.goalId),
            asOf,
            g.effectiveFrom,
            g.abolishedFrom,
          ),
    );
    const liveStrategies = strategies.filter((s) =>
      latest
        ? s.abolishedFrom == null
        : this.structure.activeInYear(
            strategyVersions?.get(s.strategyId),
            asOf,
            s.effectiveFrom,
            s.abolishedFrom,
          ),
    );
    const liveTasks = tasks.filter((t) =>
      latest
        ? t.abolishedFrom == null
        : this.structure.activeInYear(
            taskVersions?.get(t.taskCode),
            asOf,
            t.effectiveFrom,
            t.abolishedFrom,
          ),
    );
    const liveSubtasks = subtasks.filter((s) =>
      latest
        ? s.abolishedFrom == null
        : this.structure.activeInYear(
            subtaskVersions?.get(s.subtaskCode),
            asOf,
            s.effectiveFrom,
            s.abolishedFrom,
          ),
    );
    const liveKpis = kpis.filter((k) =>
      latest
        ? k.abolishedFrom == null
        : this.structure.activeInYear(
            kpiVersions?.get(k.kpiCode),
            asOf,
            k.effectiveFrom,
            k.abolishedFrom,
          ),
    );

    const officeNames = await this.officeOrg.resolveDisplayNames(
      liveTasks.flatMap((t) => [t.primaryDept, ...(t.relatedDepts ?? [])]),
      asOf,
    );
    const officeName = (value: string | null | undefined) => {
      if (!value) return null;
      return officeNames.get(value) ?? value;
    };

    const overlayGoal = async (row: IrSpGoal) => {
      const payload = year
        ? await this.structure.overlayPayload('goal', row.goalId, asOf)
        : null;
      return {
        goalId: row.goalId,
        displayCode: displayGoal(row.goalId),
        goalNo: Number(payload?.goalNo ?? row.goalNo),
        goalName: String(payload?.goalName ?? row.goalName),
      };
    };
    const overlayStrategy = async (row: IrSpStrategy) => {
      const payload = year
        ? await this.structure.overlayPayload('strategy', row.strategyId, asOf)
        : null;
      return {
        strategyId: row.strategyId,
        displayCode: displayStrategy(row.strategyId),
        strategyName: String(payload?.strategyName ?? row.strategyName),
        goalId: String(payload?.goalId ?? row.goalId),
      };
    };
    const overlayTask = async (row: IrSpTask) => {
      const payload = year
        ? await this.structure.overlayPayload('task', row.taskCode, asOf)
        : null;
      const hangul = String(payload?.hangulCode ?? row.hangulCode ?? '');
      return {
        taskCode: row.taskCode,
        hangulCode: hangul,
        displayCode: displayTask(row.taskCode, hangul),
        taskName: String(payload?.taskName ?? row.taskName),
        strategyId: String(payload?.strategyId ?? row.strategyId),
        goalId: String(payload?.goalId ?? row.goalId),
        isSpecialized: Boolean(payload?.isSpecialized ?? row.isSpecialized),
        primaryDept: officeName(
          payload?.primaryDept === undefined
            ? row.primaryDept
            : (payload.primaryDept as string | null),
        ),
        relatedDepts: (
          Array.isArray(payload?.relatedDepts)
            ? (payload.relatedDepts as string[])
            : (row.relatedDepts ?? [])
        )
          .map((d) => officeName(d) ?? d)
          .filter((d): d is string => Boolean(d)),
      };
    };
    const overlaySubtask = async (row: IrSpSubtask) => {
      const payload = year
        ? await this.structure.overlayPayload('subtask', row.subtaskCode, asOf)
        : null;
      const hangul = String(payload?.hangulCode ?? row.hangulCode ?? '');
      const seq = Number(payload?.seqNo ?? row.seqNo ?? 1);
      return {
        subtaskId: row.subtaskId,
        subtaskCode: row.subtaskCode,
        hangulCode: hangul,
        seqNo: seq,
        displayCode: displaySubtask(row.taskCode, seq, hangul),
        subtaskName: String(payload?.subtaskName ?? row.subtaskName),
        purpose:
          payload?.purpose === undefined
            ? row.purpose
            : (payload.purpose as string | null),
        method:
          payload?.method === undefined
            ? row.method
            : (payload.method as string | null),
      };
    };
    const overlayKpi = async (row: IrSpKpi) => {
      const payload = year
        ? await this.structure.overlayPayload('kpi', row.kpiCode, asOf)
        : null;
      const taskAlpha = kpiTaskPrefix(
        row.kpiCode,
        String(payload?.taskCode ?? row.taskCode ?? ''),
      );
      const suffix = payload
        ? kpiSuffixOf(
            String(payload.kpiCode ?? row.kpiCode),
            payload.suffix as string | undefined,
          )
        : kpiSuffixOf(row.kpiCode, row.suffix);
      return {
        kpiCode: row.kpiCode,
        suffix,
        displayCode: displayKpiCode(taskAlpha, suffix),
        kpiName: String(payload?.kpiName ?? row.kpiName),
        unit:
          payload?.unit === undefined ? row.unit : (payload.unit as string | null),
        taskCode: (payload?.taskCode as string | null | undefined) ?? row.taskCode,
        strategyId:
          (payload?.strategyId as string | null | undefined) ?? row.strategyId,
        goalId: (payload?.goalId as string | null | undefined) ?? row.goalId,
        primaryDept: officeName(
          payload?.primaryDept === undefined
            ? row.primaryDept
            : (payload.primaryDept as string | null),
        ),
        baseline:
          payload?.baseline === undefined
            ? row.baseline
            : (payload.baseline as number | null),
        baselineRef:
          payload?.baselineRef === undefined
            ? row.baselineRef
            : (payload.baselineRef as string | null),
        formula:
          payload?.formula === undefined
            ? row.formula
            : (payload.formula as string | null),
        source: row.source,
      };
    };

    const goalViews = await Promise.all(liveGoals.map(overlayGoal));
    const strategyViews = await Promise.all(liveStrategies.map(overlayStrategy));
    const taskViews = await Promise.all(liveTasks.map(overlayTask));
    const subtaskViews = await Promise.all(liveSubtasks.map(overlaySubtask));
    const kpiViews = await Promise.all(liveKpis.map(overlayKpi));

    const subtasksByTask = new Map<string, SpSubtaskNode[]>();
    for (const s of subtaskViews) {
      const parent = liveSubtasks.find((x) => x.subtaskId === s.subtaskId);
      const taskCode = parent?.taskCode ?? '';
      const list = subtasksByTask.get(taskCode) ?? [];
      list.push(s);
      subtasksByTask.set(taskCode, list);
    }

    const kpiCodesByTask = new Map<string, string[]>();
    for (const k of kpiViews) {
      if (!k.taskCode) continue;
      const list = kpiCodesByTask.get(k.taskCode) ?? [];
      list.push(k.kpiCode);
      kpiCodesByTask.set(k.taskCode, list);
    }
    const kpiViewByCode = new Map(kpiViews.map((k) => [k.kpiCode, k]));
    for (const list of kpiCodesByTask.values()) {
      list.sort((a, b) => {
        const da = kpiViewByCode.get(a)?.displayCode ?? a;
        const db = kpiViewByCode.get(b)?.displayCode ?? b;
        return da.localeCompare(db);
      });
    }

    const targetsByKpi = new Map<string, Record<number, number | null>>();
    for (const t of targets) {
      const map = targetsByKpi.get(t.kpiCode) ?? {};
      map[t.year] = t.targetValue;
      targetsByKpi.set(t.kpiCode, map);
    }
    const resultsByKpi = new Map<string, Record<number, number | null>>();
    for (const r of results) {
      const map = resultsByKpi.get(r.kpiCode) ?? {};
      map[r.year] = r.actualValue;
      resultsByKpi.set(r.kpiCode, map);
    }

    const taskNodes: SpTaskNode[] = taskViews.map((t) => ({
      ...t,
      subtasks: subtasksByTask.get(t.taskCode) ?? [],
      kpiCodes: kpiCodesByTask.get(t.taskCode) ?? [],
    }));

    const goalNodes: SpGoalNode[] = goalViews.map((g) => ({
      ...g,
      strategies: strategyViews
        .filter((s) => s.goalId === g.goalId)
        .map((s) => ({
          ...s,
          tasks: taskNodes.filter((t) => t.strategyId === s.strategyId),
        })),
    }));

    const kpiNodes: SpKpiNode[] = kpiViews.map((k) => ({
      ...k,
      targets: targetsByKpi.get(k.kpiCode) ?? {},
      results: resultsByKpi.get(k.kpiCode) ?? {},
    }));

    const v = vision[0] ?? null;

    return {
      years: [...SP_YEARS],
      asOfYear: latest ? null : asOf,
      scales: {
        deptGrades: [...SP_DEPT_GRADES],
        irGrades: [...SP_IR_GRADES],
        surveyPlanGrades: [...SP_SURVEY_PLAN_GRADES],
      },
      vision: v ? this.toVisionJson(v) : null,
      goals: goalNodes,
      tasks: taskNodes,
      kpis: kpiNodes,
    };
  }


  async getCompare() {
    const rows = await this.compareRepo.find({
      order: { displayOrder: 'ASC', indicatorId: 'ASC', year: 'ASC' },
    });

    const byIndicator = new Map<string, SpCompareIndicator>();
    const years = new Set<number>();
    for (const row of rows) {
      years.add(row.year);
      let ind = byIndicator.get(row.indicatorId);
      if (!ind) {
        ind = {
          id: row.indicatorId,
          name: row.indicatorName,
          src: row.src,
          srcLabel: row.srcLabel,
          priv: row.isPrivateBasis,
          years: {},
          alt: null,
        };
        byIndicator.set(row.indicatorId, ind);
      }
      ind.years[row.year] = row.payload;
      if (row.altPayload) {
        if (!ind.alt) ind.alt = { label: row.altPayload.label, years: {} };
        ind.alt.years[row.year] = row.altPayload.value;
      }
    }

    return {
      years: [...years].sort((a, b) => a - b),
      indicators: [...byIndicator.values()],
    };
  }

  async listFundSources(includeInactive = false, year?: number) {
    const rows = await this.fundSourceRepo.find({
      order: { displayOrder: 'ASC', fundSourceId: 'ASC' },
    });
    const versions =
      year != null ? await this.structure.versionsFor('fund') : null;
    const live = rows.filter((f) => {
      if (year != null) {
        return this.structure.activeInYear(
          versions?.get(String(f.fundSourceId)),
          year,
          f.effectiveFrom,
          f.abolishedFrom,
        );
      }
      if (includeInactive) return true;
      return f.abolishedFrom == null && f.isActive;
    });
    const out: Array<{
      fundSourceId: number;
      fundSourceName: string;
      displayOrder: number;
      isActive: boolean;
      effectiveFrom: number;
      abolishedFrom: number | null;
    }> = [];
    for (const row of live) {
      const payload = year
        ? await this.structure.overlayPayload(
            'fund',
            String(row.fundSourceId),
            year,
          )
        : null;
      out.push({
        fundSourceId: row.fundSourceId,
        fundSourceName: String(payload?.fundSourceName ?? row.fundSourceName),
        displayOrder: row.displayOrder,
        isActive:
          year != null
            ? this.structure.activeInYear(
                versions?.get(String(row.fundSourceId)),
                year,
                row.effectiveFrom,
                row.abolishedFrom,
              )
            : row.abolishedFrom == null && row.isActive,
        effectiveFrom: row.effectiveFrom,
        abolishedFrom: row.abolishedFrom,
      });
    }
    return out;
  }

  async listDepartments(year?: number) {
    return this.officeOrg.listSelectable(year);
  }

  /** 회원가입·회원정보 소속(부서) 드롭다운. 마스터만 읽고 자동 보강하지 않는다. */
  async listAffiliationOffices(): Promise<
    Array<{ officeCode: string; deptName: string; categoryName: string | null }>
  > {
    return this.officeOrg.listAffiliationOffices();
  }

  listEvaluations(year: number) {
    return this.evaluationRepo.find({ where: { year } });
  }

  listBudgets(year: number) {
    return this.budgetRepo.find({ where: { year } });
  }

  /* ── 자체평가 (로그인 사용자 전원) ── */

  async listWriteLocks(year: number) {
    const rows = await this.writeLockRepo.find({ where: { year } });
    return rows.map((row) => ({
      taskCode: row.taskCode,
      year: row.year,
      budgetCompleted: row.budgetCompleted,
      evalCompleted: row.evalCompleted,
    }));
  }

  async upsertWriteLock(dto: UpsertWriteLockDto, userId: string) {
    await this.assertTaskExists(dto.taskCode);
    const existing = await this.writeLockRepo.findOne({
      where: { taskCode: dto.taskCode, year: dto.year },
    });
    const row = this.writeLockRepo.create({
      ...existing,
      taskCode: dto.taskCode,
      year: dto.year,
      budgetCompleted: existing?.budgetCompleted ?? false,
      evalCompleted: existing?.evalCompleted ?? false,
      updatedBy: userId,
    });
    if (dto.kind === 'budget') {
      row.budgetCompleted = dto.isCompleted;
    } else {
      row.evalCompleted = dto.isCompleted;
    }
    const saved = await this.writeLockRepo.save(row);
    return {
      taskCode: saved.taskCode,
      year: saved.year,
      budgetCompleted: saved.budgetCompleted,
      evalCompleted: saved.evalCompleted,
    };
  }

  async listFullRevisions() {
    const rows = await this.revisionRepo.find({
      order: { year: 'DESC', revisionId: 'DESC' },
    });
    return rows.map((row) => ({
      revisionId: row.revisionId,
      year: row.year,
      snapshotYear: row.snapshotYear,
      scope: row.scope,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    }));
  }

  async createFullRevision(dto: CreateFullRevisionDto, userId: string) {
    this.structure.assertYear(dto.year);
    await this.structure.fullRevise(
      { scope: dto.scope, year: dto.year },
      userId,
    );
    const row = await this.revisionRepo.save(
      this.revisionRepo.create({
        year: dto.year,
        snapshotYear: dto.year - 1,
        scope: dto.scope,
        createdBy: userId,
      }),
    );
    return {
      revisionId: row.revisionId,
      year: row.year,
      snapshotYear: row.snapshotYear,
      scope: row.scope,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  private async assertUnlocked(
    taskCode: string,
    year: number,
    kind: 'budget' | 'eval',
  ) {
    const lock = await this.writeLockRepo.findOne({
      where: { taskCode, year },
    });
    if (!lock) return;
    if (kind === 'budget' && lock.budgetCompleted) {
      throw new BadRequestException(
        '작성완료된 예결산은 수정할 수 없습니다. 수정 버튼을 눌러 주세요.',
      );
    }
    if (kind === 'eval' && lock.evalCompleted) {
      throw new BadRequestException(
        '작성완료된 자체평가는 수정할 수 없습니다. 수정 버튼을 눌러 주세요.',
      );
    }
  }

  async upsertEvaluation(dto: UpsertEvaluationDto, userId: string) {
    const onlyIr =
      dto.irEval !== undefined &&
      [
        'deptSummary',
        'deptAnalysis',
        'deptGrade',
        'deptImprovement',
        'irGrade',
        'irFeedback',
        'surveyGrade',
        'surveyAnalysis',
        'surveyFeedback',
        'budgetAdequacy',
        'budgetAdequacyGrade',
        'processAdequacy',
        'processAdequacyGrade',
        'kpiAdequacy',
        'kpiAdequacyGrade',
        'taskActivities',
        'kpiPoEvals',
        'kpiPoComments',
        'surveyItems',
        'surveyPlans',
        'surveyItemsNa',
        'surveyPlansNa',
      ].every((key) => dto[key as keyof UpsertEvaluationDto] === undefined);
    if (!onlyIr) {
      await this.assertUnlocked(dto.taskCode, dto.year, 'eval');
    }
    await this.assertTaskExists(dto.taskCode);
    this.assertGrade(dto.deptGrade, SP_DEPT_GRADES, '부서 자체점검');
    this.assertGrade(dto.irGrade, SP_IR_GRADES, 'IR센터 평가');
    this.assertGrade(dto.surveyGrade, SP_DEPT_GRADES, '만족도조사 자체점검');
    this.assertGrade(dto.budgetAdequacyGrade, SP_DEPT_GRADES, '예결산의 적절성');
    this.assertGrade(dto.processAdequacyGrade, SP_DEPT_GRADES, '절차상 적절성');
    this.assertGrade(dto.kpiAdequacyGrade, SP_DEPT_GRADES, '성과지표 적절성');

    const existing = await this.evaluationRepo.findOne({
      where: { taskCode: dto.taskCode, year: dto.year },
    });
    const row = this.evaluationRepo.create({
      ...existing,
      taskCode: dto.taskCode,
      year: dto.year,
      updatedBy: userId,
    });
    for (const key of [
      'deptSummary',
      'deptAnalysis',
      'deptGrade',
      'deptImprovement',
      'irGrade',
      'irFeedback',
      'surveyGrade',
      'surveyAnalysis',
      'surveyFeedback',
      'budgetAdequacy',
      'budgetAdequacyGrade',
      'processAdequacy',
      'processAdequacyGrade',
      'kpiAdequacy',
      'kpiAdequacyGrade',
    ] as const) {
      if (dto[key] !== undefined) {
        row[key] = this.emptyToNull(dto[key]);
      }
    }
    if (dto.taskActivities !== undefined) {
      row.taskActivities = sanitizeTaskActivities(dto.taskActivities);
    }
    if (dto.kpiPoEvals !== undefined) {
      row.kpiPoEvals = sanitizeKpiPoEvals(dto.kpiPoEvals);
    }
    if (dto.kpiPoComments !== undefined) {
      row.kpiPoComments = sanitizeKpiPoComments(dto.kpiPoComments);
    }
    if (dto.surveyItems !== undefined) {
      row.surveyItems = sanitizeSurveyItems(dto.surveyItems);
    }
    if (dto.surveyPlans !== undefined) {
      row.surveyPlans = sanitizeSurveyPlans(dto.surveyPlans);
    }
    if (dto.surveyItemsNa !== undefined) {
      row.surveyItemsNa = Boolean(dto.surveyItemsNa);
    }
    if (dto.surveyPlansNa !== undefined) {
      row.surveyPlansNa = Boolean(dto.surveyPlansNa);
    }
    if (dto.irEval !== undefined) {
      row.irEval = sanitizeIrEval(dto.irEval);
    }
    return this.evaluationRepo.save(row);
  }

  /* ── 예산·결산 (로그인 사용자 전원) ── */

  async upsertBudget(dto: UpsertBudgetDto, userId: string) {
    await this.assertUnlocked(dto.taskCode, dto.year, 'budget');
    await this.assertBudgetUnit(dto.taskCode, dto.subtaskCode);
    const fund = await this.fundSourceRepo.findOne({
      where: { fundSourceId: dto.fundSourceId },
    });
    if (!fund) {
      throw new NotFoundException('재원 유형을 찾을 수 없습니다.');
    }
    if (
      !(await this.structure.isLineageActiveAt(
        'fund',
        String(fund.fundSourceId),
        dto.year,
        fund.effectiveFrom,
        fund.abolishedFrom,
      ))
    ) {
      throw new BadRequestException(
        `「${fund.fundSourceName}」은 ${dto.year}학년도에 사용할 수 없는 재원입니다.`,
      );
    }

    const existing = await this.budgetRepo.findOne({
      where: {
        taskCode: dto.taskCode,
        subtaskCode: dto.subtaskCode,
        year: dto.year,
        fundSourceId: dto.fundSourceId,
      },
    });
    const row = this.budgetRepo.create({
      ...existing,
      taskCode: dto.taskCode,
      subtaskCode: dto.subtaskCode,
      year: dto.year,
      fundSourceId: dto.fundSourceId,
      updatedBy: userId,
    });
    if (dto.budgetAmount !== undefined) {
      row.budgetAmount = dto.budgetAmount ?? null;
    }
    if (dto.settlementAmount !== undefined) {
      row.settlementAmount = dto.settlementAmount ?? null;
    }

    // 두 값이 모두 비면 행을 남기지 않는다.
    if (
      row.budgetAmount === null &&
      row.settlementAmount === null &&
      existing
    ) {
      await this.budgetRepo.delete(existing.budgetId);
      return {
        taskCode: dto.taskCode,
        subtaskCode: dto.subtaskCode,
        year: dto.year,
        fundSourceId: dto.fundSourceId,
        budgetAmount: null,
        settlementAmount: null,
      };
    }
    return this.budgetRepo.save(row);
  }

  /* ── 관리자: 체계 CRUD ── */

  listGoals() {
    return this.goalRepo.find({ order: { goalNo: 'ASC', goalId: 'ASC' } });
  }

  async createGoal(dto: UpsertGoalDto, userId: string) {
    return this.structure.createGoal(
      { alphaCode: dto.goalId, name: dto.goalName, year: dto.year },
      userId,
    );
  }

  async updateGoal(goalId: string, dto: UpdateGoalDto, userId: string) {
    return this.structure.updateNode(
      {
        kind: 'goal',
        lineageId: goalId,
        year: dto.year,
        patch: { goalName: dto.goalName },
      },
      userId,
    );
  }

  async deleteGoal(goalId: string, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'goal', lineageId: goalId, year },
      userId,
    );
  }

  async createStrategy(dto: UpsertStrategyDto, userId: string) {
    return this.structure.createStrategy(
      {
        alphaCode: dto.strategyId,
        goalId: dto.goalId,
        name: dto.strategyName,
        year: dto.year,
      },
      userId,
    );
  }

  async updateStrategy(
    strategyId: string,
    dto: UpdateStrategyDto,
    userId: string,
  ) {
    return this.structure.updateNode(
      {
        kind: 'strategy',
        lineageId: strategyId,
        year: dto.year,
        patch: { strategyName: dto.strategyName },
      },
      userId,
    );
  }

  async deleteStrategy(strategyId: string, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'strategy', lineageId: strategyId, year },
      userId,
    );
  }

  async createTask(dto: UpsertTaskDto, userId: string) {
    const parsed = parseTaskCode(dto.taskCode);
    return this.structure.createTask(
      {
        alphaCode: parsed.alphaCode,
        hangulCode: dto.hangulCode || parsed.hangulCode,
        name: dto.taskName,
        strategyId: dto.strategyId,
        year: dto.year,
        isSpecialized: dto.isSpecialized,
        primaryDept:
          (await this.toOfficeCode(dto.primaryDept, dto.year)) ?? undefined,
      },
      userId,
    );
  }

  async updateTask(taskCode: string, dto: UpdateTaskDto, userId: string) {
    const patch: Record<string, unknown> = {};
    if (dto.taskName !== undefined) patch.taskName = dto.taskName;
    if (dto.hangulCode !== undefined) patch.hangulCode = dto.hangulCode;
    if (dto.isSpecialized !== undefined) patch.isSpecialized = dto.isSpecialized;
    if (dto.primaryDept !== undefined) {
      patch.primaryDept = await this.toOfficeCode(dto.primaryDept, dto.year);
    }
    if (dto.relatedDepts !== undefined) {
      const codes: string[] = [];
      for (const name of dto.relatedDepts) {
        const code = await this.toOfficeCode(name, dto.year);
        if (code) codes.push(code);
      }
      patch.relatedDepts = codes;
    }
    return this.structure.updateNode(
      { kind: 'task', lineageId: taskCode, year: dto.year, patch },
      userId,
    );
  }

  async deleteTask(taskCode: string, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'task', lineageId: taskCode, year },
      userId,
    );
  }

  async createSubtask(dto: CreateSubtaskDto, userId: string) {
    return this.structure.createSubtask(
      {
        taskCode: dto.taskCode,
        hangulCode: dto.hangulCode ?? '',
        seqNo: dto.seqNo,
        name: dto.subtaskName,
        purpose: dto.purpose,
        method: dto.method,
        year: dto.year,
      },
      userId,
    );
  }

  async updateSubtask(
    subtaskCode: string,
    dto: UpdateSubtaskDto,
    userId: string,
  ) {
    return this.structure.updateNode(
      {
        kind: 'subtask',
        lineageId: subtaskCode,
        year: dto.year,
        patch: {
          subtaskName: dto.subtaskName,
          hangulCode: dto.hangulCode,
          purpose: dto.purpose,
          method: dto.method,
        },
      },
      userId,
    );
  }

  async deleteSubtask(subtaskCode: string, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'subtask', lineageId: subtaskCode, year },
      userId,
    );
  }

  async replaceSubtasks(taskCode: string, dto: ReplaceSubtasksDto) {
    await this.assertTaskExists(taskCode);
    const seen = new Set<string>();
    for (const s of dto.subtasks) {
      if (seen.has(s.subtaskCode)) {
        throw new BadRequestException(
          `세부과제 코드가 중복됩니다: ${s.subtaskCode}`,
        );
      }
      seen.add(s.subtaskCode);
    }
    await this.subtaskRepo.delete({ taskCode });
    const kept = new Set(dto.subtasks.map((s) => s.subtaskCode));
    const budgets = await this.budgetRepo.find({ where: { taskCode } });
    const staleIds = budgets
      .filter((b) => b.subtaskCode && !kept.has(b.subtaskCode))
      .map((b) => b.budgetId);
    if (staleIds.length > 0) {
      await this.budgetRepo.delete(staleIds);
    }
    if (dto.subtasks.length === 0) return [];
    return this.subtaskRepo.save(
      dto.subtasks.map((s, index) =>
        this.subtaskRepo.create({
          taskCode,
          subtaskCode: s.subtaskCode,
          subtaskName: s.subtaskName,
          displayOrder: index,
        }),
      ),
    );
  }

  /* ── 관리자: KPI ── */

  async createKpi(dto: UpsertKpiDto, userId: string) {
    if (!dto.taskCode) {
      throw new BadRequestException('KPI는 실행과제에 묶여야 합니다.');
    }
    const parsed = parseKpiCode(dto.kpiCode);
    const row = await this.structure.createKpi(
      {
        kpiCode: parsed.alphaCode,
        taskCode: dto.taskCode,
        name: dto.kpiName,
        year: dto.year,
        unit: dto.unit,
        primaryDept: dto.primaryDept,
      },
      userId,
    );
    if (
      dto.baseline !== undefined ||
      dto.baselineRef !== undefined ||
      dto.formula !== undefined
    ) {
      await this.structure.updateNode(
        {
          kind: 'kpi',
          lineageId: row.kpiCode,
          year: dto.year,
          patch: {
            baseline: dto.baseline,
            baselineRef: dto.baselineRef,
            formula: dto.formula,
          },
        },
        userId,
      );
    }
    return row;
  }

  async updateKpi(kpiCode: string, dto: UpdateKpiDto, userId: string) {
    const patch: Record<string, unknown> = {};
    if (dto.kpiName !== undefined) patch.kpiName = dto.kpiName;
    if (dto.unit !== undefined) patch.unit = dto.unit;
    if (dto.primaryDept !== undefined) patch.primaryDept = dto.primaryDept;
    if (dto.baseline !== undefined) patch.baseline = dto.baseline;
    if (dto.baselineRef !== undefined) patch.baselineRef = dto.baselineRef;
    if (dto.formula !== undefined) patch.formula = dto.formula;
    if (dto.suffix !== undefined) patch.suffix = dto.suffix;
    return this.structure.updateNode(
      { kind: 'kpi', lineageId: kpiCode, year: dto.year, patch },
      userId,
    );
  }

  async deleteKpi(kpiCode: string, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'kpi', lineageId: kpiCode, year },
      userId,
    );
  }

  listChanges() {
    return this.structure.listChanges();
  }

  rollbackChange(logId: number, userId: string) {
    return this.structure.rollback(logId, userId);
  }

  async setKpiTarget(kpiCode: string, year: number, value: number | null) {
    await this.assertKpiExists(kpiCode);
    const existing = await this.targetRepo.findOne({
      where: { kpiCode, year },
    });
    if (value === null || value === undefined) {
      if (existing) await this.targetRepo.delete(existing.targetId);
      return { kpiCode, year, targetValue: null };
    }
    return this.targetRepo.save(
      this.targetRepo.create({
        targetId: existing?.targetId,
        kpiCode,
        year,
        targetValue: value,
      }),
    );
  }

  async setKpiResult(
    kpiCode: string,
    year: number,
    value: number | null,
    userId: string,
  ) {
    await this.assertKpiExists(kpiCode);
    const existing = await this.resultRepo.findOne({
      where: { kpiCode, year },
    });
    if (value === null || value === undefined) {
      if (existing) await this.resultRepo.delete(existing.resultId);
      return { kpiCode, year, actualValue: null };
    }
    return this.resultRepo.save(
      this.resultRepo.create({
        resultId: existing?.resultId,
        kpiCode,
        year,
        actualValue: value,
        updatedBy: userId,
      }),
    );
  }

  /* ── 관리자: 재원 유형 ── */

  async createFundSource(dto: CreateFundSourceDto, userId: string) {
    return this.structure.createFund(
      {
        name: dto.fundSourceName,
        year: dto.year,
        displayOrder: dto.displayOrder,
      },
      userId,
    );
  }

  async updateFundSource(
    fundSourceId: number,
    dto: UpdateFundSourceDto,
    userId: string,
  ) {
    if (dto.displayOrder !== undefined || dto.isActive !== undefined) {
      const fund = await this.fundSourceRepo.findOne({
        where: { fundSourceId },
      });
      if (!fund) throw new NotFoundException('재원 유형을 찾을 수 없습니다.');
      if (dto.displayOrder !== undefined) fund.displayOrder = dto.displayOrder;
      if (dto.isActive !== undefined) fund.isActive = dto.isActive;
      await this.fundSourceRepo.save(fund);
    }
    if (dto.fundSourceName !== undefined) {
      if (dto.year == null) {
        throw new BadRequestException('재원 이름 변경 시 적용 학년도를 지정해 주세요.');
      }
      return this.structure.updateNode(
        {
          kind: 'fund',
          lineageId: String(fundSourceId),
          year: dto.year,
          patch: { fundSourceName: dto.fundSourceName },
        },
        userId,
      );
    }
    return this.fundSourceRepo.findOne({ where: { fundSourceId } });
  }

  async deleteFundSource(fundSourceId: number, year: number, userId: string) {
    return this.structure.abolishNode(
      { kind: 'fund', lineageId: String(fundSourceId), year },
      userId,
    );
  }

  /* ── 관리자: 부서 ── */

  async createDepartment(dto: CreateDepartmentDto) {
    return this.officeOrg.createOffice({
      deptName: dto.deptName,
      year: defaultOrgYear(),
      isCategory: false,
      displayOrder: dto.displayOrder,
    });
  }

  async updateDepartment(deptId: number, dto: UpdateDepartmentDto) {
    return this.officeOrg.updateOffice(deptId, {
      deptName: dto.deptName,
      displayOrder: dto.displayOrder,
      year: defaultOrgYear(),
    });
  }

  async deleteDepartment(deptId: number) {
    return this.officeOrg.abolishOffice(deptId, defaultOrgYear());
  }

  /* ── 관리자: 비전·비교 ── */

  async updateVision(dto: UpdateVisionDto) {
    const rows = await this.visionRepo.find({
      order: { visionId: 'ASC' },
      take: 1,
    });
    const vision = rows[0] ?? this.visionRepo.create({});
    for (const key of [
      'officialName',
      'planPeriod',
      'structureSummary',
      'visionStatement',
      'visionGoal',
      'mission',
    ] as const) {
      if (dto[key] !== undefined) vision[key] = this.emptyToNull(dto[key]);
    }
    if (dto.keyIndicators !== undefined) {
      vision.keyIndicators = dto.keyIndicators;
    }
    if (dto.foundingPhilosophy !== undefined) {
      vision.foundingPhilosophy = dto.foundingPhilosophy;
    }
    if (dto.mottoPairs !== undefined) {
      vision.mottoPairs = dto.mottoPairs.map((p) => ({
        motto: p.motto.trim(),
        talent: p.talent.trim(),
      }));
    }
    if (dto.talent3c !== undefined) {
      vision.talent3c = dto.talent3c
        ? {
            name: dto.talent3c.name.trim() || '3C형 인재',
            items: dto.talent3c.items.map((item) => item.trim()).filter(Boolean),
          }
        : null;
    }
    if (dto.contentHtml !== undefined) {
      const cleaned = sanitizeVisionHtml(dto.contentHtml ?? '');
      vision.contentHtml = cleaned.trim() ? cleaned : null;
    }
    const saved = await this.visionRepo.save(vision);
    return this.toVisionJson(saved);
  }

  saveVisionImage(file: Express.Multer.File) {
    if (!file?.buffer?.length) {
      throw new BadRequestException('업로드된 파일이 없습니다.');
    }
    const ext = VISION_IMAGE_MIME[extname(file.originalname).toLowerCase()]
      ? extname(file.originalname).toLowerCase()
      : mimeToExt(file.mimetype);
    if (!ext) {
      throw new BadRequestException(
        'jpeg, png, gif, webp 이미지만 올릴 수 있습니다.',
      );
    }
    mkdirSync(VISION_IMAGE_DIR, { recursive: true });
    const filename = `${randomUUID()}${ext}`;
    writeFileSync(join(VISION_IMAGE_DIR, filename), file.buffer);
    return {
      filename,
      url: `/strategic-plan/vision/images/${filename}`,
    };
  }

  getVisionImage(filename: string) {
    if (!VISION_IMAGE_NAME_RE.test(filename)) {
      throw new BadRequestException('잘못된 파일 이름입니다.');
    }
    const filePath = join(VISION_IMAGE_DIR, filename);
    if (!existsSync(filePath)) {
      throw new NotFoundException('이미지를 찾을 수 없습니다.');
    }
    const contentType =
      VISION_IMAGE_MIME[extname(filename).toLowerCase()] ?? 'application/octet-stream';
    return { stream: createReadStream(filePath), contentType };
  }

  private toVisionJson(v: IrSpVision) {
    return {
      officialName: v.officialName,
      planPeriod: v.planPeriod,
      structureSummary: v.structureSummary,
      visionStatement: v.visionStatement,
      visionGoal: v.visionGoal,
      mission: v.mission,
      keyIndicators: v.keyIndicators ?? [],
      foundingPhilosophy: v.foundingPhilosophy ?? [],
      mottoPairs: v.mottoPairs ?? [],
      talent3c: v.talent3c,
      contentHtml: v.contentHtml ?? null,
    };
  }

  async replaceCompare(payload: {
    years: number[];
    indicators: SpCompareIndicator[];
  }) {
    if (!payload || !Array.isArray(payload.indicators)) {
      throw new BadRequestException(
        'indicators 배열이 있는 JSON을 넣어 주세요.',
      );
    }
    const rows: IrSpCompareData[] = [];
    payload.indicators.forEach((ind, order) => {
      if (!ind?.id || !ind?.name || !ind?.years) {
        throw new BadRequestException(
          '각 지표에는 id, name, years가 있어야 합니다.',
        );
      }
      for (const [yearKey, value] of Object.entries(ind.years)) {
        const year = Number(yearKey);
        if (!Number.isFinite(year)) continue;
        const altValue = ind.alt?.years?.[year];
        rows.push(
          this.compareRepo.create({
            indicatorId: ind.id,
            indicatorName: ind.name,
            src: ind.src ?? null,
            srcLabel: ind.srcLabel ?? null,
            isPrivateBasis: Boolean(ind.priv),
            year,
            payload: value,
            altPayload:
              ind.alt && altValue
                ? { label: ind.alt.label, value: altValue }
                : null,
            displayOrder: order,
          }),
        );
      }
    });
    await this.compareRepo.clear();
    if (rows.length > 0) await this.compareRepo.save(rows);
    return this.getCompare();
  }

  /* ── helpers ── */

  private emptyToNull(value: string | null | undefined): string | null {
    if (value === null || value === undefined) return null;
    const trimmed = value.trim();
    return trimmed === '' ? null : trimmed;
  }

  private assertGrade(
    value: string | null | undefined,
    allowed: readonly string[],
    label: string,
  ) {
    if (value === undefined || value === null || value.trim() === '') return;
    if (!allowed.includes(value)) {
      throw new BadRequestException(
        `${label} 등급은 ${allowed.join(' / ')} 중 하나여야 합니다.`,
      );
    }
  }

  private async assertGoalExists(goalId: string) {
    const exists = await this.goalRepo.count({ where: { goalId } });
    if (!exists) throw new NotFoundException('발전전략을 찾을 수 없습니다.');
  }

  private async assertTaskExists(taskCode: string) {
    const exists = await this.taskRepo.count({ where: { taskCode } });
    if (!exists) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
  }

  private async assertBudgetUnit(taskCode: string, subtaskCode: string) {
    await this.assertTaskExists(taskCode);
    const subCount = await this.subtaskRepo.count({ where: { taskCode } });
    if (subCount === 0) {
      if (subtaskCode !== taskCode) {
        throw new NotFoundException('TASK를 찾을 수 없습니다.');
      }
      return;
    }
    const sub = await this.subtaskRepo.findOne({
      where: { taskCode, subtaskCode },
    });
    if (!sub) throw new NotFoundException('TASK를 찾을 수 없습니다.');
  }

  private async assertKpiExists(kpiCode: string) {
    const exists = await this.kpiRepo.count({ where: { kpiCode } });
    if (!exists) throw new NotFoundException('KPI를 찾을 수 없습니다.');
  }

  private collectTaskDeptNames(tasks: IrSpTask[]): string[] {
    const names = new Set<string>();
    for (const task of tasks) {
      const primary = task.primaryDept?.trim();
      if (primary) names.add(primary);
      for (const related of task.relatedDepts ?? []) {
        const name = related.trim();
        if (name) names.add(name);
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  /** 실행과제에 남은 텍스트 부서명을 마스터에 넣어 드롭다운이 비지 않게 한다. */
  private async ensureDepartmentsFromTasks() {
    const [tasks, existing] = await Promise.all([
      this.taskRepo.find(),
      this.departmentRepo.find(),
    ]);
    const have = new Set(existing.map((d) => d.deptName));
    const missing = this.collectTaskDeptNames(tasks).filter(
      (name) => !have.has(name),
    );
    if (missing.length === 0) return;
    const maxOrder = existing.reduce((m, d) => Math.max(m, d.displayOrder), -1);
    await this.departmentRepo.save(
      missing.map((deptName, i) =>
        this.departmentRepo.create({
          deptName,
          displayOrder: maxOrder + 1 + i,
        }),
      ),
    );
  }

  private async rewriteDeptOnTasks(
    oldName: string,
    newName: string | null,
  ) {
    const tasks = await this.taskRepo.find();
    const changed: IrSpTask[] = [];
    for (const task of tasks) {
      let dirty = false;
      if (task.primaryDept === oldName) {
        task.primaryDept = newName;
        dirty = true;
      }
      const related = task.relatedDepts ?? [];
      if (related.includes(oldName)) {
        const next = newName
          ? related.map((d) => (d === oldName ? newName : d))
          : related.filter((d) => d !== oldName);
        task.relatedDepts = [...new Set(next.filter((d) => d.trim() !== ''))];
        dirty = true;
      }
      if (dirty) changed.push(task);
    }
    if (changed.length > 0) await this.taskRepo.save(changed);
  }

  private async toOfficeCode(
    value: string | null | undefined,
    year: number,
  ): Promise<string | null> {
    if (!value?.trim()) return null;
    const trimmed = value.trim();
    const rows = await this.officeOrg.listSelectable(year);
    const byCode = rows.find((r) => r.officeCode === trimmed);
    if (byCode) return byCode.officeCode;
    const byName = rows.find((r) => r.deptName === trimmed);
    if (byName) return byName.officeCode;
    throw new BadRequestException(
      `등록되지 않은 부서입니다: ${trimmed}. 조직관리에서 먼저 추가해 주세요.`,
    );
  }

  private async normalizeTaskDepts(
    primaryDept: string | null | undefined,
    relatedDepts: string[],
  ) {
    const primary = this.emptyToNull(primaryDept ?? null);
    const related = [
      ...new Set(
        relatedDepts
          .map((d) => d.trim())
          .filter((d) => d !== '' && d !== primary),
      ),
    ];
    const names = primary ? [primary, ...related] : related;
    if (names.length === 0) return related;
    const found = await this.departmentRepo.find();
    const known = new Set(found.map((d) => d.deptName));
    const unknown = names.filter((n) => !known.has(n));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `등록되지 않은 부서입니다: ${unknown.join(', ')}. 부서관리에서 먼저 추가해 주세요.`,
      );
    }
    return related;
  }
}
