import { envFilePaths } from './config/load-env';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildTypeOrmOptions } from './config/typeorm.config';
import { AlimiModule } from './modules/alimi/alimi.module';
import { AnnualEventsModule } from './modules/annual-events/annual-events.module';
import { AuthModule } from './modules/auth/auth.module';
import { InternalOrgModule } from './modules/internal-org/internal-org.module';
import { MailModule } from './modules/mail/mail.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { PivotModule } from './modules/pivot/pivot.module';
import { PresetsModule } from './modules/presets/presets.module';
import { RawCorrectionModule } from './modules/raw-correction/raw-correction.module';
import { StrategicPlanModule } from './modules/strategic-plan/strategic-plan.module';
import { UniversitiesModule } from './modules/universities/universities.module';
import { UpdateLogModule } from './modules/update-log/update-log.module';
import { UploadModule } from './modules/upload/upload.module';
import { UsersModule } from './modules/users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: envFilePaths }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRoot(buildTypeOrmOptions()),
    AuthModule,
    UsersModule,
    MailModule,
    MetricsModule,
    UniversitiesModule,
    InternalOrgModule,
    PivotModule,
    PresetsModule,
    UpdateLogModule,
    AlimiModule,
    UploadModule,
    AnnualEventsModule,
    RawCorrectionModule,
    StrategicPlanModule,
  ],
})
export class AppModule {}
