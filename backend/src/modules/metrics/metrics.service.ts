import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  IrMetricCategory,
  IrMetricRegistry,
  IrRawData,
  type MetricSourceType,
} from '../../entities';
import {
  FormulaError,
  isLockedAutoComputeMetric,
  validateMetricFormula,
} from './metric-formula';
import { UNCATEGORIZED_CATEGORY_NAME } from './metric.constants';
import {
  hasDeptLevelMetricSuffix,
  stripDeptLevelMetricSuffix,
  withDeptLevelMetricSuffix,
} from './metric-labels';
import { coerceMetricSourceType, sourceTypeLabel } from './metric-source';
import {
  MONITORING_ALIMI_LINKS,
  MONITORING_SEED_CATALOG,
  type MonitoringSeedCategory,
  type MonitoringSeedMetric,
} from './monitoring.catalog';

export interface MetricNode {
  metricId: number;
  metricCode: string | null;
  metricName: string;
  metricUnit: string | null;
  sourceType: MetricSourceType;
  displayOrder: number;
  parentMetricId: number | null;
  isHidden: boolean;
  computeFormula: string | null;
  computeEnabled: boolean;
  /** 이 지표 자체(상위)에 업로드된 원본 값이 있는지 */
  hasRawData: boolean;
  children: MetricNode[];
}

export interface CategoryTreeNode {
  categoryId: number;
  categoryCode: string | null;
  categoryName: string;
  displayOrder: number;
  sourceType: MetricSourceType;
  isHidden: boolean;
  metrics: MetricNode[];
}

@Injectable()
export class MetricsService {
  constructor(
    @InjectRepository(IrMetricCategory)
    private readonly categoryRepo: Repository<IrMetricCategory>,
    @InjectRepository(IrMetricRegistry)
    private readonly metricRepo: Repository<IrMetricRegistry>,
    @InjectRepository(IrRawData)
    private readonly rawRepo: Repository<IrRawData>,
  ) {}

  private domainReady = false;

  /** 레거시 미분류 지표용 「분류없음」 카테고리를 출처별로 보장한다. */
  async ensureUncategorizedCategory(
    sourceType: MetricSourceType = 'ALIMI',
  ): Promise<IrMetricCategory> {
    let cat = await this.categoryRepo.findOne({
      where: { categoryName: UNCATEGORIZED_CATEGORY_NAME, sourceType },
    });
    if (!cat) {
      cat = await this.categoryRepo.save(
        this.categoryRepo.create({
          categoryName: UNCATEGORIZED_CATEGORY_NAME,
          sourceType,
          displayOrder: -1,
        }),
      );
    } else if (cat.displayOrder !== -1) {
      await this.categoryRepo.update(cat.categoryId, { displayOrder: -1 });
      cat.displayOrder = -1;
    }
    return cat;
  }

  /**
   * 기존 카테고리/지표를 공시(ALIMI) · 자체(INTERNAL) · 모니터링(MONITORING) 위계로 분리.
   */
  private async ensureMetricDomains(): Promise<void> {
    if (this.domainReady) {
      await this.ensureUncategorizedCategory('ALIMI');
      await this.ensureUncategorizedCategory('INTERNAL');
      await this.ensureUncategorizedCategory('MONITORING');
      await this.ensureMonitoringCatalog();
      await this.removeUnusedEmptyCategories();
      return;
    }

    const categories = await this.categoryRepo.find();
    const metrics = await this.metricRepo.find();

    for (const cat of categories) {
      const sourceType = coerceMetricSourceType(cat.sourceType);
      if (cat.sourceType !== sourceType) {
        cat.sourceType = sourceType;
        await this.categoryRepo.save(cat);
      }
    }

    await this.ensureUncategorizedCategory('ALIMI');
    await this.ensureUncategorizedCategory('INTERNAL');
    await this.ensureUncategorizedCategory('MONITORING');

    for (const metric of metrics) {
      if (metric.sourceType !== 'INTERNAL') continue;
      const current = categories.find((c) => c.categoryId === metric.categoryId);
      if (current?.sourceType === 'INTERNAL') continue;

      const name = current?.categoryName ?? UNCATEGORIZED_CATEGORY_NAME;
      let dest = await this.categoryRepo.findOne({
        where: { categoryName: name, sourceType: 'INTERNAL' },
      });
      if (!dest) {
        dest = await this.categoryRepo.save(
          this.categoryRepo.create({
            categoryName: name,
            sourceType: 'INTERNAL',
            displayOrder: current?.displayOrder ?? 0,
          }),
        );
      }
      await this.metricRepo.update(metric.metricId, {
        categoryId: dest.categoryId,
      });
    }

    await this.ensureMonitoringCatalog();
    await this.removeUnusedEmptyCategories();
    this.domainReady = true;
  }

