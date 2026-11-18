'use client';

import { RotateCcw, Search } from 'lucide-react';
import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DualListboxModal } from './DualListboxModal';
import { PresetManager } from './PresetManager';
import { TargetTree } from './TargetTree';
import { YearRangeSelector } from './YearRangeSelector';

export function FilterControls() {
  const years = useAnalysisStore((s) => s.years);
  const yearsStatus = useAnalysisStore((s) => s.yearsStatus);
  const fetchPivot = useAnalysisStore((s) => s.fetchPivot);
  const loading = useAnalysisStore((s) => s.loading);
  const selectedTargets = useAnalysisStore((s) => s.selectedTargets);
  const selectedMetrics = useAnalysisStore((s) => s.selectedMetrics);
  const resetSelections = useAnalysisStore((s) => s.resetSelections);
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const relativeExpand = useAnalysisStore((s) => s.relativeExpand);

  const blockedByInternalCompare =
    analysisScope === 'disclosure' &&
    selectedMetrics.some((m) => m.sourceType === 'INTERNAL') &&
    selectedTargets.some((t) => !t.isYeonsung);
  const expandOn =
    analysisScope === 'internal' &&
    (relativeExpand.allSeries || relativeExpand.allDepts);
  const queryDisabled =
    loading ||
    yearsStatus !== 'ready' ||
    years.length === 0 ||
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

        <YearRangeSelector />

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
