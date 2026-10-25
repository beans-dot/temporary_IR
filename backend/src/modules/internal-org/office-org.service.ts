import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { IrSpDepartment, IrSpTask } from '../../entities';
import { OrgAnnualSyncService } from './org-annual-sync.service';
import {
  OFFICE_CATEGORY_CODE_PREFIX,
  OFFICE_CODE_PREFIX,
  ORG_MIN_YEAR,
  activeAt,
  defaultOrgYear,
} from './org.constants';
import { OrgVersioningService } from './org-versioning.service';

export interface OfficeNode {
  deptId: number;
  officeCode: string | null;
  deptName: string;
  isCategory: boolean;
  parentId: number | null;
  displayOrder: number;
  effectiveFrom: number;
  abolishedFrom: number | null;
  children: OfficeNode[];
}

@Injectable()
export class OfficeOrgService {
  private migrated = false;

  constructor(
    @InjectRepository(IrSpDepartment)
    private readonly officeRepo: Repository<IrSpDepartment>,
    @InjectRepository(IrSpTask)
    private readonly taskRepo: Repository<IrSpTask>,
    private readonly versioning: OrgVersioningService,
    private readonly annualSync: OrgAnnualSyncService,
    private readonly dataSource: DataSource,
  ) {}

  private payload(row: IrSpDepartment) {
    return {
      name: row.deptName,
      officeCode: row.officeCode,
      isCategory: row.isCategory,
      parentId: row.parentId,
      displayOrder: row.displayOrder,
      effectiveFrom: row.effectiveFrom,
      abolishedFrom: row.abolishedFrom,
    };
  }

  async ensureMigrated(): Promise<void> {
    if (this.migrated) return;
    try {
      await this.dataSource.query(
        'ALTER TABLE ir_sp_department DROP CONSTRAINT IF EXISTS uq_sp_department_name',
      );
    } catch {
      // ignore
    }
    const rows = await this.officeRepo.find({
      order: { displayOrder: 'ASC', deptId: 'ASC' },
    });
    for (const row of rows) {
      let dirty = false;
      if (!row.officeCode) {
        row.officeCode = row.isCategory
          ? await this.nextCode(true)
          : await this.nextCode(false);
        dirty = true;
      }
      if (!row.effectiveFrom) {
        row.effectiveFrom = ORG_MIN_YEAR;
        dirty = true;
      }
      if (dirty) await this.officeRepo.save(row);
    }
    await this.migrateTaskNamesToCodes();
    this.migrated = true;
  }

  private async nextCode(isCategory: boolean): Promise<string> {
    const rows = await this.officeRepo.find();
    const prefix = isCategory ? OFFICE_CATEGORY_CODE_PREFIX : OFFICE_CODE_PREFIX;
    const used = new Set(rows.map((r) => r.officeCode).filter(Boolean));
    let n = 1;
    let code = `${prefix}${String(n).padStart(4, '0')}`;
    while (used.has(code)) {
      n += 1;
      code = `${prefix}${String(n).padStart(4, '0')}`;
    }
    return code;
  }

  private async migrateTaskNamesToCodes() {
    const offices = await this.officeRepo.find();
    const byName = new Map(
      offices.filter((o) => o.officeCode).map((o) => [o.deptName, o.officeCode!]),
    );
    const byCode = new Set(offices.map((o) => o.officeCode).filter(Boolean));
    const tasks = await this.taskRepo.find();
    for (const task of tasks) {
      let dirty = false;
      if (task.primaryDept && !byCode.has(task.primaryDept)) {
        const code = byName.get(task.primaryDept);
        if (code) {
          task.primaryDept = code;
          dirty = true;
        }
      }
      if (task.relatedDepts?.length) {
        const next = task.relatedDepts.map((d) => {
          if (byCode.has(d)) return d;
          return byName.get(d) ?? d;
        });
        if (next.some((v, i) => v !== task.relatedDepts![i])) {
          task.relatedDepts = next;
          dirty = true;
        }
      }
      if (dirty) await this.taskRepo.save(task);
    }
  }