  /** 쓰지 않는 빈 카테고리(대학 만족도 조사, 기타 자체지표)를 제거한다. */
  private async removeUnusedEmptyCategories(): Promise<void> {
    const names = ['대학 만족도 조사', '기타(자체지표)'];
    for (const name of names) {
      const cats = await this.categoryRepo.find({ where: { categoryName: name } });
      for (const cat of cats) {
        const n = await this.metricRepo.count({
          where: { categoryId: cat.categoryId },
        });
        if (n === 0) {
          await this.categoryRepo.delete(cat.categoryId);
        }
      }
    }
  }

  /** 해당 지표에 연결된 원본 데이터 건수 */
  private async rawDataCount(metricId: number): Promise<number> {
    return this.metricRepo.manager.count(IrRawData, { where: { metricId } });
  }

  private async metricsWithRawData(metricIds: number[]): Promise<Set<number>> {
    const ids = [...new Set(metricIds.filter((id) => Number.isFinite(id)))];
    if (ids.length === 0) return new Set();
    const rows = await this.metricRepo.manager
      .createQueryBuilder(IrRawData, 'r')
      .select('r.metricId', 'metricId')
      .addSelect('COUNT(*)', 'cnt')
      .where('r.metricId IN (:...ids)', { ids })
      .groupBy('r.metricId')
      .getRawMany<{ metricId: string | number; cnt: string | number }>();
    return new Set(
      rows
        .filter((row) => Number(row.cnt) > 0)
        .map((row) => Number(row.metricId)),
    );
  }

  /**
   * 모니터링 화면에서 조회할 수 있는 연도 (내림차순).
   * 직접 업로드한 MONITORING 값뿐 아니라, 대학 전체값에 자동 연결된
   * 대학알리미 지표의 보유 연도도 포함한다.
   */
  async listMonitoringYears(): Promise<number[]> {
    const [rows, official] = await Promise.all([
      this.metricRepo.manager
        .createQueryBuilder(IrRawData, 'r')
        .innerJoin('r.metric', 'm')
        .select('r.year', 'year')
        .distinct(true)
        .where('m.sourceType = :sourceType', { sourceType: 'MONITORING' })
        .orderBy('r.year', 'DESC')
        .getRawMany<{ year: string | number }>(),
      this.getMonitoringOfficialLinks(),
    ]);

    return [
      ...new Set([
        ...rows.map((row) => Number(row.year)),
        ...official.years,
      ]),
    ]
      .filter((year) => Number.isFinite(year))
      .sort((a, b) => b - a);
  }

  /**
   * 모니터링 KPI와 대학알리미 대학 전체값의 연결 정보.
   * 프런트는 이 지표들을 같은 피벗 요청에 포함한 뒤 대학값만 공시 우선으로
   * 합성한다. 학과값에는 절대 대학 전체값을 복제하지 않는다.
   */
  async getMonitoringOfficialLinks(): Promise<{
    years: number[];
    links: Array<{
      monitoringMetricCode: string;
      alimiMetricId: number;
      alimiMetricName: string;
    }>;
  }> {
    await this.ensureMetricDomains();

    const names = [
      ...new Set(MONITORING_ALIMI_LINKS.flatMap((link) => link.alimiMetricNames)),
    ];
    const metrics = names.length
      ? await this.metricRepo.find({
          where: {
            sourceType: 'ALIMI',
            metricName: In(names),
          },
        })
      : [];
    const byName = new Map(metrics.map((metric) => [metric.metricName, metric]));

    const links = MONITORING_ALIMI_LINKS.flatMap((link) => {
      const metric = link.alimiMetricNames
        .map((name) => byName.get(name))
        .find((candidate) => !!candidate);
      return metric
        ? [
            {
              monitoringMetricCode: link.monitoringMetricCode,
              alimiMetricId: metric.metricId,
              alimiMetricName: metric.metricName,
            },
          ]
        : [];
    });

    if (links.length === 0) return { years: [], links: [] };

    const rows = await this.metricRepo.manager
      .createQueryBuilder(IrRawData, 'r')
      .select('r.year', 'year')
      .distinct(true)
      .where('r.metricId IN (:...metricIds)', {
        metricIds: links.map((link) => link.alimiMetricId),
      })
      .orderBy('r.year', 'DESC')
      .getRawMany<{ year: string | number }>();

    return {
      years: rows
        .map((row) => Number(row.year))
        .filter((year) => Number.isFinite(year)),
      links,
    };
  }

