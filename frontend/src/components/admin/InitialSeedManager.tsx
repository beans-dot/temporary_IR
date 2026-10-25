'use client';

import { useMemo, useState } from 'react';
import { FileJson } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { apiMessage } from '@/lib/strategic-plan/apiError';
import {
  importSpSeedSnapshot,
  fetchSpSeedCatalog,
  type SpSeedImportResult,
  type SpSeedJsonMode,
} from '@/lib/strategic-plan/api';
import { cn } from '@/lib/utils';

const SAMPLE = `{
  "year": 2025,
  "금액단위": "천원",
  "strategies": [
    {
      "code_id": "A1",
      "name": "미래선도형 창의융합 교육강화",
      "executionTasks": [
        {
          "code_id": "A11-혁신",
          "name": "핵심역량 기반 AI+X 직무교육과정 고도화",
          "책임부서": "교육혁신센터",
          "주요성과": "AI 리터러시 기초 과정을 2회 운영하고 120명이 이수했다.",
          "자체분석_및_개선방향": "목표는 근접했으나 심화 과정 참여가 적었다. 차년도에 심화 과정을 신설한다.",
          "자체점검": {
            "예결산의_적절성": {
              "등급_code_id": "GRADE_MID",
              "내용": "집행률이 96%라 예산 규모는 유지한다."
            },
            "절차상_적절성": {
              "등급_code_id": "GRADE_HIGH",
              "내용": "운영 지침에 따라 과정을 개설하고 결과를 기록했다."
            },
            "성과지표_적절성": {
              "등급_code_id": "GRADE_MID",
              "내용": "만족도 지표는 유지하고 이수 인원 지표의 산식을 점검한다."
            }
          },
          "만족도": {
            "세부항목_해당없음": false,
            "세부항목": [
              {
                "name": "전공교육 재학생 만족도",
                "전년도_달성값": "70.2",
                "올해_달성값": "76.1",
                "등급_code_id": "GRADE_MID"
              }
            ],
            "외부조사_해당없음": false,
            "외부조사": [
              {
                "구분": "수요조사",
                "영역": "전공",
                "조사_및_요구사항": "AI 실습 시간이 더 필요하다.",
                "환류계획_등급_code_id": "PLAN_NOW",
                "환류계획": "차년도 실습 시수를 늘린다."
              }
            ]
          },
          "tasks": [
            {
              "code_id": "A11-혁신-1",
              "name": "AI 리터러시 교육 프로그램 개발·운영",
              "예산_천원": 50000,
              "결산_천원": 48000,
              "재원별": [
                { "재원_code_id": "FUND_TUITION", "name": "교비", "예산_천원": 20000, "결산_천원": 18000 },
                { "재원_code_id": "FUND_INNOV", "name": "재정지원사업(혁신)", "예산_천원": 30000, "결산_천원": 30000 }
              ],
              "사업프로그램": [
                {
                  "사업명": "AI 리터러시 기초 과정",
                  "추진실적": "2회 운영, 120명 이수",
                  "재원_code_id": "FUND_TUITION",
                  "집행액_천원": 18000,
                  "등급_code_id": "GRADE_HIGH",
                  "차년도_환류사항": "심화 과정을 신설한다."
                }
              ]
            }
          ],
          "indicators": [
            {
              "code_id": "A11a",
              "name": "전공교육 재학생 만족도",
              "책임부서": "교육혁신센터",
              "단위": "점",
              "실적": 76.1,
              "자체평가_등급_code_id": "GRADE_MID",
              "자체평가": "목표에 근접했다. 실습 만족이 낮아 과정을 보완한다."
            }
          ]
        }
      ]
    }
  ]
}`;

