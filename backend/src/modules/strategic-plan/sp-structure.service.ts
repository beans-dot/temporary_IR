import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  IrSpChangeLog,
  IrSpFundSource,
  IrSpGoal,
  IrSpItemVersion,
  IrSpKpi,
  IrSpStrategy,
  IrSpSubtask,
  IrSpTask,
  IrSpTaskBudget,
  IrSpEvaluation,
} from '../../entities';
import {
  changeTypeLabel,
  displayGoal,
  displayKpiCode,
  displayStrategy,
  displaySubtask,
  displayTask,
  isGoalAlpha,
  isStrategyAlpha,
  kindLabel,
  kpiSuffixOf,
  kpiTaskPrefix,
  parseKpiCode,
  parseSubtaskCode,
  parseTaskCode,
  type SpChangeType,
  type SpNodeKind,
} from './sp-codes';
import { SP_MIN_YEAR, SP_YEARS } from './strategic-plan.constants';

function activeAt(
  effectiveFrom: number,
  abolishedFrom: number | null,
  year: number,
) {
  return effectiveFrom <= year && (abolishedFrom == null || year < abolishedFrom);
}

function versionCovers(
  from: number,
  to: number | null,
  year: number,
) {
  return from <= year && (to == null || year <= to);
}

@Injectable()
export class SpStructureService {
  constructor(
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
    @InjectRepository(IrSpFundSource)
    private readonly fundRepo: Repository<IrSpFundSource>,
    @InjectRepository(IrSpItemVersion)
    private readonly versionRepo: Repository<IrSpItemVersion>,
    @InjectRepository(IrSpChangeLog)
    private readonly logRepo: Repository<IrSpChangeLog>,
    @InjectRepository(IrSpEvaluation)
    private readonly evaluationRepo: Repository<IrSpEvaluation>,
    @InjectRepository(IrSpTaskBudget)
    private readonly budgetRepo: Repository<IrSpTaskBudget>,
  ) {}