  /**
   * metric_code 도입 전에 심어진 시드 지표 찾기.
   * 업로드 동기화로 (학과별) 접미사가 붙은 이름도 같은 지표로 본다.
   */
  private async findLegacyMonitoringSeedMetrics(
    categoryId: number,
    parentMetricId: number | null,
    spec: MonitoringSeedMetric,
  ): Promise<IrMetricRegistry[]> {
    const siblings = await this.metricRepo.find({
      where:
        parentMetricId == null
          ? {
              categoryId,
              sourceType: 'MONITORING',
              parentMetricId: IsNull(),
            }
          : { categoryId, sourceType: 'MONITORING', parentMetricId },
    });
    const base = stripDeptLevelMetricSuffix(spec.name);
    return siblings.filter(
      (m) => !m.metricCode && stripDeptLevelMetricSuffix(m.metricName) === base,
    );
  }

  /**
   * 이름으로 시드를 찾던 시절 중복 생성된 빈 지표 정리.
   * 하위 지표와 원본 데이터가 모두 없는 행만 지운다.
   */
  private async pruneEmptyMonitoringDuplicates(
    duplicates: IrMetricRegistry[],
    keepMetricId: number,
  ): Promise<void> {
    for (const dup of duplicates) {
      if (dup.metricId === keepMetricId) continue;
      const children = await this.metricRepo.count({
        where: { parentMetricId: dup.metricId },
      });
      if (children > 0) continue;
      if ((await this.rawDataCount(dup.metricId)) > 0) continue;
      await this.metricRepo.delete(dup.metricId);
    }
  }

  private async ensureMonitoringMetric(
    categoryId: number,
    parentMetricId: number | null,
    spec: MonitoringSeedMetric,
    displayOrder: number,
    /** false면 없는 시드 지표를 다시 만들지 않는다(지표 DB 빌더에서 삭제한 상태 유지). */
    allowCreate: boolean,
  ): Promise<void> {
    // 코드로 먼저 찾으므로 지표명을 바꿔도 중복 생성되지 않는다.
    let metric = await this.metricRepo.findOne({
      where: { metricCode: spec.code, sourceType: 'MONITORING' },
    });

    if (!metric) {
      const legacy = await this.findLegacyMonitoringSeedMetrics(
        categoryId,
        parentMetricId,
        spec,
      );
      // 원본 데이터가 있는 행을 원본으로 본다 ((학과별) 이름으로 바뀐 시드 지표)
      let picked: IrMetricRegistry | undefined;
      for (const candidate of legacy) {
        if ((await this.rawDataCount(candidate.metricId)) > 0) {
          picked = candidate;
          break;
        }
      }
      picked = picked ?? legacy[0];

      if (picked) {
        picked.metricCode = spec.code;
        metric = await this.metricRepo.save(picked);
        await this.pruneEmptyMonitoringDuplicates(legacy, metric.metricId);
      }
    }

    if (!metric) {
      // 이미 모니터링 지표가 있는 DB에서는 삭제를 존중해 시드를 재생성하지 않는다.
      if (!allowCreate) return;
      metric = await this.metricRepo.save(
        this.metricRepo.create({
          categoryId,
          metricCode: spec.code,
          sourceType: 'MONITORING',
          metricName: spec.name,
          metricUnit: spec.unit,
          aggregationType: 'SUM',
          displayOrder,
          parentMetricId,
        }),
      );
    } else if (metric.metricUnit == null && spec.unit != null) {
      // 이름·순서·소속은 지표 DB 빌더에서 관리하므로 시드가 덮어쓰지 않는다.
      await this.metricRepo.update(metric.metricId, { metricUnit: spec.unit });
    }

    for (let i = 0; i < (spec.children ?? []).length; i++) {
      await this.ensureMonitoringMetric(
        metric.categoryId,
        metric.metricId,
        spec.children![i],
        i,
        allowCreate,
      );
    }
  }

  private async ensureMonitoringCategory(
    spec: MonitoringSeedCategory,
  ): Promise<IrMetricCategory> {
    let cat = await this.categoryRepo.findOne({
      where: { categoryCode: spec.code, sourceType: 'MONITORING' },
    });

    if (!cat) {
      // 코드 도입 전에 만들어진 시드 카테고리 백필
      const legacy = await this.categoryRepo.findOne({
        where: { categoryName: spec.categoryName, sourceType: 'MONITORING' },
      });
      if (legacy && !legacy.categoryCode) {
        legacy.categoryCode = spec.code;
        cat = await this.categoryRepo.save(legacy);
      }
    }

    if (!cat) {
      cat = await this.categoryRepo.save(
        this.categoryRepo.create({
          categoryCode: spec.code,
          categoryName: spec.categoryName,
          sourceType: 'MONITORING',
          displayOrder: spec.displayOrder,
        }),
      );
    }
    return cat;
  }

