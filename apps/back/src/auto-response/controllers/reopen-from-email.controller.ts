import { Body, Controller, HttpCode, HttpStatus, Logger, Param, Post } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { TicketResponse } from '@tikora/core';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { Public } from '../../auth/decorators/public.decorator';
import { ApiException } from '../../common/exceptions/api.exception';
import { TicketsService } from '../../tickets/services/tickets.service';
import { ReopenFromEmailDto } from '../dto/reopen-from-email.dto';
import { AiResponse, AiResponseDocument } from '../schemas/ai-response.schema';
import { EmailReopenTokenService } from '../services/email-reopen-token.service';

const REOPEN_FROM_EMAIL_MOTIVO = 'Auto-respuesta insuficiente — reapertura desde correo';

/**
 * Endpoint público (sin auth) que materializa el botón "Esto no resolvió
 * mi problema" del correo de auto-respuesta. El JWT del token autoriza
 * la acción — `JwtAuthGuard` global deja pasar por `@Public()`.
 *
 * Match con `tikora-ia.md` §7.7. Idempotente vía la state machine de
 * tickets: si el solicitante clickea dos veces, la primera reabre y la
 * segunda recibe `TICKET_TRANSITION_INVALID` (el ticket ya no está
 * `cerrado`).
 */
@Controller('tickets/:ticketId/reopen-from-email')
export class ReopenFromEmailController {
  private readonly logger = new Logger(ReopenFromEmailController.name);

  constructor(
    private readonly tokens: EmailReopenTokenService,
    private readonly tickets: TicketsService,
    @InjectModel(AiResponse.name)
    private readonly aiResponseModel: Model<AiResponseDocument>,
  ) {}

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post()
  async reopen(
    @Param('ticketId') ticketId: string,
    @Body() dto: ReopenFromEmailDto,
  ): Promise<TicketResponse> {
    let payload;
    try {
      payload = this.tokens.verify(dto.token);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'REOPEN_TOKEN_INVALID',
        `Token de reapertura inválido o vencido: ${message}`,
      );
    }

    if (payload.ticketId !== ticketId) {
      // Defensa contra tampering — el `:ticketId` del path no coincide
      // con el que viajó firmado en el JWT.
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'REOPEN_TOKEN_MISMATCH',
        'El token no corresponde al ticket indicado.',
      );
    }

    // Caller virtual armado desde el JWT del correo — el `reopen()`
    // valida que `requesterId === caller.userId`, así que esto sólo
    // habilita reabrir su propio ticket.
    const caller: AuthenticatedUser = {
      userId: payload.requesterId,
      tenantId: payload.tenantId,
      role: 'empleado',
      areaIds: [],
    };

    const result = await this.tickets.reopen(caller, ticketId, {
      motivo: REOPEN_FROM_EMAIL_MOTIVO,
    });

    // Marcar la AiResponse origen — métrica clave de Fase 3 para medir
    // cuántas auto-respuestas terminan reabriéndose. El update es best
    // effort: si la AiResponse fue purgada (extremadamente raro), el
    // reopen ya quedó persistido y logueamos un warning.
    try {
      await this.aiResponseModel.updateOne(
        {
          _id: new Types.ObjectId(payload.aiResponseId),
          tenantId: new Types.ObjectId(payload.tenantId),
        },
        { $set: { reopenedAfterAutoResponse: true } },
      );
    } catch (err) {
      this.logger.warn(
        `No se pudo marcar reopenedAfterAutoResponse en aiResponseId=${payload.aiResponseId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    return result;
  }
}
