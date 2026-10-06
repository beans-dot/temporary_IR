import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { JwtPayload } from '../auth/jwt-payload';
import { AlimiService } from './alimi.service';

@Controller('alimi')
@Roles('admin')
export class AlimiController {
  constructor(private readonly alimiService: AlimiService) {}

  @Get('batches')
  listBatches() {
    return this.alimiService.listBatches();
  }

  @Get('batch/status')
  getBatchStatus() {
    return this.alimiService.getBatchStatus();
  }

  @Post('batch')
  @HttpCode(HttpStatus.ACCEPTED)
  runBatch(@CurrentUser() admin: JwtPayload) {
    return this.alimiService.startBatch(admin.sub, 'manual');
  }
}