  /**
   * 대학주요모니터링 분류·하위지표 보장.
   * - 모니터링 지표가 하나도 없을 때만 시드로 생성(최초 부트스트랩).
   * - 그 외에는 코드 백필·단위 보정만 하고, 지표 DB 빌더에서 지운 지표는 다시 만들지 않는다.
   */
  private async ensureMonitoringCatalog(): Promise<void> {
    const existingCount = await this.metricRepo.count({
      where: { sourceType: 'MONITORING' },
    });
    const allowCreate = existingCount === 0;

    for (const spec of MONITORING_SEED_CATALOG) {
      const cat = await this.ensureMonitoringCategory(spec);

      if (spec.code === 'foundation') {
        await this.remountMonitoringForeignStudent(cat.categoryId);
      }

      for (let i = 0; i < spec.metrics.length; i++) {
        await this.ensureMonitoringMetric(
          cat.categoryId,
          null,
          spec.metrics[i],
          i,
          allowCreate,
        );
      }
    }
  }

  /**
   * 외국인 유학생 수는 재학생 수 구성 항목이 아니라 별도 지표다.
   * 이전에 재학생 수 하위로 심어진 '외국인 재학생 수'를 루트로 옮기고 이름을 맞춘다.
   * 코드가 부여된 뒤(=이름 변경 가능 상태)에는 이름을 건드리지 않는다.
   */
  private async remountMonitoringForeignStudent(
    foundationCategoryId: number,
  ): Promise<void> {
    const coded = await this.metricRepo.findOne({
      where: { metricCode: 'foreign-student-count', sourceType: 'MONITORING' },
    });
    if (coded) return;

    const found = await this.metricRepo.find({
      where: [
        { sourceType: 'MONITORING', metricName: '외국인 재학생 수' },
        { sourceType: 'MONITORING', metricName: '외국인 유학생 수' },
      ],
    });
    if (found.length === 0) return;

    const keep =
      found.find((m) => m.metricName === '외국인 유학생 수') ?? found[0];

    await this.metricRepo.update(keep.metricId, {
      categoryId: foundationCategoryId,
      parentMetricId: null,
      metricName: '외국인 유학생 수',
      metricUnit: keep.metricUnit ?? '명',
      displayOrder: 1,
    });

    for (const extra of found) {
      if (extra.metricId === keep.metricId) continue;
      await this.metricRepo.update(extra.metricId, {
        categoryId: foundationCategoryId,
        parentMetricId: keep.metricId,
      });
    }
  }

  private toMetricNode(
    m: IrMetricRegistry,
    hasRawData = false,
  ): MetricNode {
    return {
      metricId: m.metricId,
      metricCode: m.metricCode ?? null,
      metricName: m.metricName,
      metricUnit: m.metricUnit,
      sourceType: m.sourceType,
      displayOrder: m.displayOrder,
      parentMetricId: m.parentMetricId ?? null,
      isHidden: !!m.isHidden,
      computeFormula: m.computeFormula ?? null,
      computeEnabled: !!m.computeEnabled,
      hasRawData,
      children: [],
    };
  }

  private filterHiddenMetrics(nodes: MetricNode[]): MetricNode[] {
    return nodes
      .filter((n) => !n.isHidden)
      .map((n) => ({
        ...n,
        children: this.filterHiddenMetrics(n.children),
      }));
  }

