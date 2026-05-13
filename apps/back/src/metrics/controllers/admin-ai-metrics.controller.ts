import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AiMetricsResponse } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AiMetricsQueryDto } from '../dto/ai-metrics.query.dto';
import { AdminAiMetricsService } from '../services/admin-ai-metrics.service';

/**
 * Endpoint admin-only para el dashboard de uso de IA. Devuelve agregados
 * sobre `ai_call_logs` por tenant (ver `tikora-ia.md` §12.2 — el doc
 * histórico lo llamaba `/internal/metrics`, acá quedó alineado al patrón
 * de rutas `/admin/*` del resto de la API).
 */
@ApiTags('Admin')
@ApiBearerAuth('bearer')
@Controller('admin/ai-metrics')
export class AdminAiMetricsController {
  constructor(private readonly service: AdminAiMetricsService) {}

  @Roles('admin')
  @Get()
  async getAiMetrics(
    @CurrentUser() caller: AuthenticatedUser,
    @Query() query: AiMetricsQueryDto,
  ): Promise<AiMetricsResponse> {
    return this.service.getTenantAiMetrics(caller, query);
  }
}
