'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { CategorySection } from './CategorySection';
import { MetricDetailViewer } from './MetricDetailViewer';
import { MonitoringYearSelector } from './MonitoringYearSelector';
import { ScrollToTopButton } from './ScrollToTopButton';
import { DEFAULT_STUDENT_COUNT_TOGGLES } from '@/lib/monitoring/catalog';
import {
  buildKpiViews,
  fetchMonitoringBundle,
  STUDENT_TOGGLE_IDS,
  type KpiViewModel,
  type MonitoringBundle,
} from '@/lib/monitoring/fetchMonitoringData';
import type {
  MonitoringKpiId,
  StudentCountComponentKey,
  StudentCountToggles,
} from '@/lib/monitoring/types';
import { useAuthStore } from '@/store/useAuthStore';

export function MonitoringDashboard() {
  const isAdmin = useAuthStore((state) => state.user?.role === 'admin');
  const [bundle, setBundle] = useState<MonitoringBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toggles, setToggles] = useState<StudentCountToggles>(
    DEFAULT_STUDENT_COUNT_TOGGLES,
  );
  const [formulaToggles, setFormulaToggles] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [selectedId, setSelectedId] = useState<MonitoringKpiId | null>(null);
  const [selectedYear, setSelectedYear] = useState<number>(
    () => new Date().getFullYear(),
  );
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMonitoringBundle()
      .then((data) => {
        if (cancelled) return;
        setBundle(data);
        const latest = data.availableYears[0];
        setSelectedYear((prev) =>
          data.availableYears.includes(prev) ? prev : (latest ?? prev),
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : '모니터링 데이터를 불러오지 못했습니다.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const views = useMemo(
    () =>
      bundle
        ? buildKpiViews(bundle, toggles, formulaToggles, selectedYear)
        : [],
    [bundle, toggles, formulaToggles, selectedYear],
  );

  const viewMap = useMemo(() => {
    const map = new Map<MonitoringKpiId, KpiViewModel>();
    views.forEach((v) => map.set(v.id, v));
    return map;
  }, [views]);

  const selected = selectedId ? viewMap.get(selectedId) ?? null : null;
  const yearOptions = bundle?.availableYears ?? [];

  const onComponentToggle = (
    kpiId: string,
    itemId: string,
    on: boolean,
  ) => {
    if (kpiId === 'student-count') {
      const field = STUDENT_TOGGLE_IDS[itemId as StudentCountComponentKey];
      if (!field) return;
      setToggles((prev) => ({ ...prev, [field]: on }));
      return;
    }
    setFormulaToggles((prev) => ({
      ...prev,
      [kpiId]: { ...(prev[kpiId] ?? {}), [itemId]: on },
    }));
  };

  const onSelect = (id: MonitoringKpiId) => {
    setSelectedId(id);
    requestAnimationFrame(() => {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  if (loading) {
    return (
      <div className="py-16 text-center text-sm text-muted-foreground">
        대학 주요 현황을 불러오는 중입니다…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border bg-card p-6 shadow-sm md:p-8">
        <header className="mb-8 border-b pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">지표 현황</h2>
            <MonitoringYearSelector
              years={yearOptions}
              value={selectedYear}
              onChange={setSelectedYear}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {isAdmin ? (
              <>
                대학 전체값은 대학알리미 정보공시를 우선하며, 공시가 없거나
                학과별 값이 필요한 경우 모니터링 엑셀 입력값을 사용합니다.{' '}
              </>
            ) : null}
            카드를 누르면 아래 상세 조회 영역에서 추이와 하위 위계 비교를
            봅니다.
          </p>
        </header>
        <div className="space-y-10">
          {(bundle?.sections ?? []).map((category) => {
            const categoryViews = category.kpiIds
              .map((id) => viewMap.get(id))
              .filter((v): v is KpiViewModel => !!v);
            if (categoryViews.length === 0) return null;
            return (
              <CategorySection
                key={category.id}
                category={category}
                title={bundle?.categoryTitles[category.id]}
                views={categoryViews}
                selectedId={selectedId}
                showValueSource={isAdmin}
                onSelect={onSelect}
                onComponentToggle={onComponentToggle}
              />
            );
          })}
        </div>
      </section>

      <section
        ref={detailRef}
        className="rounded-xl border bg-muted/30 p-6 shadow-sm md:p-8"
      >
        <header className="mb-6 border-b border-border/80 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl">상세 조회</h2>
            <MonitoringYearSelector
              years={yearOptions}
              value={selectedYear}
              onChange={setSelectedYear}
            />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            선택한 지표의 대학 추이와 계열·학과 비교입니다. 위 현황 보드와
            구분된 영역입니다.
          </p>
        </header>
        {selected ? (
          <MetricDetailViewer
            key={`${selected.id}-${selected.selectedYear}-${selected.hasHierarchy ? 'h' : 'n'}-${selected.stackBreakdown?.keys.join('-') ?? selected.studentBreakdown?.keys.join('-') ?? 'plain'}`}
            view={selected}
            org={bundle!.org}
          />
        ) : (
          <div className="rounded-md border border-dashed bg-background px-4 py-12 text-center text-sm text-muted-foreground">
            위 지표 카드를 선택하면 이 영역에 상세 내용이 표시됩니다.
          </div>
        )}
      </section>

      <ScrollToTopButton />
    </div>
  );
}
