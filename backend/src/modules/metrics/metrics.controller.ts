import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { parseMetricSourceType } from './metric-source';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  // 업무 주제별 카테고리 지표 트리 (Dual-Listbox 모달용)
  @Get('tree')
  getTree(
    @Query('sourceType') sourceType?: string,
    @Query('includeHidden') includeHidden?: string,
  ) {
    return this.metricsService.getCategoryTree(
      parseMetricSourceType(sourceType),
      includeHidden === 'true' || includeHidden === '1',
    );
  }

  /** 업로드용 지표 코드북 (공시/자체/모니터링 구분) */
  @Get('codebook')
  getCodebook(@Query('includeHidden') includeHidden?: string) {
    return this.metricsService.getCodebook(
      includeHidden === 'true' || includeHidden === '1',
    );
  }

  /** 모니터링 입력값 또는 자동연결 정보공시값이 존재하는 연도 */
  @Get('monitoring/years')
  listMonitoringYears() {
    return this.metricsService.listMonitoringYears();
  }

  /** 대학 전체값에 사용할 대학알리미 지표 매핑과 가용 연도 */
  @Get('monitoring/official-links')
  getMonitoringOfficialLinks() {
    return this.metricsService.getMonitoringOfficialLinks();
  }

  @Get('categories')
  listCategories() {
    return this.metricsService.listCategories();
  }

  @Post('categories')
  createCategory(
    @Body()
    body: {
      categoryName: string;
      displayOrder?: number;
      sourceType?: string;
    },
  ) {
    return this.metricsService.createCategory({
      ...body,
      sourceType: parseMetricSourceType(body.sourceType),
    });
  }

  @Put('categories/:id')
  updateCategory(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { categoryName: string },
  ) {
    return this.metricsService.updateCategory(id, body);
  }

  @Put('categories/:id/hidden')
  setCategoryHidden(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isHidden: boolean },
  ) {
    return this.metricsService.setCategoryHidden(id, !!body.isHidden);
  }

  @Delete('categories/:id')
  deleteCategory(@Param('id', ParseIntPipe) id: number) {
    return this.metricsService.deleteCategory(id);
  }

  @Post()
  createMetric(
    @Body()
    body: {
      categoryId: number;
      sourceType?: string;
      metricName: string;
      metricUnit?: string;
      aggregationType?: string;
      displayOrder?: number;
      parentMetricId?: number | null;
    },
  ) {
    return this.metricsService.createMetric({
      ...body,
      sourceType: parseMetricSourceType(body.sourceType),
    });
  }

  @Put('reorder')
  reorder(
    @Body()
    body: {
      categories?: { categoryId: number; displayOrder: number }[];
      metrics?: {
        metricId: number;
        categoryId: number;
        displayOrder: number;
        parentMetricId?: number | null;
      }[];
    },
  ) {
    return this.metricsService.reorder(body);
  }

  @Put(':id/hidden')
  setMetricHidden(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { isHidden: boolean },
  ) {
    return this.metricsService.setMetricHidden(id, !!body.isHidden);
  }

  /** 지표명·자동계산식 변경 (자체 데이터·모니터링) */
  @Put(':id')
  updateMetric(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      metricName?: string;
      computeFormula?: string | null;
      computeEnabled?: boolean;
    },
  ) {
    return this.metricsService.updateMetric(id, body);
  }

  @Delete(':id')
  deleteMetric(@Param('id', ParseIntPipe) id: number) {
    return this.metricsService.deleteMetric(id);
  }
}