  async resolveAt(year: number): Promise<OfficeNode[]> {
    await this.ensureMigrated();
    this.versioning.assertYear(year);
    const [rows, overlay] = await Promise.all([
      this.officeRepo.find({
        order: { displayOrder: 'ASC', deptId: 'ASC' },
      }),
      this.versioning.overlayMap('office', year),
    ]);
    const nodes: OfficeNode[] = [];
    for (const row of rows) {
      if (!activeAt(row.effectiveFrom, row.abolishedFrom, year)) continue;
      const payload = overlay.get(String(row.deptId));
      nodes.push({
        deptId: row.deptId,
        officeCode: String(payload?.officeCode ?? row.officeCode ?? ''),
        deptName: String(payload?.name ?? row.deptName),
        isCategory: Boolean(
          payload?.isCategory === undefined ? row.isCategory : payload.isCategory,
        ),
        parentId:
          payload?.parentId === undefined
            ? row.parentId
            : (payload.parentId as number | null),
        displayOrder: Number(payload?.displayOrder ?? row.displayOrder),
        effectiveFrom: row.effectiveFrom,
        abolishedFrom: row.abolishedFrom,
        children: [],
      });
    }
    return nodes.sort(
      (a, b) => a.displayOrder - b.displayOrder || a.deptId - b.deptId,
    );
  }

  async getTree(year?: number): Promise<{
    categories: OfficeNode[];
    uncategorized: OfficeNode[];
  }> {
    const asOf = year ?? defaultOrgYear();
    const nodes = await this.resolveAt(asOf);
    const byId = new Map(nodes.map((n) => [n.deptId, n]));
    const categories: OfficeNode[] = [];
    const uncategorized: OfficeNode[] = [];
    for (const n of nodes) {
      if (n.isCategory) {
        categories.push(n);
        continue;
      }
      if (n.parentId && byId.get(n.parentId)?.isCategory) {
        byId.get(n.parentId)!.children.push(n);
      } else {
        uncategorized.push(n);
      }
    }
    return { categories, uncategorized };
  }

  /** 책임부서·소속 드롭다운: 대분류 제외 */
  async listSelectable(year?: number): Promise<
    Array<{
      deptId: number;
      officeCode: string;
      deptName: string;
      categoryName: string | null;
    }>
  > {
    const { categories, uncategorized } = await this.getTree(year);
    const out: Array<{
      deptId: number;
      officeCode: string;
      deptName: string;
      categoryName: string | null;
    }> = [];
    for (const cat of categories) {
      for (const child of cat.children) {
        if (!child.officeCode) continue;
        out.push({
          deptId: child.deptId,
          officeCode: child.officeCode,
          deptName: child.deptName,
          categoryName: cat.deptName,
        });
      }
    }
    for (const office of uncategorized) {
      if (!office.officeCode) continue;
      out.push({
        deptId: office.deptId,
        officeCode: office.officeCode,
        deptName: office.deptName,
        categoryName: null,
      });
    }
    return out;
  }

  async listAffiliationOffices(): Promise<
    Array<{ officeCode: string; deptName: string; categoryName: string | null }>
  > {
    const rows = await this.listSelectable(defaultOrgYear());
    return rows.map((r) => ({
      officeCode: r.officeCode,
      deptName: r.deptName,
      categoryName: r.categoryName,
    }));
  }

  async resolveDisplayName(
    codeOrName: string | null | undefined,
    year?: number,
  ): Promise<string | null> {
    if (!codeOrName) return null;
    const asOf = year ?? defaultOrgYear();
    const nodes = await this.resolveAt(asOf);
    const byCode = nodes.find((n) => n.officeCode === codeOrName);
    if (byCode) return byCode.deptName;
    const byName = nodes.find((n) => n.deptName === codeOrName);
    return byName?.deptName ?? codeOrName;
  }

