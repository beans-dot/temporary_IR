import type { CategoryTreeNode, MetricNode } from '@/lib/api';
import { UNCATEGORIZED_CATEGORY_NAME } from '@/lib/metricConstants';
import {
  MONITORING_CATEGORIES,
  MONITORING_KPI_MAP,
  STUDENT_COUNT_COMPONENT_CODES,
  STUDENT_COUNT_COMPONENT_NAMES,
  isLockedAutoComputeMetric,
} from './catalog';
import { collectFormulaMetricIds, toFormulaEvalNode } from './composeFormula';
import { formulaToDisplay } from './formula';
import type {
  MonitoringCategoryDef,
  MonitoringKpiDef,
  ResolvedAccountingKpi,
  ResolvedCompositeKpi,
  ResolvedDirectKpi,
  ResolvedFormulaKpi,
  StudentCountComponentKey,
} from './types';

const DEPT_SUFFIXES = ['(학과별)', '(학과)'];

export function stripDeptLevelSuffix(name: string): string {
  let n = name.trim();
  for (const suffix of DEPT_SUFFIXES) {
    if (n.endsWith(suffix)) n = n.slice(0, -suffix.length).trimEnd();
  }
  return n;
}

function walkMetrics(metrics: MetricNode[], visit: (m: MetricNode) => void) {
  for (const m of metrics) {
    visit(m);
    if (m.children?.length) walkMetrics(m.children, visit);
  }
}

function flattenMetrics(tree: CategoryTreeNode[]): MetricNode[] {
  const out: MetricNode[] = [];
  for (const cat of tree) {
    walkMetrics(cat.metrics ?? [], (m) => out.push(m));
  }
  return out;
}

function collectByName(metrics: MetricNode[], targetName: string) {
  const base = stripDeptLevelSuffix(targetName);
  const matched = metrics.filter(
    (m) => stripDeptLevelSuffix(m.metricName) === base,
  );
  const unit =
    matched.find((m) => m.metricUnit)?.metricUnit ??
    matched[0]?.metricUnit ??
    null;
  return { ids: matched.map((m) => m.metricId), unit, nodes: matched };
}

function collectLeafIds(node: MetricNode): number[] {
  if (!node.children?.length) return [node.metricId];
  return node.children.flatMap(collectLeafIds);
}

function childNamed(parent: MetricNode | undefined, name: string) {
  return parent?.children?.find(
    (c) => stripDeptLevelSuffix(c.metricName) === stripDeptLevelSuffix(name),
  );
}

function childByCode(parent: MetricNode | undefined, code: string) {
  return parent?.children?.find((c) => c.metricCode === code);
}

function displayName(node: MetricNode | undefined, fallback: string): string {
  return node ? stripDeptLevelSuffix(node.metricName) : fallback;
}

function categoryKey(cat: CategoryTreeNode): string {
  return cat.categoryCode ?? `cat-${cat.categoryId}`;
}

/** 시드에 없는 루트 지표 → 직접 조회 KPI로 취급 */
function synthesizeDirectKpi(
  node: MetricNode,
  categoryId: string,
): MonitoringKpiDef {
  const id = node.metricCode ?? `metric-${node.metricId}`;
  return {
    id,
    categoryId,
    label: stripDeptLevelSuffix(node.metricName),
    kind: 'direct',
    metricCode: id,
    metricName: node.metricName,
    direction: 'higher-better',
    seriesAggregation: 'sum',
    fallbackUnit: node.metricUnit,
  };
}

