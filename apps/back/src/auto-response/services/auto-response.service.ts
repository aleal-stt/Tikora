import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AiResponse as AiResponseDto,
  AiResponseSource,
  ApproveWithChanges,
  DiscardAiResponse,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { EmailService } from '../../email/services/email.service';
import { InteractionsService } from '../../interactions/services/interactions.service';
import { KbSearchService } from '../../kb/services/kb-search.service';
import { KbChunk, KbChunkDocument } from '../../kb/schemas/kb-chunk.schema';
import { KbDocument, KbDocumentDocument } from '../../kb/schemas/kb-document.schema';
import {
  NOTIFICATION_EVENTS,
  TicketResolvedEvent,
} from '../../notifications/events/notification-events';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  AUTO_RESPONSE_EVENTS,
  AiResponseApprovedEvent,
  AiResponseDiscardedEvent,
  AiResponseSentEvent,
} from '../events/auto-response-events';
import { AiResponse, AiResponseDocument } from '../schemas/ai-response.schema';

/**
 * Endpoints públicos del módulo `auto-response`. Maneja las decisiones
 * humanas (aprobar / aprobar con cambios / descartar) y orquesta el
 * envío del correo + cierre auto del ticket.
 *
 * Match con `tikora-ia.md` §7.6 y `tikora-api.md` §10.
 *
 * Flujo de aprobación:
 *
 *   sugerida → aprobada (PATCH approve)
 *   sugerida → editada  (PATCH approve-with-changes)
 *   sugerida → descartada (PATCH discard)
 *
 *   aprobada/editada → enviada (síncrono, dentro del approve)
 *   enviada ⇒ ticket: estado=cerrado, resolutionType=auto
 */
@Injectable()
export class AutoResponseService {
  private readonly logger = new Logger(AutoResponseService.name);

