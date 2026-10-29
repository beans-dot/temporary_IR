import { Controller, Get } from '@nestjs/common';
import { Public } from './modules/auth/decorators/public.decorator';

@Controller()
export class RootController {
  @Public()
  @Get()
  home() {
    return { ok: true, service: 'YSU IR API' };
  }
}