const JSON_MODE_OPTIONS: Array<{
  id: SpSeedJsonMode;
  title: string;
  description: string;
}> = [
  {
    id: 'keep',
    title: '중복값은 유지, 신규 데이터만 넣기',
    description:
      '같은 세부TASK·지표에 이미 사업프로그램·등급·서술이 있으면 그 값은 그대로 둡니다. 아직 없는 세부TASK·지표만 추가합니다.',
  },
  {
    id: 'overwrite',
    title: '중복값은 덮어쓰고, 신규 데이터는 넣기',
    description:
      '파일에 있는 세부TASK·지표는 이번 내용으로 바꿉니다. 파일에 없는 기존 세부TASK·지표는 남기고, 없는 항목은 추가합니다.',
  },
  {
    id: 'sync',
    title: '기존 데이터는 없애고, 지금 넣는 JSON과 맞추기',
    description:
      '이번 파일에 있는 실행과제의 사업프로그램·지표 JSON을 파일과 같게 맞춥니다. 그 실행과제에서 파일에 없는 세부TASK·지표는 지워집니다.',
  },
];

function applyLabel(replaceMissing: boolean, jsonMode: SpSeedJsonMode) {
  if (replaceMissing && jsonMode === 'sync') return '합계를 바꾸고 JSON을 파일과 맞추기';
  if (replaceMissing && jsonMode === 'keep') return '합계를 바꾸고 없는 JSON만 넣기';
  if (replaceMissing) return '이 연도 초기시딩 합계를 파일로 바꾸기';
  if (jsonMode === 'sync') return 'JSON은 파일과 같게 맞추기';
  if (jsonMode === 'keep') return '없는 JSON만 넣기';
  return '맞는 항목만 반영';
}

function jsonPreviewNote(
  mode: SpSeedJsonMode,
  existingJson: number,
  dryRun: boolean,
) {
  if (mode === 'keep') {
    return existingJson > 0
      ? ` · 기존 JSON ${existingJson}건은 같은 세부TASK·지표를 유지하고, 없는 항목만 넣습니다`
      : '';
  }
  if (mode === 'overwrite') {
    return existingJson > 0
      ? ` · 기존 JSON ${existingJson}건은 파일에 있는 세부TASK·지표만 덮어쓰고 나머지는 남깁니다`
      : '';
  }
  if (existingJson > 0) {
    return dryRun
      ? ` · 기존 JSON ${existingJson}건을 이 파일과 같게 맞춥니다`
      : ` · 기존 JSON ${existingJson}건을 이 파일과 같게 맞췄습니다`;
  }
  return ' · 맞출 기존 JSON은 없습니다';
}

function fmt(value: number, digits: number) {
  return value.toLocaleString('ko-KR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function readStrategies(text: string):
  | {
      ok: true;
      strategies: unknown[];
      fileYear: number | null;
      unit: string | null;
    }
  | { ok: false; message: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, message: 'JSON 형식이 아닙니다.' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ok: false,
      message: '최상위는 strategies 배열을 가진 객체여야 합니다.',
    };
  }
  const record = parsed as Record<string, unknown>;
  if (!Array.isArray(record.strategies)) {
    return { ok: false, message: 'strategies 배열이 없습니다.' };
  }
  const fileYear =
    typeof record.year === 'number' && Number.isInteger(record.year)
      ? record.year
      : null;
  const unit = typeof record['금액단위'] === 'string' ? record['금액단위'].trim() : null;
  return { ok: true, strategies: record.strategies, fileYear, unit };
}