function resolveComposite(
  kpi: MonitoringKpiDef,
  parent: MetricNode,
  allMetrics: MetricNode[],
  byCode: Map<string, MetricNode>,
  idSet: Set<number>,
): ResolvedCompositeKpi {
  const components = {} as ResolvedCompositeKpi['components'];
  let found = false;
  let unit: string | null = parent.metricUnit ?? kpi.fallbackUnit;

  (
    Object.keys(STUDENT_COUNT_COMPONENT_NAMES) as StudentCountComponentKey[]
  ).forEach((key) => {
    const coded =
      childByCode(parent, STUDENT_COUNT_COMPONENT_CODES[key]) ??
      byCode.get(STUDENT_COUNT_COMPONENT_CODES[key]);
    const fromParent =
      coded ?? childNamed(parent, STUDENT_COUNT_COMPONENT_NAMES[key]);
    const hit = fromParent
      ? {
          ids: collectLeafIds(fromParent),
          unit: fromParent.metricUnit,
        }
      : collectByName(allMetrics, STUDENT_COUNT_COMPONENT_NAMES[key]);
    hit.ids.forEach((id) => idSet.add(id));
    if (hit.ids.length > 0) {
      found = true;
      if (hit.unit) unit = hit.unit;
    }
    components[key] = { metricIds: hit.ids, found: hit.ids.length > 0 };
  });

  return {
    kpi,
    label: displayName(parent, kpi.label),
    components,
    unit,
    found,
  };
}

function resolveAccounting(
  kpi: MonitoringKpiDef,
  parent: MetricNode,
  idSet: Set<number>,
): ResolvedAccountingKpi {
  const incomeGroup =
    childByCode(parent, `${kpi.metricCode}.income`) ??
    childNamed(parent, '수입');
  const expenseGroup =
    childByCode(parent, `${kpi.metricCode}.expense`) ??
    childNamed(parent, '지출');
  const toLines = (group: MetricNode | undefined) => {
    const leaves = group?.children?.length
      ? group.children
      : group
        ? [group]
        : [];
    return leaves.map((leaf) => {
      const ids = collectLeafIds(leaf);
      ids.forEach((id) => idSet.add(id));
      return {
        name: leaf.metricName,
        metricIds: ids,
        found: ids.length > 0,
      };
    });
  };
  const incomeLines = toLines(incomeGroup);
  const expenseLines = toLines(expenseGroup);
  return {
    kpi,
    label: displayName(parent, kpi.label),
    incomeLines,
    expenseLines,
    unit: parent.metricUnit ?? kpi.fallbackUnit,
    found: incomeLines.length > 0 || expenseLines.length > 0,
  };
}

function resolveDirect(
  kpi: MonitoringKpiDef,
  node: MetricNode,
  allMetrics: MetricNode[],
  idSet: Set<number>,
): ResolvedDirectKpi {
  const names =
    kpi.id === 'foreign-student-count'
      ? ['외국인 유학생 수', '외국인 재학생 수']
      : [kpi.metricName ?? kpi.label];
  const nodes = [
    node,
    ...allMetrics.filter(
      (m) =>
        !m.metricCode &&
        m.metricId !== node.metricId &&
        stripDeptLevelSuffix(m.metricName) ===
          stripDeptLevelSuffix(node.metricName),
    ),
    // 코드가 없는 레거시 동명만 이름 폴백
    ...(node.metricCode
      ? []
      : names.flatMap((n) => collectByName(allMetrics, n).nodes)),
  ];
  const unique = new Map(nodes.map((n) => [n.metricId, n]));
  const list = Array.from(unique.values());
  // 하위지표가 있어도 자동계산이 꺼져 있으면 이 지표 자체 값만 사용한다.
  const ids = [...new Set(list.map((n) => n.metricId))];
  ids.forEach((id) => idSet.add(id));
  return {
    kpi,
    label: displayName(list[0], kpi.label),
    metricIds: ids,
    unit: list.find((n) => n.metricUnit)?.metricUnit ?? kpi.fallbackUnit,
    found: ids.length > 0,
  };
}

function canUseFormula(node: MetricNode): boolean {
  return (
    !!node.computeEnabled &&
    !!node.computeFormula &&
    !isLockedAutoComputeMetric(node.metricCode)
  );
}

function resolveFormula(
  kpi: MonitoringKpiDef,
  node: MetricNode,
  idSet: Set<number>,
): ResolvedFormulaKpi {
  const evalNode = toFormulaEvalNode(node);
  const metricIds = collectFormulaMetricIds(evalNode);
  metricIds.forEach((id) => idSet.add(id));
  const children = (node.children ?? []).map((c) => ({
    metricId: c.metricId,
    metricName: c.metricName,
  }));
  return {
    kpi: { ...kpi, kind: 'formula' },
    label: displayName(node, kpi.label),
    unit: node.metricUnit ?? kpi.fallbackUnit,
    found: true,
    node: evalNode,
    formulaLabel: formulaToDisplay(node.computeFormula, children),
    metricIds,
  };
}

