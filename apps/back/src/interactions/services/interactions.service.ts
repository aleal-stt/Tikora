import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type {
  CreateInteraction,
  Interaction as InteractionResponse,
  InteractionListResponse,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { EmailService } from '../../email/services/email.service';
import {
  InteractionAddedEvent,
  NOTIFICATION_EVENTS,
} from '../../notifications/events/notification-events';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import { UsersService } from '../../users/services/users.service';
import { Interaction, InteractionDocument } from '../schemas/interaction.schema';

interface ListParams {
  cursor?: string;
  limit: number;
}

interface SystemEventInput {
  tenantId: Types.ObjectId;
  ticketId: Types.ObjectId;
  eventName: string;
  fromEstado?: string;
  toEstado?: string;
  extra?: Record<string, unknown>;
  content: string;
}

interface AiMessageInput {
  tenantId: Types.ObjectId;
  ticketId: Types.ObjectId;
  content: string;
  aiResponseId?: string;
  /** Distingue si el mensaje fue aprobado por un agente o autónomo. */
  autonomous: boolean;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class InteractionsService {
  private readonly logger = new Logger(InteractionsService.name);

  constructor(
    @InjectModel(Interaction.name)
    private readonly interactionModel: Model<InteractionDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly events: EventEmitter2,
    private readonly email: EmailService,
    private readonly users: UsersService,
  ) {}

  // -------- API pública --------

  async createForCaller(
    caller: AuthenticatedUser,
    ticketId: string,
    input: CreateInteraction,
  ): Promise<InteractionResponse> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    const isOwner = ticket.requesterId.toString() === caller.userId;

    // Validamos coherencia entre `type` declarado y el rol del caller.
    if (input.type === 'usuario') {
      if (!isOwner) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'INTERACTION_TYPE_FORBIDDEN',
          'Solo el solicitante puede crear interacciones de usuario.',
        );
      }
    } else if (input.type === 'agente') {
      if (caller.role === 'empleado') {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'INTERACTION_TYPE_FORBIDDEN',
          'Empleados no pueden crear interacciones de agente.',
        );
      }
      this.assertOperatesOnTicket(caller, ticket);
    }

    const shouldSendByEmail = input.type === 'agente' && Boolean(input.enviarPorCorreo);

    const metadata: Record<string, unknown> =
      input.type === 'agente' ? { enviadoPorCorreo: shouldSendByEmail } : { canal: 'plataforma' };

    const created = await this.interactionModel.create({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      type: input.type,
      authorId: new Types.ObjectId(caller.userId),
      content: input.content,
      metadata,
    });

    // El envío del correo es best-effort: si falla, la interaction ya quedó
    // guardada y el agente puede reintentar agregando otra nota. Loggeamos
    // pero no rompemos la respuesta HTTP.
    if (shouldSendByEmail) {
      await this.sendAgentReplyByEmail({ caller, ticket, content: input.content });
    }

    // Resolvemos los participantes ANTES del emit para que el listener no
    // necesite tocar la colección de tickets — el productor tiene toda la
    // info en mano.
    const participantIds = this.resolveParticipants(ticket);
    this.events.emit(NOTIFICATION_EVENTS.InteractionAdded, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      interactionId: created._id.toString(),
      authorId: caller.userId,
      type: input.type,
      contentSnippet: input.content.slice(0, 280),
      participantIds,
    } satisfies InteractionAddedEvent);

    return this.toResponse(created);
  }

  private async sendAgentReplyByEmail(args: {
    caller: AuthenticatedUser;
    ticket: TicketDocument;
    content: string;
  }): Promise<void> {
    try {
      const [requester, agent] = await Promise.all([
        this.users.findById(args.ticket.tenantId, args.ticket.requesterId),
        this.users.findById(args.ticket.tenantId, new Types.ObjectId(args.caller.userId)),
      ]);
      if (!requester) {
        this.logger.warn(
          `No se pudo enviar reply por correo: solicitante no encontrado ticketId=${args.ticket._id.toString()}`,
        );
        return;
      }
      await this.email.sendAgentReplyEmail({
        to: requester.email,
        fullName: requester.fullName,
        ticketShortCode: args.ticket.shortCode,
        asunto: args.ticket.asunto,
        body: args.content,
        agentFullName: agent?.fullName ?? 'Agente',
      });
    } catch (err) {
      this.logger.warn(
        `Falló el envío de reply por correo ticketId=${args.ticket._id.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * Lista de userIds que ven el ticket actualmente: solicitante y agente
   * asignado (si difiere). El listener filtra al autor para evitar
   * notificarle su propia interacción.
   */
  private resolveParticipants(ticket: TicketDocument): string[] {
    const participants = new Set<string>();
    participants.add(ticket.requesterId.toString());
    if (ticket.assignedAgentId) {
      participants.add(ticket.assignedAgentId.toString());
    }
    return Array.from(participants);
  }

  async listForTicket(
    caller: AuthenticatedUser,
    ticketId: string,
    params: ListParams,
  ): Promise<InteractionListResponse> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    this.assertCanReadTicket(caller, ticket);

    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const filter: Record<string, unknown> = {
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
    };
    if (params.cursor) {
      filter._id = { $gt: this.decodeCursor(params.cursor) };
    }

    // ASC: timeline cronológico (la más vieja primero).
    const docs = await this.interactionModel
      .find(filter)
      .sort({ _id: 1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((d) => this.toResponse(d)),
      nextCursor: hasMore && last ? this.encodeCursor(last._id) : null,
    };
  }

  // -------- API interna (sin permisos) — usada por TicketsService --------

  /**
   * Inserta una interacción `type: 'sistema'` con el evento dado.
   * El `content` es el mensaje legible que se muestra en el timeline;
   * la metadata estructurada queda para que el front renderice variantes.
   */
  async appendSystemEvent(input: SystemEventInput): Promise<InteractionDocument> {
    return this.interactionModel.create({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      type: 'sistema',
      authorId: null,
      content: input.content,
      metadata: {
        eventName: input.eventName,
        fromEstado: input.fromEstado,
        toEstado: input.toEstado,
        extra: input.extra,
      },
    });
  }

  /**
   * Inserta una interacción `type: 'ia'` con el cuerpo de la auto-respuesta.
   * Se usa para que el contenido real del email enviado al solicitante quede
   * visible en la conversación (no solo el system event de cierre).
   */
  async appendAiInteraction(input: AiMessageInput): Promise<InteractionDocument> {
    return this.interactionModel.create({
      tenantId: input.tenantId,
      ticketId: input.ticketId,
      type: 'ia',
      authorId: null,
      content: input.content,
      metadata: {
        aiResponseId: input.aiResponseId,
        autonomous: input.autonomous,
      },
    });
  }

  // -------- helpers --------

  private async findTicketOrFail(tenantId: string, id: string): Promise<TicketDocument> {
    let objectId: Types.ObjectId;
    try {
      objectId = new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    const doc = await this.ticketModel
      .findOne({ _id: objectId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return doc;
  }

  private assertCanReadTicket(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (ticket.requesterId.toString() === caller.userId) return; // OWN
    if (caller.role === 'agente' || caller.role === 'lider') {
      if (ticket.areaId && caller.areaIds.includes(ticket.areaId.toString())) {
        return;
      }
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'TICKET_FORBIDDEN',
      'No tenés permisos sobre este ticket.',
    );
  }

  private assertOperatesOnTicket(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (ticket.areaId && caller.areaIds.includes(ticket.areaId.toString())) {
      return;
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'TICKET_AREA_FORBIDDEN',
      'No tenés permisos sobre el área de este ticket.',
    );
  }

  private encodeCursor(id: Types.ObjectId): string {
    return Buffer.from(id.toHexString()).toString('base64url');
  }

  private decodeCursor(cursor: string): Types.ObjectId {
    try {
      const hex = Buffer.from(cursor, 'base64url').toString('utf8');
      return new Types.ObjectId(hex);
    } catch {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'CURSOR_INVALID',
        'El cursor de paginación no es válido.',
      );
    }
  }

  private toResponse(doc: InteractionDocument): InteractionResponse {
    const base = {
      id: doc._id.toString(),
      ticketId: doc.ticketId.toString(),
      authorId: doc.authorId ? doc.authorId.toString() : null,
      content: doc.content,
      createdAt: doc.createdAt.toISOString(),
    };
    // El cast es necesario porque el discriminatedUnion de Zod tipa
    // `metadata` distinto por variante; la persistencia es un único Mixed.
    return {
      ...base,
      type: doc.type,
      metadata: (doc.metadata ?? {}) as never,
    } as InteractionResponse;
  }
}