  async resolveDisplayNames(
    values: Array<string | null | undefined>,
    year?: number,
  ): Promise<Map<string, string>> {
    const asOf = year ?? defaultOrgYear();
    const nodes = await this.resolveAt(asOf);
    const map = new Map<string, string>();
    for (const n of nodes) {
      if (n.officeCode) map.set(n.officeCode, n.deptName);
      map.set(n.deptName, n.deptName);
    }
    const out = new Map<string, string>();
    for (const value of values) {
      if (!value) continue;
      out.set(value, map.get(value) ?? value);
    }
    return out;
  }

  async createOffice(
    input: {
      deptName: string;
      year: number;
      isCategory?: boolean;
      parentId?: number | null;
      displayOrder?: number;
    },
    userId?: string,
  ): Promise<IrSpDepartment> {
    await this.ensureMigrated();
    this.versioning.assertYear(input.year);
    const name = input.deptName.trim();
    if (!name) throw new BadRequestException('이름을 입력해 주세요.');
    const isCategory = Boolean(input.isCategory);
    if (isCategory && input.parentId) {
      throw new BadRequestException('대분류는 하위로 둘 수 없습니다.');
    }
    if (!isCategory && input.parentId) {
      await this.assertCategory(input.parentId, input.year);
    }
    const nodes = await this.resolveAt(input.year);
    if (nodes.some((n) => n.deptName === name && n.isCategory === isCategory)) {
      throw new BadRequestException('같은 이름이 이미 있습니다.');
    }
    const siblings = nodes.filter((n) =>
      isCategory ? n.isCategory : n.parentId === (input.parentId ?? null),
    );
    const max = Math.max(-1, ...siblings.map((n) => n.displayOrder));
    const saved = await this.officeRepo.save(
      this.officeRepo.create({
        officeCode: await this.nextCode(isCategory),
        deptName: name,
        isCategory,
        parentId: isCategory ? null : (input.parentId ?? null),
        displayOrder: input.displayOrder ?? max + 1,
        effectiveFrom: input.year,
        abolishedFrom: null,
      }),
    );
    const payload = this.payload(saved);
    await this.versioning.writeVersion({
      kind: 'office',
      lineageId: String(saved.deptId),
      alphaCode: saved.officeCode ?? '',
      displayName: name,
      year: input.year,
      changeType: 'create',
      payload,
      userId,
    });
    await this.versioning.recordChange({
      year: input.year,
      kind: 'office',
      lineageId: String(saved.deptId),
      displayName: name,
      changeType: 'create',
      summary: `${name} 신설`,
      before: null,
      after: payload,
      userId,
    });
    await this.annualSync.sync(input.year);
    return saved;
  }

  /**
   * 그 학년도에 없는 행정부서를 만들거나, 이미 있는 부서의 적용 구간을 그 해까지 연다.
   * 중장기발전계획 관리·조직 변경이력이 같은 학년도 기록을 쓰도록 신설·수정 이력을 남긴다.
   */
  async ensureOffice(
    deptName: string,
    year: number,
    userId?: string,
  ): Promise<string> {
    await this.ensureMigrated();
    this.versioning.assertYear(year);
    const name = deptName.trim();
    if (!name) throw new BadRequestException('부서 이름을 입력해 주세요.');
    const rows = await this.officeRepo.find();
    const found =
      rows.find((row) => !row.isCategory && row.officeCode === name) ??
      rows.find((row) => !row.isCategory && row.deptName === name);
    if (found?.officeCode) {
      await this.coverOfficeYear(found, year, userId);
      return found.officeCode;
    }
    const created = await this.createOffice(
      { deptName: name, year, isCategory: false },
      userId,
    );
    if (!created.officeCode) {
      throw new BadRequestException(`부서 코드를 만들지 못했습니다: ${name}`);
    }
    return created.officeCode;
  }

