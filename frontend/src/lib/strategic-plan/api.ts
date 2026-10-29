import { api } from '@/lib/api';
import type {
  SpBudget,
  SpChangeLog,
  SpCompare,
  SpDepartment,
  SpEvaluation,
  SpEvaluationDraft,
  SpFundSource,
  SpFullRevision,
  SpKpi,
  SpTree,
  SpVision,
  SpWriteLock,
} from './types';

export async function fetchSpTree(year?: number) {
  const { data } = await api.get<SpTree>('/strategic-plan/tree', {
    params: year ? { year } : undefined,
  });
  return data;
}

export async function fetchSpCompare() {
  const { data } = await api.get<SpCompare>('/strategic-plan/compare');
  return data;
}

export async function fetchSpFundSources(includeInactive = false, year?: number) {
  const { data } = await api.get<SpFundSource[]>(
    '/strategic-plan/fund-sources',
    {
      params: {
        ...(includeInactive ? { includeInactive: 'true' } : {}),
        ...(year ? { year } : {}),
      },
    },
  );
  return data;
}

export async function fetchSpDepartments() {
  const { data } = await api.get<SpDepartment[]>('/strategic-plan/departments');
  return data;
}

export async function fetchSpEvaluations(year: number) {
  const { data } = await api.get<SpEvaluation[]>(
    '/strategic-plan/evaluations',
    { params: { year } },
  );
  return data;
}

export async function saveSpEvaluation(
  payload: {
    taskCode: string;
    year: number;
  } & Partial<SpEvaluationDraft>,
) {
  const { data } = await api.put<SpEvaluation>(
    '/strategic-plan/evaluations',
    payload,
  );
  return data;
}

export async function fetchSpBudgets(year: number) {
  const { data } = await api.get<SpBudget[]>('/strategic-plan/budgets', {
    params: { year },
  });
  return data;
}

export async function fetchSpWriteLocks(year: number) {
  const { data } = await api.get<SpWriteLock[]>(
    '/strategic-plan/write-locks',
    { params: { year } },
  );
  return data;
}

export async function saveSpWriteLock(payload: {
  taskCode: string;
  year: number;
  kind: 'budget' | 'eval';
  isCompleted: boolean;
}) {
  const { data } = await api.put<SpWriteLock>(
    '/strategic-plan/write-locks',
    payload,
  );
  return data;
}

export async function fetchSpFullRevisions() {
  const { data } = await api.get<SpFullRevision[]>(
    '/strategic-plan/full-revisions',
  );
  return data;
}

export async function createSpFullRevision(payload: {
  year: number;
  scope: SpFullRevision['scope'];
}) {
  const { data } = await api.post<SpFullRevision>(
    '/strategic-plan/full-revisions',
    payload,
  );
  return data;
}

export async function saveSpBudget(payload: {
  taskCode: string;
  subtaskCode: string;
  year: number;
  fundSourceId: number;
  budgetAmount?: number | null;
  settlementAmount?: number | null;
}) {
  const { data } = await api.put<SpBudget>('/strategic-plan/budgets', payload);
  return data;
}

export async function saveSpKpiResult(
  kpiCode: string,
  year: number,
  value: number | null,
) {
  await api.put(`/strategic-plan/kpis/${encodeURIComponent(kpiCode)}/results/${year}`, {
    value,
  });
}

export async function saveSpKpiTarget(
  kpiCode: string,
  year: number,
  value: number | null,
) {
  await api.put(`/strategic-plan/kpis/${encodeURIComponent(kpiCode)}/targets/${year}`, {
    value,
  });
}

/* ── 관리자 ── */

export async function fetchSpChanges() {
  const { data } = await api.get<SpChangeLog[]>('/strategic-plan/changes');
  return data;
}

export async function rollbackSpChange(logId: number) {
  await api.post(`/strategic-plan/changes/${logId}/rollback`);
}

