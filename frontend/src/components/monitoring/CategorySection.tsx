'use client';

import { MetricOverviewCard } from './MetricOverviewCard';
import type { KpiViewModel } from '@/lib/monitoring/fetchMonitoringData';
import type { MonitoringCategoryDef } from '@/lib/monitoring/types';

export function CategorySection({
  category,
  title,
  views,
  selectedId,
  showValueSource,
  onSelect,
  onComponentToggle,
}: {
  category: MonitoringCategoryDef;
  /** 트리 빌더에서 바꾼 카테고리명. 없으면 category.title */
  title?: string;
  views: KpiViewModel[];
  selectedId: string | null;
  showValueSource: boolean;
  onSelect: (id: KpiViewModel['id']) => void;
  onComponentToggle: (kpiId: string, itemId: string, on: boolean) => void;
}) {
  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-base">{title ?? category.title}</h3>
        <p className="text-sm text-muted-foreground">{category.description}</p>
      </div>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {views.map((view) => (
          <MetricOverviewCard
            key={view.id}
            view={view}
            selected={selectedId === view.id}
            showValueSource={showValueSource}
            onSelect={() => onSelect(view.id)}
            onComponentToggle={(itemId, on) =>
              onComponentToggle(view.id, itemId, on)
            }
          />
        ))}
      </div>
    </section>
  );
}