  private async coverOfficeYear(
    row: IrSpDepartment,
    year: number,
    userId?: string,
  ) {
    if (activeAt(row.effectiveFrom, row.abolishedFrom, year)) return;
    const before = this.payload(row);
    if (row.effectiveFrom > year) row.effectiveFrom = year;
    if (row.abolishedFrom != null && row.abolishedFrom <= year) {
      row.abolishedFrom = null;
    }
    await this.officeRepo.save(row);
    const after = this.payload(row);
    await this.versioning.writeVersion({
      kind: 'office',
      lineageId: String(row.deptId),
      alphaCode: row.officeCode ?? '',
      displayName: row.deptName,
      year,
      changeType: 'update',
      payload: after,
      previousPayload: before,
      userId,
    });
    await this.versioning.recordChange({
      year,
      kind: 'office',
      lineageId: String(row.deptId),
      displayName: row.deptName,
      changeType: 'update',
      summary: `${row.deptName}를 ${year}학년도부터 사용`,
      before,
      after,
      userId,
    });
    await this.annualSync.sync(year);
  }

  async updateOffice(
    deptId: number,
    input: {
      deptName?: string;
      year: number;
      parentId?: number | null;
      displayOrder?: number;
    },
    userId?: string,
  ): Promise<IrSpDepartment> {
    await this.ensureMigrated();
    this.versioning.assertYear(input.year);
    const row = await this.officeRepo.findOne({ where: { deptId } });
    if (!row) throw new NotFoundException('부서를 찾을 수 없습니다.');
    if (!activeAt(row.effectiveFrom, row.abolishedFrom, input.year)) {
      throw new BadRequestException('해당 학년도에 존재하지 않는 조직입니다.');
    }
    const overlay = await this.versioning.overlayPayload(
      'office',
      String(deptId),
      input.year,
    );
    const before = overlay ?? this.payload(row);
    if (input.deptName !== undefined) {
      const name = input.deptName.trim();
      if (!name) throw new BadRequestException('이름을 입력해 주세요.');
      row.deptName = name;
    }
    if (input.parentId !== undefined) {
      if (row.isCategory) {
        throw new BadRequestException('대분류는 하위로 둘 수 없습니다.');
      }
      if (input.parentId != null) {
        await this.assertCategory(input.parentId, input.year);
      }
      row.parentId = input.parentId;
    }
    if (input.displayOrder !== undefined) {
      row.displayOrder = input.displayOrder;
    }
    await this.officeRepo.save(row);
    const after = this.payload(row);
    const renamed = String(before.name ?? '') !== String(after.name ?? '');
    await this.versioning.writeVersion({
      kind: 'office',
      lineageId: String(row.deptId),
      alphaCode: row.officeCode ?? '',
      displayName: row.deptName,
      year: input.year,
      changeType: 'update',
      payload: after,
      previousPayload: before,
      userId,
    });
    await this.versioning.recordChange({
      year: input.year,
      kind: 'office',
      lineageId: String(row.deptId),
      displayName: row.deptName,
      changeType: 'update',
      summary: renamed
        ? `${String(before.name)} → ${row.deptName}`
        : `${row.deptName} 수정`,
      before,
      after,
      userId,
    });
    if (renamed) {
      await this.annualSync.sync(input.year);
    }
    return row;
  }

