'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

interface BatchLog {
  logId: number;
  updateDate: string;
  updateType: string;
  logText: string;
}

type BatchState =
  | 'idle'
  | 'running'
  | 'completed'
  | 'completed_with_warnings'
  | 'no_data'
  | 'failed';

type BatchPhase =
  | 'idle'
  | 'checking'
  | 'universities'
  | 'departments'
  | 'statistics'
  | 'finalizing'
  | 'done';

interface BatchStatus {
  state: BatchState;
  phase: BatchPhase;
  runId: string | null;
  trigger: 'manual' | 'scheduled' | null;
  requestedYear: number | null;
  year: number | null;
  message: string;
  processed: number;
  total: number;
  upserted: number;
  departments: number;
  warnings: number;
  startedAt: string | null;
  updatedAt: string;
  finishedAt: string | null;
  schedule: { cron: string; timeZone: string };
}

const PHASE_LABELS: Record<BatchPhase, string> = {
  idle: '대기',
  checking: '공개연도 확인',
  universities: '대학 목록',
  departments: '학과 정보',
  statistics: '통계 지표',
  finalizing: '마무리',
  done: '완료',
};

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

export function AlimiBatchManager() {
  const [logs, setLogs] = useState<BatchLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const statusRef = useRef<BatchStatus | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await api.get<BatchLog[]>('/alimi/batches');
      setLogs(data);
    } catch (err) {
      setError(apiErrorMessage(err, '배치 기록을 불러오지 못했습니다.'));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStatus = useCallback(
    async (showError = true) => {
      try {
        const { data } = await api.get<BatchStatus>('/alimi/batch/status');
        const previous = statusRef.current;
        statusRef.current = data;
        setStatus(data);

        if (previous?.state === 'running' && data.state !== 'running') {
          if (data.state === 'failed' || data.state === 'no_data') {
            setError(data.message);
            setMsg(null);
          } else {
            setMsg(data.message);
            setError(null);
          }
          void load();
        }
      } catch (err) {
        if (showError) {
          setError(apiErrorMessage(err, '배치 상태를 불러오지 못했습니다.'));
        }
      }
    },
    [load],
  );

  useEffect(() => {
    void load();
    void loadStatus();
    const timer = window.setInterval(() => void loadStatus(false), 3000);
    return () => window.clearInterval(timer);
  }, [load, loadStatus]);

  const runBatch = async () => {
    setMsg(null);
    setError(null);
    try {
      const { data } = await api.post<BatchStatus>('/alimi/batch');
      statusRef.current = data;
      setStatus(data);
      setMsg('배치를 시작했습니다. 이 화면을 닫아도 서버에서 계속 실행됩니다.');
    } catch (err) {
      setError(apiErrorMessage(err, '배치 실행 실패 (백엔드/API 키 확인)'));
    }
  };

  const busy = status?.state === 'running';
  const progress =
    status && status.total > 0
      ? Math.min(100, Math.round((status.processed / status.total) * 100))
      : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold">대학알리미 API 배치</h2>
          <p className="text-sm text-muted-foreground">
            최신 공개연도를 자동으로 찾아 반영합니다. 매월 1일 오전 3시
            (한국시간)에 자동 실행되며, 실행 기록은 아래에 남습니다.
          </p>
        </div>
        <Button onClick={() => void runBatch()} disabled={busy}>
          <RefreshCw className={`mr-1 h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
          {busy ? '배치 실행 중…' : '배치 실행'}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {msg && <p className="text-sm text-muted-foreground">{msg}</p>}

      {status && (
        <div className="space-y-2 rounded-md border bg-muted/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-semibold">
              {busy ? '실행 중' : PHASE_LABELS[status.phase]}
              {busy ? ` · ${PHASE_LABELS[status.phase]}` : ''}
            </span>
            <span className="text-muted-foreground">
              {status.year
                ? `${status.year}년 공개자료`
                : status.requestedYear
                  ? `${status.requestedYear}년부터 확인`
                  : '최신 공개연도 자동 선택'}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{status.message}</p>
          {busy && status.total > 0 && (
            <>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-right text-xs text-muted-foreground">
                {status.processed.toLocaleString()} /{' '}
                {status.total.toLocaleString()} ({progress}%)
              </p>
            </>
          )}
          {status.startedAt && (
            <p className="text-xs text-muted-foreground">
              시작 {formatDate(status.startedAt)}
              {status.trigger === 'scheduled' ? ' · 자동 실행' : ' · 수동 실행'}
              {status.warnings > 0 ? ` · 경고 ${status.warnings}건` : ''}
            </p>
          )}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-muted-foreground">불러오는 중…</p>
      ) : logs.length === 0 ? (
        <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          아직 배치 기록이 없습니다.
        </p>
      ) : (
        <div className="overflow-auto rounded-md border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="px-3 py-2 font-bold">시각</th>
                <th className="px-3 py-2 font-bold">내용</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.logId} className="border-t">
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatDate(log.updateDate)}
                  </td>
                  <td className="px-3 py-2">{log.logText}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