  private nestMetrics(
    metrics: IrMetricRegistry[],
    rawDataIds: Set<number>,
  ): MetricNode[] {
    const nodes = new Map<number, MetricNode>();
    for (const m of metrics) {
      nodes.set(m.metricId, this.toMetricNode(m, rawDataIds.has(m.metricId)));
    }
    const roots: MetricNode[] = [];
    const sorted = [...metrics].sort(
      (a, b) =>
        a.displayOrder - b.displayOrder || a.metricId - b.metricId,
    );
    for (const m of sorted) {
      const node = nodes.get(m.metricId)!;
      const parentId = m.parentMetricId ?? null;
      const parent = parentId != null ? nodes.get(parentId) : undefined;
      if (parent && parent.metricId !== node.metricId) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    const sortRec = (list: MetricNode[]) => {
      list.sort(
        (a, b) =>
          a.displayOrder - b.displayOrder || a.metricId - b.metricId,
      );
      list.forEach((n) => sortRec(n.children));
    };
    sortRec(roots);
    return roots;
  }

  /**
   * 업무 주제별 카테고리 기준 지표 트리.
   * sourceType이 있으면 해당 출처만 반환.
   * 「분류없음」은 항상 최상단에 노출.
   * includeHidden=false(기본)이면 숨김 카테고리·지표는 제외한다.
   */
  async getCategoryTree(
    sourceType?: MetricSourceType,
    includeHidden = false,
  ): Promise<CategoryTreeNode[]> {
    await this.ensureMetricDomains();

    const categories = await this.categoryRepo.find({
      where: sourceType ? { sourceType } : undefined,
      order: { displayOrder: 'ASC', categoryId: 'ASC' },
    });
    const metrics = await this.metricRepo.find({
      where: sourceType ? { sourceType } : undefined,
      order: { displayOrder: 'ASC', metricId: 'ASC' },
    });
    const rawDataIds = await this.metricsWithRawData(
      metrics.map((m) => m.metricId),
    );

    let nodes: CategoryTreeNode[] = categories.map((cat) => ({
      categoryId: cat.categoryId,
      categoryCode: cat.categoryCode ?? null,
      categoryName: cat.categoryName,
      displayOrder: cat.displayOrder,
      sourceType: cat.sourceType,
      isHidden: !!cat.isHidden,
      metrics: this.nestMetrics(
        metrics.filter((m) => m.categoryId === cat.categoryId),
        rawDataIds,
      ),
    }));

    if (!includeHidden) {
      nodes = nodes
        .filter((c) => !c.isHidden)
        .map((c) => ({
          ...c,
          metrics: this.filterHiddenMetrics(c.metrics),
        }))
        .filter((c) => c.metrics.length > 0);
    }

    return nodes.sort((a, b) => {
      if (a.categoryName === UNCATEGORIZED_CATEGORY_NAME) return -1;
      if (b.categoryName === UNCATEGORIZED_CATEGORY_NAME) return 1;
      return a.displayOrder - b.displayOrder || a.categoryId - b.categoryId;
    });
  }

  async listCategories(): Promise<IrMetricCategory[]> {
    await this.ensureMetricDomains();
    return this.categoryRepo.find({
      order: { displayOrder: 'ASC' },
    });
  }

  /**
   * 업로드용 지표 코드북 (공시 / 자체 / 모니터링 구분).
   * includeHidden=false(기본)이면 숨김 카테고리·지표는 양식·코드북에서 제외한다.
   */
  async getCodebook(includeHidden = false): Promise<{
    generatedAt: string;
    metrics: Array<{
      metricId: number;
      metricCode: string | null;
      metricName: string;
      sourceType: MetricSourceType;
      sourceLabel: string;
      categoryName: string;
      metricUnit: string | null;
      parentMetricId: number | null;
      parentMetricName: string | null;
      /** 기존 원시데이터에 대학 전체(_ALL_) 값이 있는지 */
      hasUniversityData: boolean;
      /** 기존 원시데이터에 학과 값이 있는지 */
      hasDepartmentData: boolean;
      /** 대학 전체값(_ALL_)을 대학알리미 값으로 우선 대체하는 지표 */
      officialAllLinked: boolean;
      /** 자동연결에 사용하는 대학알리미 지표명 */
      officialMetricName: string | null;
    }>;
  }> {
    await this.ensureMetricDomains();

    const all = await this.metricRepo.find({
      relations: ['category'],
      order: {
        sourceType: 'ASC',
        metricName: 'ASC',
        metricId: 'ASC',
      },
    });
    const byId = new Map(all.map((m) => [m.metricId, m]));
    const metrics = includeHidden
      ? all
      : all.filter((m) => !m.isHidden && !m.category?.isHidden);
    const officialByMonitoringCode = new Map(
      MONITORING_ALIMI_LINKS.map((link) => [
        link.monitoringMetricCode,
        link.alimiMetricNames[0] ?? null,
      ]),
    );
    const scopeRows: Array<{
      metricId: string;
      hasUniversityData: string;
      hasDepartmentData: string;
    }> = await this.rawRepo
      .createQueryBuilder('raw')
      .select('raw.metric_id', 'metricId')
      .addSelect(
        `MAX(CASE WHEN raw.dept_code = '_ALL_' THEN 1 ELSE 0 END)`,
        'hasUniversityData',
      )
      .addSelect(
        `MAX(CASE WHEN raw.dept_code <> '_ALL_' THEN 1 ELSE 0 END)`,
        'hasDepartmentData',
      )
      .groupBy('raw.metric_id')
      .getRawMany();
    const scopesByMetricId = new Map(
      scopeRows.map((row) => [
        Number(row.metricId),
        {
          hasUniversityData: Number(row.hasUniversityData) === 1,
          hasDepartmentData: Number(row.hasDepartmentData) === 1,
        },
      ]),
    );

    return {
      generatedAt: new Date().toISOString(),
      metrics: metrics.map((m) => {
        const parent =
          m.parentMetricId != null ? byId.get(m.parentMetricId) : undefined;
        const officialMetricName =
          m.sourceType === 'MONITORING' && m.metricCode
            ? (officialByMonitoringCode.get(m.metricCode) ?? null)
            : null;
        const scopes = scopesByMetricId.get(m.metricId);
        return {
          metricId: m.metricId,
          metricCode: m.metricCode ?? null,
          metricName: m.metricName,
          sourceType: m.sourceType,
          sourceLabel: sourceTypeLabel(m.sourceType),
          categoryName: m.category?.categoryName ?? '',
          metricUnit: m.metricUnit,
          parentMetricId: m.parentMetricId ?? null,
          parentMetricName: parent?.metricName ?? null,
          hasUniversityData: scopes?.hasUniversityData ?? false,
          hasDepartmentData: scopes?.hasDepartmentData ?? false,
          officialAllLinked: officialMetricName != null,
          officialMetricName,
        };
      }),
    };
  }

  async createCategory(data: Partial<IrMetricCategory>): Promise<IrMetricCategory> {
    if (data.categoryName?.trim() === UNCATEGORIZED_CATEGORY_NAME) {
      throw new BadRequestException(
        `「${UNCATEGORIZED_CATEGORY_NAME}」은 시스템 카테고리입니다.`,
      );
    }
    const sourceType = coerceMetricSourceType(data.sourceType);
    return this.categoryRepo.save(
      this.categoryRepo.create({ ...data, sourceType }),
    );
  }

  async updateCategory(
    categoryId: number,
    data: { categoryName: string },
  ): Promise<IrMetricCategory> {
    const cat = await this.categoryRepo.findOne({ where: { categoryId } });
    if (!cat) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    if (cat.categoryName === UNCATEGORIZED_CATEGORY_NAME) {
      throw new BadRequestException(
        `「${UNCATEGORIZED_CATEGORY_NAME}」카테고리 이름은 변경할 수 없습니다.`,
      );
    }

    const name = data.categoryName?.trim();
    if (!name) {
      throw new BadRequestException('카테고리 이름을 입력해 주세요.');
    }
    if (name === UNCATEGORIZED_CATEGORY_NAME) {
      throw new BadRequestException(
        `「${UNCATEGORIZED_CATEGORY_NAME}」은 시스템 카테고리입니다.`,
      );
    }

    cat.categoryName = name;
    return this.categoryRepo.save(cat);
  }

  async createMetric(data: {
    categoryId: number;
    sourceType?: MetricSourceType;
    metricName: string;
    metricUnit?: string | null;
    aggregationType?: string;
    displayOrder?: number;
    parentMetricId?: number | null;
  }): Promise<IrMetricRegistry> {
    const name = data.metricName?.trim();
    if (!name) {
      throw new BadRequestException('지표 이름을 입력해 주세요.');
    }

    const cat = await this.categoryRepo.findOne({
      where: { categoryId: data.categoryId },
    });
    if (!cat) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }

    const sourceType = coerceMetricSourceType(data.sourceType ?? cat.sourceType);
    if (cat.sourceType !== sourceType) {
      throw new BadRequestException(
        '지표 출처가 카테고리 출처와 일치하지 않습니다.',
      );
    }

    let parentMetricId: number | null = data.parentMetricId ?? null;
    if (parentMetricId != null) {
      const parent = await this.metricRepo.findOne({
        where: { metricId: parentMetricId },
      });
      if (!parent) {
        throw new NotFoundException('상위 지표를 찾을 수 없습니다.');
      }
      if (parent.categoryId !== cat.categoryId) {
        throw new BadRequestException(
          '상위 지표는 같은 카테고리에 있어야 합니다.',
        );
      }
      if (parent.sourceType !== sourceType) {
        throw new BadRequestException(
          '상위 지표의 출처가 일치하지 않습니다.',
        );
      }
    }

    const siblingWhere =
      parentMetricId == null
        ? { categoryId: cat.categoryId, parentMetricId: IsNull() }
        : { categoryId: cat.categoryId, parentMetricId };
    const siblings = await this.metricRepo.find({
      where: siblingWhere,
      order: { displayOrder: 'DESC' },
      take: 1,
    });
    const displayOrder =
      data.displayOrder ?? (siblings[0] ? siblings[0].displayOrder + 1 : 0);

    return this.metricRepo.save(
      this.metricRepo.create({
        categoryId: cat.categoryId,
        sourceType,
        metricName: name,
        metricUnit: data.metricUnit ?? null,
        aggregationType: data.aggregationType ?? 'SUM',
        displayOrder,
        parentMetricId,
      }),
    );
  }

