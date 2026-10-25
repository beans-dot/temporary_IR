'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { NativeSelect } from '@/components/strategic-plan/ui';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notifyAutoSaved } from '@/components/admin/AutoSaveToast';
import {
  createSpFullRevision,
  fetchSpFullRevisions,
  fetchSpTree,
} from '@/lib/strategic-plan/api';
import { apiMessage } from '@/lib/strategic-plan/apiError';
import type { SpFullRevision, SpFullRevisionScope, SpTree } from '@/lib/strategic-plan/types';
import { FullRevisionBar } from './strategic-plan/FullRevisionBar';
import { PlanChangeLogManager } from './strategic-plan/PlanChangeLogManager';
import { PlanFundSourceManager } from './strategic-plan/PlanFundSourceManager';
import { PlanKpiManager } from './strategic-plan/PlanKpiManager';
import { PlanStructureManager } from './strategic-plan/PlanStructureManager';

export function StrategicPlanManager() {
  const [tree, setTree] = useState<SpTree | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState('structure');
  const [viewYear, setViewYear] = useState<number | null>(null);
  const [structureYear, setStructureYear] = useState<number | null>(null);
  const [revisions, setRevisions] = useState<SpFullRevision[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async (asOfYear?: number | null) => {
    const year =
      asOfYear === undefined ? (viewYear ?? structureYear) : asOfYear;
    try {
      const nextTree = await fetchSpTree(year ?? undefined);
      setTree(nextTree);
      setError(null);
    } catch {
      setError(
        '중장기발전계획 데이터를 불러오지 못했습니다. 초기 시딩이 끝났는지 확인해 주세요.',
      );
    } finally {
      setLoading(false);
    }
  }, [viewYear, structureYear]);

  const loadRevisions = useCallback(() => {
    fetchSpFullRevisions()
      .then(setRevisions)
      .catch(() => setRevisions([]));
  }, []);

  useEffect(() => {
    void reload();
    loadRevisions();
  }, [reload, loadRevisions]);

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        불러오는 중입니다…
      </div>
    );
  }

  if (error || !tree) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        {error ?? '데이터가 없습니다.'}
      </div>
    );
  }

  const viewingSnapshot = viewYear != null;
  const revisionScope: SpFullRevisionScope =
    tab === 'kpi' ? 'kpi' : tab === 'funds' ? 'fund' : 'structure';

  const handleRevise = async (year: number) => {
    const ok = window.confirm(
      `${year}학년도부터 ${
        revisionScope === 'structure'
          ? '전략체계'
          : revisionScope === 'kpi'
            ? 'KPI'
            : '재원 유형'
      }를 전면개정하여 공란으로 만들까요?\n${year - 1}학년도까지는 기존 내용이 유지됩니다.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await createSpFullRevision({ year, scope: revisionScope });
      loadRevisions();
      setViewYear(null);
      await reload(null);
      notifyAutoSaved('전면개정 되었습니다.');
    } catch (e) {
      alert(apiMessage(e, '전면개정에 실패했습니다.'));
    } finally {
      setBusy(false);
    }
  };

  const viewRevision = (snapshotYear: number) => {
    setViewYear(snapshotYear);
  };

  const viewCurrent = () => {
    setViewYear(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-bold">중장기발전계획</h2>
        <p className="text-sm text-muted-foreground">
          최신 전략체계를 관리합니다. 학년도를 고르면 그 해 변경이력이 반영된
          이름과 담당부서를 봅니다.
        </p>
      </div>
      {tab !== 'changes' && tab !== 'funds' && (
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sp-structure-year">조회 학년도</Label>
            <NativeSelect
              id="sp-structure-year"
              value={structureYear == null ? '' : String(structureYear)}
              onChange={(e) => {
                const next = e.target.value ? Number(e.target.value) : null;
                setViewYear(null);
                setStructureYear(next);
                setLoading(true);
              }}
            >
              <option value="">최신</option>
              {tree.years.map((year) => (
                <option key={year} value={String(year)}>
                  {year}학년도
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
      )}
      {viewingSnapshot && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {viewYear}학년도 전면개정 시점을 조회 중입니다. 이 화면은 조회 전용이며
          수정할 수 없습니다.
        </div>
      )}
      {!viewingSnapshot && structureYear != null && (
        <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
          {structureYear}학년도 변경이력이 반영된 전략체계와 KPI입니다. 이름과
          담당부서는 그 해 기준으로 보이고, 수정은 최신 화면에서 합니다.
        </div>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
          <TabsList className="h-auto flex-wrap justify-start">
            <TabsTrigger value="structure">전략체계</TabsTrigger>
            <TabsTrigger value="kpi">KPI</TabsTrigger>
            <TabsTrigger value="funds">재원 유형</TabsTrigger>
            <TabsTrigger value="changes">변경이력</TabsTrigger>
          </TabsList>
          {tab !== 'changes' && (
            <FullRevisionBar
              scope={revisionScope}
              years={tree.years}
              viewYear={viewYear}
              revisions={revisions}
              busy={busy}
              onRevise={handleRevise}
              onViewRevision={viewRevision}
              onViewCurrent={viewCurrent}
            />
          )}
        </div>

        <TabsContent value="structure">
          <PlanStructureManager
            tree={tree}
            reload={() => reload()}
            readOnly={viewingSnapshot || structureYear != null}
          />
        </TabsContent>

        <TabsContent value="kpi">
          <PlanKpiManager
            tree={tree}
            reload={() => reload()}
            readOnly={viewingSnapshot || structureYear != null}
          />
        </TabsContent>

        <TabsContent value="funds">
          <PlanFundSourceManager
            asOfYear={viewYear ?? structureYear}
            readOnly={viewingSnapshot || structureYear != null}
          />
        </TabsContent>

        <TabsContent value="changes">
          <PlanChangeLogManager reload={() => reload()} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
