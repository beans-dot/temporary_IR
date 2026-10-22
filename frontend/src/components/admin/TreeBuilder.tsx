'use client';

import { useEffect, useState } from 'react';
import {
  DragDropContext,
  Draggable,
  Droppable,
  type DraggableProvidedDragHandleProps,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  ArrowRight,
  Calculator,
  Check,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { api, type CategoryTreeNode, type MetricNode } from '@/lib/api';
import { UNCATEGORIZED_CATEGORY_NAME } from '@/lib/metricConstants';
import {
  isLockedAutoComputeMetric,
  monitoringComputeRole,
} from '@/lib/monitoring/catalog';
import { cn } from '@/lib/utils';
import { FormulaEditorDialog } from '@/components/admin/FormulaEditorDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

const CATEGORIES_DROPPABLE_ID = 'categories';
const CATEGORY_DRAG_PREFIX = 'category-';

function isUncategorized(cat: CategoryTreeNode): boolean {
  return cat.categoryName === UNCATEGORIZED_CATEGORY_NAME;
}

function sortTree(nodes: CategoryTreeNode[]): CategoryTreeNode[] {
  return [...nodes].sort((a, b) => {
    if (isUncategorized(a)) return -1;
    if (isUncategorized(b)) return 1;
    return a.displayOrder - b.displayOrder || a.categoryId - b.categoryId;
  });
}

function splitTree(nodes: CategoryTreeNode[]): {
  uncategorized: CategoryTreeNode | null;
  ordered: CategoryTreeNode[];
} {
  const uncategorized = nodes.find(isUncategorized) ?? null;
  const ordered = nodes.filter((c) => !isUncategorized(c));
  return { uncategorized, ordered };
}

function metricLabel(m: MetricNode): string {
  const name = m.metricName;
  return m.isHidden ? `[숨김] ${name}` : name;
}

function ComputeRoleBadge({
  metric,
  parentComputed,
}: {
  metric: MetricNode;
  parentComputed?: boolean;
}) {
  const catalog = monitoringComputeRole(metric.metricCode);
  const role =
    catalog ??
    (metric.computeEnabled
      ? 'computed'
      : parentComputed
        ? 'component'
        : null);
  if (!role) return null;
  if (role === 'computed') {
    const formulaHint = metric.computeFormula
      ? ' 계산식이 설정되어 있습니다.'
      : '';
    return (
      <Badge
        variant="outline"
        className="shrink-0 border-violet-300 bg-violet-50 text-violet-800"
        title={
          catalog
            ? '하위 구성항목을 합산해 조회 화면에 표시합니다. 이 행 자체는 업로드하지 않습니다.'
            : `하위지표 계산식으로 조회 화면에 표시합니다.${formulaHint} 하위 항목만 엑셀로 올리면 됩니다.`
        }
      >
        자동계산
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-sky-300 bg-sky-50 text-sky-800"
      title="자동계산 지표의 입력 항목입니다. 엑셀 업로드 대상입니다."
    >
      구성항목
    </Badge>
  );
}

function categoryLabel(cat: CategoryTreeNode): string {
  return cat.isHidden ? `[숨김] ${cat.categoryName}` : cat.categoryName;
}

function countMetricNodes(metrics: MetricNode[]): number {
  return metrics.reduce(
    (n, m) => n + 1 + countMetricNodes(m.children ?? []),
    0,
  );
}

function setMetricHiddenInTree(
  metrics: MetricNode[],
  metricId: number,
  isHidden: boolean,
): MetricNode[] {
  return metrics.map((m) => {
    if (m.metricId === metricId) return { ...m, isHidden };
    return {
      ...m,
      children: setMetricHiddenInTree(m.children ?? [], metricId, isHidden),
    };
  });
}

function removeMetricFromTree(
  metrics: MetricNode[],
  metricId: number,
): MetricNode[] {
  return metrics
    .filter((m) => m.metricId !== metricId)
    .map((m) => ({
      ...m,
      children: removeMetricFromTree(m.children ?? [], metricId),
    }));
}

function renameMetricInTree(
  metrics: MetricNode[],
  metricId: number,
  metricName: string,
): MetricNode[] {
  return metrics.map((m) => {
    if (m.metricId === metricId) return { ...m, metricName };
    return {
      ...m,
      children: renameMetricInTree(m.children ?? [], metricId, metricName),
    };
  });
}

function patchMetricInTree(
  metrics: MetricNode[],
  metricId: number,
  patch: Partial<MetricNode>,
): MetricNode[] {
  return metrics.map((m) => {
    if (m.metricId === metricId) return { ...m, ...patch };
    return {
      ...m,
      children: patchMetricInTree(m.children ?? [], metricId, patch),
    };
  });
}

function findMetricInList(
  metrics: MetricNode[],
  metricId: number,
): MetricNode | undefined {
  for (const m of metrics) {
    if (m.metricId === metricId) return m;
    const hit = findMetricInList(m.children ?? [], metricId);
    if (hit) return hit;
  }
  return undefined;
}

function findMetricInTree(
  tree: CategoryTreeNode[],
  metricId: number,
): MetricNode | undefined {
  for (const cat of tree) {
    const hit = findMetricInList(cat.metrics, metricId);
    if (hit) return hit;
  }
  return undefined;
}

function canEditFormula(metric: MetricNode): boolean {
  return !isLockedAutoComputeMetric(metric.metricCode);
}

/** 들여쓰기 폭: 상위 지표 아래 하위·하위하위 지표 */
function depthIndentClass(depth: number): string {
  if (depth <= 0) return '';
  if (depth === 1) return 'ml-8';
  if (depth === 2) return 'ml-14';
  return 'ml-20';
}

function VisibilityControls({
  hidden,
  onHiddenChange,
  onDelete,
  deleteDisabled,
  deleteTitle,
  busy,
}: {
  hidden: boolean;
  onHiddenChange: (value: boolean) => void;
  onDelete?: () => void;
  deleteDisabled?: boolean;
  deleteTitle?: string;
  busy?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-2"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        숨김
        <Switch
          checked={hidden}
          disabled={busy}
          onCheckedChange={onHiddenChange}
        />
      </label>
      {onDelete && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-8 px-2 text-destructive hover:text-destructive"
          disabled={busy || deleteDisabled}
          onClick={onDelete}
          title={deleteTitle ?? '삭제'}
          aria-label={deleteTitle ?? '삭제'}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

function flattenMetricNodes(metrics: MetricNode[]): MetricNode[] {
  return metrics.flatMap((m) => [
    m,
    ...flattenMetricNodes(m.children ?? []),
  ]);
}

function flattenMetricsForSave(
  metrics: MetricNode[],
  categoryId: number,
  parentMetricId: number | null,
): {
  metricId: number;
  categoryId: number;
  displayOrder: number;
  parentMetricId: number | null;
}[] {
  return metrics.flatMap((m, index) => [
    {
      metricId: m.metricId,
      categoryId,
      displayOrder: index,
      parentMetricId,
    },
    ...flattenMetricsForSave(m.children ?? [], categoryId, m.metricId),
  ]);
}

function extractSelectedMetrics(
  metrics: MetricNode[],
  idSet: Set<number>,
): { remaining: MetricNode[]; collected: MetricNode[] } {
  const remaining: MetricNode[] = [];
  const collected: MetricNode[] = [];
  for (const m of metrics) {
    if (idSet.has(m.metricId)) {
      collected.push(m);
      continue;
    }
    const nested = extractSelectedMetrics(m.children ?? [], idSet);
    remaining.push({ ...m, children: nested.remaining });
    collected.push(...nested.collected);
  }
  return { remaining, collected };
}

function sourceBadge(sourceType: MetricNode['sourceType']) {
  if (sourceType === 'ALIMI') return { variant: 'alimi' as const, label: '공시' };
  if (sourceType === 'INTERNAL')
    return { variant: 'internal' as const, label: '자체' };
  return { variant: 'monitoring' as const, label: '모니터링' };
}

function sourceTitle(sourceType: 'ALIMI' | 'INTERNAL' | 'MONITORING') {
  if (sourceType === 'ALIMI') return '대학정보공시';
  if (sourceType === 'INTERNAL') return '대학자체데이터';
  return '대학주요모니터링';
}

function moveMetricsInTree(
  prev: CategoryTreeNode[],
  metricIds: number[],
  destCategoryId: number,
  destIndex: number,
): CategoryTreeNode[] {
  const idSet = new Set(metricIds);
  const next = prev.map((c) => ({ ...c, metrics: [...c.metrics] }));
  const collected: MetricNode[] = [];

  for (const cat of next) {
    const extracted = extractSelectedMetrics(cat.metrics, idSet);
    cat.metrics = extracted.remaining;
    collected.push(...extracted.collected);
  }

  // 원본 선택 순서 유지
  const order = new Map(metricIds.map((id, i) => [id, i]));
  collected.sort(
    (a, b) => (order.get(a.metricId) ?? 0) - (order.get(b.metricId) ?? 0),
  );

  const dstCat = next.find((c) => c.categoryId === destCategoryId);
  if (!dstCat) return prev;

  const insertAt = Math.min(Math.max(destIndex, 0), dstCat.metrics.length);
  dstCat.metrics.splice(insertAt, 0, ...collected);
  return next;
}

function reorderCategoriesInTree(
  prev: CategoryTreeNode[],
  fromIndex: number,
  toIndex: number,
): CategoryTreeNode[] {
  const { uncategorized, ordered } = splitTree(prev);
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= ordered.length ||
    toIndex >= ordered.length ||
    fromIndex === toIndex
  ) {
    return prev;
  }

  const nextOrdered = ordered.map((c) => ({ ...c, metrics: [...c.metrics] }));
  const [removed] = nextOrdered.splice(fromIndex, 1);
  nextOrdered.splice(toIndex, 0, removed);

  const withOrder = nextOrdered.map((c, index) => ({
    ...c,
    displayOrder: index,
  }));

  return uncategorized
    ? [{ ...uncategorized, metrics: [...uncategorized.metrics] }, ...withOrder]
    : withOrder;
}

function TreeBuilderPane({
  sourceType,
}: {
  sourceType: 'ALIMI' | 'INTERNAL' | 'MONITORING';
}) {
  const [tree, setTree] = useState<CategoryTreeNode[]>([]);
  const [dirty, setDirty] = useState(false);
  const [newCategory, setNewCategory] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [moveTargetId, setMoveTargetId] = useState('');
  const [newMetricByCategory, setNewMetricByCategory] = useState<
    Record<number, string>
  >({});
  const [addingChildOf, setAddingChildOf] = useState<number | null>(null);
  const [childMetricName, setChildMetricName] = useState('');
  const [settingsMode, setSettingsMode] = useState(false);
  const [deletingMetricId, setDeletingMetricId] = useState<number | null>(null);
  const [editingMetricId, setEditingMetricId] = useState<number | null>(null);
  const [editingMetricName, setEditingMetricName] = useState('');
  const [renamingMetric, setRenamingMetric] = useState(false);
  const [formulaMetric, setFormulaMetric] = useState<MetricNode | null>(null);

  /** 공시(ALIMI)는 알리미 배치가 지표명으로 값을 물므로 수정 불가. 자체·모니터링은 metric_id가 유지된다. */
  const metricRenameEnabled = sourceType !== 'ALIMI';

  const handleAddMetric = async (
    categoryId: number,
    parentMetricId: number | null,
    name: string,
  ) => {
    const metricName = name.trim();
    if (!metricName) return;
    const parentBefore =
      parentMetricId != null ? findMetricInTree(tree, parentMetricId) : undefined;
    const wasFirstChild = (parentBefore?.children?.length ?? 0) === 0;
    await api.post('/metrics', {
      categoryId,
      sourceType,
      metricName,
      parentMetricId,
    });
    setNewMetricByCategory((prev) => ({ ...prev, [categoryId]: '' }));
    setAddingChildOf(null);
    setChildMetricName('');
    window.dispatchEvent(new Event('ir-metrics-changed'));
    const next = await load();
    if (
      parentMetricId != null &&
      sourceType === 'MONITORING' &&
      parentBefore &&
      canEditFormula(parentBefore)
    ) {
      const parent = findMetricInTree(next, parentMetricId);
      if (parent) {
        const shouldOpen =
          wasFirstChild ||
          !!parent.hasRawData ||
          !!parent.computeEnabled ||
          (parent.children?.length ?? 0) > 0;
        if (shouldOpen) setFormulaMetric(parent);
      }
    }
  };

  const load = (): Promise<CategoryTreeNode[]> => {
    return api
      .get<CategoryTreeNode[]>('/metrics/tree', {
        params: { sourceType, includeHidden: true },
      })
      .then(({ data }) => {
        const sorted = sortTree(data);
        setTree(sorted);
        setSelectedIds(new Set());
        return sorted;
      })
      .catch(() => {
        setTree([]);
        return [];
      });
  };

  useEffect(() => {
    load();
    const onChanged = () => load();
    window.addEventListener('ir-metrics-changed', onChanged);
    return () => window.removeEventListener('ir-metrics-changed', onChanged);
  }, [sourceType]);

  const toggleSelect = (metricId: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(metricId)) next.delete(metricId);
      else next.add(metricId);
      return next;
    });
  };

  const categorySelectionState = (
    cat: CategoryTreeNode,
  ): boolean | 'indeterminate' => {
    const all = flattenMetricNodes(cat.metrics);
    if (all.length === 0) return false;
    const selectedCount = all.filter((m) =>
      selectedIds.has(m.metricId),
    ).length;
    if (selectedCount === 0) return false;
    if (selectedCount === all.length) return true;
    return 'indeterminate';
  };

  const toggleSelectCategory = (cat: CategoryTreeNode) => {
    const all = flattenMetricNodes(cat.metrics);
    const allSelected = all.length > 0 && all.every((m) => selectedIds.has(m.metricId));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const m of all) {
        if (allSelected) next.delete(m.metricId);
        else next.add(m.metricId);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setMoveTargetId('');
  };

  const applyMove = (
    metricIds: number[],
    destCategoryId: number,
    destIndex: number,
  ) => {
    if (metricIds.length === 0) return;
    setTree((prev) =>
      moveMetricsInTree(prev, metricIds, destCategoryId, destIndex),
    );
    setDirty(true);
    clearSelection();
  };

  const handleBulkMove = () => {
    if (!moveTargetId || selectedIds.size === 0) return;
    const destCategoryId = Number(moveTargetId);
    const destCat = tree.find((c) => c.categoryId === destCategoryId);
    if (!destCat) return;
    applyMove([...selectedIds], destCategoryId, destCat.metrics.length);
  };

  const onDragEnd = (result: DropResult) => {
    const { source, destination, draggableId, type } = result;
    if (!destination) return;
    if (
      source.droppableId === destination.droppableId &&
      source.index === destination.index
    ) {
      return;
    }

    if (type === 'CATEGORY') {
      setTree((prev) =>
        reorderCategoriesInTree(prev, source.index, destination.index),
      );
      setDirty(true);
      return;
    }

    const draggedId = Number(draggableId);
    const destCategoryId = Number(destination.droppableId);

    // 선택된 항목을 드래그하면 선택 전체를 함께 이동
    const idsToMove =
      selectedIds.has(draggedId) && selectedIds.size > 1
        ? [...selectedIds]
        : [draggedId];

    let destIndex = destination.index;
    if (idsToMove.length > 1 && source.droppableId === destination.droppableId) {
      // 같은 카테고리 내 다중 이동: 앞에 있던 선택 항목이 빠지면 삽입 인덱스 보정
      const srcCat = tree.find((c) => String(c.categoryId) === source.droppableId);
      if (srcCat) {
        const removedBefore = srcCat.metrics
          .slice(0, destination.index)
          .filter((m) => idsToMove.includes(m.metricId)).length;
        destIndex = destination.index - removedBefore;
      }
    }

    applyMove(idsToMove, destCategoryId, destIndex);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const metrics = tree.flatMap((cat) =>
        flattenMetricsForSave(cat.metrics, cat.categoryId, null),
      );
      const categories = tree.map((c, index) => ({
        categoryId: c.categoryId,
        displayOrder: isUncategorized(c) ? -1 : index,
      }));
      await api.put('/metrics/reorder', { categories, metrics });
      setDirty(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleAddCategory = async () => {
    if (!newCategory.trim()) return;
    if (newCategory.trim() === UNCATEGORIZED_CATEGORY_NAME) {
      alert(`「${UNCATEGORIZED_CATEGORY_NAME}」은 시스템 카테고리입니다.`);
      return;
    }
    await api.post('/metrics/categories', {
      categoryName: newCategory.trim(),
      displayOrder: tree.length + 1,
      sourceType,
    });
    setNewCategory('');
    load();
  };

  const startRenameCategory = (cat: CategoryTreeNode) => {
    if (isUncategorized(cat)) return;
    setEditingId(cat.categoryId);
    setEditingName(cat.categoryName);
  };

  const cancelRenameCategory = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleRenameCategory = async (cat: CategoryTreeNode) => {
    const name = editingName.trim();
    if (!name) {
      alert('카테고리 이름을 입력해 주세요.');
      return;
    }
    if (name === UNCATEGORIZED_CATEGORY_NAME) {
      alert(`「${UNCATEGORIZED_CATEGORY_NAME}」은 시스템 카테고리입니다.`);
      return;
    }
    if (name === cat.categoryName) {
      cancelRenameCategory();
      return;
    }
    setRenaming(true);
    try {
      await api.put(`/metrics/categories/${cat.categoryId}`, {
        categoryName: name,
      });
      cancelRenameCategory();
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '카테고리 이름 수정 실패');
    } finally {
      setRenaming(false);
    }
  };

  const handleSetCategoryHidden = async (
    cat: CategoryTreeNode,
    isHidden: boolean,
  ) => {
    try {
      await api.put(`/metrics/categories/${cat.categoryId}/hidden`, {
        isHidden,
      });
      setTree((prev) =>
        prev.map((c) =>
          c.categoryId === cat.categoryId ? { ...c, isHidden } : c,
        ),
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '숨김 설정 실패');
      load();
    }
  };

  const handleSetMetricHidden = async (metric: MetricNode, isHidden: boolean) => {
    try {
      await api.put(`/metrics/${metric.metricId}/hidden`, { isHidden });
      setTree((prev) =>
        prev.map((c) => ({
          ...c,
          metrics: setMetricHiddenInTree(c.metrics, metric.metricId, isHidden),
        })),
      );
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '숨김 설정 실패');
      load();
    }
  };

  const startRenameMetric = (metric: MetricNode) => {
    if (!metricRenameEnabled) return;
    setEditingMetricId(metric.metricId);
    setEditingMetricName(metric.metricName);
  };

  const cancelRenameMetric = () => {
    setEditingMetricId(null);
    setEditingMetricName('');
  };

  const handleRenameMetric = async (metric: MetricNode) => {
    const name = editingMetricName.trim();
    if (!name) {
      alert('지표명을 입력해 주세요.');
      return;
    }
    if (name === metric.metricName) {
      cancelRenameMetric();
      return;
    }
    setRenamingMetric(true);
    try {
      const { data } = await api.put<MetricNode>(
        `/metrics/${metric.metricId}`,
        { metricName: name },
      );
      // 서버가 (학과별) 접미사를 보정할 수 있으므로 응답값을 반영
      setTree((prev) =>
        prev.map((c) => ({
          ...c,
          metrics: renameMetricInTree(
            c.metrics,
            metric.metricId,
            data?.metricName ?? name,
          ),
        })),
      );
      cancelRenameMetric();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '지표명 수정 실패');
    } finally {
      setRenamingMetric(false);
    }
  };

  const handleDeleteMetric = async (metric: MetricNode) => {
    const childCount = countMetricNodes(metric.children ?? []);
    const extra =
      childCount > 0
        ? `\n하위 지표 ${childCount}개와 원본 데이터도 함께 삭제되며 되돌릴 수 없습니다.`
        : '\n원본 데이터도 함께 삭제되며 되돌릴 수 없습니다.';
    const ok = window.confirm(
      `지표 「${metric.metricName}」을(를) 삭제할까요?${extra}`,
    );
    if (!ok) return;
    setDeletingMetricId(metric.metricId);
    try {
      await api.delete(`/metrics/${metric.metricId}`);
      if (editingMetricId === metric.metricId) cancelRenameMetric();
      setTree((prev) =>
        prev.map((c) => ({
          ...c,
          metrics: removeMetricFromTree(c.metrics, metric.metricId),
        })),
      );
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(metric.metricId);
        for (const child of flattenMetricNodes(metric.children ?? [])) {
          next.delete(child.metricId);
        }
        return next;
      });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '지표 삭제 실패');
      load();
    } finally {
      setDeletingMetricId(null);
    }
  };

  const handleDeleteCategory = async (cat: CategoryTreeNode) => {
    if (isUncategorized(cat)) return;
    const n = countMetricNodes(cat.metrics);
    const ok = window.confirm(
      `카테고리 「${cat.categoryName}」을(를) 삭제할까요?\n소속 지표 ${n}개와 원본 데이터가 함께 삭제되며 되돌릴 수 없습니다.`,
    );
    if (!ok) return;
    setDeletingId(cat.categoryId);
    try {
      await api.delete(`/metrics/categories/${cat.categoryId}`);
      setDirty(false);
      cancelRenameCategory();
      load();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      alert(err.response?.data?.message ?? '카테고리 삭제 실패');
    } finally {
      setDeletingId(null);
    }
  };

  const selectedCount = selectedIds.size;
  const { uncategorized, ordered } = splitTree(tree);

  const toggleSettingsMode = () => {
    setSettingsMode((prev) => {
      if (!prev) {
        clearSelection();
        cancelRenameCategory();
        cancelRenameMetric();
      }
      return !prev;
    });
  };

  /** 지표 한 줄. depth>0이면 하위 지표(드래그 불가). */
  const renderMetricRow = (
    m: MetricNode,
    cat: CategoryTreeNode,
    depth: number,
    dragHandleProps?: DraggableProvidedDragHandleProps | null,
    parentComputed = false,
  ) => {
    const isSelected = selectedIds.has(m.metricId);
    const badge = sourceBadge(m.sourceType);
    const editing = editingMetricId === m.metricId;
    const draggable = depth === 0 && !!dragHandleProps && !settingsMode && !editing;
    const busy = deletingMetricId === m.metricId;

    return (
      <div key={m.metricId} className={cn('space-y-1', depthIndentClass(depth))}>
        <div
          className={cn(
            'flex items-center gap-2 rounded-md border bg-background px-2 py-1.5 text-sm',
            depth > 0 && 'bg-muted/30',
            isSelected && 'border-primary/40 bg-primary/5',
            m.isHidden && 'border-dashed bg-muted/60',
          )}
        >
          {!settingsMode && !editing && (
            <Checkbox
              checked={isSelected}
              onCheckedChange={() => toggleSelect(m.metricId)}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              aria-label={`${metricLabel(m)} 선택`}
            />
          )}
          {editing ? (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Input
                value={editingMetricName}
                onChange={(e) => setEditingMetricName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleRenameMetric(m);
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelRenameMetric();
                  }
                }}
                className="h-8"
                disabled={renamingMetric}
                autoFocus
                aria-label="지표명 수정"
              />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                disabled={renamingMetric}
                onClick={() => void handleRenameMetric(m)}
                title="지표명 저장"
                aria-label="지표명 저장"
              >
                <Check className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                disabled={renamingMetric}
                onClick={cancelRenameMetric}
                title="수정 취소"
                aria-label="수정 취소"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ) : draggable ? (
            <span
              {...dragHandleProps}
              className="flex min-w-0 flex-1 cursor-grab items-center gap-2 active:cursor-grabbing"
            >
              <GripVertical className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span
                className={cn(
                  'truncate font-mono text-[13px]',
                  m.isHidden && 'text-muted-foreground',
                )}
              >
                {metricLabel(m)}
              </span>
            </span>
          ) : (
            <span
              className={cn(
                'min-w-0 flex-1 truncate font-mono text-[13px]',
                m.isHidden && 'text-muted-foreground',
              )}
            >
              {metricLabel(m)}
            </span>
          )}
          {!editing && (
            <>
              {sourceType === 'MONITORING' && !settingsMode && (
                <>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => {
                      e.stopPropagation();
                      setAddingChildOf(m.metricId);
                      setChildMetricName('');
                    }}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    하위
                  </Button>
                  {canEditFormula(m) &&
                    ((m.children?.length ?? 0) > 0 || m.computeEnabled) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFormulaMetric(m);
                        }}
                        onPointerDown={(e) => e.stopPropagation()}
                        title="하위지표 자동계산식"
                      >
                        <Calculator className="mr-1 h-3 w-3" />
                        계산식
                      </Button>
                    )}
                </>
              )}
              {metricRenameEnabled && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 shrink-0 px-2"
                  disabled={renamingMetric || busy}
                  onClick={(e) => {
                    e.stopPropagation();
                    startRenameMetric(m);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="지표명 수정"
                  aria-label={`${m.metricName} 지표명 수정`}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              )}
              {sourceType === 'MONITORING' && (
                <ComputeRoleBadge
                  metric={m}
                  parentComputed={parentComputed}
                />
              )}
              <Badge variant={badge.variant}>{badge.label}</Badge>
              {settingsMode && (
                <VisibilityControls
                  hidden={!!m.isHidden}
                  onHiddenChange={(v) => void handleSetMetricHidden(m, v)}
                  onDelete={() => void handleDeleteMetric(m)}
                  deleteTitle="지표 삭제"
                  busy={busy}
                />
              )}
            </>
          )}
        </div>
        {addingChildOf === m.metricId && (
          <div className="ml-8 flex gap-2">
            <Input
              className="h-8"
              placeholder="하위 지표 이름"
              value={childMetricName}
              onChange={(e) => setChildMetricName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleAddMetric(
                    cat.categoryId,
                    m.metricId,
                    childMetricName,
                  );
                }
              }}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={() =>
                void handleAddMetric(cat.categoryId, m.metricId, childMetricName)
              }
            >
              추가
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8"
              onClick={() => {
                setAddingChildOf(null);
                setChildMetricName('');
              }}
            >
              취소
            </Button>
          </div>
        )}
        {(m.children ?? []).map((child) =>
          renderMetricRow(
            child,
            cat,
            depth + 1,
            undefined,
            parentComputed ||
              !!m.computeEnabled ||
              monitoringComputeRole(m.metricCode) === 'computed',
          ),
        )}
      </div>
    );
  };

  const renderCategoryBody = (
    cat: CategoryTreeNode,
    categoryDragHandleProps?: DraggableProvidedDragHandleProps | null,
  ) => {
    const uncategorizedCat = isUncategorized(cat);
    const catChecked = categorySelectionState(cat);

    return (
      <>
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {categoryDragHandleProps && !settingsMode && (
              <span
                {...categoryDragHandleProps}
                className="flex shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing"
                title="분류 순서 변경"
                aria-label={`${cat.categoryName} 순서 변경`}
              >
                <GripVertical className="h-4 w-4" />
              </span>
            )}
            {!settingsMode && (
              <Checkbox
                checked={catChecked}
                disabled={cat.metrics.length === 0}
                onCheckedChange={() => toggleSelectCategory(cat)}
                aria-label={`${cat.categoryName} 전체 선택`}
              />
            )}
            {editingId === cat.categoryId ? (
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <Input
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void handleRenameCategory(cat);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRenameCategory();
                    }
                  }}
                  className="h-8"
                  disabled={renaming}
                  autoFocus
                  aria-label="카테고리 이름 수정"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={renaming}
                  onClick={() => void handleRenameCategory(cat)}
                  title="이름 저장"
                  aria-label="이름 저장"
                >
                  <Check className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={renaming}
                  onClick={cancelRenameCategory}
                  title="수정 취소"
                  aria-label="수정 취소"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div
                className={`min-w-0 text-sm font-bold ${
                  cat.isHidden ? 'text-muted-foreground' : ''
                }`}
              >
                {categoryLabel(cat)}
                {uncategorizedCat && (
                  <span className="ml-2 text-xs font-medium text-amber-800">
                    엑셀 업로드 대기 분류
                  </span>
                )}
                {cat.metrics.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    {cat.metrics.length}개
                  </span>
                )}
              </div>
            )}
          </div>
          {settingsMode ? (
            <VisibilityControls
              hidden={!!cat.isHidden}
              onHiddenChange={(v) => void handleSetCategoryHidden(cat, v)}
              onDelete={
                uncategorizedCat
                  ? undefined
                  : () => void handleDeleteCategory(cat)
              }
              deleteTitle="카테고리 삭제"
              busy={deletingId === cat.categoryId}
            />
          ) : (
            !uncategorizedCat &&
            editingId !== cat.categoryId && (
              <div className="flex shrink-0 items-center gap-0.5">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-8 px-2"
                  disabled={renaming || deletingId != null}
                  onClick={() => startRenameCategory(cat)}
                  title="카테고리 이름 수정"
                  aria-label="카테고리 이름 수정"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
            )
          )}
        </div>
        <Droppable droppableId={String(cat.categoryId)} type="METRIC">
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className={`min-h-[40px] space-y-1 rounded ${
                snapshot.isDraggingOver ? 'bg-primary/5' : ''
              }`}
            >
              {cat.metrics.map((m, index) => (
                <Draggable
                  key={m.metricId}
                  draggableId={String(m.metricId)}
                  index={index}
                  isDragDisabled={settingsMode || editingMetricId != null}
                >
                  {(dragProvided) => (
                    <div
                      ref={dragProvided.innerRef}
                      {...dragProvided.draggableProps}
                    >
                      {renderMetricRow(
                        m,
                        cat,
                        0,
                        dragProvided.dragHandleProps,
                      )}
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
              {cat.metrics.length === 0 && (
                <div className="py-2 text-center text-xs text-muted-foreground">
                  지표를 여기로 드래그
                </div>
              )}
              {sourceType === 'MONITORING' && !isUncategorized(cat) && (
                <div className="flex gap-2 pt-1">
                  <Input
                    className="h-8"
                    placeholder="이 분류에 지표 추가"
                    value={newMetricByCategory[cat.categoryId] ?? ''}
                    onChange={(e) =>
                      setNewMetricByCategory((prev) => ({
                        ...prev,
                        [cat.categoryId]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void handleAddMetric(
                          cat.categoryId,
                          null,
                          newMetricByCategory[cat.categoryId] ?? '',
                        );
                      }
                    }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8"
                    onClick={() =>
                      void handleAddMetric(
                        cat.categoryId,
                        null,
                        newMetricByCategory[cat.categoryId] ?? '',
                      )
                    }
                  >
                    <Plus className="mr-1 h-3 w-3" /> 지표
                  </Button>
                </div>
              )}
            </div>
          )}
        </Droppable>
      </>
    );
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{sourceTitle(sourceType)}</CardTitle>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={settingsMode ? 'default' : 'outline'}
            onClick={toggleSettingsMode}
            title="숨김·삭제 설정"
            aria-pressed={settingsMode}
          >
            <Settings2 className="mr-1 h-4 w-4" />
            {settingsMode ? '설정 종료' : '설정'}
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!dirty || saving || settingsMode}
          >
            <Save className="mr-1 h-4 w-4" /> {saving ? '저장 중...' : '작업 저장'}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {settingsMode ? (
          <p className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
            설정 모드입니다. 카테고리·지표 오른쪽에서 「숨김」을 켜면 조회 화면과
            지표선택·업로드 양식에서 제외되고 트리에는 회색 [숨김] 표시로 남습니다.
            같은 스위치를 끄면 다시 노출됩니다. 휴지통은 지표와 원본 데이터를
            영구 삭제하며 되돌릴 수 없습니다. 설정 모드에서는 순서 변경이
            잠깁니다.
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {sourceType === 'ALIMI'
            ? '대학정보공시(알리미) 지표만 표시됩니다. dashboard 조회 대상이며, 분류 왼쪽 손잡이로 순서를 바꾸고 지표는 드래그하거나 체크박스로 일괄 이동한 뒤 「작업 저장」을 눌러 주세요.'
            : sourceType === 'INTERNAL'
              ? `신규 자체 지표는 이 지표 DB 관리에서 먼저 등록한 뒤 최신 엑셀 양식을 받아 값을 입력하세요. 엑셀 업로드는 띄어쓰기·오타로 새 지표를 자동 생성하지 않습니다. competitiveness 조회 대상이며, 분류 왼쪽 손잡이로 순서를 바꾸고 지표는 드래그하거나 체크박스로 일괄 이동한 뒤 「작업 저장」을 눌러 주세요. 자체 지표명은 연필 버튼으로 수정할 수 있고 metric_id는 유지됩니다.`
              : '대학주요모니터링 전용 지표입니다. 하위지표를 두면 「계산식」으로 사칙연산 자동계산을 설정할 수 있습니다. 기존에 값이 있는 지표도 자동계산으로 전환할 수 있고, 하위 값이 없는 연도는 기존 값을 유지합니다. 재학생 수·회계는 조회 화면 계산이 고정되어 있습니다. 「구성항목」만 엑셀로 올리면 됩니다. 지표명은 연필 버튼으로 수정할 수 있고 metric_id는 그대로입니다. 이름을 바꾼 뒤에는 양식·코드북을 다시 받으세요.'}
        </p>

        <div className="flex gap-2">
          <Input
            placeholder="새 카테고리 이름"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="h-9"
          />
          <Button size="sm" variant="outline" onClick={handleAddCategory}>
            <Plus className="mr-1 h-4 w-4" /> 카테고리 추가
          </Button>
        </div>

        {selectedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2">
            <span className="text-sm font-medium">
              {selectedCount}개 선택됨
            </span>
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={moveTargetId}
              onChange={(e) => setMoveTargetId(e.target.value)}
              aria-label="이동할 카테고리"
            >
              <option value="">이동할 카테고리 선택</option>
              {tree.map((cat) => (
                <option key={cat.categoryId} value={String(cat.categoryId)}>
                  {cat.categoryName}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              onClick={handleBulkMove}
              disabled={!moveTargetId}
            >
              <ArrowRight className="mr-1 h-4 w-4" /> 선택 이동
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>
              <X className="mr-1 h-4 w-4" /> 선택 해제
            </Button>
          </div>
        )}

        <DragDropContext onDragEnd={onDragEnd}>
          <div className="space-y-4">
            {uncategorized && (
              <div className="rounded-md border border-amber-300 bg-amber-50/40 p-3">
                {renderCategoryBody(uncategorized)}
              </div>
            )}

            <Droppable droppableId={CATEGORIES_DROPPABLE_ID} type="CATEGORY">
              {(catProvided, catSnapshot) => (
                <div
                  ref={catProvided.innerRef}
                  {...catProvided.droppableProps}
                  className={`space-y-4 rounded-md ${
                    catSnapshot.isDraggingOver ? 'bg-muted/40' : ''
                  }`}
                >
                  {ordered.map((cat, index) => (
                    <Draggable
                      key={cat.categoryId}
                      draggableId={`${CATEGORY_DRAG_PREFIX}${cat.categoryId}`}
                      index={index}
                      isDragDisabled={settingsMode}
                    >
                      {(dragProvided, dragSnapshot) => (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          className={`rounded-md border p-3 ${
                            dragSnapshot.isDragging
                              ? 'border-primary/40 shadow-md'
                              : ''
                          }`}
                        >
                          {renderCategoryBody(
                            cat,
                            dragProvided.dragHandleProps,
                          )}
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {catProvided.placeholder}
                </div>
              )}
            </Droppable>
          </div>
        </DragDropContext>
      </CardContent>
      <FormulaEditorDialog
        metric={formulaMetric}
        open={formulaMetric != null}
        onOpenChange={(next) => {
          if (!next) setFormulaMetric(null);
        }}
        onSaved={(updated) => {
          setTree((prev) =>
            prev.map((c) => ({
              ...c,
              metrics: patchMetricInTree(c.metrics, updated.metricId, {
                computeFormula: updated.computeFormula,
                computeEnabled: updated.computeEnabled,
              }),
            })),
          );
          window.dispatchEvent(new Event('ir-metrics-changed'));
        }}
      />
    </Card>
  );
}

export function TreeBuilder() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">지표 DB 빌더</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          대학정보공시 데이터는 dashboard에서, 대학자체데이터는 competitiveness에서,
          대학주요모니터링은 monitoring에서 조회됩니다. 구성은 분리되어 있습니다.
        </p>
      </div>
      <Tabs defaultValue="ALIMI">
        <TabsList>
          <TabsTrigger value="ALIMI">대학정보공시</TabsTrigger>
          <TabsTrigger value="INTERNAL">대학자체데이터</TabsTrigger>
          <TabsTrigger value="MONITORING">대학주요모니터링</TabsTrigger>
        </TabsList>
        <TabsContent value="ALIMI">
          <TreeBuilderPane sourceType="ALIMI" />
        </TabsContent>
        <TabsContent value="INTERNAL">
          <TreeBuilderPane sourceType="INTERNAL" />
        </TabsContent>
        <TabsContent value="MONITORING">
          <TreeBuilderPane sourceType="MONITORING" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
