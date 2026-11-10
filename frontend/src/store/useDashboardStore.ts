'use client';

import { create } from 'zustand';
import { api, type PivotResult, type TargetTreeNode } from '@/lib/api';
import {
  buildRelativeScales,
  buildRelativeScalesFromPivotRows,
  collectUnivLevelCodes,
  shouldShowRelativeCompare,
  type RelativeMetricGroup,
} from '@/lib/relativeCompare';
import { collapseSelectedTargets } from '@/lib/targetSelection';
import {
  collectInternalRelativeTargets,
  collectYeonsungUnivTarget,
  type RelativeExpandOptions,
} from '@/lib/internalRelativeTargets';

export interface SelectedTarget {
  key: string; // 개별: univCode 또는 univCode::deptCode / 그룹: 트리 node.id
  label: string;
  isYeonsung: boolean;
  /** individual = 단일 대학·학과 / group = 위계 평균 */
  mode: 'individual' | 'group';
  univCode?: string;
  deptCode?: string;
  /** group: 소속 대학 평균 (타 대학 위계) */
  memberUnivCodes?: string[];
  /** group: 소속 학과 평균 (계열·연성대 root 위계) */
  memberDeptCodes?: string[];
}

export interface SelectedMetric {
  metricId: number;
  metricName: string;
  sourceType: 'ALIMI' | 'INTERNAL' | 'MONITORING';
  unit: string | null;
}

export interface ChartOptions {
  showDataLabels: boolean;
  showTrendline: boolean;
  showReferenceLine: boolean;
  referenceValue: number;
  /** 선택 데이터(시리즈 key)별 추세선 on/off. key 미존재 시 기본 on 처리 */
  trendlineSeries: Record<string, boolean>;
}

export type AnalysisScope = 'disclosure' | 'internal';

export interface DashboardState {
  analysisScope: AnalysisScope;
  targetTree: TargetTreeNode[];
  selectedTargets: SelectedTarget[];
  selectedMetrics: SelectedMetric[];
  years: number[];
  chartOptions: ChartOptions;
  /** 하위 위계가 모두 선택되면 상위 위계 평균으로 접기 */
  hierarchyIntegrate: boolean;
  pivot: PivotResult | null;
  relativeScales: RelativeMetricGroup[];
  relativeExpand: RelativeExpandOptions;
  relativeLoading: boolean;
  loading: boolean;
  presetName: string;

  hasOtherUniversity: () => boolean;

  setTargetTree: (tree: TargetTreeNode[]) => void;
  setHierarchyIntegrate: (value: boolean) => void;
  toggleHierarchyGroup: (group: SelectedTarget, descendantKeys: string[]) => void;
  toggleIndividualTarget: (
    target: SelectedTarget,
    descendantKeys: string[],
  ) => void;
  toggleTarget: (t: SelectedTarget) => void;
  applyTargetSelection: (targets: SelectedTarget[], selected: boolean) => void;
  toggleMetric: (m: SelectedMetric) => void;
  /** 지표 트리 기준으로 선택 목록 정리: 숨김·삭제된 지표 제거, 변경된 지표명 갱신 */
  syncMetricCatalog: (
    sourceType: SelectedMetric['sourceType'],
    available: SelectedMetric[],
  ) => void;
  clearTargets: () => void;
  clearMetrics: () => void;
  /** 대상·지표 선택과 조회 결과만 비움 (연도·차트옵션은 유지) */
  resetSelections: () => void;
  setYears: (years: number[]) => void;
  deletePreset: (presetId: number) => Promise<void>;
  setChartOption: <K extends keyof ChartOptions>(
    key: K,
    value: ChartOptions[K],
  ) => void;
  setPresetName: (name: string) => void;
  setRelativeExpand: (patch: Partial<RelativeExpandOptions>) => void;

  fetchPivot: () => Promise<void>;
  loadPresetState: (state: {
    selectedTargets: SelectedTarget[];
    selectedMetrics: SelectedMetric[];
    years: number[];
    chartOptions?: ChartOptions;
    hierarchyIntegrate?: boolean;
    relativeExpand?: RelativeExpandOptions;
  }) => void;
  serialize: () => Record<string, unknown>;
}

/** 공시 화면은 2023년부터, 자체 경쟁력은 2020년부터 조회한다. */
export const MIN_AVAILABLE_YEAR = 2023;
export const MIN_INTERNAL_YEAR = 2020;

