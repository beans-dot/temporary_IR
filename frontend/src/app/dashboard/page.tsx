'use client';

import { AuthGuard } from '@/components/auth/AuthGuard';
import { FilterControls } from '@/components/dashboard/FilterControls';
import { HybridChart } from '@/components/dashboard/HybridChart';
import { DescriptiveStatsGrid } from '@/components/dashboard/DescriptiveStatsGrid';
import { PivotDataGrid } from '@/components/dashboard/PivotDataGrid';
import { RelativeComparePanel } from '@/components/dashboard/RelativeComparePanel';
import { AnalysisStoreProvider } from '@/store/AnalysisStoreProvider';
import { useDashboardStore } from '@/store/useDashboardStore';

export default function DashboardPage() {
  return (
    <AuthGuard>
      <AnalysisStoreProvider store={useDashboardStore}>
        <div className="px-6 py-6">
          <h1 className="mb-4 text-2xl">대학정보공시 데이터 검색 및 조회</h1>
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
