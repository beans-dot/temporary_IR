'use client';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { FilterControls } from '@/components/dashboard/FilterControls';
import { HybridChart } from '@/components/dashboard/HybridChart';
import { DescriptiveStatsGrid } from '@/components/dashboard/DescriptiveStatsGrid';
import { PivotDataGrid } from '@/components/dashboard/PivotDataGrid';
import { RelativeComparePanel } from '@/components/dashboard/RelativeComparePanel';
import { AnalysisStoreProvider } from '@/store/AnalysisStoreProvider';
import { useCompetitivenessStore } from '@/store/useDashboardStore';

export default function CompetitivenessPage() {
  return (
    <AuthGuard>
      <AnalysisStoreProvider store={useCompetitivenessStore}>
        <div className="px-6 py-6">
          <h1 className="mb-4 text-2xl">학과별 자체 경쟁력 분석 지표</h1>
          <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
            <div>
              <FilterControls />
            </div>
            <div className="space-y-6">
              <HybridChart />
              <RelativeComparePanel />
              <PivotDataGrid />
              <DescriptiveStatsGrid />
            </div>
          </div>
        </div>
      </AnalysisStoreProvider>
    </AuthGuard>
  );
}