  /**
   * 지표명·자동계산식 변경. metric_id·metric_code는 유지되므로 원본 데이터, 프리셋,
   * 모니터링 KPI 매칭이 그대로 유지된다.
   * 대학정보공시(ALIMI)는 알리미 배치가 지표명으로 값을 다시 물기 때문에 이름 수정 불가.
   */
  async updateMetric(
    metricId: number,
    data: {
      metricName?: string;
      computeFormula?: string | null;
      computeEnabled?: boolean;
    },
  ): Promise<IrMetricRegistry> {
    const metric = await this.metricRepo.findOne({ where: { metricId } });
    if (!metric) {
      throw new NotFoundException('지표를 찾을 수 없습니다.');
    }

    const hasName = data.metricName !== undefined;
    const hasFormula = data.computeFormula !== undefined;
    const hasEnabled = data.computeEnabled !== undefined;
    if (!hasName && !hasFormula && !hasEnabled) {
      throw new BadRequestException('수정할 항목이 없습니다.');
    }

    if (hasName) {
      if (metric.sourceType === 'ALIMI') {
        throw new BadRequestException(
          '대학정보공시 지표명은 변경할 수 없습니다. 자체 데이터·모니터링 지표만 수정할 수 있습니다.',
        );
      }

      const input = data.metricName?.trim();
      if (!input) {
        throw new BadRequestException('지표명을 입력해 주세요.');
      }
      if (input.length > 300) {
        throw new BadRequestException('지표명은 300자 이내로 입력해 주세요.');
      }

      // 학과단위 데이터가 있는 지표는 (학과별) 접미사를 유지해야 업로드 동기화와 어긋나지 않는다.
      const name = hasDeptLevelMetricSuffix(metric.metricName)
        ? withDeptLevelMetricSuffix(input)
        : input;

      if (name !== metric.metricName) {
        await this.assertMetricNameAvailable(metric, name);
        metric.metricName = name;
      }
    }

    if (hasFormula || hasEnabled) {
      if (metric.sourceType !== 'MONITORING') {
        throw new BadRequestException(
          '자동계산식은 대학주요모니터링 지표에만 설정할 수 있습니다.',
        );
      }
      if (isLockedAutoComputeMetric(metric.metricCode)) {
        throw new BadRequestException(
          '이 지표는 조회 화면의 계산 방식이 고정되어 있어 계산식을 바꿀 수 없습니다.',
        );
      }

      if (hasFormula) {
        const raw = data.computeFormula;
        metric.computeFormula =
          raw == null || String(raw).trim() === ''
            ? null
            : String(raw).trim();
      }
      if (hasEnabled) {
        metric.computeEnabled = !!data.computeEnabled;
      }

      if (metric.computeEnabled) {
        if (!metric.computeFormula) {
          throw new BadRequestException(
            '자동계산을 켜려면 하위지표 계산식을 입력해 주세요.',
          );
        }
        const children = await this.metricRepo.find({
          where: { parentMetricId: metric.metricId },
        });
        try {
          validateMetricFormula(
            metric.computeFormula,
            children.map((c) => c.metricId),
          );
        } catch (e) {
          if (e instanceof FormulaError) {
            throw new BadRequestException(e.message);
          }
          throw e;
        }
      }
    }

    return this.metricRepo.save(metric);
  }

