import { Module } from '@nestjs/common';
import { AlimiController } from './alimi.controller';
import { AlimiScheduler } from './alimi.scheduler';
import { AlimiService } from './alimi.service';

@Module({
  controllers: [AlimiController],
  providers: [AlimiService, AlimiScheduler],
  exports: [AlimiService],
})
export class AlimiModule {}
