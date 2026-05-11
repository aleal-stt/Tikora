import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Body,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AiResponse as AiResponseDto } from '@tikora/core';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Roles } from '../../auth/decorators/roles.decorator';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApproveWithChangesDto } from '../dto/approve-with-changes.dto';
import { DiscardAiResponseDto } from '../dto/discard-ai-response.dto';
import { AutoResponseService } from '../services/auto-response.service';

/**
 * Controller para `/ai-responses` y el atajo `/tickets/:id/ai-response`.
 * Match con `tikora-api.md` §10.
 *
 * El RBAC fino lo aplica `AutoResponseService` (LID/AGE solo sobre tickets
 * de áreas que tocan; ADM siempre).
 */
@ApiTags('AI Responses')
@ApiBearerAuth('bearer')
@Controller()
export class AiResponsesController {
  constructor(private readonly autoResponse: AutoResponseService) {}

  @Roles('agente', 'lider', 'admin')
  @Get('tickets/:id/ai-response')
  async getCurrentForTicket(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') ticketId: string,
  ): Promise<AiResponseDto> {
    const ai = await this.autoResponse.getCurrentForTicket(caller, ticketId);
    if (!ai) {
      // 404 explícito según `tikora-api.md` §10 — el front lo usa para
      // decidir si mostrar el panel "Sugerencia IA" o no.
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'AI_RESPONSE_NOT_FOUND',
        message: 'El ticket no tiene una sugerencia IA vigente.',
        details: [],
      });
    }
    return ai;
  }

  /**
   * Endpoint admin-only — habilita el panel de diagnóstico cuando el cron
   * de auto-respuesta falló. Devuelve 404 si la última respuesta del
   * ticket no es `fallida`, así el front decide si mostrar el panel.
   */
  @Roles('admin')
  @Get('tickets/:id/ai-response/failed')
  async getLatestFailedForTicket(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') ticketId: string,
  ): Promise<AiResponseDto> {
    const ai = await this.autoResponse.getLatestFailedForTicket(caller, ticketId);
    if (!ai) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        code: 'AI_RESPONSE_NOT_FOUND',
        message: 'El ticket no tiene una respuesta IA fallida.',
        details: [],
      });
    }
    return ai;
  }

  @Roles('agente', 'lider', 'admin')
  @HttpCode(HttpStatus.OK)
  @Patch('ai-responses/:id/approve')
  async approve(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<AiResponseDto> {
    return this.autoResponse.approve(caller, id);
  }

  @Roles('agente', 'lider', 'admin')
  @HttpCode(HttpStatus.OK)
  @Patch('ai-responses/:id/approve-with-changes')
  async approveWithChanges(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ApproveWithChangesDto,
  ): Promise<AiResponseDto> {
    return this.autoResponse.approveWithChanges(caller, id, dto);
  }

  @Roles('agente', 'lider', 'admin')
  @HttpCode(HttpStatus.OK)
  @Patch('ai-responses/:id/discard')
  async discard(
    @CurrentUser() caller: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: DiscardAiResponseDto,
  ): Promise<AiResponseDto> {
    return this.autoResponse.discard(caller, id, dto);
  }
}
