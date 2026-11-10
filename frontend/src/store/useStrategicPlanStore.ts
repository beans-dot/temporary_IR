'use client';

import { create } from 'zustand';
import { notifyAutoSaved } from '@/components/admin/AutoSaveToast';
import {
  fetchSpBudgets,
  fetchSpEvaluations,
  fetchSpFundSources,
  fetchSpTree,
  fetchSpWriteLocks,
  saveSpBudget,
  saveSpEvaluation,
  saveSpKpiResult,
  saveSpWriteLock,
} from '@/lib/strategic-plan/api';
import { parseAmount } from '@/lib/strategic-plan/format';
import type {
  SpBudgetDraft,
  SpEvaluationDraft,
  SpEvaluationTextField,
  SpFundSource,
  SpIrEvalOverlay,
  SpTree,
  SpVision,
} from '@/lib/strategic-plan/types';

export type SpWriteLockKind = 'budget' | 'eval';
export type SpWriteLockMap = Record<
  string,
  { budgetCompleted: boolean; evalCompleted: boolean }
>;

export type SpView =
  | 'vision'
  | 'strategy'
  | 'budget'
  | 'eval'
  | 'kpi'
  | 'settlement'
  | 'eval-report';
export type SpCompareMode = 'jc' | 'all' | 'univ';
export type SpKpiSortKey = '' | 'code' | 'baseline' | 'lastTarget';

export const SP_YEAR_VIEWS: SpView[] = [
  'strategy',
  'budget',
  'eval',
  'kpi',
  'settlement',
  'eval-report',
];

/** 작성 데이터가 전년도에만 있는 조회·입력 화면 */
export const SP_WRITTEN_YEAR_VIEWS: SpView[] = [
  'budget',
  'eval',
  'kpi',
  'settlement',
  'eval-report',
];

export const SP_COMPARE_MODES: Array<{ value: SpCompareMode; label: string }> = [
  { value: 'jc', label: '전문대학 내' },
  { value: 'all', label: '전체(4년제 포함)' },
  { value: 'univ', label: '4년제와 비교' },
];

/** 입력 후 서버 반영까지의 지연 (ms) */
const SAVE_DEBOUNCE_MS = 700;

const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

function scheduleSave(key: string, run: () => Promise<void>) {
  const existing = saveTimers.get(key);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    key,
    setTimeout(() => {
      saveTimers.delete(key);
      void run();
    }, SAVE_DEBOUNCE_MS),
  );
}

export function budgetKey(
  taskCode: string,
  subtaskCode: string,
  fundSourceId: number,
) {
  return `${taskCode}::${subtaskCode}::${fundSourceId}`;
}

/** n년 3월 1일 ~ n+1년 2월 말일(윤달 포함) → n학년도 */
export function currentAcademicYear(now = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() < 2 ? year - 1 : year;
}

/**
 * 예결산·자체평가·성과지표·결산·결과 조회에 들어갈 자료가 있는 학년도.
 * yyyy.mm.dd 시점에는 yyyy-1년 자료만 작성되어 있다.
 */
export function writtenDataYear(now = new Date()): number {
  return now.getFullYear() - 1;
}

function pickListedYear(years: number[], preferred: number): number {
  if (years.length === 0) return preferred;
  if (years.includes(preferred)) return preferred;
  const past = years.filter((y) => y <= preferred);
  return past.length > 0 ? Math.max(...past) : years[0];
}

function isWrittenYearView(view: SpView) {
  return SP_WRITTEN_YEAR_VIEWS.includes(view);
}

/** 화면마다 마지막으로 고른 학년도. 첫 진입 기본값만 다르고, 이후에는 선택을 유지한다. */
let planYear = currentAcademicYear();
let recordYear = writtenDataYear();
let yearLoadId = 0;

function rememberYear(view: SpView, year: number) {
  if (isWrittenYearView(view)) recordYear = year;
  else if (view === 'strategy') planYear = year;
}

function yearForView(view: SpView, fallback: number) {
  if (isWrittenYearView(view)) return recordYear;
  if (view === 'strategy') return planYear;
  return fallback;
}