  async migrateLegacyCodes() {
    const tasks = await this.taskRepo.find();
    const taskMap = new Map<string, string>();
    for (const task of tasks) {
      const parsed = parseTaskCode(task.taskCode);
      if (parsed.alphaCode === task.taskCode && (task.hangulCode ?? '') !== '') {
        continue;
      }
      if (parsed.alphaCode === task.taskCode) continue;
      if (taskMap.has(task.taskCode)) continue;
      const taken = await this.taskRepo.findOne({
        where: { taskCode: parsed.alphaCode },
      });
      if (taken && taken.taskCode !== task.taskCode) continue;
      taskMap.set(task.taskCode, parsed.alphaCode);
      await this.taskRepo.query(
        `UPDATE ir_sp_task SET task_code = $1, hangul_code = $2 WHERE task_code = $3`,
        [parsed.alphaCode, parsed.hangulCode, task.taskCode],
      );
    }

    const renameTaskRefs = async (from: string, to: string) => {
      await this.taskRepo.query(
        `UPDATE ir_sp_subtask SET task_code = $1 WHERE task_code = $2`,
        [to, from],
      );
      await this.taskRepo.query(
        `UPDATE ir_sp_kpi SET task_code = $1 WHERE task_code = $2`,
        [to, from],
      );
      await this.taskRepo.query(
        `UPDATE ir_sp_evaluation SET task_code = $1 WHERE task_code = $2`,
        [to, from],
      );
      await this.taskRepo.query(
        `UPDATE ir_sp_task_budget SET task_code = $1 WHERE task_code = $2`,
        [to, from],
      );
    };
    for (const [from, to] of taskMap) {
      await renameTaskRefs(from, to);
    }

    const subtasks = await this.subtaskRepo.find();
    const subMap = new Map<string, { from: string; to: string; hangul: string; seq: number }>();
    for (const sub of subtasks) {
      const parsed = parseSubtaskCode(sub.subtaskCode);
      if (parsed.alphaCode === sub.subtaskCode && (sub.hangulCode ?? '') !== '') {
        continue;
      }
      if (parsed.alphaCode === sub.subtaskCode && parsed.seq > 0) {
        if (!sub.seqNo) {
          await this.subtaskRepo.update(sub.subtaskId, { seqNo: parsed.seq });
        }
        continue;
      }
      subMap.set(`${sub.taskCode}::${sub.subtaskCode}`, {
        from: sub.subtaskCode,
        to: parsed.alphaCode,
        hangul: parsed.hangulCode,
        seq: parsed.seq,
      });
      await this.subtaskRepo.update(sub.subtaskId, {
        subtaskCode: parsed.alphaCode,
        hangulCode: parsed.hangulCode,
        seqNo: parsed.seq || sub.seqNo || 1,
      });
    }

    const evals = await this.evaluationRepo.find();
    for (const row of evals) {
      if (!row.taskActivities) continue;
      let changed = false;
      const next: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row.taskActivities)) {
        const parsed = parseSubtaskCode(key);
        const nextKey = parsed.alphaCode || key;
        if (nextKey !== key) changed = true;
        next[nextKey] = value;
      }
      if (changed) {
        await this.evaluationRepo.update(row.evaluationId, {
          taskActivities: next as IrSpEvaluation['taskActivities'],
        });
      }
    }

    const budgets = await this.budgetRepo.find();
    for (const row of budgets) {
      const parsed = parseSubtaskCode(row.subtaskCode);
      if (parsed.alphaCode && parsed.alphaCode !== row.subtaskCode) {
        await this.budgetRepo.update(row.budgetId, {
          subtaskCode: parsed.alphaCode,
        });
      }
    }

    const kpis = await this.kpiRepo.find();
    for (const kpi of kpis) {
      if (kpi.primaryDept) continue;
      if (!kpi.taskCode) continue;
      const task = await this.taskRepo.findOne({
        where: { taskCode: kpi.taskCode },
      });
      if (task?.primaryDept) {
        await this.kpiRepo.update(kpi.kpiCode, {
          primaryDept: task.primaryDept,
        });
      }
    }

    const allKpis = await this.kpiRepo.find();
    for (const kpi of allKpis) {
      const suffix = kpiSuffixOf(kpi.kpiCode, kpi.suffix);
      if (kpi.suffix !== suffix) {
        await this.kpiRepo.update(kpi.kpiCode, { suffix });
      }
    }
  }

  private kpiDisplay(row: IrSpKpi, payload?: Record<string, unknown> | null) {
    const taskAlpha = kpiTaskPrefix(
      row.kpiCode,
      String(payload?.taskCode ?? row.taskCode ?? ''),
    );
    const suffix = kpiSuffixOf(
      row.kpiCode,
      String((payload?.suffix as string | undefined) ?? row.suffix ?? ''),
    );
    return displayKpiCode(taskAlpha, suffix);
  }

  isActiveAt(effectiveFrom: number, abolishedFrom: number | null, year: number) {
    return activeAt(effectiveFrom, abolishedFrom, year);
  }

  /** 버전 이력이 있으면 그 구간으로, 없으면 live effective/abolished로 판단한다. */
  activeInYear(
    versions: IrSpItemVersion[] | undefined,
    year: number,
    fallbackFrom: number,
    fallbackAbolished: number | null,
  ) {
    if (!versions || versions.length === 0) {
      return activeAt(fallbackFrom, fallbackAbolished, year);
    }
    return versions.some((row) =>
      versionCovers(row.effectiveFrom, row.effectiveTo, year),
    );
  }

  async versionsFor(kind: SpNodeKind): Promise<Map<string, IrSpItemVersion[]>> {
    const rows = await this.versionRepo.find({ where: { kind } });
    const map = new Map<string, IrSpItemVersion[]>();
    for (const row of rows) {
      const list = map.get(row.lineageId) ?? [];
      list.push(row);
      map.set(row.lineageId, list);
    }
    return map;
  }

  async isLineageActiveAt(
    kind: SpNodeKind,
    lineageId: string,
    year: number,
    fallbackFrom: number,
    fallbackAbolished: number | null,
  ) {
    const rows = await this.versionRepo.find({ where: { kind, lineageId } });
    return this.activeInYear(rows, year, fallbackFrom, fallbackAbolished);
  }

  /** 폐지 후 같은 이름으로 다시 신설된 재원의 live 구간을 열린 버전에 맞춘다. */
  async syncFundLiveIntervals() {
    const funds = await this.fundRepo.find();
    const versions = await this.versionsFor('fund');
    for (const fund of funds) {
      const rows = versions.get(String(fund.fundSourceId)) ?? [];
      const open = rows
        .filter((row) => row.effectiveTo == null)
        .sort((a, b) => b.effectiveFrom - a.effectiveFrom)[0];
      if (!open) continue;
      if (
        fund.effectiveFrom === open.effectiveFrom &&
        fund.abolishedFrom == null &&
        fund.isActive
      ) {
        continue;
      }
      fund.effectiveFrom = open.effectiveFrom;
      fund.abolishedFrom = null;
      fund.isActive = true;
      await this.fundRepo.save(fund);
    }
  }

  async overlayPayload(
    kind: SpNodeKind,
    lineageId: string,
    year: number,
  ): Promise<Record<string, unknown> | null> {
    const rows = await this.versionRepo.find({
      where: { kind, lineageId },
      order: { effectiveFrom: 'DESC', versionId: 'DESC' },
    });
    const hit = rows.find((row) =>
      versionCovers(row.effectiveFrom, row.effectiveTo, year),
    );
    return hit?.payload ?? null;
  }

  /**
   * 선택한 학년도 화면에만 payload를 얹는다. live 행과 다른 연도는 그대로 둔다.
   * 중간 개정처럼 한 해의 이름·책임부서만 다를 때 쓴다.
   */
  async pinYearPayload(input: {
    kind: SpNodeKind;
    lineageId: string;
    displayCode: string;
    year: number;
    live: Record<string, unknown>;
    patch: Record<string, unknown>;
    userId: string;
  }) {
    this.assertYear(input.year);
    const rows = await this.versionRepo.find({
      where: { kind: input.kind, lineageId: input.lineageId },
      order: { effectiveFrom: 'DESC', versionId: 'DESC' },
    });
    const covering = rows.find((row) =>
      versionCovers(row.effectiveFrom, row.effectiveTo, input.year),
    );
    const before = covering?.payload ?? input.live;
    const exact = rows.find(
      (row) => row.effectiveFrom === input.year && row.effectiveTo === input.year,
    );
    const after = { ...(exact?.payload ?? before), ...input.patch };
    const saveSlice = (
      from: number,
      to: number | null,
      payload: Record<string, unknown>,
    ) =>
      this.versionRepo.save(
        this.versionRepo.create({
          kind: input.kind,
          lineageId: input.lineageId,
          alphaCode: input.lineageId,
          displayCode: input.displayCode,
          effectiveFrom: from,
          effectiveTo: to,
          payload,
          changeType: 'update',
          changedBy: input.userId,
        }),
      );
    if (rows.length === 0) {
      // 버전 이력이 생기면 그 구간만 활성으로 본다. 시딩 연도 앞뒤를 live 문구로 채워
      // 다른 연도가 화면에서 빠지지 않게 한다.
      const liveFrom = Number(input.live.effectiveFrom ?? SP_MIN_YEAR);
      const liveAbolished =
        input.live.abolishedFrom == null ? null : Number(input.live.abolishedFrom);
      if (input.year - 1 >= liveFrom) {
        await saveSlice(liveFrom, input.year - 1, input.live);
      }
      await saveSlice(input.year, input.year, after);
      const afterFrom = input.year + 1;
      const afterTo = liveAbolished == null ? null : liveAbolished - 1;
      if (afterTo == null || afterTo >= afterFrom) {
        await saveSlice(afterFrom, afterTo, input.live);
      }
    } else if (exact) {
      exact.payload = after;
      exact.displayCode = input.displayCode;
      exact.changeType = 'update';
      exact.changedBy = input.userId;
      await this.versionRepo.save(exact);
    } else {
      await saveSlice(input.year, input.year, after);
    }
    await this.recordChange({
      year: input.year,
      kind: input.kind,
      lineageId: input.lineageId,
      displayCode: input.displayCode,
      changeType: 'update',
      summary: `${input.displayCode} 수정`,
      before,
      after,
      userId: input.userId,
    });
  }

  async recordChange(input: {
    year: number;
    kind: SpNodeKind;
    lineageId: string;
    displayCode: string;
    changeType: SpChangeType;
    summary: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    userId?: string | null;
  }) {
    await this.logRepo.save(
      this.logRepo.create({
        year: input.year,
        kind: input.kind,
        lineageId: input.lineageId,
        displayCode: input.displayCode,
        changeType: input.changeType,
        summary: input.summary,
        beforePayload: input.before,
        afterPayload: input.after,
        changedBy: input.userId ?? null,
      }),
    );
  }

  async writeVersion(input: {
    kind: SpNodeKind;
    lineageId: string;
    alphaCode: string;
    displayCode: string;
    year: number;
    changeType: SpChangeType;
    payload: Record<string, unknown>;
    previousPayload?: Record<string, unknown> | null;
    userId?: string | null;
  }) {
    const open = await this.versionRepo.find({
      where: {
        kind: input.kind,
        lineageId: input.lineageId,
        effectiveTo: IsNull(),
      },
      order: { effectiveFrom: 'DESC', versionId: 'DESC' },
    });
    const current = open[0];
    if (current) {
      const closeTo = input.year - 1;
      if (closeTo >= current.effectiveFrom) {
        current.effectiveTo = closeTo;
        await this.versionRepo.save(current);
      } else {
        await this.versionRepo.delete(current.versionId);
      }
    } else if (input.changeType === 'update' || input.changeType === 'abolish') {
      const historic = input.previousPayload ?? input.payload;
      if (input.year > SP_MIN_YEAR) {
        await this.versionRepo.save(
          this.versionRepo.create({
            kind: input.kind,
            lineageId: input.lineageId,
            alphaCode: input.alphaCode,
            displayCode: input.displayCode,
            effectiveFrom: SP_MIN_YEAR,
            effectiveTo: input.year - 1,
            payload: historic,
            changeType: 'create',
            changedBy: input.userId ?? null,
          }),
        );
      }
    }
    if (input.changeType !== 'abolish') {
      await this.versionRepo.save(
        this.versionRepo.create({
          kind: input.kind,
          lineageId: input.lineageId,
          alphaCode: input.alphaCode,
          displayCode: input.displayCode,
          effectiveFrom: input.year,
          effectiveTo: null,
          payload: input.payload,
          changeType: input.changeType,
          changedBy: input.userId ?? null,
        }),
      );
    }
  }

  assertYear(year: number) {
    if (!SP_YEARS.includes(year as (typeof SP_YEARS)[number])) {
      throw new BadRequestException(
        `학년도는 ${SP_YEARS[0]}~${SP_YEARS[SP_YEARS.length - 1]} 사이여야 합니다.`,
      );
    }
  }

  async listChanges() {
    const rows = await this.logRepo.find({
      order: { year: 'DESC', logId: 'DESC' },
    });
    return rows.map((row) => ({
      logId: row.logId,
      year: row.year,
      kind: row.kind,
      kindLabel: kindLabel(row.kind as SpNodeKind),
      lineageId: row.lineageId,
      displayCode: row.displayCode,
      changeType: row.changeType,
      changeTypeLabel: changeTypeLabel(row.changeType as SpChangeType),
      summary: row.summary,
      beforePayload: row.beforePayload,
      afterPayload: row.afterPayload,
      changedBy: row.changedBy,
      createdAt: row.createdAt,
    }));
  }

  async rollback(logId: number, userId: string) {
    const log = await this.logRepo.findOne({ where: { logId } });
    if (!log) throw new NotFoundException('변경이력을 찾을 수 없습니다.');
    if (!log.beforePayload) {
      throw new BadRequestException('되돌릴 이전 내용이 없습니다.');
    }
    const payload = log.beforePayload;
    const year = log.year;
    if (log.kind === 'goal') {
      const goal = await this.goalRepo.findOne({
        where: { goalId: log.lineageId },
      });
      if (!goal) throw new NotFoundException('발전전략을 찾을 수 없습니다.');
      const before = this.goalPayload(goal);
      goal.goalName = String(payload.goalName ?? goal.goalName);
      goal.goalNo = Number(payload.goalNo ?? goal.goalNo);
      goal.abolishedFrom =
        payload.abolishedFrom === undefined
          ? goal.abolishedFrom
          : (payload.abolishedFrom as number | null);
      await this.goalRepo.save(goal);
      const after = this.goalPayload(goal);
      await this.writeVersion({
        kind: 'goal',
        lineageId: goal.goalId,
        alphaCode: goal.goalId,
        displayCode: displayGoal(goal.goalId),
        year,
        changeType: 'rollback',
        payload: after,
        userId,
      });
      await this.recordChange({
        year,
        kind: 'goal',
        lineageId: goal.goalId,
        displayCode: displayGoal(goal.goalId),
        changeType: 'rollback',
        summary: `${displayGoal(goal.goalId)} 롤백`,
        before,
        after,
        userId,
      });
      return after;
    }
    if (log.kind === 'strategy') {
      const row = await this.strategyRepo.findOne({
        where: { strategyId: log.lineageId },
      });
      if (!row) throw new NotFoundException('전략과제를 찾을 수 없습니다.');
      const before = this.strategyPayload(row);
      row.strategyName = String(payload.strategyName ?? row.strategyName);
      row.goalId = String(payload.goalId ?? row.goalId);
      row.abolishedFrom =
        payload.abolishedFrom === undefined
          ? row.abolishedFrom
          : (payload.abolishedFrom as number | null);
      await this.strategyRepo.save(row);
      const after = this.strategyPayload(row);
      await this.finishRollback('strategy', row.strategyId, displayStrategy(row.strategyId), year, before, after, userId);
      return after;
    }
    if (log.kind === 'task') {
      const row = await this.taskRepo.findOne({
        where: { taskCode: log.lineageId },
      });
      if (!row) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
      const before = this.taskPayload(row);
      row.taskName = String(payload.taskName ?? row.taskName);
      row.hangulCode = String(payload.hangulCode ?? row.hangulCode ?? '');
      row.isSpecialized = Boolean(payload.isSpecialized ?? row.isSpecialized);
      row.primaryDept =
        payload.primaryDept === undefined
          ? row.primaryDept
          : (payload.primaryDept as string | null);
      row.relatedDepts =
        payload.relatedDepts === undefined
          ? row.relatedDepts
          : (payload.relatedDepts as string[] | null);
      row.abolishedFrom =
        payload.abolishedFrom === undefined
          ? row.abolishedFrom
          : (payload.abolishedFrom as number | null);
      await this.taskRepo.save(row);
      const after = this.taskPayload(row);
      await this.finishRollback(
        'task',
        row.taskCode,
        displayTask(row.taskCode, row.hangulCode),
        year,
        before,
        after,
        userId,
      );
      return after;
    }
    if (log.kind === 'subtask') {
      const row = await this.subtaskRepo.findOne({
        where: { subtaskCode: log.lineageId },
      });
      if (!row) throw new NotFoundException('TASK를 찾을 수 없습니다.');
      const before = this.subtaskPayload(row);
      row.subtaskName = String(payload.subtaskName ?? row.subtaskName);
      row.hangulCode = String(payload.hangulCode ?? row.hangulCode ?? '');
      row.purpose =
        payload.purpose === undefined
          ? row.purpose
          : (payload.purpose as string | null);
      row.method =
        payload.method === undefined
          ? row.method
          : (payload.method as string | null);
      row.abolishedFrom =
        payload.abolishedFrom === undefined
          ? row.abolishedFrom
          : (payload.abolishedFrom as number | null);
      await this.subtaskRepo.save(row);
      const after = this.subtaskPayload(row);
      await this.finishRollback(
        'subtask',
        row.subtaskCode,
        displaySubtask(row.taskCode, row.seqNo, row.hangulCode),
        year,
        before,
        after,
        userId,
      );
      return after;
    }
    if (log.kind === 'kpi') {
      const row = await this.kpiRepo.findOne({
        where: { kpiCode: log.lineageId },
      });
      if (!row) throw new NotFoundException('KPI를 찾을 수 없습니다.');
      const before = this.kpiPayload(row);
      row.kpiName = String(payload.kpiName ?? row.kpiName);
      row.unit =
        payload.unit === undefined ? row.unit : (payload.unit as string | null);
      row.baseline =
        payload.baseline === undefined
          ? row.baseline
          : (payload.baseline as number | null);
      row.baselineRef =
        payload.baselineRef === undefined
          ? row.baselineRef
          : (payload.baselineRef as string | null);
      row.formula =
        payload.formula === undefined
          ? row.formula
          : (payload.formula as string | null);
      row.primaryDept =
        payload.primaryDept === undefined
          ? row.primaryDept
          : (payload.primaryDept as string | null);
      if (typeof payload.suffix === 'string') {
        row.suffix = kpiSuffixOf(row.kpiCode, payload.suffix);
      }
      row.abolishedFrom =
        payload.abolishedFrom === undefined
          ? row.abolishedFrom
          : (payload.abolishedFrom as number | null);
      await this.kpiRepo.save(row);
      const after = this.kpiPayload(row);
      await this.finishRollback(
        'kpi',
        row.kpiCode,
        this.kpiDisplay(row),
        year,
        before,
        after,
        userId,
      );
      return after;
    }
    const row = await this.fundRepo.findOne({
      where: { fundSourceId: Number(log.lineageId) },
    });
    if (!row) throw new NotFoundException('재원 유형을 찾을 수 없습니다.');
    const before = this.fundPayload(row);
    row.fundSourceName = String(payload.fundSourceName ?? row.fundSourceName);
    row.isActive =
      payload.isActive === undefined ? row.isActive : Boolean(payload.isActive);
    row.abolishedFrom =
      payload.abolishedFrom === undefined
        ? row.abolishedFrom
        : (payload.abolishedFrom as number | null);
    await this.fundRepo.save(row);
    const after = this.fundPayload(row);
    await this.finishRollback(
      'fund',
      String(row.fundSourceId),
      row.fundSourceName,
      year,
      before,
      after,
      userId,
    );
    return after;
  }

  private async finishRollback(
    kind: SpNodeKind,
    lineageId: string,
    displayCode: string,
    year: number,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    userId: string,
  ) {
    await this.writeVersion({
      kind,
      lineageId,
      alphaCode: lineageId,
      displayCode,
      year,
      changeType: 'rollback',
      payload: after,
      userId,
    });
    await this.recordChange({
      year,
      kind,
      lineageId,
      displayCode,
      changeType: 'rollback',
      summary: `${displayCode} 롤백`,
      before,
      after,
      userId,
    });
  }

  goalPayload(row: IrSpGoal): Record<string, unknown> {
    return {
      goalId: row.goalId,
      goalNo: row.goalNo,
      goalName: row.goalName,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  strategyPayload(row: IrSpStrategy): Record<string, unknown> {
    return {
      strategyId: row.strategyId,
      goalId: row.goalId,
      strategyName: row.strategyName,
      displayOrder: row.displayOrder,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  taskPayload(row: IrSpTask): Record<string, unknown> {
    return {
      taskCode: row.taskCode,
      hangulCode: row.hangulCode,
      taskName: row.taskName,
      strategyId: row.strategyId,
      goalId: row.goalId,
      isSpecialized: row.isSpecialized,
      primaryDept: row.primaryDept,
      relatedDepts: row.relatedDepts,
      displayOrder: row.displayOrder,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  subtaskPayload(row: IrSpSubtask): Record<string, unknown> {
    return {
      subtaskId: row.subtaskId,
      taskCode: row.taskCode,
      subtaskCode: row.subtaskCode,
      hangulCode: row.hangulCode,
      seqNo: row.seqNo,
      subtaskName: row.subtaskName,
      purpose: row.purpose,
      method: row.method,
      displayOrder: row.displayOrder,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  kpiPayload(row: IrSpKpi): Record<string, unknown> {
    return {
      kpiCode: row.kpiCode,
      suffix: kpiSuffixOf(row.kpiCode, row.suffix),
      kpiName: row.kpiName,
      unit: row.unit,
      taskCode: row.taskCode,
      strategyId: row.strategyId,
      goalId: row.goalId,
      primaryDept: row.primaryDept,
      baseline: row.baseline,
      baselineRef: row.baselineRef,
      formula: row.formula,
      source: row.source,
      displayOrder: row.displayOrder,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  fundPayload(row: IrSpFundSource): Record<string, unknown> {
    return {
      fundSourceId: row.fundSourceId,
      fundSourceName: row.fundSourceName,
      displayOrder: row.displayOrder,
      isActive: row.isActive,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  async createGoal(input: { alphaCode: string; name: string; year: number }, userId: string) {
    this.assertYear(input.year);
    const alpha = input.alphaCode.trim().toUpperCase();
    if (!isGoalAlpha(alpha)) {
      throw new BadRequestException('발전전략 코드는 A, B, C처럼 알파벳 한 글자여야 합니다.');
    }
    const exists = await this.goalRepo.findOne({ where: { goalId: alpha } });
    if (exists && exists.abolishedFrom == null) {
      throw new BadRequestException(`이미 있는 발전전략 코드입니다: ${alpha}`);
    }
    const row = exists
      ? exists
      : this.goalRepo.create({
          goalId: alpha,
          goalNo: alpha.charCodeAt(0) - 64,
          goalName: '',
          effectiveFrom: input.year,
          abolishedFrom: null,
        });
    row.goalName = input.name.trim();
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.goalRepo.save(row);
    const after = this.goalPayload(row);
    await this.writeVersion({
      kind: 'goal',
      lineageId: alpha,
      alphaCode: alpha,
      displayCode: displayGoal(alpha),
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'goal',
      lineageId: alpha,
      displayCode: displayGoal(alpha),
      changeType: 'create',
      summary: `${displayGoal(alpha)} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async createStrategy(
    input: { alphaCode: string; goalId: string; name: string; year: number },
    userId: string,
  ) {
    this.assertYear(input.year);
    const alpha = input.alphaCode.trim().toUpperCase();
    if (!isStrategyAlpha(alpha)) {
      throw new BadRequestException('전략과제 코드는 A1, B2처럼 알파벳+숫자여야 합니다.');
    }
    const goal = await this.goalRepo.findOne({ where: { goalId: input.goalId } });
    if (!goal) throw new NotFoundException('발전전략을 찾을 수 없습니다.');
    const exists = await this.strategyRepo.findOne({ where: { strategyId: alpha } });
    if (exists && exists.abolishedFrom == null) {
      throw new BadRequestException(`이미 있는 전략과제 코드입니다: ${alpha}`);
    }
    const count = await this.strategyRepo.count({ where: { goalId: goal.goalId } });
    const row = exists ?? this.strategyRepo.create({ strategyId: alpha });
    row.goalId = goal.goalId;
    row.strategyName = input.name.trim();
    row.displayOrder = exists?.displayOrder ?? count;
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.strategyRepo.save(row);
    const after = this.strategyPayload(row);
    await this.writeVersion({
      kind: 'strategy',
      lineageId: alpha,
      alphaCode: alpha,
      displayCode: displayStrategy(alpha),
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'strategy',
      lineageId: alpha,
      displayCode: displayStrategy(alpha),
      changeType: 'create',
      summary: `${displayStrategy(alpha)} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async createTask(
    input: {
      alphaCode: string;
      hangulCode: string;
      name: string;
      strategyId: string;
      year: number;
      isSpecialized?: boolean;
      primaryDept?: string;
    },
    userId: string,
  ) {
    this.assertYear(input.year);
    const parsed = parseTaskCode(input.alphaCode);
    const alpha = parsed.alphaCode;
    if (!/^[A-Z]\d+$/.test(alpha)) {
      throw new BadRequestException('실행과제 알파벳+숫자 코드는 A11처럼 입력해 주세요.');
    }
    const strategy = await this.strategyRepo.findOne({
      where: { strategyId: input.strategyId },
    });
    if (!strategy) throw new NotFoundException('전략과제를 찾을 수 없습니다.');
    const exists = await this.taskRepo.findOne({ where: { taskCode: alpha } });
    if (exists && exists.abolishedFrom == null) {
      throw new BadRequestException(`이미 있는 실행과제 코드입니다: ${alpha}`);
    }
    const count = await this.taskRepo.count({
      where: { strategyId: strategy.strategyId },
    });
    const row = exists ?? this.taskRepo.create({ taskCode: alpha });
    row.hangulCode = (input.hangulCode || parsed.hangulCode).trim();
    row.taskName = input.name.trim();
    row.strategyId = strategy.strategyId;
    row.goalId = strategy.goalId;
    row.isSpecialized = input.isSpecialized ?? false;
    row.primaryDept = input.primaryDept?.trim() || null;
    row.displayOrder = exists?.displayOrder ?? count;
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.taskRepo.save(row);
    const after = this.taskPayload(row);
    const display = displayTask(row.taskCode, row.hangulCode);
    await this.writeVersion({
      kind: 'task',
      lineageId: alpha,
      alphaCode: alpha,
      displayCode: display,
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'task',
      lineageId: alpha,
      displayCode: display,
      changeType: 'create',
      summary: `${display} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async createSubtask(
    input: {
      taskCode: string;
      hangulCode: string;
      seqNo?: number;
      name: string;
      purpose?: string;
      method?: string;
      year: number;
    },
    userId: string,
  ) {
    this.assertYear(input.year);
    const task = await this.taskRepo.findOne({ where: { taskCode: input.taskCode } });
    if (!task) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
    const siblings = await this.subtaskRepo.find({
      where: { taskCode: task.taskCode },
    });
    const seq =
      input.seqNo && input.seqNo > 0
        ? input.seqNo
        : Math.max(0, ...siblings.map((s) => s.seqNo || 0)) + 1;
    const alpha = `${task.taskCode}-${seq}`;
    const exists = siblings.find((s) => s.subtaskCode === alpha);
    if (exists && exists.abolishedFrom == null) {
      throw new BadRequestException(`이미 있는 TASK 코드입니다: ${alpha}`);
    }
    const hangul = (input.hangulCode || task.hangulCode || '').trim();
    const row = exists ?? this.subtaskRepo.create({ taskCode: task.taskCode, subtaskCode: alpha });
    row.hangulCode = hangul;
    row.seqNo = seq;
    row.subtaskName = input.name.trim();
    row.purpose = input.purpose?.trim() || null;
    row.method = input.method?.trim() || null;
    row.displayOrder = exists?.displayOrder ?? siblings.length;
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.subtaskRepo.save(row);
    const after = this.subtaskPayload(row);
    const display = displaySubtask(task.taskCode, seq, hangul);
    await this.writeVersion({
      kind: 'subtask',
      lineageId: alpha,
      alphaCode: alpha,
      displayCode: display,
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'subtask',
      lineageId: alpha,
      displayCode: display,
      changeType: 'create',
      summary: `${display} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async createKpi(
    input: {
      kpiCode: string;
      taskCode: string;
      name: string;
      year: number;
      unit?: string;
      primaryDept?: string;
    },
    userId: string,
  ) {
    this.assertYear(input.year);
    const parsed = parseKpiCode(input.kpiCode);
    const alpha = parsed.alphaCode;
    if (!/^[A-Z]\d+[a-z]$/.test(alpha)) {
      throw new BadRequestException('KPI 코드는 A11a처럼 실행과제 코드+소문자여야 합니다.');
    }
    const suffix = kpiSuffixOf(alpha);
    const task = await this.taskRepo.findOne({ where: { taskCode: input.taskCode } });
    if (!task) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
    if (parsed.taskAlpha && parsed.taskAlpha !== task.taskCode) {
      throw new BadRequestException('KPI 코드의 앞자리는 실행과제 코드와 같아야 합니다.');
    }
    const exists = await this.kpiRepo.findOne({ where: { kpiCode: alpha } });
    if (exists && exists.abolishedFrom == null) {
      throw new BadRequestException(`이미 있는 KPI 코드입니다: ${alpha}`);
    }
    const siblings = await this.kpiRepo.find({
      where: { taskCode: task.taskCode, abolishedFrom: IsNull() },
    });
    for (const sibling of siblings) {
      if (sibling.kpiCode === alpha) continue;
      if (kpiSuffixOf(sibling.kpiCode, sibling.suffix) === suffix) {
        throw new BadRequestException(
          `이미 쓰는 표시 코드입니다: ${displayKpiCode(task.taskCode, suffix)}`,
        );
      }
    }
    const count = await this.kpiRepo.count({ where: { taskCode: task.taskCode } });
    const row = exists ?? this.kpiRepo.create({ kpiCode: alpha });
    row.kpiName = input.name.trim();
    row.taskCode = task.taskCode;
    row.strategyId = task.strategyId;
    row.goalId = task.goalId;
    row.unit = input.unit?.trim() || null;
    row.primaryDept = input.primaryDept?.trim() || task.primaryDept;
    row.suffix = suffix;
    row.displayOrder = exists?.displayOrder ?? count;
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.kpiRepo.save(row);
    const after = this.kpiPayload(row);
    const display = this.kpiDisplay(row);
    await this.writeVersion({
      kind: 'kpi',
      lineageId: alpha,
      alphaCode: alpha,
      displayCode: display,
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'kpi',
      lineageId: alpha,
      displayCode: display,
      changeType: 'create',
      summary: `${display} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async createFund(
    input: { name: string; year: number; displayOrder?: number },
    userId: string,
  ) {
    this.assertYear(input.year);
    const name = input.name.trim();
    if (!name) throw new BadRequestException('재원 이름을 입력해 주세요.');
    const dup = await this.fundRepo.findOne({ where: { fundSourceName: name } });
    if (dup && dup.abolishedFrom == null) {
      throw new BadRequestException('같은 이름의 재원이 이미 있습니다.');
    }
    const max = await this.fundRepo
      .createQueryBuilder('f')
      .select('MAX(f.displayOrder)', 'max')
      .getRawOne<{ max: number | null }>();
    const row = dup ?? this.fundRepo.create({ fundSourceName: name });
    row.fundSourceName = name;
    row.displayOrder = input.displayOrder ?? (max?.max ?? -1) + 1;
    row.isActive = true;
    row.effectiveFrom = input.year;
    row.abolishedFrom = null;
    await this.fundRepo.save(row);
    const after = this.fundPayload(row);
    await this.writeVersion({
      kind: 'fund',
      lineageId: String(row.fundSourceId),
      alphaCode: String(row.fundSourceId),
      displayCode: row.fundSourceName,
      year: input.year,
      changeType: 'create',
      payload: after,
      userId,
    });
    await this.recordChange({
      year: input.year,
      kind: 'fund',
      lineageId: String(row.fundSourceId),
      displayCode: row.fundSourceName,
      changeType: 'create',
      summary: `${row.fundSourceName} 신설`,
      before: null,
      after,
      userId,
    });
    return row;
  }

  async updateNode(
    input: {
      kind: SpNodeKind;
      lineageId: string;
      year: number;
      patch: Record<string, unknown>;
    },
    userId: string,
  ) {
    this.assertYear(input.year);
    if (input.kind === 'goal') {
      const row = await this.goalRepo.findOne({ where: { goalId: input.lineageId } });
      if (!row) throw new NotFoundException('발전전략을 찾을 수 없습니다.');
      const before = this.goalPayload(row);
      if (typeof input.patch.goalName === 'string') row.goalName = input.patch.goalName.trim();
      await this.goalRepo.save(row);
      return this.commitUpdate('goal', row.goalId, displayGoal(row.goalId), input.year, before, this.goalPayload(row), userId);
    }
    if (input.kind === 'strategy') {
      const row = await this.strategyRepo.findOne({
        where: { strategyId: input.lineageId },
      });
      if (!row) throw new NotFoundException('전략과제를 찾을 수 없습니다.');
      const before = this.strategyPayload(row);
      if (typeof input.patch.strategyName === 'string') {
        row.strategyName = input.patch.strategyName.trim();
      }
      await this.strategyRepo.save(row);
      return this.commitUpdate('strategy', row.strategyId, displayStrategy(row.strategyId), input.year, before, this.strategyPayload(row), userId);
    }
    if (input.kind === 'task') {
      const row = await this.taskRepo.findOne({ where: { taskCode: input.lineageId } });
      if (!row) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
      const before = this.taskPayload(row);
      if (typeof input.patch.taskName === 'string') row.taskName = input.patch.taskName.trim();
      if (typeof input.patch.hangulCode === 'string') {
        row.hangulCode = input.patch.hangulCode.trim();
      }
      if (typeof input.patch.isSpecialized === 'boolean') {
        row.isSpecialized = input.patch.isSpecialized;
      }
      if (input.patch.primaryDept !== undefined) {
        row.primaryDept =
          typeof input.patch.primaryDept === 'string'
            ? input.patch.primaryDept.trim() || null
            : null;
      }
      if (Array.isArray(input.patch.relatedDepts)) {
        row.relatedDepts = (input.patch.relatedDepts as unknown[]).map((d) =>
          String(d),
        );
      }
      await this.taskRepo.save(row);
      return this.commitUpdate(
        'task',
        row.taskCode,
        displayTask(row.taskCode, row.hangulCode),
        input.year,
        before,
        this.taskPayload(row),
        userId,
      );
    }
    if (input.kind === 'subtask') {
      const row = await this.subtaskRepo.findOne({
        where: { subtaskCode: input.lineageId },
      });
      if (!row) throw new NotFoundException('TASK를 찾을 수 없습니다.');
      const before = this.subtaskPayload(row);
      if (typeof input.patch.subtaskName === 'string') {
        row.subtaskName = input.patch.subtaskName.trim();
      }
      if (typeof input.patch.hangulCode === 'string') {
        row.hangulCode = input.patch.hangulCode.trim();
      }
      if (input.patch.purpose !== undefined) {
        row.purpose =
          typeof input.patch.purpose === 'string'
            ? input.patch.purpose.trim() || null
            : null;
      }
      if (input.patch.method !== undefined) {
        row.method =
          typeof input.patch.method === 'string'
            ? input.patch.method.trim() || null
            : null;
      }
      await this.subtaskRepo.save(row);
      return this.commitUpdate(
        'subtask',
        row.subtaskCode,
        displaySubtask(row.taskCode, row.seqNo, row.hangulCode),
        input.year,
        before,
        this.subtaskPayload(row),
        userId,
      );
    }
    if (input.kind === 'kpi') {
      const row = await this.kpiRepo.findOne({ where: { kpiCode: input.lineageId } });
      if (!row) throw new NotFoundException('KPI를 찾을 수 없습니다.');
      const before = this.kpiPayload(row);
      if (typeof input.patch.kpiName === 'string') row.kpiName = input.patch.kpiName.trim();
      if (input.patch.unit !== undefined) {
        row.unit =
          typeof input.patch.unit === 'string' ? input.patch.unit.trim() || null : null;
      }
      if (input.patch.primaryDept !== undefined) {
        row.primaryDept =
          typeof input.patch.primaryDept === 'string'
            ? input.patch.primaryDept.trim() || null
            : null;
      }
      if (input.patch.baseline !== undefined) {
        row.baseline =
          input.patch.baseline === null ? null : Number(input.patch.baseline);
      }
      if (input.patch.baselineRef !== undefined) {
        row.baselineRef =
          typeof input.patch.baselineRef === 'string'
            ? input.patch.baselineRef.trim() || null
            : null;
      }
      if (input.patch.formula !== undefined) {
        row.formula =
          typeof input.patch.formula === 'string'
            ? input.patch.formula.trim() || null
            : null;
      }
      if (typeof input.patch.suffix === 'string') {
        const letter = input.patch.suffix.trim().toLowerCase();
        if (!/^[a-z]$/.test(letter)) {
          throw new BadRequestException('KPI 접미사는 소문자 한 글자여야 합니다.');
        }
        const prefix = kpiTaskPrefix(row.kpiCode, row.taskCode);
        if (!row.taskCode) {
          throw new BadRequestException('KPI에 실행과제가 없습니다.');
        }
        const siblings = await this.kpiRepo.find({
          where: { taskCode: row.taskCode, abolishedFrom: IsNull() },
        });
        for (const sibling of siblings) {
          if (sibling.kpiCode === row.kpiCode) continue;
          if (kpiSuffixOf(sibling.kpiCode, sibling.suffix) === letter) {
            throw new BadRequestException(
              `이미 쓰는 표시 코드입니다: ${displayKpiCode(prefix, letter)}`,
            );
          }
        }
        row.suffix = letter;
      }
      await this.kpiRepo.save(row);
      return this.commitUpdate(
        'kpi',
        row.kpiCode,
        this.kpiDisplay(row),
        input.year,
        before,
        this.kpiPayload(row),
        userId,
      );
    }
    const row = await this.fundRepo.findOne({
      where: { fundSourceId: Number(input.lineageId) },
    });
    if (!row) throw new NotFoundException('재원 유형을 찾을 수 없습니다.');
    const before = this.fundPayload(row);
    if (typeof input.patch.fundSourceName === 'string') {
      row.fundSourceName = input.patch.fundSourceName.trim();
    }
    await this.fundRepo.save(row);
    return this.commitUpdate(
      'fund',
      String(row.fundSourceId),
      row.fundSourceName,
      input.year,
      before,
      this.fundPayload(row),
      userId,
    );
  }

  async abolishNode(
    input: { kind: SpNodeKind; lineageId: string; year: number; skipCompact?: boolean },
    userId: string,
  ) {
    this.assertYear(input.year);
    if (input.kind === 'goal') {
      const children = await this.strategyRepo.count({
        where: { goalId: input.lineageId, abolishedFrom: IsNull() },
      });
      if (children > 0) {
        // still abolish cascade
      }
      const row = await this.goalRepo.findOne({ where: { goalId: input.lineageId } });
      if (!row) throw new NotFoundException('발전전략을 찾을 수 없습니다.');
      const strategies = await this.strategyRepo.find({
        where: { goalId: row.goalId, abolishedFrom: IsNull() },
      });
      for (const strategy of strategies) {
        await this.abolishNode(
          { kind: 'strategy', lineageId: strategy.strategyId, year: input.year },
          userId,
        );
      }
      return this.markAbolished('goal', row.goalId, displayGoal(row.goalId), this.goalPayload(row), input.year, userId, async () => {
        row.abolishedFrom = input.year;
        await this.goalRepo.save(row);
      });
    }
    if (input.kind === 'strategy') {
      const row = await this.strategyRepo.findOne({
        where: { strategyId: input.lineageId },
      });
      if (!row) throw new NotFoundException('전략과제를 찾을 수 없습니다.');
      const tasks = await this.taskRepo.find({
        where: { strategyId: row.strategyId, abolishedFrom: IsNull() },
      });
      for (const task of tasks) {
        await this.abolishNode(
          { kind: 'task', lineageId: task.taskCode, year: input.year },
          userId,
        );
      }
      return this.markAbolished('strategy', row.strategyId, displayStrategy(row.strategyId), this.strategyPayload(row), input.year, userId, async () => {
        row.abolishedFrom = input.year;
        await this.strategyRepo.save(row);
      });
    }
    if (input.kind === 'task') {
      const row = await this.taskRepo.findOne({ where: { taskCode: input.lineageId } });
      if (!row) throw new NotFoundException('실행과제를 찾을 수 없습니다.');
      const subs = await this.subtaskRepo.find({
        where: { taskCode: row.taskCode, abolishedFrom: IsNull() },
      });
      for (const sub of subs) {
        await this.abolishNode(
          { kind: 'subtask', lineageId: sub.subtaskCode, year: input.year },
          userId,
        );
      }
      const kpis = await this.kpiRepo.find({
        where: { taskCode: row.taskCode, abolishedFrom: IsNull() },
      });
      for (const kpi of kpis) {
        await this.abolishNode(
          { kind: 'kpi', lineageId: kpi.kpiCode, year: input.year, skipCompact: true },
          userId,
        );
      }
      return this.markAbolished(
        'task',
        row.taskCode,
        displayTask(row.taskCode, row.hangulCode),
        this.taskPayload(row),
        input.year,
        userId,
        async () => {
          row.abolishedFrom = input.year;
          await this.taskRepo.save(row);
        },
      );
    }
    if (input.kind === 'subtask') {
      const row = await this.subtaskRepo.findOne({
        where: { subtaskCode: input.lineageId },
      });
      if (!row) throw new NotFoundException('TASK를 찾을 수 없습니다.');
      return this.markAbolished(
        'subtask',
        row.subtaskCode,
        displaySubtask(row.taskCode, row.seqNo, row.hangulCode),
        this.subtaskPayload(row),
        input.year,
        userId,
        async () => {
          row.abolishedFrom = input.year;
          await this.subtaskRepo.save(row);
        },
      );
    }
    if (input.kind === 'kpi') {
      const row = await this.kpiRepo.findOne({ where: { kpiCode: input.lineageId } });
      if (!row) throw new NotFoundException('KPI를 찾을 수 없습니다.');
      const taskCode = row.taskCode;
      const result = await this.markAbolished(
        'kpi',
        row.kpiCode,
        this.kpiDisplay(row),
        this.kpiPayload(row),
        input.year,
        userId,
        async () => {
          row.abolishedFrom = input.year;
          await this.kpiRepo.save(row);
        },
      );
      if (!input.skipCompact && taskCode) {
        await this.compactKpiSuffixes(taskCode, input.year, userId);
      }
      return result;
    }
    const row = await this.fundRepo.findOne({
      where: { fundSourceId: Number(input.lineageId) },
    });
    if (!row) throw new NotFoundException('재원 유형을 찾을 수 없습니다.');
    return this.markAbolished(
      'fund',
      String(row.fundSourceId),
      row.fundSourceName,
      this.fundPayload(row),
      input.year,
      userId,
      async () => {
        row.abolishedFrom = input.year;
        row.isActive = false;
        await this.fundRepo.save(row);
      },
    );
  }

  private async compactKpiSuffixes(taskCode: string, year: number, userId: string) {
    const live = await this.kpiRepo.find({
      where: { taskCode, abolishedFrom: IsNull() },
    });
    live.sort((a, b) => {
      const sa = kpiSuffixOf(a.kpiCode, a.suffix);
      const sb = kpiSuffixOf(b.kpiCode, b.suffix);
      if (sa !== sb) return sa.localeCompare(sb);
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.kpiCode.localeCompare(b.kpiCode);
    });
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    for (let i = 0; i < live.length; i++) {
      const next = letters[i];
      if (!next) break;
      const row = live[i];
      if (kpiSuffixOf(row.kpiCode, row.suffix) === next) continue;
      const before = this.kpiPayload(row);
      row.suffix = next;
      await this.kpiRepo.save(row);
      await this.commitUpdate(
        'kpi',
        row.kpiCode,
        this.kpiDisplay(row),
        year,
        before,
        this.kpiPayload(row),
        userId,
      );
    }
  }

  private async commitUpdate(
    kind: SpNodeKind,
    lineageId: string,
    displayCode: string,
    year: number,
    before: Record<string, unknown>,
    after: Record<string, unknown>,
    userId: string,
  ) {
    await this.writeVersion({
      kind,
      lineageId,
      alphaCode: lineageId,
      displayCode,
      year,
      changeType: 'update',
      payload: after,
      previousPayload: before,
      userId,
    });
    await this.recordChange({
      year,
      kind,
      lineageId,
      displayCode,
      changeType: 'update',
      summary: `${displayCode} 수정`,
      before,
      after,
      userId,
    });
    return after;
  }

  private async markAbolished(
    kind: SpNodeKind,
    lineageId: string,
    displayCode: string,
    before: Record<string, unknown>,
    year: number,
    userId: string,
    apply: () => Promise<void>,
  ) {
    await this.writeVersion({
      kind,
      lineageId,
      alphaCode: lineageId,
      displayCode,
      year,
      changeType: 'abolish',
      payload: before,
      previousPayload: before,
      userId,
    });
    await apply();
    await this.recordChange({
      year,
      kind,
      lineageId,
      displayCode,
      changeType: 'abolish',
      summary: `${displayCode} 폐지`,
      before,
      after: { ...before, abolishedFrom: year },
      userId,
    });
    return { ok: true as const };
  }

  async fullRevise(
    input: { scope: 'structure' | 'kpi' | 'fund'; year: number },
    userId: string,
  ) {
    this.assertYear(input.year);
    if (input.scope === 'structure') {
      const goals = await this.goalRepo.find({
        where: { abolishedFrom: IsNull() },
      });
      for (const goal of goals) {
        await this.abolishNode(
          { kind: 'goal', lineageId: goal.goalId, year: input.year },
          userId,
        );
      }
    } else if (input.scope === 'kpi') {
      const kpis = await this.kpiRepo.find({
        where: { abolishedFrom: IsNull() },
      });
      for (const kpi of kpis) {
        await this.abolishNode(
          { kind: 'kpi', lineageId: kpi.kpiCode, year: input.year, skipCompact: true },
          userId,
        );
      }
    } else {
      const funds = await this.fundRepo.find({
        where: { abolishedFrom: IsNull() },
      });
      for (const fund of funds) {
        await this.abolishNode(
          { kind: 'fund', lineageId: String(fund.fundSourceId), year: input.year },
          userId,
        );
      }
    }
    const scopeLabel =
      input.scope === 'structure'
        ? '전략체계'
        : input.scope === 'kpi'
          ? 'KPI'
          : '재원 유형';
    await this.recordChange({
      year: input.year,
      kind: input.scope === 'structure' ? 'goal' : input.scope === 'kpi' ? 'kpi' : 'fund',
      lineageId: `full-revision:${input.scope}:${input.year}`,
      displayCode: '전면개정',
      changeType: 'revise',
      summary: `${scopeLabel} 전면개정 (${input.year}학년도부터)`,
      before: { snapshotYear: input.year - 1, scope: input.scope },
      after: { blank: true, effectiveFrom: input.year },
      userId,
    });
    return { ok: true as const, year: input.year, snapshotYear: input.year - 1 };
  }
}