  /**
   * 이름 충돌 검사.
   * 자체 데이터는 업로드가 지표명으로 값을 찾으므로 출처 전체에서 유일해야 한다.
   * 모니터링은 회계 수입/지출처럼 같은 이름이 여러 상위 아래 존재하므로
   * 같은 상위(형제) 안에서만 중복을 막는다. 업로드는 metric_id로 구분한다.
   */
  private async assertMetricNameAvailable(
    metric: IrMetricRegistry,
    name: string,
  ): Promise<void> {
    if (metric.sourceType === 'MONITORING') {
      const siblings = await this.metricRepo.find({
        where:
          metric.parentMetricId == null
            ? {
                sourceType: 'MONITORING',
                categoryId: metric.categoryId,
                parentMetricId: IsNull(),
              }
            : {
                sourceType: 'MONITORING',
                parentMetricId: metric.parentMetricId,
              },
      });
      const clash = siblings.find(
        (m) => m.metricId !== metric.metricId && m.metricName === name,
      );
      if (clash) {
        throw new BadRequestException(
          `같은 위치에 이미 「${name}」 지표가 있습니다. 다른 이름을 사용해 주세요.`,
        );
      }
      return;
    }

    const duplicate = await this.metricRepo.findOne({
      where: {
        metricName: name,
        sourceType: metric.sourceType,
        metricId: Not(metric.metricId),
      },
    });
    if (duplicate) {
      throw new BadRequestException(
        `이미 「${name}」 지표가 있습니다. 엑셀 업로드가 지표명으로 값을 찾기 때문에 중복 이름은 사용할 수 없습니다.`,
      );
    }
  }