type YearStore = {
  set: (
    partial: Partial<
      Pick<
        StrategicPlanState,
        | 'year'
        | 'view'
        | 'tree'
        | 'fundSources'
        | 'entryLoading'
        | 'saveError'
        | 'evaluations'
        | 'budgets'
        | 'writeLocks'
      >
    >,
  ) => void;
  get: () => StrategicPlanState;
};

function beginYearChange(
  year: number,
  extra: Partial<Pick<StrategicPlanState, 'view'>> ,
  store: YearStore,
) {
  const changed = store.get().year !== year;
  store.set({
    year,
    ...extra,
    ...(changed
      ? {
          entryLoading: true,
          saveError: null,
          evaluations: {},
          budgets: {},
          writeLocks: {},
        }
      : {}),
  });
  if (!changed) return;
  const loadId = ++yearLoadId;
  void loadYear(year, loadId, store);
}

async function loadYear(year: number, loadId: number, store: YearStore) {
  try {
    const [tree, fundSources] = await Promise.all([
      fetchSpTree(year),
      fetchSpFundSources(false, year),
    ]);
    if (loadId !== yearLoadId) return;
    store.set({ tree, fundSources });
  } catch {
    if (loadId !== yearLoadId) return;
    store.set({ saveError: '해당 학년도 체계를 불러오지 못했습니다.' });
  }
  if (loadId !== yearLoadId) return;
  await store.get().loadEntries(year, loadId);
}

interface StrategicPlanState {
  tree: SpTree | null;
  fundSources: SpFundSource[];
  evaluations: Record<string, SpEvaluationDraft>;
  budgets: SpBudgetDraft;
  writeLocks: SpWriteLockMap;

  loading: boolean;
  entryLoading: boolean;
  error: string | null;
  saveError: string | null;
  pendingSaves: number;

  view: SpView;
  goalId: string;
  dept: string;
  query: string;
  specializedOnly: boolean;
  year: number;
  compareMode: SpCompareMode;
  kpiSort: { key: SpKpiSortKey; dir: 1 | -1 };

  load: () => Promise<void>;
  loadEntries: (year: number, loadId?: number) => Promise<void>;
  setView: (view: SpView) => void;
  setGoalId: (goalId: string) => void;
  setDept: (dept: string) => void;
  setQuery: (query: string) => void;
  setSpecializedOnly: (value: boolean) => void;
  setYear: (year: number) => void;
  setCompareMode: (mode: SpCompareMode) => void;
  toggleKpiSort: (key: SpKpiSortKey) => void;
  resetFilters: () => void;

  setEvaluationField: (
    taskCode: string,
    field: SpEvaluationTextField,
    value: string,
  ) => void;
  setEvaluationData: (
    taskCode: string,
    patch: Partial<SpEvaluationDraft>,
  ) => void;
  setIrEvalField: (
    taskCode: string,
    field: keyof SpIrEvalOverlay,
    value: string | Record<string, string>,
  ) => void;
  setBudgetField: (
    taskCode: string,
    subtaskCode: string,
    fundSourceId: number,
    kind: 'budget' | 'settlement',
    value: string,
  ) => void;
  copyPreviousYearBudgets: () => Promise<string | null>;
  setKpiResult: (kpiCode: string, value: string) => void;
  setWriteLock: (
    taskCode: string,
    kind: SpWriteLockKind,
    isCompleted: boolean,
  ) => Promise<void>;
  patchVision: (partial: Partial<SpVision>) => void;
}