  constructor(
    @InjectModel(AiResponse.name)
    private readonly aiResponseModel: Model<AiResponseDocument>,
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(KbDocument.name)
    private readonly kbDocumentModel: Model<KbDocumentDocument>,
    @InjectModel(KbChunk.name) private readonly kbChunkModel: Model<KbChunkDocument>,
    private readonly email: EmailService,
    private readonly interactions: InteractionsService,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Devuelve la última `AiResponse` del ticket en estado `fallida` para
   * que el admin pueda inspeccionar la falla del LLM (modelo, tokens,
   * detalle del error). Sólo admin — el resto de roles no tienen
   * razón operativa para verla. Devuelve `null` si la última no es
   * fallida o si el ticket no tiene ninguna.
   */
  async getLatestFailedForTicket(
    caller: AuthenticatedUser,
    ticketId: string,
  ): Promise<AiResponseDto | null> {
    if (caller.role !== 'admin') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'AI_RESPONSE_FORBIDDEN',
        'Solo admins pueden ver fallas de IA.',
      );
    }
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    const ai = await this.aiResponseModel
      .findOne({ tenantId: ticket.tenantId, ticketId: ticket._id, estado: 'fallida' })
      .sort({ createdAt: -1 })
      .exec();
    if (!ai) return null;
    return this.toResponse(ai);
  }

  /**
   * Devuelve la respuesta IA vigente del ticket, si hay una en estado
   * `sugerida`. Si la única que existe ya fue descartada/enviada,
   * retorna `null` (el endpoint mapea a 404).
   */
  async getCurrentForTicket(
    caller: AuthenticatedUser,
    ticketId: string,
  ): Promise<AiResponseDto | null> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    this.assertCanReadTicket(caller, ticket);

    const ai = await this.aiResponseModel
      .findOne({ tenantId: ticket.tenantId, ticketId: ticket._id })
      .sort({ createdAt: -1 })
      .exec();
    // Las fallidas son audit-only: se persisten para trazar la llamada
    // perdida pero no se muestran en el panel del ticket porque no son
    // accionables (no hay nada que aprobar ni descartar).
    if (!ai || ai.estado === 'descartada' || ai.estado === 'fallida') return null;
    return this.toResponse(ai);
  }

  async approve(caller: AuthenticatedUser, id: string): Promise<AiResponseDto> {
    const ai = await this.findOrFail(caller.tenantId, id);
    const ticket = await this.findTicketOrFailById(ai.tenantId, ai.ticketId);
    this.assertCanActOnTicket(caller, ticket);
    this.assertSugerida(ai);

    if (!ai.respondable || !ai.originalAiContent) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI_RESPONSE_NOT_RESPONDABLE',
        'La respuesta IA no es aprobable: el modelo determinó que la KB no alcanza.',
      );
    }

    ai.estado = 'aprobada';
    ai.approvedBy = new Types.ObjectId(caller.userId);
    ai.approvedAt = new Date();
    ai.content = ai.originalAiContent;
    await ai.save();

    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseApproved, {
      tenantId: ai.tenantId.toString(),
      ticketId: ai.ticketId.toString(),
      aiResponseId: ai._id.toString(),
      approvedBy: caller.userId,
      edited: false,
    } satisfies AiResponseApprovedEvent);

    await this.deliverAndClose(ai, ticket, caller.userId, false);
    return this.toResponse(ai);
  }

  async approveWithChanges(
    caller: AuthenticatedUser,
    id: string,
    input: ApproveWithChanges,
  ): Promise<AiResponseDto> {
    const ai = await this.findOrFail(caller.tenantId, id);
    const ticket = await this.findTicketOrFailById(ai.tenantId, ai.ticketId);
    this.assertCanActOnTicket(caller, ticket);
    this.assertSugerida(ai);

    if (!ai.respondable || !ai.originalAiContent) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AI_RESPONSE_NOT_RESPONDABLE',
        'La respuesta IA no es aprobable: el modelo determinó que la KB no alcanza.',
      );
    }

    ai.estado = 'editada';
    ai.editedBy = new Types.ObjectId(caller.userId);
    ai.editedAt = new Date();
    ai.approvedBy = new Types.ObjectId(caller.userId);
    ai.approvedAt = new Date();
    ai.content = input.respuestaFinal;
    ai.diffSummary = this.summarizeDiff(ai.originalAiContent, input.respuestaFinal);
    await ai.save();

    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseApproved, {
      tenantId: ai.tenantId.toString(),
      ticketId: ai.ticketId.toString(),
      aiResponseId: ai._id.toString(),
      approvedBy: caller.userId,
      edited: true,
    } satisfies AiResponseApprovedEvent);

    await this.deliverAndClose(ai, ticket, caller.userId, false);
    return this.toResponse(ai);
  }

  async discard(
    caller: AuthenticatedUser,
    id: string,
    input: DiscardAiResponse,
  ): Promise<AiResponseDto> {
    const ai = await this.findOrFail(caller.tenantId, id);
    const ticket = await this.findTicketOrFailById(ai.tenantId, ai.ticketId);
    this.assertCanActOnTicket(caller, ticket);
    this.assertSugerida(ai);

    ai.estado = 'descartada';
    ai.discardedBy = new Types.ObjectId(caller.userId);
    ai.discardedAt = new Date();
    ai.discardReason = input.motivo;
    await ai.save();

    // Interacción de sistema en el ticket — útil para que el agente que
    // toma el caso vea por qué llegó "manual" si había una sugerencia.
    await this.interactions
      .appendSystemEvent({
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
        eventName: 'AiResponseDiscarded',
        extra: { discardedBy: caller.userId, motivo: input.motivo },
        content: `Sugerencia IA descartada: ${input.motivo}`,
      })
      .catch((err) =>
        this.logger.warn(
          `No se pudo emitir interaction AiResponseDiscarded para ticketId=${ticket._id.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseDiscarded, {
      tenantId: ai.tenantId.toString(),
      ticketId: ai.ticketId.toString(),
      aiResponseId: ai._id.toString(),
      discardedBy: caller.userId,
      motivo: input.motivo,
    } satisfies AiResponseDiscardedEvent);

    return this.toResponse(ai);
  }

  /**
   * Envía el correo al solicitante y cierra el ticket con
   * `resolutionType: 'auto'`. Si el envío falla, **no** revertimos la
   * aprobación: la `AiResponse` queda en su estado de entrada
   * (`aprobada`/`editada` para Fase 2, o `sugerida` para Fase 3
   * cuando el caller del Generator nos invoca). El admin puede
   * reintentar manualmente.
   *
   * - `approvedByUserId` se persiste como `ticket.resolvedBy` y en el
   *   `extra.approvedBy` de la interaction. Es `null` cuando el envío
   *   es autónomo (Fase 3, sistema).
   * - `autonomous: true` marca el evento `AiResponseSent` como
   *   originado sin paso humano. Los listeners pueden usarlo para
   *   distinguir métricas (ratio Fase 3 vs Fase 2).
   *
   * Devuelve `true` cuando el envío fue exitoso y el ticket quedó
   * cerrado; `false` cuando algo en el camino falló (sin requester,
   * email caído). Es público para que `AutoResponseGeneratorService`
   * pueda reusarlo en el flujo autónomo.
   */
  async deliverAndClose(
    ai: AiResponseDocument,
    ticket: TicketDocument,
    approvedByUserId: string | null,
    autonomous: boolean,
  ): Promise<boolean> {
    const requester = await this.userModel
      .findById(ticket.requesterId)
      .select('email fullName')
      .lean()
      .exec();
    if (!requester) {
      this.logger.warn(
        `No se encontró el solicitante ${ticket.requesterId.toString()} del ticket ${ticket._id.toString()} — auto-respuesta queda en aprobada sin envío.`,
      );
      return false;
    }

    let messageId: string | null = null;
    try {
      const result = await this.email.sendAutoResponseEmail({
        to: requester.email,
        fullName: requester.fullName,
        ticketShortCode: ticket.shortCode,
        asunto: ticket.asunto,
        body: ai.content ?? '',
      });
      messageId = result.messageId;
    } catch (err) {
      this.logger.error(
        `Falló el envío de auto-respuesta para ticketId=${ticket._id.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return false;
    }

    ai.estado = 'enviada';
    ai.sentAt = new Date();
    ai.emailMessageId = messageId;
    await ai.save();

    // Cerrar ticket con resolutionType=auto. Misma transición que un
    // resolve manual pero con marca distinta para reportes.
    const fromEstado = ticket.estado;
    ticket.estado = 'cerrado';
    ticket.resolutionType = 'auto';
    ticket.resolvedBy = approvedByUserId ? new Types.ObjectId(approvedByUserId) : null;
    ticket.resolvedAt = new Date();
    await ticket.save();

    await this.interactions
      .appendSystemEvent({
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
        eventName: 'AiResponseSent',
        fromEstado,
        toEstado: 'cerrado',
        extra: {
          aiResponseId: ai._id.toString(),
          approvedBy: approvedByUserId,
          autonomous,
        },
        content: autonomous
          ? 'Auto-respuesta enviada autónomamente al solicitante. Ticket cerrado.'
          : 'Auto-respuesta enviada al solicitante. Ticket cerrado automáticamente.',
      })
      .catch((err) =>
        this.logger.warn(
          `No se pudo emitir interaction AiResponseSent para ticketId=${ticket._id.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );

    // Evento del módulo auto-response (notifica al solicitante).
    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseSent, {
      tenantId: ai.tenantId.toString(),
      ticketId: ai.ticketId.toString(),
      aiResponseId: ai._id.toString(),
      requesterId: ticket.requesterId.toString(),
      emailMessageId: messageId,
      autonomous,
    } satisfies AiResponseSentEvent);

    // Evento estándar de tickets — los suscriptores existentes (métricas,
    // notificaciones del solicitante con la nota, SLA) reaccionan igual
    // que con un cierre manual. Diferenciamos por `resolutionType` en
    // los listeners que necesiten distinguir.
    this.events.emit(NOTIFICATION_EVENTS.TicketResolved, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      requesterId: ticket.requesterId.toString(),
      resolvedBy: approvedByUserId,
      nota: ai.content ?? '',
    } satisfies TicketResolvedEvent);
    return true;
  }

  // -------- internos --------

  private summarizeDiff(original: string, edited: string): string {
    if (original === edited) return 'sin-cambios';
    const charsAdded = Math.max(0, edited.length - original.length);
    const charsRemoved = Math.max(0, original.length - edited.length);
    const changedChars = charsAdded + charsRemoved;
    const pct = Math.round((changedChars / Math.max(original.length, 1)) * 100);
    return `~${pct}% chars cambiados (+${charsAdded}/-${charsRemoved})`;
  }

  private assertSugerida(ai: AiResponseDocument): void {
    if (ai.estado !== 'sugerida') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'AI_RESPONSE_NOT_PENDING',
        `La respuesta IA está en estado '${ai.estado}' y no admite esta acción.`,
      );
    }
  }

  private assertCanActOnTicket(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (caller.role === 'lider' || caller.role === 'agente') {
      if (!ticket.areaId) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'AI_RESPONSE_FORBIDDEN',
          'No tenés permisos para actuar sobre este ticket.',
        );
      }
      const callerAreas = new Set(caller.areaIds);
      if (callerAreas.has(ticket.areaId.toString())) return;
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'AI_RESPONSE_FORBIDDEN',
      'No tenés permisos para actuar sobre este ticket.',
    );
  }

  private assertCanReadTicket(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (caller.role === 'empleado') {
      if (ticket.requesterId.toString() === caller.userId) return;
    } else if (ticket.areaId) {
      const callerAreas = new Set(caller.areaIds);
      if (callerAreas.has(ticket.areaId.toString())) return;
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'AI_RESPONSE_FORBIDDEN',
      'No tenés acceso a este ticket.',
    );
  }

  private async findOrFail(tenantId: string, id: string): Promise<AiResponseDocument> {
    const oid = this.toObjectId(id, 'AI_RESPONSE_ID_INVALID');
    const ai = await this.aiResponseModel
      .findOne({ _id: oid, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!ai) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'AI_RESPONSE_NOT_FOUND',
        'Respuesta IA no encontrada.',
      );
    }
    return ai;
  }

  private async findTicketOrFail(tenantId: string, id: string): Promise<TicketDocument> {
    const oid = this.toObjectId(id, 'TICKET_NOT_FOUND');
    const t = await this.ticketModel
      .findOne({ _id: oid, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!t) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return t;
  }

  private async findTicketOrFailById(
    tenantId: Types.ObjectId,
    ticketId: Types.ObjectId,
  ): Promise<TicketDocument> {
    const t = await this.ticketModel.findOne({ _id: ticketId, tenantId }).exec();
    if (!t) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return t;
  }

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
    }
  }

  private async toResponse(ai: AiResponseDocument): Promise<AiResponseDto> {
    const sources: AiResponseSource[] = await this.resolveSources(ai);
    return {
      id: ai._id.toString(),
      ticketId: ai.ticketId.toString(),
      estado: ai.estado,
      respondable: ai.respondable,
      motivoNoRespondable: ai.motivoNoRespondable,
      originalAiContent: ai.originalAiContent,
      content: ai.content,
      confianza: ai.confianza,
      sources,
      approvedBy: ai.approvedBy?.toString() ?? null,
      approvedAt: ai.approvedAt?.toISOString() ?? null,
      editedBy: ai.editedBy?.toString() ?? null,
      editedAt: ai.editedAt?.toISOString() ?? null,
      discardedBy: ai.discardedBy?.toString() ?? null,
      discardedAt: ai.discardedAt?.toISOString() ?? null,
      discardReason: ai.discardReason,
      sentAt: ai.sentAt?.toISOString() ?? null,
      failureReason: ai.failureReason,
      failureDetail: ai.failureDetail,
      createdAt: ai.createdAt.toISOString(),
    };
  }

  /**
   * Enriquece los `sourceChunks` persistidos con `documentTitle` y
   * `contentSnippet`, que viven en `kb_documents` y `kb_chunks`. Lo
   * hacemos al rehidratar (no al persistir) para que cambios de título
   * en la KB se reflejen en el panel de "Sugerencia IA".
   */
  private async resolveSources(ai: AiResponseDocument): Promise<AiResponseSource[]> {
    if (ai.sourceChunks.length === 0) return [];
    const docIds = ai.sourceChunks.map((s) => s.documentId);
    const chunkIds = ai.sourceChunks.map((s) => s.chunkId);
    const [docs, chunks] = await Promise.all([
      this.kbDocumentModel
        .find({ _id: { $in: docIds }, tenantId: ai.tenantId })
        .select({ _id: 1, title: 1 })
        .lean()
        .exec(),
      this.kbChunkModel
        .find({ _id: { $in: chunkIds }, tenantId: ai.tenantId })
        .select({ _id: 1, content: 1 })
        .lean()
        .exec(),
    ]);
    const titleByDoc = new Map(docs.map((d) => [d._id.toString(), d.title]));
    const contentByChunk = new Map(chunks.map((c) => [c._id.toString(), c.content]));
    return ai.sourceChunks.map((s) => ({
      chunkId: s.chunkId.toString(),
      documentId: s.documentId.toString(),
      parentDocumentId: s.parentDocumentId.toString(),
      position: s.position,
      score: s.score,
      usedFor: s.usedFor,
      documentTitle: titleByDoc.get(s.documentId.toString()) ?? '(documento)',
      contentSnippet: KbSearchService.snippet(contentByChunk.get(s.chunkId.toString()) ?? ''),
    }));
  }
}