export function minAvailableYear(scope: AnalysisScope): number {
  return scope === 'internal' ? MIN_INTERNAL_YEAR : MIN_AVAILABLE_YEAR;
}

function defaultYearsFor(minYear: number): number[] {
  const currentYear = new Date().getFullYear();
  return [0, 1, 2, 3, 4]
    .map((offset) => currentYear - offset)
    .filter((year) => year >= minYear)
    .sort((a, b) => a - b);
}

function filterAvailableYears(years: number[], minYear: number): number[] {
  return [...years].filter((year) => year >= minYear).sort((a, b) => a - b);
}

function normalizeTarget(t: SelectedTarget): SelectedTarget {
  const isGroup =
    !!t.memberUnivCodes?.length || !!t.memberDeptCodes?.length;
  return {
    ...t,
    mode: t.mode ?? (isGroup ? 'group' : 'individual'),
  };
}

function toPivotPayload(targets: SelectedTarget[]) {
  return targets.map((t) => {
    const target = normalizeTarget(t);
    if (target.mode === 'group') {
      return {
        groupKey: target.key,
        groupLabel: target.label,
        isYeonsung: target.isYeonsung,
        univCode: target.univCode,
        memberUnivCodes: target.memberUnivCodes,
        memberDeptCodes: target.memberDeptCodes,
      };
    }
    return {
      univCode: target.univCode as string,
      deptCode: target.deptCode,
    };
  });
}

async function fetchInternalRelativeScales(
  get: () => DashboardState,
  set: (
    partial:
      | Partial<DashboardState>
      | ((s: DashboardState) => Partial<DashboardState>),
  ) => void,
) {
  const {
    selectedTargets,
    selectedMetrics,
    years,
    relativeExpand,
    analysisScope,
  } = get();
  if (analysisScope !== 'internal') return;

  const scopedMetrics = selectedMetrics.filter(
    (m) => m.sourceType === 'INTERNAL',
  );
  if (!scopedMetrics.length || !years.length) {
    set({ relativeScales: [] });
    return;
  }

  let { targetTree } = get();
  const catalogYear = years.length ? Math.max(...years) : undefined;
  try {
    const { data } = await api.get<TargetTreeNode[]>(
      catalogYear
        ? `/universities/tree?scope=internal&year=${catalogYear}&years=${years.join(',')}`
        : '/universities/tree?scope=internal',
    );
    targetTree = data;
    set({ targetTree: data });
  } catch {
    if (!targetTree.length) targetTree = [];
  }

  const relTargets = collectInternalRelativeTargets(
    targetTree,
    selectedTargets,
    relativeExpand,
  );
  if (relTargets.length === 0) {
    set({ relativeScales: [] });
    return;
  }

  set({ relativeLoading: true });
  try {
    const { data: rel } = await api.post<PivotResult>('/pivot', {
      targets: toPivotPayload(relTargets),
      metricIds: scopedMetrics.map((m) => m.metricId),
      years,
      hierarchyIntegrate: false,
    });
    set({
      relativeScales: buildRelativeScalesFromPivotRows(
        rel,
        scopedMetrics.map((m) => m.metricId),
        ['root:yeonsung'],
      ),
    });
  } catch {
    set({ relativeScales: [] });
  } finally {
    set({ relativeLoading: false });
  }
}

