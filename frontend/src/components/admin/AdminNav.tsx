'use client';

import { ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';

export type AdminMenuId =
  | 'signup'
  | 'members'
  | 'records'
  | 'tree'
  | 'org'
  | 'strategic-plan'
  | 'alimi'
  | 'upload'
  | 'correction'
  | 'annual';

interface NavLeaf {
  id: AdminMenuId;
  label: string;
}

interface NavGroup {
  id: string;
  label: string;
  children: NavLeaf[];
}

const NAV: NavGroup[] = [
  {
    id: 'member',
    label: '회원관리',
    children: [
      { id: 'signup', label: '회원가입 승인' },
      { id: 'members', label: '전체 회원 관리' },
      { id: 'records', label: '회원 기록' },
    ],
  },
  {
    id: 'base-db',
    label: '기초 DB 관리',
    children: [
      { id: 'tree', label: '지표 DB 빌더' },
      { id: 'org', label: '조직 관리' },
      { id: 'strategic-plan', label: '중장기발전계획' },
      { id: 'alimi', label: '대학알리미 API 배치' },
    ],
  },
  {
    id: 'self-db',
    label: '자체 DB 관리',
    children: [
      { id: 'upload', label: '엑셀 업로드' },
      { id: 'correction', label: '자체 데이터 교정' },
      { id: 'annual', label: '연간 변동사항 관리' },
    ],
  },
];

export const ADMIN_MENU_TITLES: Record<AdminMenuId, string> = {
  signup: '회원가입 승인',
  members: '전체 회원 관리',
  records: '회원 기록',
  tree: '지표 DB 빌더',
  org: '조직 관리',
  'strategic-plan': '중장기발전계획',
  alimi: '대학알리미 API 배치',
  upload: '엑셀 업로드',
  correction: '자체 데이터 교정',
  annual: '연간 변동사항 관리',
};

function groupContains(group: NavGroup, menu: AdminMenuId) {
  return group.children.some((c) => c.id === menu);
}

export function AdminNav({
  menu,
  onSelect,
}: {
  menu: AdminMenuId;
  onSelect: (id: AdminMenuId) => void;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({
    member: true,
    'base-db': true,
    'self-db': true,
  });

  return (
    <nav
      aria-label="시스템관리 메뉴"
      className="flex w-full shrink-0 flex-col lg:sticky lg:top-20 lg:w-56"
    >
      <ul className="space-y-1 overflow-y-auto rounded-md border p-2">
        {NAV.map((group) => {
          const expanded = open[group.id] ?? groupContains(group, menu);
          return (
            <li key={group.id}>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((prev) => ({ ...prev, [group.id]: !expanded }))
                }
                className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-bold hover:bg-accent"
              >
                {group.label}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                    expanded && 'rotate-180',
                  )}
                />
              </button>
              {expanded && (
                <ul className="mt-0.5 space-y-0.5">
                  {group.children.map((child) => {
                    const active = menu === child.id;
                    return (
                      <li key={child.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(child.id)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'w-full rounded-md px-3 py-2 pl-6 text-left text-sm transition-colors',
                            active
                              ? 'bg-primary text-primary-foreground font-bold'
                              : 'hover:bg-accent',
                          )}
                        >
                          {child.label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