export async function createSpGoal(payload: {
  goalId: string;
  goalNo?: number;
  goalName: string;
  year: number;
}) {
  await api.post('/strategic-plan/goals', payload);
}

export async function updateSpGoal(
  goalId: string,
  payload: { goalNo?: number; goalName?: string; year: number },
) {
  await api.put(`/strategic-plan/goals/${encodeURIComponent(goalId)}`, payload);
}

export async function deleteSpGoal(goalId: string, year: number) {
  await api.delete(`/strategic-plan/goals/${encodeURIComponent(goalId)}`, {
    params: { year },
  });
}

export async function createSpStrategy(payload: {
  strategyId: string;
  goalId: string;
  strategyName: string;
  displayOrder?: number;
  year: number;
}) {
  await api.post('/strategic-plan/strategies', payload);
}

export async function updateSpStrategy(
  strategyId: string,
  payload: {
    goalId?: string;
    strategyName?: string;
    displayOrder?: number;
    year: number;
  },
) {
  await api.put(
    `/strategic-plan/strategies/${encodeURIComponent(strategyId)}`,
    payload,
  );
}

export async function deleteSpStrategy(strategyId: string, year: number) {
  await api.delete(
    `/strategic-plan/strategies/${encodeURIComponent(strategyId)}`,
    { params: { year } },
  );
}

export async function createSpTask(payload: {
  taskCode: string;
  taskName: string;
  strategyId: string;
  isSpecialized?: boolean;
  primaryDept?: string;
  relatedDepts?: string[];
  hangulCode?: string;
  displayOrder?: number;
  year: number;
}) {
  await api.post('/strategic-plan/tasks', payload);
}

export async function updateSpTask(
  taskCode: string,
  payload: {
    taskName?: string;
    strategyId?: string;
    isSpecialized?: boolean;
    primaryDept?: string;
    relatedDepts?: string[];
    hangulCode?: string;
    displayOrder?: number;
    year: number;
  },
) {
  await api.put(`/strategic-plan/tasks/${encodeURIComponent(taskCode)}`, payload);
}

export async function deleteSpTask(taskCode: string, year: number) {
  await api.delete(`/strategic-plan/tasks/${encodeURIComponent(taskCode)}`, {
    params: { year },
  });
}

export async function createSpSubtask(payload: {
  taskCode: string;
  hangulCode?: string;
  seqNo?: number;
  subtaskName: string;
  purpose?: string;
  method?: string;
  year: number;
}) {
  await api.post('/strategic-plan/subtasks', payload);
}

export async function updateSpSubtask(
  subtaskCode: string,
  payload: {
    subtaskName?: string;
    hangulCode?: string;
    purpose?: string | null;
    method?: string | null;
    year: number;
  },
) {
  await api.put(
    `/strategic-plan/subtasks/${encodeURIComponent(subtaskCode)}`,
    payload,
  );
}

export async function deleteSpSubtask(subtaskCode: string, year: number) {
  await api.delete(
    `/strategic-plan/subtasks/${encodeURIComponent(subtaskCode)}`,
    { params: { year } },
  );
}

export async function createSpKpi(payload: {
  kpiCode: string;
  kpiName: string;
  taskCode: string;
  unit?: string;
  primaryDept?: string;
  baseline?: number | null;
  baselineRef?: string;
  formula?: string;
  year: number;
}) {
  await api.post('/strategic-plan/kpis', payload);
}

export async function updateSpKpi(
  kpiCode: string,
  payload: Partial<
    Pick<SpKpi, 'kpiName' | 'unit' | 'baseline' | 'formula' | 'primaryDept' | 'suffix'>
  > & {
    taskCode?: string;
    baselineRef?: string;
    source?: string;
    year: number;
  },
) {
  await api.put(`/strategic-plan/kpis/${encodeURIComponent(kpiCode)}`, payload);
}

export async function deleteSpKpi(kpiCode: string, year: number) {
  await api.delete(`/strategic-plan/kpis/${encodeURIComponent(kpiCode)}`, {
    params: { year },
  });
}

