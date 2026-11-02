'use client';

import { useAnalysisStore } from '@/store/AnalysisStoreProvider';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function RelativeExpandOptions({ idPrefix = 'rel-expand' }: { idPrefix?: string }) {
  const analysisScope = useAnalysisStore((s) => s.analysisScope);
  const relativeExpand = useAnalysisStore((s) => s.relativeExpand);
  const setRelativeExpand = useAnalysisStore((s) => s.setRelativeExpand);

  if (analysisScope !== 'internal') return null;

  const seriesId = `${idPrefix}-all-series`;
  const deptsId = `${idPrefix}-all-depts`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1">
        <Label htmlFor={seriesId} className="cursor-pointer text-xs font-medium">
          전체 계열 비교 보기
        </Label>
        <Switch
          id={seriesId}
          checked={relativeExpand.allSeries}
          onCheckedChange={(v) => setRelativeExpand({ allSeries: v })}
        />
      </div>
      <div className="inline-flex items-center gap-2 rounded-md border px-2.5 py-1">
        <Label htmlFor={deptsId} className="cursor-pointer text-xs font-medium">
          전체 학과 보기
        </Label>
        <Switch
          id={deptsId}
          checked={relativeExpand.allDepts}
          onCheckedChange={(v) => setRelativeExpand({ allDepts: v })}
        />
      </div>
    </div>
  );
}
