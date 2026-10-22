'use client';

import { useEffect, useState } from 'react';
import { notifyAutoSaved } from '@/components/admin/AutoSaveToast';
import { SpCodeBadge, spCodeLevelFromKind } from '@/components/strategic-plan/SpCodeBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { fetchSpChanges, rollbackSpChange } from '@/lib/strategic-plan/api';
import { apiMessage } from '@/lib/strategic-plan/apiError';
import type { SpChangeLog } from '@/lib/strategic-plan/types';

const FIELD_LABELS: Record<string, string> = {
  goalId: '발전전략 코드',
  goalNo: '발전전략 순번',
  goalName: '명칭',
  strategyId: '전략과제 코드',
  strategyName: '명칭',
  taskCode: '실행과제 코드',
  taskName: '명칭',
  subtaskId: 'TASK 식별번호',
  subtaskCode: 'TASK 코드',
  subtaskName: 'TASK명',
  hangulCode: '한글코드',
  seqNo: '순번',
  purpose: '추진내용',
  method: '추진방법',
  isSpecialized: '특성화 연계',
  primaryDept: '담당부서',
  relatedDepts: '연관부서',
  kpiCode: 'KPI 코드',
  suffix: '소문자 코드',
  kpiName: '지표명',
  unit: '단위',
  baseline: '기준값',
  baselineRef: '기준값 참조',
  formula: '산출식',
  source: '출처',
  fundSourceId: '재원 식별번호',
  fundSourceName: '재원명',
  displayOrder: '표시 순서',
  isActive: '사용 여부',
  effectiveFrom: '적용 시작 학년도',
  abolishedFrom: '폐지 학년도',
  snapshotYear: '조회 기준 학년도',
  scope: '개정 범위',
  blank: '공란 처리',
};

const FIELD_ORDER: Record<string, string[]> = {
  goal: ['goalId', 'goalNo', 'goalName', 'effectiveFrom', 'abolishedFrom'],
  strategy: [
    'strategyId',
    'goalId',
    'strategyName',
    'displayOrder',
    'effectiveFrom',
    'abolishedFrom',
  ],
  task: [
    'taskCode',
    'hangulCode',
    'taskName',
    'strategyId',
    'goalId',
    'isSpecialized',
    'primaryDept',
    'relatedDepts',
    'displayOrder',
    'effectiveFrom',
    'abolishedFrom',
  ],
  subtask: [
    'subtaskId',
    'taskCode',
    'subtaskCode',
    'hangulCode',
    'seqNo',
    'subtaskName',
    'purpose',
    'method',
    'displayOrder',
    'effectiveFrom',
    'abolishedFrom',
  ],
  kpi: [
    'kpiCode',
    'suffix',
    'kpiName',
    'unit',
    'taskCode',
    'strategyId',
    'goalId',
    'primaryDept',
    'baseline',
    'baselineRef',
    'formula',
    'source',
    'displayOrder',
    'effectiveFrom',
    'abolishedFrom',
  ],
  fund: [
    'fundSourceId',
    'fundSourceName',
    'displayOrder',
    'isActive',
    'effectiveFrom',
    'abolishedFrom',
  ],
};

const YEAR_FIELDS = new Set([
  'effectiveFrom',
  'abolishedFrom',
  'snapshotYear',
]);

