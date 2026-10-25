import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import {
  CreateDepartmentDto,
  CreateFullRevisionDto,
  CreateFundSourceDto,
  CreateSubtaskDto,
  KpiValueDto,
  OptionalYearQueryDto,
  ReplaceSubtasksDto,
  UpdateDepartmentDto,
  UpdateFundSourceDto,
  UpdateGoalDto,
  UpdateKpiDto,
  UpdateStrategyDto,
  UpdateSubtaskDto,
  UpdateTaskDto,
  ImportSeedSnapshotDto,
  UpdateVisionDto,
  UpsertBudgetDto,
  UpsertEvaluationDto,
  UpsertWriteLockDto,
  UpsertGoalDto,
  UpsertKpiDto,
  UpsertStrategyDto,
  UpsertTaskDto,
  YearQueryDto,
} from './dto/strategic-plan.dto';
import { SpSeedImportService } from './sp-seed-import.service';
import {
  StrategicPlanService,
  type SpCompareIndicator,
} from './strategic-plan.service';

@Controller('strategic-plan')
export class StrategicPlanController {
  constructor(
    private readonly service: StrategicPlanService,
    private readonly seedImport: SpSeedImportService,
  ) {}

  /* ── 대시보드: 로그인 사용자 전원 ── */

  @Get('tree')
  getTree(@Query() query: OptionalYearQueryDto) {
    return this.service.getTree(query.year);
  }

  @Get('compare')
  getCompare() {
    return this.service.getCompare();
  }

  @Get('fund-sources')
  listFundSources(
    @Query('includeInactive') includeInactive?: string,
    @Query('year') yearRaw?: string,
  ) {
    const year = yearRaw ? Number(yearRaw) : undefined;
    return this.service.listFundSources(
      includeInactive === 'true',
      Number.isFinite(year) ? year : undefined,
    );
  }

  @Get('evaluations')
  listEvaluations(@Query() query: YearQueryDto) {
    return this.service.listEvaluations(query.year);
  }

  @Put('evaluations')
  upsertEvaluation(
    @Body() dto: UpsertEvaluationDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.upsertEvaluation(dto, user.sub);
  }

  @Get('budgets')
  listBudgets(@Query() query: YearQueryDto) {
    return this.service.listBudgets(query.year);
  }

  @Put('budgets')
  upsertBudget(@Body() dto: UpsertBudgetDto, @CurrentUser() user: JwtPayload) {
    return this.service.upsertBudget(dto, user.sub);
  }

  /** 보고서 JSON으로 해당 연도 예결산·자체평가를 임시 반영 */
  @Roles('admin')
  @Post('seed-snapshot')
  importSeedSnapshot(
    @Body() dto: ImportSeedSnapshotDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.seedImport.importSnapshot(dto, user.sub);
  }

  /** 추출 LLM에 넘길 닫힌 코드표 */
  @Roles('admin')
  @Get('seed-catalog')
  seedCatalog() {
    return this.seedImport.extractionCatalog();
  }

  @Get('write-locks')
  listWriteLocks(@Query() query: YearQueryDto) {
    return this.service.listWriteLocks(query.year);
  }

  @Put('write-locks')
  upsertWriteLock(
    @Body() dto: UpsertWriteLockDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.upsertWriteLock(dto, user.sub);
  }

  /* ── 관리자: 체계 ── */

  @Roles('admin')
  @Get('full-revisions')
  listFullRevisions() {
    return this.service.listFullRevisions();
  }

  @Roles('admin')
  @Post('full-revisions')
  createFullRevision(
    @Body() dto: CreateFullRevisionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createFullRevision(dto, user.sub);
  }

  @Roles('admin')
  @Get('changes')
  listChanges() {
    return this.service.listChanges();
  }

  @Roles('admin')
  @Post('changes/:logId/rollback')
  rollbackChange(
    @Param('logId', ParseIntPipe) logId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.rollbackChange(logId, user.sub);
  }

  @Roles('admin')
  @Post('goals')
  createGoal(@Body() dto: UpsertGoalDto, @CurrentUser() user: JwtPayload) {
    return this.service.createGoal(dto, user.sub);
  }

  @Roles('admin')
  @Put('goals/:goalId')
  updateGoal(
    @Param('goalId') goalId: string,
    @Body() dto: UpdateGoalDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateGoal(goalId, dto, user.sub);
  }

  @Roles('admin')
  @Delete('goals/:goalId')
  deleteGoal(
    @Param('goalId') goalId: string,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteGoal(goalId, query.year, user.sub);
  }

  @Roles('admin')
  @Post('strategies')
  createStrategy(
    @Body() dto: UpsertStrategyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createStrategy(dto, user.sub);
  }

  @Roles('admin')
  @Put('strategies/:strategyId')
  updateStrategy(
    @Param('strategyId') strategyId: string,
    @Body() dto: UpdateStrategyDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateStrategy(strategyId, dto, user.sub);
  }

  @Roles('admin')
  @Delete('strategies/:strategyId')
  deleteStrategy(
    @Param('strategyId') strategyId: string,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteStrategy(strategyId, query.year, user.sub);
  }

  @Roles('admin')
  @Post('tasks')
  createTask(@Body() dto: UpsertTaskDto, @CurrentUser() user: JwtPayload) {
    return this.service.createTask(dto, user.sub);
  }