export async function createSpFundSource(fundSourceName: string, year: number) {
  await api.post('/strategic-plan/fund-sources', { fundSourceName, year });
}

export async function updateSpFundSource(
  fundSourceId: number,
  payload: {
    fundSourceName?: string;
    displayOrder?: number;
    isActive?: boolean;
    year?: number;
  },
) {
  await api.put(`/strategic-plan/fund-sources/${fundSourceId}`, payload);
}

export async function deleteSpFundSource(fundSourceId: number, year: number) {
  const { data } = await api.delete<{ ok: boolean }>(
    `/strategic-plan/fund-sources/${fundSourceId}`,
    { params: { year } },
  );
  return data;
}

export async function createSpDepartment(deptName: string) {
  await api.post('/strategic-plan/departments', { deptName });
}

export async function updateSpDepartment(
  deptId: number,
  payload: { deptName?: string; displayOrder?: number },
) {
  await api.put(`/strategic-plan/departments/${deptId}`, payload);
}

export async function deleteSpDepartment(deptId: number) {
  await api.delete(`/strategic-plan/departments/${deptId}`);
}

export async function updateSpVision(payload: {
  officialName?: string | null;
  planPeriod?: string | null;
  visionStatement?: string | null;
  visionGoal?: string | null;
  mission?: string | null;
  keyIndicators?: string[];
  foundingPhilosophy?: string[];
  mottoPairs?: Array<{ motto: string; talent: string }>;
  talent3c?: { name: string; items: string[] } | null;
  contentHtml?: string | null;
}) {
  const { data } = await api.put<SpVision>('/strategic-plan/vision', payload);
  return data;
}

export async function uploadSpVisionImage(file: File) {
  const form = new FormData();
  form.append('file', file);
  const { data } = await api.post<{ filename: string; url: string }>(
    '/strategic-plan/vision/images',
    form,
  );
  return {
    filename: data.filename,
    url: `/api${data.url}`,
  };
}

export async function replaceSpCompare(payload: SpCompare) {
  const { data } = await api.put<SpCompare>('/strategic-plan/compare', payload);
  return data;
}

export interface SpSeedImportIssue {
  kind: 'miss' | 'warn';
  code: string;
  message: string;
}

/** 사업프로그램·지표 JSON을 기존 값과 합치는 방식. */
export type SpSeedJsonMode = 'keep' | 'overwrite' | 'sync';

export interface SpSeedImportResult {
  dryRun: boolean;
  year: number;
  fundSourceName: string;
  fundSourceCreated: boolean;
  replaceMissing: boolean;
  jsonMode: SpSeedJsonMode;
  blocked: boolean;
  budget: {
    matched: number;
    unmatched: number;
    budgetThousand: number;
    executedThousand: number;
    budgetWon: number;
    executedWon: number;
    existingRows: number;
    replace: boolean;
    namedRows: number;
  };
  indicators: {
    matched: number;
    unmatched: number;
    rateMismatch: number;
    averageRate: number | null;
  };
  reports: {
    matched: number;
    unmatched: number;
    activities: number;
    kpiNotes: number;
    sections: number;
    existingJson: number;
  };
  usesSeedFund: boolean;
  textRevisions: number;
  newDepartments: string[];
  historicalNodes: string[];
  issues: SpSeedImportIssue[];
  issueCount: number;
}

export async function fetchSpSeedCatalog() {
  const { data } = await api.get<Record<string, unknown>>(
    '/strategic-plan/seed-catalog',
  );
  return data;
}

export async function importSpSeedSnapshot(payload: {
  year: number;
  dryRun: boolean;
  replaceMissing: boolean;
  jsonMode: SpSeedJsonMode;
  strategies: unknown[];
}) {
  const { data } = await api.post<SpSeedImportResult>(
    '/strategic-plan/seed-snapshot',
    payload,
  );
  return data;
}