/**
 * DB 지표 트리를 기준으로 현황 보드 KPI를 구성한다.
 * - 트리에 없는(삭제·숨김) 시드 KPI는 카드에 나오지 않는다.
 * - 지표 DB 빌더에서 추가한 루트 지표는 직접 조회 카드로 나타난다.
 */
export function resolveMonitoringMetrics(tree: CategoryTreeNode[]): {
  directs: ResolvedDirectKpi[];
  formulas: ResolvedFormulaKpi[];
  composite: ResolvedCompositeKpi | null;
  accountings: ResolvedAccountingKpi[];
  allMetricIds: number[];
  sections: MonitoringCategoryDef[];
} {
  const metrics = flattenMetrics(tree);
  const byCode = new Map<string, MetricNode>();
  for (const m of metrics) {
    if (m.metricCode && !byCode.has(m.metricCode)) byCode.set(m.metricCode, m);
  }

  const directs: ResolvedDirectKpi[] = [];
  const formulas: ResolvedFormulaKpi[] = [];
  const accountings: ResolvedAccountingKpi[] = [];
  const idSet = new Set<number>();
  let composite: ResolvedCompositeKpi | null = null;
  const sections: MonitoringCategoryDef[] = [];

  for (const cat of tree) {
    if (cat.categoryName === UNCATEGORIZED_CATEGORY_NAME) continue;
    const catId = categoryKey(cat);
    const catalogSection = MONITORING_CATEGORIES.find((c) => c.id === catId);
    const kpiIds: string[] = [];

    for (const root of cat.metrics ?? []) {
      // 대학알리미 API에서 정원 내 값을 별도로 제공하지 않아 현재 화면에서는
      // 노출하지 않는다. DB 지표와 업로드 값은 그대로 보존한다.
      if (root.metricCode === 'enrolled-fill-inner') continue;

      const catalogKpi = root.metricCode
        ? MONITORING_KPI_MAP[root.metricCode]
        : undefined;

      if (catalogKpi?.kind === 'composite') {
        const resolved = resolveComposite(
          catalogKpi,
          root,
          metrics,
          byCode,
          idSet,
        );
        if (!resolved.found) continue;
        composite = resolved;
        kpiIds.push(catalogKpi.id);
        continue;
      }

      if (catalogKpi?.kind === 'accounting') {
        const resolved = resolveAccounting(catalogKpi, root, idSet);
        if (!resolved.found) continue;
        accountings.push(resolved);
        kpiIds.push(catalogKpi.id);
        continue;
      }

      const baseKpi =
        catalogKpi?.kind === 'direct'
          ? catalogKpi
          : synthesizeDirectKpi(root, catId);

      if (canUseFormula(root)) {
        const resolved = resolveFormula(baseKpi, root, idSet);
        formulas.push(resolved);
        kpiIds.push(resolved.kpi.id);
        continue;
      }

      const resolved = resolveDirect(baseKpi, root, metrics, idSet);
      if (!resolved.found) continue;
      directs.push(resolved);
      kpiIds.push(baseKpi.id);
    }

    if (kpiIds.length === 0) continue;
    sections.push({
      id: catId,
      title: cat.categoryName,
      description: catalogSection?.description ?? '',
      kpiIds,
    });
  }

  return {
    directs,
    formulas,
    composite,
    accountings,
    allMetricIds: Array.from(idSet),
    sections,
  };
}

/** 시드 카테고리 코드 → 현재 카테고리명 */
export function resolveCategoryTitles(
  tree: CategoryTreeNode[],
): Record<string, string> {
  const titles: Record<string, string> = {};
  for (const cat of tree) {
    if (cat.categoryCode) titles[cat.categoryCode] = cat.categoryName;
  }
  return titles;
}