  @Roles('admin')
  @Put('tasks/:taskCode')
  updateTask(
    @Param('taskCode') taskCode: string,
    @Body() dto: UpdateTaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateTask(taskCode, dto, user.sub);
  }

  @Roles('admin')
  @Delete('tasks/:taskCode')
  deleteTask(
    @Param('taskCode') taskCode: string,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteTask(taskCode, query.year, user.sub);
  }

  @Roles('admin')
  @Post('subtasks')
  createSubtask(
    @Body() dto: CreateSubtaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createSubtask(dto, user.sub);
  }

  @Roles('admin')
  @Put('subtasks/:subtaskCode')
  updateSubtask(
    @Param('subtaskCode') subtaskCode: string,
    @Body() dto: UpdateSubtaskDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateSubtask(subtaskCode, dto, user.sub);
  }

  @Roles('admin')
  @Delete('subtasks/:subtaskCode')
  deleteSubtask(
    @Param('subtaskCode') subtaskCode: string,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteSubtask(subtaskCode, query.year, user.sub);
  }

  @Roles('admin')
  @Put('tasks/:taskCode/subtasks')
  replaceSubtasks(
    @Param('taskCode') taskCode: string,
    @Body() dto: ReplaceSubtasksDto,
  ) {
    return this.service.replaceSubtasks(taskCode, dto);
  }

  /* ── 관리자: KPI 목표·실적 ── */

  @Roles('admin')
  @Post('kpis')
  createKpi(@Body() dto: UpsertKpiDto, @CurrentUser() user: JwtPayload) {
    return this.service.createKpi(dto, user.sub);
  }

  @Roles('admin')
  @Put('kpis/:kpiCode')
  updateKpi(
    @Param('kpiCode') kpiCode: string,
    @Body() dto: UpdateKpiDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateKpi(kpiCode, dto, user.sub);
  }

  @Roles('admin')
  @Delete('kpis/:kpiCode')
  deleteKpi(
    @Param('kpiCode') kpiCode: string,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteKpi(kpiCode, query.year, user.sub);
  }

  @Roles('admin')
  @Put('kpis/:kpiCode/targets/:year')
  setKpiTarget(
    @Param('kpiCode') kpiCode: string,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: KpiValueDto,
  ) {
    return this.service.setKpiTarget(kpiCode, year, dto.value ?? null);
  }

  @Roles('admin')
  @Put('kpis/:kpiCode/results/:year')
  setKpiResult(
    @Param('kpiCode') kpiCode: string,
    @Param('year', ParseIntPipe) year: number,
    @Body() dto: KpiValueDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.setKpiResult(kpiCode, year, dto.value ?? null, user.sub);
  }

  /* ── 관리자: 재원 유형 ── */

  @Roles('admin')
  @Post('fund-sources')
  createFundSource(
    @Body() dto: CreateFundSourceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.createFundSource(dto, user.sub);
  }

  @Roles('admin')
  @Put('fund-sources/:fundSourceId')
  updateFundSource(
    @Param('fundSourceId', ParseIntPipe) fundSourceId: number,
    @Body() dto: UpdateFundSourceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.updateFundSource(fundSourceId, dto, user.sub);
  }

  @Roles('admin')
  @Delete('fund-sources/:fundSourceId')
  deleteFundSource(
    @Param('fundSourceId', ParseIntPipe) fundSourceId: number,
    @Query() query: YearQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.deleteFundSource(fundSourceId, query.year, user.sub);
  }

  /* ── 관리자: 부서 ── */

  @Roles('admin')
  @Get('departments')
  listDepartments() {
    return this.service.listDepartments();
  }

  @Roles('admin')
  @Post('departments')
  createDepartment(@Body() dto: CreateDepartmentDto) {
    return this.service.createDepartment(dto);
  }

  @Roles('admin')
  @Put('departments/:deptId')
  updateDepartment(
    @Param('deptId', ParseIntPipe) deptId: number,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.service.updateDepartment(deptId, dto);
  }

  @Roles('admin')
  @Delete('departments/:deptId')
  deleteDepartment(@Param('deptId', ParseIntPipe) deptId: number) {
    return this.service.deleteDepartment(deptId);
  }

  /* ── 비전 체계 본문 이미지 ── */

  @Public()
  @Get('vision/images/:filename')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  getVisionImage(@Param('filename') filename: string) {
    const { stream, contentType } = this.service.getVisionImage(filename);
    return new StreamableFile(stream, { type: contentType });
  }

  @Roles('admin')
  @Post('vision/images')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (!/^image\/(jpeg|png|gif|webp)$/.test(file.mimetype)) {
          cb(
            new BadRequestException(
              'jpeg, png, gif, webp 이미지만 올릴 수 있습니다.',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  uploadVisionImage(@UploadedFile() file: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('업로드된 파일이 없습니다.');
    }
    return this.service.saveVisionImage(file);
  }

  /* ── 관리자: 비전·비교 ── */

  @Roles('admin')
  @Put('vision')
  updateVision(@Body() dto: UpdateVisionDto) {
    return this.service.updateVision(dto);
  }

  @Roles('admin')
  @Put('compare')
  replaceCompare(
    @Body() body: { years: number[]; indicators: SpCompareIndicator[] },
  ) {
    return this.service.replaceCompare(body);
  }
}