  async setCategoryHidden(
    categoryId: number,
    isHidden: boolean,
  ): Promise<IrMetricCategory> {
    const cat = await this.categoryRepo.findOne({ where: { categoryId } });
    if (!cat) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    cat.isHidden = isHidden;
    return this.categoryRepo.save(cat);
  }

  async setMetricHidden(
    metricId: number,
    isHidden: boolean,
  ): Promise<IrMetricRegistry> {
    const metric = await this.metricRepo.findOne({ where: { metricId } });
    if (!metric) {
      throw new NotFoundException('지표를 찾을 수 없습니다.');
    }
    metric.isHidden = isHidden;
    return this.metricRepo.save(metric);
  }

  /** 하위 지표를 먼저 지운 뒤 본 지표를 삭제한다. raw_data는 FK CASCADE. */
  private async deleteMetricTree(metricId: number): Promise<void> {
    const children = await this.metricRepo.find({
      where: { parentMetricId: metricId },
    });
    for (const child of children) {
      await this.deleteMetricTree(child.metricId);
    }
    await this.metricRepo.delete(metricId);
  }

  async deleteMetric(metricId: number): Promise<{ ok: true }> {
    const metric = await this.metricRepo.findOne({ where: { metricId } });
    if (!metric) {
      throw new NotFoundException('지표를 찾을 수 없습니다.');
    }
    await this.deleteMetricTree(metricId);
    return { ok: true };
  }

  /**
   * 카테고리와 소속 지표·원본 데이터를 삭제. 「분류없음」 자체는 삭제 불가.
   */
  async deleteCategory(categoryId: number): Promise<{ ok: true }> {
    const cat = await this.categoryRepo.findOne({ where: { categoryId } });
    if (!cat) {
      throw new NotFoundException('카테고리를 찾을 수 없습니다.');
    }
    if (cat.categoryName === UNCATEGORIZED_CATEGORY_NAME) {
      throw new BadRequestException(
        `「${UNCATEGORIZED_CATEGORY_NAME}」카테고리는 삭제할 수 없습니다.`,
      );
    }

    const metrics = await this.metricRepo.find({ where: { categoryId } });
    const ids = new Set(metrics.map((m) => m.metricId));
    const roots = metrics.filter(
      (m) => m.parentMetricId == null || !ids.has(m.parentMetricId),
    );
    for (const root of roots) {
      await this.deleteMetricTree(root.metricId);
    }
    const leftover = await this.metricRepo.find({ where: { categoryId } });
    for (const m of leftover) {
      await this.deleteMetricTree(m.metricId);
    }
    await this.categoryRepo.delete(categoryId);
    return { ok: true };
  }

  /**
   * TreeBuilder(관리자) 드래그&드롭 결과 반영: 카테고리/지표 display_order 및 소속 일괄 갱신.
   */
  async reorder(payload: {
    categories?: { categoryId: number; displayOrder: number }[];
    metrics?: {
      metricId: number;
      categoryId: number;
      displayOrder: number;
      parentMetricId?: number | null;
    }[];
  }): Promise<{ ok: true }> {
    for (const c of payload.categories ?? []) {
      await this.categoryRepo.update(c.categoryId, {
        displayOrder: c.displayOrder,
      });
    }
    for (const m of payload.metrics ?? []) {
      const patch: Partial<IrMetricRegistry> = {
        categoryId: m.categoryId,
        displayOrder: m.displayOrder,
      };
      if ('parentMetricId' in m) {
        patch.parentMetricId = m.parentMetricId ?? null;
      }
      await this.metricRepo.update(m.metricId, patch);
    }
    await this.ensureMetricDomains();
    return { ok: true };
  }
}
