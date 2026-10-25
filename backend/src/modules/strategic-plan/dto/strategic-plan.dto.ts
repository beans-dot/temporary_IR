import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { SP_MAX_YEAR, SP_MIN_YEAR } from '../strategic-plan.constants';

export class UpsertWriteLockDto {
  @IsString()
  @MaxLength(60)
  taskCode: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;

  @IsString()
  @Matches(/^(budget|eval)$/)
  kind: 'budget' | 'eval';

  @IsBoolean()
  isCompleted: boolean;
}

export class CreateFullRevisionDto {
  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;

  @IsString()
  @Matches(/^(structure|kpi|fund)$/)
  scope: 'structure' | 'kpi' | 'fund';
}

export class YearQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class OptionalYearQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year?: number;
}

export class UpsertGoalDto {
  @IsString()
  @MaxLength(10)
  goalId: string;

  @IsOptional()
  @IsInt()
  goalNo?: number;

  @IsString()
  @MaxLength(300)
  goalName: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateGoalDto {
  @IsOptional()
  @IsInt()
  goalNo?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  goalName?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpsertStrategyDto {
  @IsString()
  @MaxLength(20)
  strategyId: string;

  @IsString()
  @MaxLength(10)
  goalId: string;

  @IsString()
  @MaxLength(300)
  strategyName: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateStrategyDto {
  @IsOptional()
  @IsString()
  @MaxLength(10)
  goalId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  strategyName?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpsertTaskDto {
  @IsString()
  @MaxLength(60)
  taskCode: string;

  @IsString()
  @MaxLength(400)
  taskName: string;

  @IsString()
  @MaxLength(20)
  strategyId: string;

  @IsOptional()
  @IsBoolean()
  isSpecialized?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  primaryDept?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  relatedDepts?: string[];

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hangulCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateTaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  taskName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  strategyId?: string;

  @IsOptional()
  @IsBoolean()
  isSpecialized?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  primaryDept?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  relatedDepts?: string[];

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hangulCode?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class SubtaskItemDto {
  @IsString()
  @MaxLength(80)
  subtaskCode: string;

  @IsString()
  @MaxLength(400)
  subtaskName: string;
}

export class ReplaceSubtasksDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubtaskItemDto)
  @ArrayMaxSize(50)
  subtasks: SubtaskItemDto[];
}

export class UpsertKpiDto {
  @IsString()
  @MaxLength(30)
  kpiCode: string;

  @IsString()
  @MaxLength(300)
  kpiName: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  taskCode?: string;

  @IsOptional()
  @IsNumber()
  baseline?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  baselineRef?: string;

  @IsOptional()
  @IsString()
  formula?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  primaryDept?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateKpiDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  kpiName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  unit?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  taskCode?: string;

  @IsOptional()
  @IsNumber()
  baseline?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  baselineRef?: string;

  @IsOptional()
  @IsString()
  formula?: string;

  @IsOptional()
  @IsString()
  source?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  primaryDept?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z]$/)
  suffix?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class KpiValueDto {
  @IsOptional()
  @IsNumber()
  value?: number | null;
}

export class UpsertEvaluationDto {
  @IsString()
  @MaxLength(60)
  taskCode: string;

  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;

  @IsOptional()
  @IsString()
  deptSummary?: string | null;

  @IsOptional()
  @IsString()
  deptAnalysis?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  deptGrade?: string | null;

  @IsOptional()
  @IsString()
  deptImprovement?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  irGrade?: string | null;

  @IsOptional()
  @IsString()
  irFeedback?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  surveyGrade?: string | null;

  @IsOptional()
  @IsString()
  surveyAnalysis?: string | null;

  @IsOptional()
  @IsString()
  surveyFeedback?: string | null;

  @IsOptional()
  @IsObject()
  taskActivities?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  kpiPoEvals?: Record<string, unknown> | null;

  @IsOptional()
  @IsObject()
  kpiPoComments?: Record<string, unknown> | null;

  @IsOptional()
  @IsString()
  budgetAdequacy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  budgetAdequacyGrade?: string | null;

  @IsOptional()
  @IsString()
  processAdequacy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  processAdequacyGrade?: string | null;

  @IsOptional()
  @IsString()
  kpiAdequacy?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  kpiAdequacyGrade?: string | null;

  @IsOptional()
  @IsArray()
  surveyItems?: unknown[] | null;

  @IsOptional()
  @IsArray()
  surveyPlans?: unknown[] | null;

  @IsOptional()
  @IsBoolean()
  surveyItemsNa?: boolean;

  @IsOptional()
  @IsBoolean()
  surveyPlansNa?: boolean;

  @IsOptional()
  @IsObject()
  irEval?: Record<string, unknown> | null;
}

export class UpsertBudgetDto {
  @IsString()
  @MaxLength(60)
  taskCode: string;

  @IsString()
  @MaxLength(80)
  subtaskCode: string;

  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;

  @IsInt()
  fundSourceId: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetAmount?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  settlementAmount?: number | null;
}

export class CreateFundSourceDto {
  @IsString()
  @MaxLength(100)
  fundSourceName: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateFundSourceDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  fundSourceName?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year?: number;
}

export class CreateSubtaskDto {
  @IsString()
  @MaxLength(60)
  taskCode: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hangulCode?: string;

  @IsOptional()
  @IsInt()
  seqNo?: number;

  @IsString()
  @MaxLength(400)
  subtaskName: string;

  @IsOptional()
  @IsString()
  purpose?: string;

  @IsOptional()
  @IsString()
  method?: string;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class UpdateSubtaskDto {
  @IsOptional()
  @IsString()
  @MaxLength(400)
  subtaskName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  hangulCode?: string;

  @IsOptional()
  @IsString()
  purpose?: string | null;

  @IsOptional()
  @IsString()
  method?: string | null;

  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year: number;
}

export class CreateDepartmentDto {
  @IsString()
  @MaxLength(100)
  deptName: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class UpdateDepartmentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  deptName?: string;

  @IsOptional()
  @IsInt()
  displayOrder?: number;
}

export class MottoPairDto {
  @IsString()
  @MaxLength(80)
  motto: string;

  @IsString()
  @MaxLength(200)
  talent: string;
}

export class Talent3cDto {
  @IsString()
  @MaxLength(80)
  name: string;

  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(12)
  items: string[];
}

export class UpdateVisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(300)
  officialName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  planPeriod?: string | null;

  @IsOptional()
  @IsString()
  structureSummary?: string | null;

  @IsOptional()
  @IsString()
  visionStatement?: string | null;

  @IsOptional()
  @IsString()
  visionGoal?: string | null;

  @IsOptional()
  @IsString()
  mission?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200000)
  contentHtml?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  keyIndicators?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  foundingPhilosophy?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MottoPairDto)
  mottoPairs?: MottoPairDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => Talent3cDto)
  talent3c?: Talent3cDto | null;
}