export const useStrategicPlanStore = create<StrategicPlanState>((set, get) => ({
  tree: null,
  fundSources: [],
  evaluations: {},
  budgets: {},
  writeLocks: {},

  loading: false,
  entryLoading: false,
  error: null,
  saveError: null,
  pendingSaves: 0,

  view: 'vision',
  goalId: '',
  dept: '',
  query: '',
  specializedOnly: false,
  year: planYear,
  compareMode: 'jc',
  kpiSort: { key: '', dir: 1 },

  load: async () => {
    set({ loading: true, error: null });
    try {
      const latest = await fetchSpTree();
      planYear = pickListedYear(latest.years, currentAcademicYear());
      recordYear = pickListedYear(latest.years, writtenDataYear());
      const year = planYear;
      const [tree, fundSources] = await Promise.all([
        fetchSpTree(year),
        fetchSpFundSources(false, year),
      ]);
      const loadId = ++yearLoadId;
      set({ tree, fundSources, year, loading: false });
      await get().loadEntries(year, loadId);
    } catch {
      set({
        loading: false,
        error:
          '중장기발전계획 데이터를 불러오지 못했습니다. 초기 시딩이 끝났는지 확인해 주세요.',
      });
    }
  },

  loadEntries: async (year, loadId = ++yearLoadId) => {
    if (loadId !== yearLoadId) return;
    set({ entryLoading: true });
    try {
      const [evaluations, budgets, locks] = await Promise.all([
        fetchSpEvaluations(year),
        fetchSpBudgets(year),
        fetchSpWriteLocks(year),
      ]);
      if (loadId !== yearLoadId) return;
      const evalDraft: Record<string, SpEvaluationDraft> = {};
      for (const e of evaluations) {
        evalDraft[e.taskCode] = {
          deptSummary: e.deptSummary ?? '',
          deptAnalysis: e.deptAnalysis ?? '',
          budgetAdequacy: e.budgetAdequacy ?? '',
          budgetAdequacyGrade: e.budgetAdequacyGrade ?? '',
          processAdequacy: e.processAdequacy ?? '',
          processAdequacyGrade: e.processAdequacyGrade ?? '',
          kpiAdequacy: e.kpiAdequacy ?? '',
          kpiAdequacyGrade: e.kpiAdequacyGrade ?? '',
          surveyAnalysis: e.surveyAnalysis ?? '',
          surveyFeedback: e.surveyFeedback ?? '',
          taskActivities: e.taskActivities ?? {},
          kpiPoEvals: e.kpiPoEvals ?? {},
          kpiPoComments: e.kpiPoComments ?? {},
          surveyItems: e.surveyItems ?? [],
          surveyPlans: e.surveyPlans ?? [],
          surveyItemsNa: e.surveyItemsNa ?? false,
          surveyPlansNa: e.surveyPlansNa ?? false,
          irEval: e.irEval ?? {},
        };
      }
      const budgetDraft: SpBudgetDraft = {};
      for (const b of budgets) {
        budgetDraft[budgetKey(b.taskCode, b.subtaskCode, b.fundSourceId)] = {
          budget: b.budgetAmount === null ? '' : String(b.budgetAmount),
          settlement:
            b.settlementAmount === null ? '' : String(b.settlementAmount),
        };
      }
      const writeLocks: SpWriteLockMap = {};
      for (const lock of locks) {
        writeLocks[lock.taskCode] = {
          budgetCompleted: lock.budgetCompleted,
          evalCompleted: lock.evalCompleted,
        };
      }
      set({
        evaluations: evalDraft,
        budgets: budgetDraft,
        writeLocks,
        entryLoading: false,
      });
    } catch {
      if (loadId !== yearLoadId) return;
      set({
        entryLoading: false,
        saveError: '연도별 입력값을 불러오지 못했습니다.',
      });
    }
  },

  setView: (view) => {
    const state = get();
    if (state.view === view) return;
    const nextYear = yearForView(view, state.year);
    rememberYear(view, nextYear);
    beginYearChange(nextYear, { view }, { set, get });
  },
  setGoalId: (goalId) => set({ goalId }),
  setDept: (dept) => set({ dept }),
  setQuery: (query) => set({ query }),
  setSpecializedOnly: (specializedOnly) => set({ specializedOnly }),
  setYear: (year) => {
    rememberYear(get().view, year);
    beginYearChange(year, {}, { set, get });
  },
  setCompareMode: (compareMode) => set({ compareMode }),
  toggleKpiSort: (key) =>
    set((state) => ({
      kpiSort:
        state.kpiSort.key === key
          ? { key, dir: state.kpiSort.dir === 1 ? -1 : 1 }
          : { key, dir: 1 },
    })),
  resetFilters: () =>
    set({ goalId: '', dept: '', query: '', specializedOnly: false }),

  patchVision: (partial) =>
    set((state) => {
      if (!state.tree) return {};
      const current = state.tree.vision ?? {
        officialName: null,
        planPeriod: null,
        structureSummary: null,
        visionStatement: null,
        visionGoal: null,
        mission: null,
        keyIndicators: [],
        foundingPhilosophy: [],
        mottoPairs: [],
        talent3c: null,
        contentHtml: null,
      };
      return {
        tree: { ...state.tree, vision: { ...current, ...partial } },
      };
    }),

  setEvaluationField: (taskCode, field, value) => {
    if (get().writeLocks[taskCode]?.evalCompleted) return;
    const year = get().year;
    set((state) => ({
      evaluations: {
        ...state.evaluations,
        [taskCode]: { ...state.evaluations[taskCode], [field]: value },
      },
      saveError: null,
    }));
    scheduleSave(`eval:${year}:${taskCode}:${field}`, async () => {
      set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
      try {
        await saveSpEvaluation({ taskCode, year, [field]: value });
        notifyAutoSaved('자동저장 되었습니다.');
      } catch {
        set({ saveError: '자체평가 저장에 실패했습니다.' });
      } finally {
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
      }
    });
  },

  setEvaluationData: (taskCode, patch) => {
    if (get().writeLocks[taskCode]?.evalCompleted) return;
    const year = get().year;
    const keys = Object.keys(patch).join(',');
    set((state) => {
      const prev = state.evaluations[taskCode] ?? {};
      const merged: SpEvaluationDraft = { ...prev, ...patch };
      if (patch.taskActivities) {
        merged.taskActivities = {
          ...prev.taskActivities,
          ...patch.taskActivities,
        };
      }
      if (patch.kpiPoEvals) {
        merged.kpiPoEvals = { ...prev.kpiPoEvals, ...patch.kpiPoEvals };
      }
      if (patch.kpiPoComments) {
        merged.kpiPoComments = { ...prev.kpiPoComments, ...patch.kpiPoComments };
      }
      return {
        evaluations: { ...state.evaluations, [taskCode]: merged },
        saveError: null,
      };
    });
    scheduleSave(`eval:${year}:${taskCode}:${keys}`, async () => {
      set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
      try {
        const draft = get().evaluations[taskCode] ?? {};
        const payload: Partial<SpEvaluationDraft> = {};
        for (const key of Object.keys(patch) as Array<keyof SpEvaluationDraft>) {
          (payload as Record<string, unknown>)[key] = draft[key];
        }
        await saveSpEvaluation({ taskCode, year, ...payload });
        notifyAutoSaved('자동저장 되었습니다.');
      } catch {
        set({ saveError: '자체평가 저장에 실패했습니다.' });
      } finally {
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
      }
    });
  },

  setIrEvalField: (taskCode, field, value) => {
    const year = get().year;
    set((state) => {
      const prev = state.evaluations[taskCode]?.irEval ?? {};
      const irEval = { ...prev, [field]: value };
      return {
        evaluations: {
          ...state.evaluations,
          [taskCode]: { ...state.evaluations[taskCode], irEval },
        },
        saveError: null,
      };
    });
    scheduleSave(`eval:${year}:${taskCode}:irEval:${String(field)}`, async () => {
      set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
      try {
        const irEval = get().evaluations[taskCode]?.irEval ?? {};
        await saveSpEvaluation({ taskCode, year, irEval });
        notifyAutoSaved('자동저장 되었습니다.');
      } catch {
        set({ saveError: 'IR평가 저장에 실패했습니다.' });
      } finally {
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
      }
    });
  },

  setBudgetField: (taskCode, subtaskCode, fundSourceId, kind, value) => {
    if (get().writeLocks[taskCode]?.budgetCompleted) return;
    const year = get().year;
    const key = budgetKey(taskCode, subtaskCode, fundSourceId);
    set((state) => {
      const prev = state.budgets[key] ?? { budget: '', settlement: '' };
      return {
        budgets: { ...state.budgets, [key]: { ...prev, [kind]: value } },
        saveError: null,
      };
    });
    scheduleSave(`budget:${year}:${key}:${kind}`, async () => {
      set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
      try {
        const amount = parseAmount(value);
        if (value.trim() !== '' && amount === null) {
          set({ saveError: '금액은 0 이상의 숫자만 입력할 수 있습니다.' });
          return;
        }
        await saveSpBudget({
          taskCode,
          subtaskCode,
          year,
          fundSourceId,
          ...(kind === 'budget'
            ? { budgetAmount: amount }
            : { settlementAmount: amount }),
        });
      } catch {
        set({ saveError: '예산·결산 저장에 실패했습니다.' });
      } finally {
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
      }
    });
  },

  copyPreviousYearBudgets: async () => {
    const { year, fundSources } = get();
    const prevYear = year - 1;
    set({ saveError: null });
    set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
    try {
      const [prev, prevFunds] = await Promise.all([
        fetchSpBudgets(prevYear),
        fetchSpFundSources(false, prevYear),
      ]);
      const activeIds = new Set(fundSources.map((f) => f.fundSourceId));
      const skippedFunds = prevFunds.filter(
        (f) => !activeIds.has(f.fundSourceId),
      );
      const skippedNotice =
        skippedFunds.length > 0
          ? `폐지된 재원(${skippedFunds.map((f) => f.fundSourceName).join(', ')})은 제외하고 복사하였습니다.`
          : null;
      const locks = get().writeLocks;
      const toCopy = prev.filter(
        (b) =>
          b.budgetAmount !== null &&
          activeIds.has(b.fundSourceId) &&
          !locks[b.taskCode]?.budgetCompleted,
      );
      if (toCopy.length === 0) {
        if (skippedNotice) {
          set({ saveError: null });
          return skippedNotice;
        }
        set({
          saveError: `${prevYear}학년도 예산이 없어 복사하지 못했습니다.`,
        });
        return null;
      }
      const next = { ...get().budgets };
      await Promise.all(
        toCopy.map(async (b) => {
          const key = budgetKey(b.taskCode, b.subtaskCode, b.fundSourceId);
          const current = next[key] ?? { budget: '', settlement: '' };
          next[key] = { ...current, budget: String(b.budgetAmount) };
          await saveSpBudget({
            taskCode: b.taskCode,
            subtaskCode: b.subtaskCode,
            year,
            fundSourceId: b.fundSourceId,
            budgetAmount: b.budgetAmount,
          });
        }),
      );
      set({ budgets: next, saveError: null });
      return skippedNotice;
    } catch {
      set({ saveError: '전년도 예산을 복사하지 못했습니다.' });
      return null;
    } finally {
      set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
    }
  },

  setWriteLock: async (taskCode, kind, isCompleted) => {
    const year = get().year;
    set({ saveError: null });
    set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
    try {
      const saved = await saveSpWriteLock({
        taskCode,
        year,
        kind,
        isCompleted,
      });
      set((state) => ({
        writeLocks: {
          ...state.writeLocks,
          [taskCode]: {
            budgetCompleted: saved.budgetCompleted,
            evalCompleted: saved.evalCompleted,
          },
        },
      }));
      notifyAutoSaved(isCompleted ? '작성완료 되었습니다.' : '수정 가능합니다.');
    } catch {
      set({
        saveError:
          kind === 'budget'
            ? '예결산 작성완료 변경에 실패했습니다.'
            : '자체평가 작성완료 변경에 실패했습니다.',
      });
    } finally {
      set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
    }
  },

  setKpiResult: (kpiCode, value) => {
    const year = get().year;
    set((state) => {
      if (!state.tree) return {};
      return {
        tree: {
          ...state.tree,
          kpis: state.tree.kpis.map((k) =>
            k.kpiCode === kpiCode
              ? {
                  ...k,
                  results: {
                    ...k.results,
                    [year]: value.trim() === '' ? null : Number(value),
                  },
                }
              : k,
          ),
        },
        saveError: null,
      };
    });
    scheduleSave(`result:${year}:${kpiCode}`, async () => {
      set((s) => ({ pendingSaves: s.pendingSaves + 1 }));
      try {
        const trimmed = value.trim();
        const parsed = trimmed === '' ? null : Number(trimmed);
        if (parsed !== null && !Number.isFinite(parsed)) {
          set({ saveError: '실적값은 숫자만 입력할 수 있습니다.' });
          return;
        }
        await saveSpKpiResult(kpiCode, year, parsed);
      } catch {
        set({ saveError: 'KPI 실적값 저장에 실패했습니다.' });
      } finally {
        set((s) => ({ pendingSaves: Math.max(0, s.pendingSaves - 1) }));
      }
    });
  },
}));