export function InitialSeedManager() {
  const [year, setYear] = useState(2025);
  const [text, setText] = useState('');
  const [replaceMissing, setReplaceMissing] = useState(false);
  const [jsonMode, setJsonMode] = useState<SpSeedJsonMode>('overwrite');
  const [preview, setPreview] = useState<SpSeedImportResult | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applied, setApplied] = useState(false);
  const [catalogBusy, setCatalogBusy] = useState(false);

  const requestKey = `${year}|${replaceMissing}|${jsonMode}|${text}`;
  const previewFresh = preview !== null && previewKey === requestKey;

  const summary = useMemo(() => {
    if (!preview) return null;
    const rate =
      preview.indicators.averageRate === null
        ? '–'
        : `${fmt(preview.indicators.averageRate, 2)}%`;
    return { rate };
  }, [preview]);

  const run = async (dryRun: boolean) => {
    const parsed = readStrategies(text);
    if (!parsed.ok) {
      setError(parsed.message);
      setPreview(null);
      return;
    }
    setError(null);
    const notes: string[] = [];
    if (parsed.fileYear !== null && parsed.fileYear !== year) {
      notes.push(
        `파일의 year는 ${parsed.fileYear}입니다. 화면 연도 ${year}를 기준으로 넣습니다.`,
      );
    }
    if (parsed.unit && parsed.unit !== '천원') {
      notes.push(
        `파일의 금액단위가 「${parsed.unit}」입니다. 예산_천원·결산_천원·집행액_천원은 천원으로 읽습니다.`,
      );
    }
    setNotice(notes.length > 0 ? notes.join(' ') : null);
    setBusy(dryRun ? 'preview' : 'apply');
    setApplied(false);
    try {
      const result = await importSpSeedSnapshot({
        year,
        dryRun,
        replaceMissing,
        jsonMode,
        strategies: parsed.strategies,
      });
      setPreview(result);
      setPreviewKey(requestKey);
      if (!dryRun) setApplied(true);
    } catch (err) {
      setError(apiMessage(err, '시딩 요청을 처리하지 못했습니다.'));
    } finally {
      setBusy(null);
    }
  };

  const downloadCatalog = async () => {
    setCatalogBusy(true);
    setError(null);
    try {
      const catalog = await fetchSpSeedCatalog();
      const blob = new Blob([JSON.stringify(catalog, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = '발전계획-추출코드표.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(apiMessage(err, '코드표를 받지 못했습니다.'));
    } finally {
      setCatalogBusy(false);
    }
  };

  const loadFile = async (file: File | undefined) => {
    if (!file) return;
    const raw = await file.text();
    setText(raw);
    setPreview(null);
    setApplied(false);
    const parsed = readStrategies(raw);
    if (parsed.ok && parsed.fileYear && parsed.fileYear >= 2022 && parsed.fileYear <= 2027) {
      setYear(parsed.fileYear);
    }
    setError(parsed.ok ? null : parsed.message);
    setNotice(null);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>초기시딩(임시)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p>
            결산 조회와 성과지표 조회는 입력 화면이 아닙니다. 이 화면은 발전계획
            예결산과 발전계획 기반 자체평가에 보고서 값을 한 번에 넣는 임시
            입구입니다. 목표와 단위는 바꾸지 않습니다. 지표명·실행과제명·책임부서가
            파일과 다르면 중장기발전계획 변경이력에 그 학년도 수정으로 남습니다.
            없던 책임부서는 그 학년도 행정부서로 만듭니다. IR 평가 칸은 넣지
            않습니다.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            <li>
              보고서에 적힌 code_id를 그대로 넣습니다. 중간 개정으로 코드가 바뀌었어도
              예전 코드를 유지합니다. 같은 번호의 실행과제·세부TASK는 그 해 이름과
              한글 코드로 바꾸고, 지금은 없는 코드는 그 학년도에만 만들어 넣습니다.
            </li>
            <li>
              재원_code_id는 FUND_TUITION(교비), FUND_INNOV(재정지원사업(혁신)),
              FUND_RISE(재정지원사업(RISE)), FUND_ANCHOR(앵커), FUND_AID,
              FUND_MOE_ETC(재정지원사업 기타), FUND_NEWIND(신산업),
              FUND_LOCAL(지자체 사업), FUND_OTHER(기타)를 우선 씁니다.
              그 해에만 있는 LINC3.0, HiVE, 재정지원사업(국고) 같은 이름은 보고서에
              적힌 그대로 넣습니다. 그 재원은 그 학년도 예결산 화면에만 생깁니다.
              한 칸에 재원이 여러 개면 행을 나눕니다.
            </li>
            <li>
              등급_code_id는 GRADE_HIGH(우수), GRADE_MID(보통), GRADE_LOW(미흡)만
              씁니다. 전년 대비 상향은 GRADE_HIGH, 동일은 GRADE_MID, 전년 대비
              하향은 GRADE_LOW입니다.
            </li>
            <li>
              환류계획_등급_code_id는 PLAN_NOW(신속반영), PLAN_STEP(점진반영),
              PLAN_NO(반영불가)만 씁니다.
            </li>
            <li>
              예결산 숫자는 천원입니다. 재원별이 있으면 그 코드의 칸에 넣고,
              없으면 합계를 「초기시딩 합계」에 넣습니다.
            </li>
            <li>
              사업프로그램과 지표 등급·서술은 아래 세 가지 중 하나로 넣습니다.
              같은 세부TASK·지표를 중복으로 봅니다. 만족도와 ③④ 본문은 파일에
              그 칸이 있으면 그 칸을 파일 내용으로 바꿉니다.
            </li>
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">보고서 JSON</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="seed-year">반영 연도</Label>
              <Input
                id="seed-year"
                type="number"
                min={2022}
                max={2027}
                value={year}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (next >= 2022 && next <= 2027) setYear(next);
                  setPreview(null);
                  setApplied(false);
                }}
                className="w-28"
              />
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <FileJson className="h-4 w-4" />
              <span>JSON 파일</span>
              <input
                type="file"
                accept="application/json,.json"
                className="max-w-[16rem] text-sm"
                onChange={(event) => {
                  void loadFile(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="text-sm text-muted-foreground">
            예결산은 예산_천원·결산_천원, 자체평가 실적은 실적, 본문은
            사업프로그램과 실행과제의 ③④⑤입니다. 목표와 달성률은 저장하지
            않습니다. 예시 넣기로 추출 양식을 볼 수 있습니다.
          </p>
          <Textarea
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setPreview(null);
              setApplied(false);
              setError(null);
              setNotice(null);
            }}
            placeholder="year, 금액단위, strategies가 있는 JSON을 붙여 넣습니다."
            className="min-h-[240px] font-mono text-xs"
            spellCheck={false}
          />
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              checked={replaceMissing}
              onCheckedChange={(checked) => {
                setReplaceMissing(checked === true);
                setPreview(null);
                setApplied(false);
              }}
              className="mt-0.5"
            />
            <span>
              파일에 없는 세부TASK의 「초기시딩 합계」를 {year}학년도에서
              지웁니다. 코드가 맞지 않는 행이 있으면 이 교체는 막습니다.
            </span>
          </label>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">
              사업프로그램·지표 JSON
            </legend>
            {JSON_MODE_OPTIONS.map((option) => (
              <label
                key={option.id}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm',
                  jsonMode === option.id && 'border-primary bg-primary/5',
                )}
              >
                <input
                  type="radio"
                  name="seed-json-mode"
                  className="mt-1"
                  checked={jsonMode === option.id}
                  onChange={() => {
                    setJsonMode(option.id);
                    setPreview(null);
                    setApplied(false);
                  }}
                />
                <span>
                  <span className="font-medium">{option.title}</span>
                  <span className="mt-0.5 block text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={busy !== null || text.trim() === ''}
              onClick={() => void run(true)}
            >
              {busy === 'preview' ? '확인 중…' : '미리보기'}
            </Button>
            <Button
              type="button"
              disabled={busy !== null || !previewFresh || Boolean(preview?.blocked)}
              onClick={() => void run(false)}
            >
              {busy === 'apply' ? '반영 중…' : applyLabel(replaceMissing, jsonMode)}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={catalogBusy}
              onClick={() => void downloadCatalog()}
            >
              {catalogBusy ? '코드표 받는 중…' : '코드표 받기'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setText(SAMPLE);
                setYear(2025);
                setPreview(null);
                setApplied(false);
                setError(null);
                setNotice(null);
              }}
            >
              예시 넣기
            </Button>
          </div>
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
          {error && (
            <p className="whitespace-pre-wrap text-sm text-destructive">{error}</p>
          )}
          {applied && preview && !preview.dryRun && (
            <p className="text-sm font-bold">
              {year}학년도 예결산과 자체평가에 반영했습니다. 결산 조회와 성과지표
              조회는 그 값을 읽기 전용으로 보여 줍니다.
            </p>
          )}
        </CardContent>
      </Card>

      {preview && summary && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {preview.dryRun ? '미리보기' : '반영 결과'} · {preview.year}학년도
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p>
              예산 {fmt(preview.budget.budgetThousand, 1)}천원 (
              {fmt(preview.budget.budgetWon, 0)}원) · 집행{' '}
              {fmt(preview.budget.executedThousand, 1)}천원 (
              {fmt(preview.budget.executedWon, 0)}원)
            </p>
            <p>
              예결산 세부TASK {preview.budget.matched}건
              {preview.budget.namedRows > 0
                ? ` · 재원별 ${preview.budget.namedRows}건`
                : ''}
              {preview.budget.unmatched > 0
                ? ` · 못 찾은 세부TASK·재원 ${preview.budget.unmatched}건`
                : ''}
              {preview.budget.replace
                ? preview.dryRun
                  ? ` · 기존 초기시딩 합계 ${preview.budget.existingRows}건을 이 파일로 바꿉니다`
                  : ' · 기존 초기시딩 합계를 이 파일로 바꿨습니다'
                : preview.budget.existingRows > 0
                  ? ` · 기존 초기시딩 합계 ${preview.budget.existingRows}건은 파일에 있는 행만 고칩니다`
                  : ''}
              . 결산 조회는 이 금액을 읽기 전용으로 보여 줍니다.
              {preview.textRevisions > 0
                ? ` 이름·책임부서 ${preview.textRevisions}건은 ${preview.year}학년도 변경이력에 남습니다.`
                : ''}
              {preview.newDepartments.length > 0
                ? ` 새 행정부서 ${preview.newDepartments.join(', ')}를 그 학년도부터 만듭니다.`
                : ''}
              {preview.historicalNodes?.length
                ? ` 개정으로 빠진 코드 ${preview.historicalNodes.length}개는 ${preview.year}학년도에만 만듭니다.`
                : ''}
            </p>
            <p>
              자체평가 실적 {preview.indicators.matched}건 · 발전계획 목표 기준
              달성률 평균 {summary.rate}
              {preview.indicators.unmatched > 0
                ? ` · 못 찾은 지표 ${preview.indicators.unmatched}건`
                : ''}
              {preview.indicators.rateMismatch > 0
                ? ` · 파일 달성률과 다른 지표 ${preview.indicators.rateMismatch}건`
                : ''}
              . 성과지표 조회는 이 실적을 읽기 전용으로 보여 줍니다.
            </p>
            {preview.reports && (
              <p>
                자체평가 본문 {preview.reports.matched}건 · 사업{' '}
                {preview.reports.activities}행 · 지표 서술{' '}
                {preview.reports.kpiNotes}건 · ③④⑤ {preview.reports.sections}건
                {preview.reports.unmatched > 0
                  ? ` · 못 찾은 실행과제 ${preview.reports.unmatched}건`
                  : ''}
                {jsonPreviewNote(
                  preview.jsonMode,
                  preview.reports.existingJson,
                  preview.dryRun,
                )}
              </p>
            )}
            <p className="text-muted-foreground">
              {preview.usesSeedFund === false
                ? '재원별로만 넣습니다. 초기시딩 합계는 만들지 않습니다.'
                : preview.fundSourceCreated
                  ? preview.dryRun
                    ? `반영하면 재원 「${preview.fundSourceName}」를 이 연도에 만듭니다.`
                    : `재원 「${preview.fundSourceName}」를 만들었습니다.`
                  : `재원 구분이 없는 합계는 「${preview.fundSourceName}」에 넣습니다.`}
              {preview.blocked
                ? ' 맞지 않는 세부TASK가 있어 통째 교체는 할 수 없습니다.'
                : ''}
            </p>
            {preview.issues.length > 0 && (
              <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-3">
                {preview.issues.map((issue, index) => (
                  <li
                    key={`${issue.kind}-${issue.code}-${index}`}
                    className={
                      issue.kind === 'miss' ? 'text-destructive' : undefined
                    }
                  >
                    {issue.message}
                  </li>
                ))}
              </ul>
            )}
            {preview.issueCount > preview.issues.length && (
              <p className="text-muted-foreground">
                안내 {preview.issueCount}건 중 {preview.issues.length}건만
                표시합니다.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
