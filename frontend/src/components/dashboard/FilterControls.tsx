'use client';

import { RotateCcw, Search } from 'lucide-react';
import { minAvailableYear } from '@/store/useDashboardStore';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ChartOptionsPanel } from './ChartOptionsPanel';
import { DualListboxModal } from './DualListboxModal';
import { PresetManager } from './PresetManager';
import { TargetTree } from './TargetTree';

export function FilterControls() {
  const years = useAnalysisStore((s) => s.years);
  const setYears = useAnalysisStore((s) => s.setYears);
  const fetchPivot = useAnalysisStore((s) => s.fetchPivot);
  const loading = useAnalysisStore((s) => s.loading);
  const selectedTargets = useAnalysisStore((s) => s.selectedTargets);
  const selectedMetrics = useAnalysisStore((s) => s.selectedMetrics);
  const resetSelections = useAnalysisStore((s) => s.resetSelections);
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const relativeExpand = useAnalysisStore((s) => s.relativeExpand);

  const currentYear = new Date().getFullYear();
  const minYear = minAvailableYear(analysisScope);
  const yearOptions = Array.from(
    { length: currentYear - minYear + 1 },
    (_, i) => currentYear - i,
  );

  const toggleYear = (y: number) => {
    if (years.includes(y)) setYears(years.filter((x) => x !== y));
    else setYears([...years, y]);
  };

  const blockedByInternalCompare =
    analysisScope === 'disclosure' &&
    selectedMetrics.some((m) => m.sourceType === 'INTERNAL') &&
    selectedTargets.some((t) => !t.isYeonsung);
  const expandOn =
    analysisScope === 'internal' &&
    (relativeExpand.allSeries || relativeExpand.allDepts);
  const queryDisabled =
    loading ||
    selectedMetrics.length === 0 ||
    (selectedTargets.length === 0 && !expandOn) ||
    blockedByInternalCompare;
  const queryBlockedTitle = blockedByInternalCompare
    ? '연성대학교 자체 지표의 경우 타대학과의 비교가 불가합니다.'
    : undefined;

  return (
    <Card className="sticky top-20">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>조회 조건</CardTitle>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={resetSelections}
          disabled={
            selectedTargets.length === 0 && selectedMetrics.length === 0
          }
          title="대상 선택과 지표 선택을 비웁니다"
        >
          <RotateCcw className="mr-1 h-3 w-3" />
          조건 초기화
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="mb-1 text-sm font-bold">대상 선택</div>
          <TargetTree />
        </div>

        <div>
          <div className="mb-1 text-sm font-bold">지표 선택</div>
          <DualListboxModal />
        </div>

        <div>
          <div className="mb-1 text-sm font-bold">조회 기간</div>
          <div className="flex flex-wrap gap-1">
            {yearOptions.map((y) => (
              <button
                key={y}
                type="button"
                onClick={() => toggleYear(y)}
                className={`rounded-md px-2 py-1 text-xs font-bold transition-colors ${
                  years.includes(y)
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-secondary-foreground'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        <ChartOptionsPanel />
        <PresetManager />

        {/* disabled 버튼은 pointer-events가 막히므로 래퍼에 title을 둔다 */}
        <span className="block w-full" title={queryBlockedTitle}>
          <Button
            className="w-full"
            onClick={fetchPivot}
            disabled={queryDisabled}
          >
            <Search className="mr-1 h-4 w-4" />
            {loading ? '조회 중...' : '조회'}
          </Button>
        </span>
      </CardContent>
    </Card>
  );
}
