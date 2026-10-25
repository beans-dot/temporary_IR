/**
 * 추출 JSON이 골라야 하는 닫힌 코드.
 * 보고서의 자연어를 그대로 넣지 않고, 이 code_id만 복사하게 한다.
 */

export interface SeedCodeRow {
  code_id: string;
  name: string;
  /** 보고서에 이렇게 보여도 code_id를 쓴다. */
  aliases: string[];
}

export const SP_FUND_CATALOG: readonly SeedCodeRow[] = [
  { code_id: 'FUND_TUITION', name: '교비', aliases: ['교비'] },
  {
    code_id: 'FUND_INNOV',
    name: '재정지원사업(혁신)',
    aliases: ['교육부(혁신)', '혁신', '재정지원(혁신)', '혁신지원사업'],
  },
  {
    code_id: 'FUND_RISE',
    name: '재정지원사업(RISE)',
    aliases: ['교육부(RISE)', 'RISE', 'rise', '라이즈'],
  },
  {
    code_id: 'FUND_ANCHOR',
    name: '재정지원사업(앵커)',
    aliases: ['교육부(앵커)', '앵커'],
  },
  {
    code_id: 'FUND_AID',
    name: '재정지원사업(AID)',
    aliases: ['교육부(AID)', 'AID', 'aid'],
  },
  {
    code_id: 'FUND_MOE_ETC',
    name: '재정지원사업 기타',
    aliases: ['교육부(기타)', '재정지원사업기타', '재정지원 기타'],
  },
  {
    code_id: 'FUND_NEWIND',
    name: '신산업',
    aliases: ['신산업', '교육부(신산업)', '신산업분야'],
  },
  {
    code_id: 'FUND_LOCAL',
    name: '지자체 사업',
    aliases: ['지자체', '지자체사업'],
  },
  { code_id: 'FUND_OTHER', name: '기타', aliases: ['기타재원'] },
];

export const SP_DEPT_GRADE_CATALOG: readonly SeedCodeRow[] = [
  {
    code_id: 'GRADE_HIGH',
    name: '우수',
    aliases: ['전년 대비 상향', '전년대비 상향', '전년대비상향', '상향', '향상'],
  },
  {
    code_id: 'GRADE_MID',
    name: '보통',
    aliases: ['동일', '유지', '전년 대비 동일', '전년대비 동일', '전년대비동일'],
  },
  {
    code_id: 'GRADE_LOW',
    name: '미흡',
    aliases: ['전년 대비 하향', '전년대비 하향', '전년대비하향', '하향', '하락'],
  },
];

export const SP_PLAN_GRADE_CATALOG: readonly SeedCodeRow[] = [
  { code_id: 'PLAN_NOW', name: '신속반영', aliases: [] },
  { code_id: 'PLAN_STEP', name: '점진반영', aliases: [] },
  { code_id: 'PLAN_NO', name: '반영불가', aliases: [] },
];

export const SEED_EXTRACT_RULES = [
  '금액단위는 천원이다. 예산_천원, 결산_천원, 집행액_천원에는 천원 숫자만 쓴다.',
  'code_id는 보고서에 적힌 코드를 그대로 복사한다. 지금 발전계획 코드표와 달라도 보고서 코드를 유지한다. 새 코드를 지어내지 않는다.',
  '실행과제가 E42-기획이어도 세부TASK 코드가 E42-CTL-3처럼 다를 수 있다. 부모 이름에 번호를 붙여 코드를 만들지 않는다.',
  '이름이 같은 행의 code_id를 복사한다. name에는 보고서의 이름을 그대로 넣는다. 코드표와 달라도 보고서 이름을 쓴다.',
  '실행과제와 성과지표에는 책임부서를 넣는다. 값은 보고서에 적힌 부서 이름이다. 코드표에 없어도 만들어 적고, 보고서에 부서가 없으면 그 키를 빼거나 빈 문자열로 둔다. 세부TASK에는 책임부서를 넣지 않는다.',
  '재원_code_id는 코드표의 아홉 개를 우선 쓴다. 교육부(혁신)과 혁신은 FUND_INNOV, 교육부(RISE)와 RISE는 FUND_RISE, 교육부(기타)는 FUND_MOE_ETC, 신산업은 FUND_NEWIND, 교비는 FUND_TUITION이다. 그 해에만 있는 사업은 보고서에 적힌 이름을 그대로 넣는다. 예: LINC3.0, HiVE, 재정지원사업(국고). 코드표에 없는 재원은 그 학년도 예결산 화면에만 생긴다.',
  '한 칸에 교비/혁신/신산업처럼 재원이 여러 개면 슬래시로 붙이지 않고 재원마다 행을 만든다. 금액이 재원별로 있으면 그 금액을 적는다. 금액이 하나면 첫 재원 행에만 그 금액을 적고 나머지 재원 행의 예산_천원과 결산_천원, 집행액_천원은 0으로 적는다.',
  '등급_code_id는 GRADE_HIGH, GRADE_MID, GRADE_LOW만 쓴다. 전년 대비 상향은 GRADE_HIGH, 동일은 GRADE_MID, 전년 대비 하향은 GRADE_LOW다. 등급 칸에 문장을 넣지 않는다.',
  '환류계획_등급_code_id는 PLAN_NOW, PLAN_STEP, PLAN_NO만 쓴다.',
  '성과지표의 자체평가_등급_code_id는 등급 코드다. 자체평가 키의 값은 문장이다.',
  '만족도 세부항목의 등급_code_id도 GRADE_HIGH, GRADE_MID, GRADE_LOW다.',
  '보고서에 내용이 없는 전략·실행과제·세부TASK·지표는 출력에서 뺀다. 빈 코드는 만들지 않는다.',
  '목표, 달성률, 기준값, IR 평가 문장은 넣지 않는다.',
] as const;

function compactKey(value: string) {
  return value.replace(/\s+/g, '').toLowerCase();
}

function lookup(catalog: readonly SeedCodeRow[], raw: string): string | null {
  const key = compactKey(raw);
  if (!key) return null;
  for (const row of catalog) {
    if (compactKey(row.code_id) === key || compactKey(row.name) === key) {
      return row.name;
    }
    for (const alias of row.aliases) {
      if (compactKey(alias) === key) return row.name;
    }
  }
  return null;
}

/** 재원_code_id, 재원명, 보고서 별칭을 화면 재원명으로 바꾼다. 모르면 null. */
export function canonicalFundName(raw: string): string | null {
  return lookup(SP_FUND_CATALOG, raw);
}

/** 슬래시·쉼표로 붙은 재원을 화면 재원명 목록으로 나눈다. */
export function resolveFundList(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const parts = text
    .split(/[/／,，、]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const tokens = parts.length > 1 ? parts : [text];
  return tokens.map((token) => canonicalFundName(token) ?? token);
}

/** 등급_code_id와 보고서의 상향·동일·하향을 미흡·보통·우수로 바꾼다. */
export function canonicalDeptGrade(raw: string): string | null {
  return lookup(SP_DEPT_GRADE_CATALOG, raw);
}

/** 환류계획_등급_code_id를 신속반영·점진반영·반영불가로 바꾼다. */
export function canonicalPlanGrade(raw: string): string | null {
  return lookup(SP_PLAN_GRADE_CATALOG, raw);
}

export function fundCodeHint() {
  return SP_FUND_CATALOG.map((row) => `${row.code_id}(${row.name})`).join(', ');
}
