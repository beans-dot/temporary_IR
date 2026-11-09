'use client';

import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

type ActivityKind = 'all' | 'login' | 'export';

interface ActivityEntry {
  id: string;
  kind: 'login' | 'export';
  createdAt: string;
  userId: string;
  userName: string | null;
  ip: string | null;
  success: boolean;
  format: 'xlsx' | 'png' | 'pdf' | 'json' | null;
  filename: string | null;
  summary: string | null;
  source: string | null;
}

function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as
      | { message?: string | string[] }
      | undefined;
    const msg = data?.message;
    if (Array.isArray(msg) && msg.length > 0) return msg.join('\n');
    if (typeof msg === 'string' && msg.trim()) return msg;
  }
  return fallback;
}

function formatDate(value: string | null | undefined) {
  if (!value) return '-';
  try {
    return new Date(value).toLocaleString('ko-KR');
  } catch {
    return value;
  }
}

function formatKind(kind: ActivityEntry['kind']) {
  return kind === 'login' ? '접속' : '다운로드';
}

function formatExportLabel(entry: ActivityEntry) {
  const format =
    entry.format === 'xlsx'
      ? '엑셀'
      : entry.format === 'png'
        ? 'PNG'
        : entry.format === 'pdf'
          ? 'PDF'
          : entry.format === 'json'
            ? 'JSON'
            : '';
  const parts = [format, entry.filename, entry.summary].filter(Boolean);
  return parts.join(' · ') || '파일 다운로드';
}

function memberLabel(entry: ActivityEntry) {
  if (entry.userName) return `${entry.userId} - ${entry.userName}`;
  return entry.userId;
}

export function MemberActivityLog() {
  const [kind, setKind] = useState<ActivityKind>('all');
  const [items, setItems] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextKind: ActivityKind) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<ActivityEntry[]>('/users/activity', {
        params: nextKind === 'all' ? undefined : { kind: nextKind },
      });
      setItems(data);
    } catch (err) {
      setError(apiErrorMessage(err, '회원 기록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(kind);
  }, [kind, load]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">회원 기록</h2>
          <p className="text-sm text-muted-foreground">
            접속과 데이터 다운로드를 시간순으로 보여 줍니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(
            [
              ['all', '전체'],
              ['login', '접속'],
              ['export', '다운로드'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={kind === value ? 'default' : 'outline'}
              onClick={() => setKind(value)}
            >
              {label}
            </Button>
          ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void load(kind)}
            disabled={loading}
          >
            새로고침
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : items.length === 0 ? (
        <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 font-bold">시각</th>
                <th className="px-3 py-2 font-bold">구분</th>
                <th className="px-3 py-2 font-bold">회원</th>
                <th className="px-3 py-2 font-bold">내용</th>
                <th className="px-3 py-2 font-bold">IP</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(entry.createdAt)}
                  </td>
                  <td className="px-3 py-2">
                    <Badge
                      variant={entry.kind === 'login' ? 'outline' : 'secondary'}
                    >
                      {formatKind(entry.kind)}
                    </Badge>
                  </td>
                  <td className="px-3 py-2">{memberLabel(entry)}</td>
                  <td className="px-3 py-2">
                    {entry.kind === 'login'
                      ? entry.success
                        ? '로그인 성공'
                        : '로그인 실패'
                      : formatExportLabel(entry)}
                  </td>
                  <td className="px-3 py-2">{entry.ip || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
