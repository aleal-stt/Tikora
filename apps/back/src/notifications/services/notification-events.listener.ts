import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type { Notification as NotificationResponse, NotificationEventType } from '@tikora/core';
import { Model, Types } from 'mongoose';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  AiResponseFailedEvent,
  AiResponseSuggestedEvent,
  InteractionAddedEvent,
  NOTIFICATION_EVENTS,
  SlaApproachingEvent,
  SlaBreachEvent,
  TicketAssignedEvent,
  TicketClassifiedEvent,
  TicketCreatedEvent,
  TicketReopenedEvent,
  TicketRequiresClassificationReviewEvent,
  TicketResolvedEvent,
} from '../events/notification-events';
import { NotificationDocument } from '../schemas/notification.schema';
import { NotificationsService } from './notifications.service';
import { SseHub } from './sse-hub.service';

/**
 * Bridge entre el bus de eventos in-process (`@nestjs/event-emitter`) y
 * los dos sinks de notificación (Notification persistido + push SSE).
 *
 * Cada handler resuelve los recipients del evento y delega a `notify()`
 * que centraliza la persistencia y el push.
 */
@Injectable()
export class NotificationEventsListener {
  private readonly logger = new Logger(NotificationEventsListener.name);

  constructor(
    private readonly notifications: NotificationsService,
    private readonly sseHub: SseHub,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  @OnEvent(NOTIFICATION_EVENTS.TicketCreated)
  async onTicketCreated(event: TicketCreatedEvent): Promise<void> {
    await this.notify({
      type: 'TicketCreated',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        shortCode: event.shortCode,
        asunto: event.asunto,
        cuerpoSnippet: event.cuerpoSnippet,
      },
      recipientIds: [event.requesterId],
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TicketClassified)
  async onTicketClassified(event: TicketClassifiedEvent): Promise<void> {
    const recipients = await this.resolveAreaAgents(event.tenantId, event.areaId);
    await this.notify({
      type: 'TicketClassified',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        classificationId: event.classificationId,
        areaId: event.areaId,
        prioridad: event.prioridad,
        confianza: event.confianza,
        resumen: event.resumen,
        modelo: event.modelo,
      },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TicketRequiresClassificationReview)
  async onRequiresReview(event: TicketRequiresClassificationReviewEvent): Promise<void> {
    // Si la IA sugirió un área, notificamos a sus líderes; sino, a admins.
    const recipients = event.suggestedAreaId
      ? await this.resolveAreaLeaders(event.tenantId, event.suggestedAreaId)
      : await this.resolveAdmins(event.tenantId);

    await this.notify({
      type: 'TicketRequiresClassificationReview',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        suggestedAreaId: event.suggestedAreaId,
        outcome: event.outcome,
        outcomeDetail: event.outcomeDetail,
      },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TicketAssigned)
  async onTicketAssigned(event: TicketAssignedEvent): Promise<void> {
    if (event.agentId === event.assignedBy) {
      // El agente se auto-asignó (tomó el ticket): no le notificamos a él
      // mismo, pero sí al líder del área para visibility (si difiere).
      return;
    }
    await this.notify({
      type: 'TicketAssigned',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        agentId: event.agentId,
        assignedBy: event.assignedBy,
        areaId: event.areaId,
      },
      recipientIds: [event.agentId],
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TicketResolved)
  async onTicketResolved(event: TicketResolvedEvent): Promise<void> {
    await this.notify({
      type: 'TicketResolved',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: { resolvedBy: event.resolvedBy, nota: event.nota },
      recipientIds: [event.requesterId],
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.TicketReopened)
  async onTicketReopened(event: TicketReopenedEvent): Promise<void> {
    if (!event.lastAssignedAgentId) return;
    await this.notify({
      type: 'TicketReopened',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: { reopenCount: event.reopenCount, motivo: event.motivo },
      recipientIds: [event.lastAssignedAgentId],
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.AiResponseSuggested)
  async onAiResponseSuggested(event: AiResponseSuggestedEvent): Promise<void> {
    // Notifica a líderes y agentes del área para que abran el panel de
    // "Sugerencia IA" del ticket. El líder se entera siempre porque es
    // el responsable de la calidad del flujo; los agentes para que
    // cualquiera del área pueda tomar la aprobación.
    const recipients = await this.resolveAreaTeam(event.tenantId, event.areaId);
    if (recipients.length === 0) return;
    await this.notify({
      type: 'AiResponseSuggested',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        aiResponseId: event.aiResponseId,
        areaId: event.areaId,
        confianza: event.confianza,
      },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.AiResponseFailed)
  async onAiResponseFailed(event: AiResponseFailedEvent): Promise<void> {
    // Errores duros (`api_error`, `validation_error`) van al admin como
    // alarma. `no_kb_match` y `not_respondable` son resultados normales
    // del flujo (la KB no cubre el caso) — no spamean al admin: el
    // ticket simplemente sigue su curso de escalada manual.
    if (event.reason === 'no_kb_match' || event.reason === 'not_respondable') {
      return;
    }
    const recipients = await this.resolveAdmins(event.tenantId);
    if (recipients.length === 0) return;
    await this.notify({
      type: 'AiResponseFailed',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: { reason: event.reason, detail: event.detail },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.SlaApproaching)
  async onSlaApproaching(event: SlaApproachingEvent): Promise<void> {
    // Si hay agente asignado, va sólo a él; si nadie tomó el ticket, al
    // equipo del área (líderes + agentes). No spameamos al líder cuando
    // ya hay agente asignado — ese caso lo cubre el `SlaBreach`.
    const recipients = event.agentId
      ? [event.agentId]
      : await this.resolveAreaTeam(event.tenantId, event.areaId);
    if (recipients.length === 0) return;
    await this.notify({
      type: 'SlaApproaching',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        areaId: event.areaId,
        prioridad: event.prioridad,
        slaDeadline: event.slaDeadline,
        remainingMinutes: event.remainingMinutes,
      },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.SlaBreach)
  async onSlaBreach(event: SlaBreachEvent): Promise<void> {
    // Vencido → líderes del área (responsables del SLA). Si el área no
    // tiene líderes, caemos a admins para que la falla no quede silenciosa.
    const recipients =
      event.leaderIds.length > 0 ? event.leaderIds : await this.resolveAdmins(event.tenantId);
    if (recipients.length === 0) return;
    await this.notify({
      type: 'SlaBreach',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        areaId: event.areaId,
        agentId: event.agentId,
        prioridad: event.prioridad,
        slaDeadline: event.slaDeadline,
        overdueMinutes: event.overdueMinutes,
      },
      recipientIds: recipients,
    });
  }

  @OnEvent(NOTIFICATION_EVENTS.InteractionAdded)
  async onInteractionAdded(event: InteractionAddedEvent): Promise<void> {
    // El productor pasa la lista de participantes ya filtrada (excluyendo
    // al autor). Si por alguna razón viene vacía, no hay nada que notificar.
    const recipients = event.participantIds.filter((id) => id !== event.authorId);
    if (recipients.length === 0) return;
    await this.notify({
      type: 'InteractionAdded',
      tenantId: event.tenantId,
      ticketId: event.ticketId,
      payload: {
        interactionId: event.interactionId,
        authorId: event.authorId,
        authorType: event.type,
        contentSnippet: event.contentSnippet,
      },
      recipientIds: recipients,
    });
  }

  // -------- helpers --------

  private async resolveAreaAgents(tenantId: string, areaId: string): Promise<string[]> {
    const area = await this.areaModel
      .findOne({
        _id: this.toObjectIdOrNull(areaId),
        tenantId: new Types.ObjectId(tenantId),
      })
      .exec();
    if (!area) return [];
    return area.agentIds.map((id) => id.toString());
  }

  private async resolveAreaTeam(tenantId: string, areaId: string): Promise<string[]> {
    const area = await this.areaModel
      .findOne({
        _id: this.toObjectIdOrNull(areaId),
        tenantId: new Types.ObjectId(tenantId),
      })
      .exec();
    if (!area) return [];
    return [...area.leaderIds, ...area.agentIds].map((id) => id.toString());
  }

  private async resolveAreaLeaders(tenantId: string, areaId: string): Promise<string[]> {
    const area = await this.areaModel
      .findOne({
        _id: this.toObjectIdOrNull(areaId),
        tenantId: new Types.ObjectId(tenantId),
      })
      .exec();
    if (!area) return this.resolveAdmins(tenantId);
    if (area.leaderIds.length === 0) return this.resolveAdmins(tenantId);
    return area.leaderIds.map((id) => id.toString());
  }

  private async resolveAdmins(tenantId: string): Promise<string[]> {
    const admins = await this.userModel
      .find({ tenantId: new Types.ObjectId(tenantId), role: 'admin', active: true }, { _id: 1 })
      .exec();
    return admins.map((u) => u._id.toString());
  }

  private async notify(args: {
    type: NotificationEventType;
    tenantId: string;
    ticketId: string;
    payload: Record<string, unknown>;
    recipientIds: string[];
  }): Promise<void> {
    // Dedup defensivo: dos productores podrían listar el mismo recipient
    // (p.ej. el solicitante también es agente del área).
    const unique = Array.from(new Set(args.recipientIds.filter(Boolean)));
    if (unique.length === 0) return;

    const tenantOid = new Types.ObjectId(args.tenantId);
    const ticketOid = new Types.ObjectId(args.ticketId);

    let docs: NotificationDocument[] = [];
    try {
      docs = await this.notifications.createMany(
        unique.map((rid) => ({
          tenantId: tenantOid,
          recipientId: new Types.ObjectId(rid),
          type: args.type,
          ticketId: ticketOid,
          payload: { ticketId: args.ticketId, ...args.payload },
        })),
      );
    } catch (err) {
      this.logger.warn(
        `No se pudieron persistir notifications para ${args.type}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return;
    }

    for (const doc of docs) {
      this.sseHub.push(doc.recipientId.toString(), {
        type: doc.type,
        id: doc._id.toString(),
        data: this.toResponse(doc),
      });
    }
  }

  private toResponse(doc: NotificationDocument): NotificationResponse {
    return {
      id: doc._id.toString(),
      recipientId: doc.recipientId.toString(),
      type: doc.type as NotificationEventType,
      ticketId: doc.ticketId ? doc.ticketId.toString() : null,
      payload: doc.payload ?? {},
      read: doc.read,
      readAt: doc.readAt ? doc.readAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  private toObjectIdOrNull(id: string): Types.ObjectId | null {
    try {
      return new Types.ObjectId(id);
    } catch {
      return null;
    }
  }
}
