import { api } from '@/lib/api';

export type ExportFormat = 'xlsx' | 'png' | 'pdf' | 'json';

export function logDataExport(input: {
  format: ExportFormat;
  source: string;
  filename: string;
  summary?: string;
}) {
  void api.post('/export-logs', input).catch(() => undefined);
}