function formatPayloadValue(key: string, value: unknown): string {
  if (value == null || value === '') return '없음';
  if (Array.isArray(value)) {
    return value.length > 0 ? value.map(String).join(', ') : '없음';
  }
  if (key === 'isSpecialized') return value ? '예' : '아니오';
  if (key === 'isActive') return value ? '사용' : '미사용';
  if (key === 'blank') return value ? '예' : '아니오';
  if (key === 'scope') {
    if (value === 'structure') return '전략체계';
    if (value === 'kpi') return 'KPI';
    if (value === 'fund') return '재원 유형';
  }
  if (YEAR_FIELDS.has(key)) return `${String(value)}학년도`;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function payloadEntries(kind: string, value: Record<string, unknown>) {
  const order = FIELD_ORDER[kind] ?? [];
  const orderIndex = new Map(order.map((key, index) => [key, index]));

  return Object.entries(value).sort(([left], [right]) => {
    const leftIndex = orderIndex.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = orderIndex.get(right) ?? Number.MAX_SAFE_INTEGER;
    if (leftIndex !== rightIndex) return leftIndex - rightIndex;
    return left.localeCompare(right);
  });
}

function PayloadDetails({
  kind,
  value,
}: {
  kind: string;
  value: Record<string, unknown> | null;
}) {
  if (!value) {
    return (
      <p className="rounded-md border bg-muted/20 px-3 py-2 text-muted-foreground">
        없음
      </p>
    );
  }

  return (
    <dl className="max-h-56 divide-y overflow-y-auto rounded-md border bg-muted/20">
      {payloadEntries(kind, value).map(([key, fieldValue]) => (
        <div key={key} className="grid gap-1 px-3 py-2 sm:grid-cols-[13rem_1fr]">
          <dt className="font-bold text-foreground">
            {FIELD_LABELS[key] ?? '기타'}({key}):
          </dt>
          <dd className="whitespace-pre-wrap break-words text-foreground">
            {formatPayloadValue(key, fieldValue)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function PlanChangeLogManager({
  reload,
}: {
  reload: () => Promise<void>;
}) {
  const [rows, setRows] = useState<SpChangeLog[]>([]);
  const [open, setOpen] = useState<SpChangeLog | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    fetchSpChanges()
      .then(setRows)
      .catch(() => setRows([]));
  };

  useEffect(load, []);

  const rollback = async (row: SpChangeLog) => {
    const ok = window.confirm(
      `${row.year}학년도 ${row.displayCode} 변경을 되돌릴까요?`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await rollbackSpChange(row.logId);
      await reload();
      load();
      notifyAutoSaved();
      setOpen(null);
    } catch (e) {
      alert(apiMessage(e, '롤백 실패'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>변경이력</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          관리자가 바꾼 전략·KPI·재원을 학년도·위계·내역으로 확인합니다. 행을 누르면
          세부 내용과 롤백을 할 수 있습니다.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-xs">
              <tr>
                <th className="px-2 py-2 text-left font-bold">변경 기준년도</th>
                <th className="px-2 py-2 text-left font-bold">변경 위계</th>
                <th className="px-2 py-2 text-left font-bold">코드</th>
                <th className="px-2 py-2 text-left font-bold">변경 내역</th>
                <th className="px-2 py-2 text-left font-bold">요약</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.logId}
                  className="cursor-pointer border-b hover:bg-accent/40"
                  onClick={() => setOpen(row)}
                >
                  <td className="px-2 py-1.5 text-left">{row.year}</td>
                  <td className="px-2 py-1.5 text-left">{row.kindLabel}</td>
                  <td className="px-2 py-1.5 text-left">
                    <SpCodeBadge level={spCodeLevelFromKind(row.kind)}>
                      {row.displayCode}
                    </SpCodeBadge>
                  </td>
                  <td className="px-2 py-1.5 text-left">{row.changeTypeLabel}</td>
                  <td className="px-2 py-1.5 text-left">{row.summary}</td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-3 py-8 text-center text-muted-foreground"
                  >
                    변경이력이 없습니다.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {open?.year} {open?.kindLabel} {open?.changeTypeLabel}
            </DialogTitle>
            <DialogDescription>{open?.summary}</DialogDescription>
          </DialogHeader>
          {open && (
            <div className="grid gap-3 text-xs">
              <div>
                <p className="mb-1 font-bold">변경 전</p>
                <PayloadDetails kind={open.kind} value={open.beforePayload} />
              </div>
              <div>
                <p className="mb-1 font-bold">변경 후</p>
                <PayloadDetails kind={open.kind} value={open.afterPayload} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(null)}>
              닫기
            </Button>
            <Button
              variant="destructive"
              disabled={busy || !open?.beforePayload}
              onClick={() => open && void rollback(open)}
            >
              롤백
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
