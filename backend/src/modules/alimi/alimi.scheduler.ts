import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AlimiService } from './alimi.service';

const MONTHLY_CRON = process.env.ALIMI_BATCH_CRON || '0 0 3 1 * *';
const BATCH_TIME_ZONE =
  process.env.ALIMI_BATCH_TIME_ZONE || 'Asia/Seoul';

@Injectable()
export class AlimiScheduler {
  private readonly logger = new Logger(AlimiScheduler.name);

  constructor(private readonly alimiService: AlimiService) {}

  @Cron(MONTHLY_CRON, {
    name: 'alimi-monthly-batch',
    timeZone: BATCH_TIME_ZONE,
  })
  async runMonthlyBatch(): Promise<void> {
    try {
      await this.alimiService.startBatch(undefined, 'scheduled');
      this.logger.log(
        `[ALIMI] 월간 자동 배치 시작 (${MONTHLY_CRON}, ${BATCH_TIME_ZONE})`,
      );
    } catch (err) {
      if (err instanceof ConflictException) {
        this.logger.warn('[ALIMI] 기존 배치가 실행 중이어서 월간 배치를 건너뜁니다.');
        return;
      }
      this.logger.error(
        `[ALIMI] 월간 자동 배치 시작 실패: ${(err as Error).message}`,
      );
    }
  }
}