  async abolishOffice(
    deptId: number,
    year: number,
    userId?: string,
  ): Promise<{ ok: true }> {
    await this.ensureMigrated();
    this.versioning.assertYear(year);
    const row = await this.officeRepo.findOne({ where: { deptId } });
    if (!row) throw new NotFoundException('부서를 찾을 수 없습니다.');
    if (!activeAt(row.effectiveFrom, row.abolishedFrom, year)) {
      throw new BadRequestException('해당 학년도에 존재하지 않는 조직입니다.');
    }
    if (row.isCategory) {
      const { categories } = await this.getTree(year);
      const cat = categories.find((c) => c.deptId === deptId);
      if (cat && cat.children.length > 0) {
        throw new BadRequestException(
          '하위 부서를 먼저 옮기거나 폐지한 뒤 대분류를 폐지할 수 있습니다.',
        );
      }
    }
    const overlay = await this.versioning.overlayPayload(
      'office',
      String(deptId),
      year,
    );
    const before = overlay ?? this.payload(row);
    row.abolishedFrom = year;
    await this.officeRepo.save(row);
    const after = this.payload(row);
    await this.versioning.writeVersion({
      kind: 'office',
      lineageId: String(row.deptId),
      alphaCode: row.officeCode ?? '',
      displayName: row.deptName,
      year,
      changeType: 'abolish',
      payload: after,
      previousPayload: before,
      userId,
    });
    await this.versioning.recordChange({
      year,
      kind: 'office',
      lineageId: String(row.deptId),
      displayName: row.deptName,
      changeType: 'abolish',
      summary: `${row.deptName} 폐지`,
      before,
      after,
      userId,
    });
    await this.annualSync.sync(year);
    return { ok: true };
  }

  async reorder(
    payload: {
      items: {
        deptId: number;
        parentId: number | null;
        displayOrder: number;
      }[];
    },
    year: number,
    userId?: string,
  ): Promise<{ ok: true }> {
    for (const item of payload.items) {
      const row = await this.officeRepo.findOne({
        where: { deptId: item.deptId },
      });
      if (!row) continue;
      if (!activeAt(row.effectiveFrom, row.abolishedFrom, year)) continue;
      if (row.isCategory) {
        if (row.displayOrder === item.displayOrder) continue;
        await this.updateOffice(
          item.deptId,
          { year, displayOrder: item.displayOrder },
          userId,
        );
        continue;
      }
      const parentId = item.parentId;
      if (row.displayOrder === item.displayOrder && row.parentId === parentId) {
        continue;
      }
      await this.updateOffice(
        item.deptId,
        { year, parentId, displayOrder: item.displayOrder },
        userId,
      );
    }
    return { ok: true };
  }

  async rollback(logId: number, userId: string) {
    const log = await this.versioning.getLog(logId);
    if (log.kind !== 'office') {
      throw new BadRequestException('이 이력은 행정부서 화면에서 되돌리세요.');
    }
    if (!log.beforePayload) {
      throw new BadRequestException('되돌릴 이전 내용이 없습니다.');
    }
    const row = await this.officeRepo.findOne({
      where: { deptId: Number(log.lineageId) },
    });
    if (!row) throw new NotFoundException('부서를 찾을 수 없습니다.');
    const payload = log.beforePayload;
    const before = this.payload(row);
    row.deptName = String(payload.name ?? row.deptName);
    row.parentId =
      payload.parentId === undefined
        ? row.parentId
        : (payload.parentId as number | null);
    row.displayOrder = Number(payload.displayOrder ?? row.displayOrder);
    row.isCategory = Boolean(
      payload.isCategory === undefined ? row.isCategory : payload.isCategory,
    );
    row.abolishedFrom =
      payload.abolishedFrom === undefined
        ? row.abolishedFrom
        : (payload.abolishedFrom as number | null);
    await this.officeRepo.save(row);
    const after = this.payload(row);
    await this.versioning.writeVersion({
      kind: 'office',
      lineageId: String(row.deptId),
      alphaCode: row.officeCode ?? '',
      displayName: row.deptName,
      year: log.year,
      changeType: 'rollback',
      payload: after,
      userId,
    });
    await this.versioning.recordChange({
      year: log.year,
      kind: 'office',
      lineageId: String(row.deptId),
      displayName: row.deptName,
      changeType: 'rollback',
      summary: `${row.deptName} 롤백`,
      before,
      after,
      userId,
    });
    await this.annualSync.sync(log.year);
    return after;
  }

  private async assertCategory(parentId: number, year: number) {
    const nodes = await this.resolveAt(year);
    const parent = nodes.find((n) => n.deptId === parentId);
    if (!parent || !parent.isCategory) {
      throw new BadRequestException('상위는 대분류만 선택할 수 있습니다.');
    }
  }
}