/**
 * 사업프로그램·지표 JSON을 기존 값과 어떻게 합칠지.
 * keep: 같은 세부TASK·지표는 유지하고 없는 항목만 추가
 * overwrite: 같은 세부TASK·지표는 파일로 덮고, 파일에 없는 기존 항목은 유지
 * sync: 파일에 있는 실행과제의 해당 JSON을 파일 내용과 같게 맞춤
 */
export const SP_SEED_JSON_MODES = ['keep', 'overwrite', 'sync'] as const;
export type SpSeedJsonMode = (typeof SP_SEED_JSON_MODES)[number];

/** 중장기 예결산·자체평가 보고서 임시 시딩. strategies 안쪽은 추출 JSON 그대로 둔다. */
export class ImportSeedSnapshotDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SP_MIN_YEAR)
  @Max(SP_MAX_YEAR)
  year?: number;

  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;

  /** 파일에 없는 세부TASK의 초기시딩 합계를 이 연도에서 지운다. */
  @IsOptional()
  @IsBoolean()
  replaceMissing?: boolean;

  /**
   * 파일에 있는 실행과제의 사업프로그램·지표 JSON을 기존 값과 어떻게 합칠지.
   * 없으면 overwrite.
   */
  @IsOptional()
  @IsIn(SP_SEED_JSON_MODES)
  jsonMode?: SpSeedJsonMode;

  @IsArray()
  @ArrayMaxSize(40)
  strategies: unknown[];
}
