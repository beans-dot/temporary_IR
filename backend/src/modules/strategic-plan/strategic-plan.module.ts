import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  IrSpChangeLog,
  IrSpCompareData,
  IrSpDepartment,
  IrSpEvaluation,
  IrSpFundSource,
  IrSpGoal,
  IrSpItemVersion,
  IrSpKpi,
  IrSpKpiResult,
  IrSpKpiTarget,
  IrSpStrategy,
  IrSpSubtask,
  IrSpTask,
  IrSpTaskBudget,
  IrSpFullRevision,
  IrSpVision,
  IrSpWriteLock,
} from '../../entities';
import { InternalOrgModule } from '../internal-org/internal-org.module';
import { SpSeedImportService } from './sp-seed-import.service';
import { SpStructureService } from './sp-structure.service';
import { StrategicPlanController } from './strategic-plan.controller';
import { StrategicPlanService } from './strategic-plan.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      IrSpVision,
      IrSpGoal,
      IrSpStrategy,
      IrSpTask,
      IrSpSubtask,
      IrSpKpi,
      IrSpKpiTarget,
      IrSpKpiResult,
      IrSpEvaluation,
      IrSpCompareData,
      IrSpFundSource,
      IrSpDepartment,
      IrSpTaskBudget,
      IrSpItemVersion,
      IrSpChangeLog,
      IrSpWriteLock,
      IrSpFullRevision,
    ]),
    InternalOrgModule,
  ],
  controllers: [StrategicPlanController],
  providers: [StrategicPlanService, SpStructureService, SpSeedImportService],
  exports: [StrategicPlanService],
})
export class StrategicPlanModule {}
