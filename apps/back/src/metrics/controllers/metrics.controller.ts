import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AreaMetricsResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AreaMetricsQueryDto } from '../dto/area-metrics.query.dto';
import { MetricsService } from '../services/metrics.service';

/**
 * Vive en su propio módulo (no dentro de `AreasController`) para evitar
 * el ciclo `AreasModule ↔ MetricsModule`. El path `/areas/:areaId/metrics`
 * coincide con el contrato de `tikora-api.md` §6.2 igual.
 */
@ApiTags('Metrics')
@ApiBearerAuth('bearer')
@Controller('areas/:areaId/metrics')
export class MetricsController {
  constructor(private readonly metrics: MetricsService) {}

  @Roles('lider', 'admin')
  @Get()
  async getAreaMetrics(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('areaId') areaId: string,
    @Query() query: AreaMetricsQueryDto,
  ): Promise<AreaMetricsResponse> {
    return this.metrics.getAreaMetrics(caller, areaId, query);
  }
}