export function createAnalysisStore(analysisScope: AnalysisScope) {
  const minYear = minAvailableYear(analysisScope);
  return create<DashboardState>((set, get) => ({
  analysisScope,
  targetTree: [],
  selectedTargets: [],
  selectedMetrics: [],
  years: defaultYearsFor(minYear),
  chartOptions: {
    showDataLabels: false,
    showTrendline: false,
    showReferenceLine: false,
    referenceValue: 0,
    trendlineSeries: {},
  },
  hierarchyIntegrate: false,
  pivot: null,
  relativeScales: [],
  relativeExpand: { allSeries: false, allDepts: false },
  relativeLoading: false,
  loading: false,
  presetName: '',

  hasOtherUniversity: () =>
    get().selectedTargets.some((t) => !t.isYeonsung),

  setTargetTree: (tree) => set({ targetTree: tree }),

  setHierarchyIntegrate: (value) => set({ hierarchyIntegrate: value }),

  toggleHierarchyGroup: (group, descendantKeys) =>
    set((state) => {
      const removeKeys = new Set([...descendantKeys, group.key]);
      const exists = state.selectedTargets.some((x) => x.key === group.key);
      const filtered = state.selectedTargets.filter((x) => !removeKeys.has(x.key));
      const nextTargets = exists
        ? filtered
        : [...filtered, normalizeTarget(group)];

      return { selectedTargets: nextTargets };
    }),

  toggleIndividualTarget: (target, descendantKeys) =>
    set((state) => {
      const normalized = normalizeTarget(target);
      const removeKeys = new Set(descendantKeys);
      const exists = state.selectedTargets.some((x) => x.key === normalized.key);
      let nextTargets = state.selectedTargets.filter((x) => !removeKeys.has(x.key));

      if (exists) {
        nextTargets = nextTargets.filter((x) => x.key !== normalized.key);
      } else {
        nextTargets = [...nextTargets, normalized];
      }

      return { selectedTargets: nextTargets };
    }),

  toggleTarget: (t) =>
    set((state) => {
      const target = normalizeTarget(t);
      const exists = state.selectedTargets.find((x) => x.key === target.key);
      const nextTargets = exists
        ? state.selectedTargets.filter((x) => x.key !== target.key)
        : [...state.selectedTargets, target];

      return { selectedTargets: nextTargets };
    }),

  applyTargetSelection: (targets, selected) =>
    set((state) => {
      const normalized = targets.map(normalizeTarget);
      let nextTargets = state.selectedTargets;
      if (selected) {
        const existingKeys = new Set(state.selectedTargets.map((x) => x.key));
        const toAdd = normalized.filter((t) => !existingKeys.has(t.key));
        nextTargets = [...state.selectedTargets, ...toAdd];
      } else {
        const removeKeys = new Set(normalized.map((t) => t.key));
        nextTargets = state.selectedTargets.filter((x) => !removeKeys.has(x.key));
      }

      return { selectedTargets: nextTargets };
    }),

  toggleMetric: (m) =>
    set((state) => {
      if (state.analysisScope === 'disclosure' && m.sourceType === 'INTERNAL') {
        return state;
      }
      if (state.analysisScope === 'internal' && m.sourceType === 'ALIMI') {
        return state;
      }
      if (m.sourceType === 'INTERNAL' && state.selectedTargets.some((t) => !t.isYeonsung)) {
        return state;
      }
      const exists = state.selectedMetrics.find((x) => x.metricId === m.metricId);
      return {
        selectedMetrics: exists
          ? state.selectedMetrics.filter((x) => x.metricId !== m.metricId)
          : [...state.selectedMetrics, m],
      };
    }),

  syncMetricCatalog: (sourceType, available) =>
    set((state) => {
      const byId = new Map(available.map((m) => [m.metricId, m]));
      let changed = false;
      const next: SelectedMetric[] = [];
      for (const m of state.selectedMetrics) {
        if (m.sourceType !== sourceType) {
          next.push(m);
          continue;
        }
        const fresh = byId.get(m.metricId);
        if (!fresh) {
          // 숨김 처리되거나 삭제된 지표
          changed = true;
          continue;
        }
        if (fresh.metricName !== m.metricName || fresh.unit !== m.unit) {
          changed = true;
          next.push({ ...m, metricName: fresh.metricName, unit: fresh.unit });
          continue;
        }
        next.push(m);
      }
      return changed ? { selectedMetrics: next } : {};
    }),

  clearTargets: () => set({ selectedTargets: [] }),
  clearMetrics: () => set({ selectedMetrics: [] }),
  resetSelections: () =>
    set({
      selectedTargets: [],
      selectedMetrics: [],
      pivot: null,
      relativeScales: [],
    }),
  setYears: (years) => set({ years: filterAvailableYears(years, minYear) }),
  deletePreset: async (presetId) => {
    await api.delete(`/presets/${presetId}`);
  },
  setChartOption: (key, value) =>
    set((state) => ({
      chartOptions: { ...state.chartOptions, [key]: value },
    })),
  setPresetName: (name) => set({ presetName: name }),

  setRelativeExpand: (patch) => {
    set((s) => ({
      relativeExpand: { ...s.relativeExpand, ...patch },
    }));
    const { analysisScope, pivot } = get();
    if (analysisScope === 'internal' && pivot) {
      void fetchInternalRelativeScales(get, set);
    }
  },

  fetchPivot: async () => {
    const {
      selectedTargets,
      selectedMetrics,
      years,
      hierarchyIntegrate,
      analysisScope,
      relativeExpand,
    } = get();
    const scopedMetrics =
      analysisScope === 'internal'
        ? selectedMetrics.filter((m) => m.sourceType === 'INTERNAL')
        : selectedMetrics.filter((m) => m.sourceType === 'ALIMI');
    const hasInternalWithOther =
      analysisScope === 'disclosure' &&
      scopedMetrics.some((m) => m.sourceType === 'INTERNAL') &&
      selectedTargets.some((t) => !t.isYeonsung);
    const expandOn =
      analysisScope === 'internal' &&
      (relativeExpand.allSeries || relativeExpand.allDepts);
    if (
      (selectedTargets.length === 0 && !expandOn) ||
      scopedMetrics.length === 0 ||
      years.length === 0 ||
      hasInternalWithOther
    ) {
      set({ pivot: { years, rows: [] }, relativeScales: [] });
      return;
    }

    const catalogYear = years.length ? Math.max(...years) : undefined;
    const treePath =
      analysisScope === 'internal'
        ? catalogYear
          ? `/universities/tree?scope=internal&year=${catalogYear}&years=${years.join(',')}`
          : '/universities/tree?scope=internal'
        : '/universities/tree';

    let { targetTree } = get();
    if (analysisScope === 'internal' || !targetTree.length) {
      try {
        const { data } = await api.get<TargetTreeNode[]>(treePath);
        targetTree = data;
        set({ targetTree: data });
      } catch {
        targetTree = [];
      }
    }

    const collapsed = collapseSelectedTargets(
      selectedTargets,
      targetTree,
      hierarchyIntegrate,
    );
    const chartTargets =
      collapsed.length > 0
        ? collapsed
        : (() => {
            const univ = collectYeonsungUnivTarget(targetTree);
            return univ ? [univ] : [];
          })();
    if (chartTargets.length === 0) {
      set({ pivot: { years, rows: [] }, relativeScales: [] });
      return;
    }

    set({ loading: true, selectedTargets: collapsed, relativeScales: [] });
    try {
      const { data } = await api.post<PivotResult>('/pivot', {
        targets: toPivotPayload(chartTargets),
        metricIds: scopedMetrics.map((m) => m.metricId),
        years,
        hierarchyIntegrate,
      });

      let relativeScales: RelativeMetricGroup[] = [];
      if (analysisScope === 'internal') {
        set({ pivot: data });
        await fetchInternalRelativeScales(get, set);
      } else if (shouldShowRelativeCompare(collapsed, scopedMetrics)) {
        const univCodes = collectUnivLevelCodes(collapsed);
        const alimiMetricIds = scopedMetrics
          .filter((m) => m.sourceType === 'ALIMI')
          .map((m) => m.metricId);
        if (univCodes.length >= 2 && alimiMetricIds.length > 0) {
          try {
            const { data: rel } = await api.post<PivotResult>('/pivot', {
              targets: univCodes.map((univCode) => ({ univCode })),
              metricIds: alimiMetricIds,
              years,
              hierarchyIntegrate: false,
            });
            relativeScales = buildRelativeScales(rel, alimiMetricIds);
          } catch {
            relativeScales = [];
          }
        }
        set({ pivot: data, relativeScales });
      } else {
        set({ pivot: data, relativeScales: [] });
      }
    } finally {
      set({ loading: false });
    }
  },

  loadPresetState: (state) =>
    set((s) => ({
      selectedTargets: (state.selectedTargets ?? []).map(normalizeTarget),
      selectedMetrics: state.selectedMetrics,
      years: filterAvailableYears(state.years ?? [], minYear),
      chartOptions: state.chartOptions
        ? { ...s.chartOptions, ...state.chartOptions }
        : s.chartOptions,
      hierarchyIntegrate: state.hierarchyIntegrate ?? s.hierarchyIntegrate,
      relativeExpand: state.relativeExpand
        ? { ...s.relativeExpand, ...state.relativeExpand }
        : s.relativeExpand,
    })),

  serialize: () => {
    const {
      selectedTargets,
      selectedMetrics,
      years,
      chartOptions,
      hierarchyIntegrate,
      relativeExpand,
    } = get();
    return {
      selectedTargets,
      selectedMetrics,
      years,
      chartOptions,
      hierarchyIntegrate,
      relativeExpand,
    };
  },
}));
}

export const useDashboardStore = createAnalysisStore('disclosure');
export const useCompetitivenessStore = createAnalysisStore('internal');
export type AnalysisStore = ReturnType<typeof createAnalysisStore>;
