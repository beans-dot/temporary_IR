'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  describeCorrelation,
  describePValue,
  formatPValue,
  pairedSeriesValues,
  pearsonCorrelation,
  pearsonPValue,
} from '@/lib/correlation';
import { cn } from '@/lib/utils';

export type CorrLegendItem = { key: string; label: string; color?: string };

export type CorrDragPayload = {
  key: string;
  label: string;
  color?: string;
  fromSlot: number | null;
};

function DropSlot({
  index,
  item,
  hover,
  onClear,
  onChipPointerDown,
}: {
  index: number;
  item: CorrLegendItem | null;
  hover: boolean;
  onClear: (index: number) => void;
  onChipPointerDown: (
    index: number,
    item: CorrLegendItem,
    e: React.PointerEvent,
  ) => void;
}) {
  return (
    <div
      data-corr-slot={index}
      className={cn(
        'flex min-h-[72px] items-center justify-center rounded-md border-2 border-dashed px-3 py-2 text-xs',
        hover
          ? 'border-primary bg-primary/5'
          : 'border-muted-foreground/30 bg-muted/30',
      )}
    >
      {item ? (
        <div
          className="flex w-full cursor-grab items-center gap-2 active:cursor-grabbing"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            onChipPointerDown(index, item, e);
          }}
        >
          {item.color ? (
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: item.color }}
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate font-bold" title={item.label}>
            {item.label}
          </span>
          <button
            type="button"
            className="shrink-0 text-muted-foreground hover:text-foreground"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onClear(index)}
            aria-label="제거"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <span className="pointer-events-none text-muted-foreground">
          데이터명을 여기로 드래그 ({index + 1}/2)
        </span>
      )}
    </div>
  );
}

export function CorrelationPanel({
  slots,
  items,
  data,
  hoverSlot,
  onClear,
  onChipPointerDown,
}: {
  slots: [string | null, string | null];
  items: CorrLegendItem[];
  data: Array<Record<string, number | string | null>>;
  hoverSlot: number | null;
  onClear: (index: number) => void;
  onChipPointerDown: (
    index: number,
    item: CorrLegendItem,
    e: React.PointerEvent,
  ) => void;
}) {
  const byKey = Object.fromEntries(items.map((it) => [it.key, it]));
  const a = slots[0] ? byKey[slots[0]] ?? null : null;
  const b = slots[1] ? byKey[slots[1]] ?? null : null;

  let result: string | null = null;
  if (a && b) {
    const { xs, ys, n } = pairedSeriesValues(data, a.key, b.key);
    if (n < 2) {
      result =
        '공통으로 값이 있는 연도가 2개 미만이라 상관계수를 계산할 수 없습니다.';
    } else {
      const r = pearsonCorrelation(xs, ys);
      if (r == null) {
        result =
          '한쪽 시계열의 값이 모두 같아 상관계수를 계산할 수 없습니다.';
      } else {
        const p = pearsonPValue(r, n);
        const corrText = describeCorrelation(r);
        const pText =
          p == null
            ? '유의확률은 관측 연도가 3개 이상일 때 계산합니다.'
            : `유의확률(${formatPValue(p)}) — ${describePValue(p)}`;
        result = `${corrText} ${pText} (관측 연도 ${n}개)`;
      }
    }
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div>
        <h5 className="text-sm font-bold">상관계수 분석</h5>
        <p className="mt-1 text-[11px] text-muted-foreground">
          표의 데이터명을 아래 칸에 최대 2개까지 놓으면 피어슨 상관계수와
          유의확률(p-value)을 계산합니다. 칸에 넣은 변수는 바깥으로 드래그하면
          빠집니다.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <DropSlot
          index={0}
          item={a}
          hover={hoverSlot === 0}
          onClear={onClear}
          onChipPointerDown={onChipPointerDown}
        />
        <DropSlot
          index={1}
          item={b}
          hover={hoverSlot === 1}
          onClear={onClear}
          onChipPointerDown={onChipPointerDown}
        />
      </div>
      {result ? (
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm leading-relaxed">
          {result}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          두 시계열을 놓으면 결과가 여기에 표시됩니다.
        </p>
      )}
    </div>
  );
}

export function CorrDragGhost({
  drag,
}: {
  drag: { label: string; color?: string; x: number; y: number };
}) {
  return (
    <div
      className="pointer-events-none fixed z-[80] max-w-[240px] truncate rounded-md border bg-white px-2 py-1 text-xs font-bold shadow-md"
      style={{ left: drag.x + 10, top: drag.y + 10 }}
    >
      {drag.color ? (
        <span
          className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
          style={{ background: drag.color }}
        />
      ) : null}
      {drag.label}
    </div>
  );
}

export function corrSlotFromPoint(x: number, y: number): number | null {
  const hit = document.elementsFromPoint(x, y);
  for (const el of hit) {
    const slot = (el as HTMLElement).closest?.('[data-corr-slot]');
    if (slot instanceof HTMLElement) {
      const n = Number(slot.dataset.corrSlot);
      return Number.isInteger(n) ? n : null;
    }
  }
  return null;
}

export function useCorrelationDrag(seriesSignature: string) {
  const [slots, setSlots] = useState<[string | null, string | null]>([
    null,
    null,
  ]);
  const [ghost, setGhost] = useState<{
    label: string;
    color?: string;
    x: number;
    y: number;
  } | null>(null);
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const pointerRef = useRef<{
    key: string;
    label: string;
    color?: string;
    fromSlot: number | null;
    startX: number;
    startY: number;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    setSlots([null, null]);
  }, [seriesSignature]);

  const assignSlot = (index: number, key: string) => {
    setSlots((prev) => {
      const next: [string | null, string | null] = [prev[0], prev[1]];
      const other = index === 0 ? 1 : 0;
      if (next[other] === key) next[other] = null;
      next[index] = key;
      return next;
    });
  };

  const clearSlot = (index: number) => {
    setSlots((prev) => {
      const next: [string | null, string | null] = [prev[0], prev[1]];
      next[index] = null;
      return next;
    });
  };

  const assignRef = useRef(assignSlot);
  assignRef.current = assignSlot;
  const clearRef = useRef(clearSlot);
  clearRef.current = clearSlot;

  const beginPointer = (
    item: CorrLegendItem,
    fromSlot: number | null,
    e: React.PointerEvent,
  ) => {
    if (e.button !== 0) return;
    e.preventDefault();
    pointerRef.current = {
      key: item.key,
      label: item.label,
      color: item.color,
      fromSlot,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = pointerRef.current;
      if (!d) return;
      const dist = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      if (!d.moved && dist < 8) return;
      d.moved = true;
      document.body.style.userSelect = 'none';
      setGhost({
        label: d.label,
        color: d.color,
        x: e.clientX,
        y: e.clientY,
      });
      setHoverSlot(corrSlotFromPoint(e.clientX, e.clientY));
    };
    const onUp = (e: PointerEvent) => {
      const d = pointerRef.current;
      if (!d) return;
      pointerRef.current = null;
      document.body.style.userSelect = '';
      setGhost(null);
      setHoverSlot(null);
      if (!d.moved) return;
      const slot = corrSlotFromPoint(e.clientX, e.clientY);
      if (slot != null) assignRef.current(slot, d.key);
      else if (d.fromSlot != null) clearRef.current(d.fromSlot);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      document.body.style.userSelect = '';
    };
  }, []);

  return { slots, ghost, hoverSlot, clearSlot, beginPointer };
}
