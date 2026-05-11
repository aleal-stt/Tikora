import { forwardRef, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AssignAgent,
  AssignArea,
  CancelTicket,
  ClassifyTicket,
  CreateTicket,
  EstadoTicket,
  Prioridad,
  ReopenTicket,
  ResolveTicket,
  Ticket as TicketResponse,
  TicketListItem,
  TicketListResponse,
} from '@tikora/core';
import { Model, QueryFilter, Types } from 'mongoose';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { BusinessHoursService } from '../../common/business-hours.service';
import { ApiException } from '../../common/exceptions/api.exception';
import type { Env } from '../../config/env.schema';
import { ClassificationQueueService } from '../../classification/services/classification-queue.service';
import { CountersService } from '../../counters/services/counters.service';
import { InteractionsService } from '../../interactions/services/interactions.service';
import {
  NOTIFICATION_EVENTS,
  TicketAssignedEvent,
  TicketCreatedEvent,
  TicketReopenedEvent,
  TicketResolvedEvent,
} from '../../notifications/events/notification-events';
import { calculateSlaDeadline } from '../tickets.sla';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { Ticket, TicketDocument } from '../schemas/ticket.schema';
import { TicketStateMachineService } from './ticket-state-machine.service';

interface ListParams {
  cursor?: string;
  limit: number;
  estado?: EstadoTicket[];
  prioridad?: Prioridad[];
  areaId?: string[];
  assignedToMe?: boolean;
  requesterId?: string;
}

const MAX_PAGE_SIZE = 100;
const REOPEN_GRACE_DAYS = 5;

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    private readonly counters: CountersService,
    private readonly stateMachine: TicketStateMachineService,
    private readonly config: ConfigService<Env, true>,
    private readonly businessHours: BusinessHoursService,
    // forwardRef requerido para resolver el ciclo TicketsModule ↔ InteractionsModule.
    @Inject(forwardRef(() => InteractionsService))
    private readonly interactions: InteractionsService,
    // forwardRef para el ciclo TicketsModule ↔ ClassificationModule.
    // El processor consume el modelo Ticket; el create encola jobs de IA.
    @Inject(forwardRef(() => ClassificationQueueService))
    private readonly classificationQueue: ClassificationQueueService,
    // Bus in-process. NotificationsModule escucha estos eventos y crea
    // las Notifications + push SSE. Los services no conocen al consumer.
    private readonly events: EventEmitter2,
  ) {}

  // -------- alta y consultas --------

  async create(caller: AuthenticatedUser, input: CreateTicket): Promise<TicketResponse> {
    const tenantId = new Types.ObjectId(caller.tenantId);
    const requesterId = new Types.ObjectId(caller.userId);

    const aiPhase = this.config.get('AI_PHASE', { infer: true });

    const shortCode = await this.counters.nextTicketShortCode(tenantId);

    // Siempre creamos en `recibido`. El ClassificationProcessor transiciona
    // a `escalado` (alta confianza) o `requiere_revision_clasificacion`
    // (baja/error). Si el encolado falla, caemos a fallback humano in-line.
    const created = await this.ticketModel.create({
      tenantId,
      shortCode,
      requesterId,
      asunto: input.asunto,
      cuerpo: input.cuerpo,
      estado: 'recibido',
      prioridad: null,
      areaId: null,
      classificationId: null,
      autoResponseId: null,
      assignedAgentId: null,
      lastAssignedAgentId: null,
      attachmentIds: [],
      tags: [],
      slaDeadline: null,
      resolutionType: null,
      resolvedBy: null,
      resolvedAt: null,
      cancelledBy: null,
      cancelledAt: null,
      cancelReason: null,
      reopenCount: 0,
      closedDefinitivelyAt: null,
    });

    let finalEstado: EstadoTicket = 'recibido';
    if (aiPhase >= 1) {
      try {
        await this.classificationQueue.enqueue(created._id.toString());
      } catch (err) {
        // Sin Redis o error de cola: fallback in-line a revisión humana
        // para que el ticket no quede atascado en `recibido`.
        this.logger.warn(
          `Encolado de clasificación falló para ticketId=${created._id.toString()}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        created.estado = 'requiere_revision_clasificacion';
        await created.save();
        finalEstado = 'requiere_revision_clasificacion';
      }
    } else {
      // Modo manual (no debería ocurrir hoy: AI_PHASE.min=1) — defensivo.
      created.estado = 'requiere_revision_clasificacion';
      await created.save();
      finalEstado = 'requiere_revision_clasificacion';
    }

    await this.emitSystem({
      tenantId,
      ticketId: created._id,
      eventName: 'TicketCreated',
      toEstado: finalEstado,
      content: `Ticket creado: ${input.asunto}`,
    });

    this.events.emit(NOTIFICATION_EVENTS.TicketCreated, {
      tenantId: tenantId.toString(),
      ticketId: created._id.toString(),
      shortCode: created.shortCode,
      requesterId: caller.userId,
      asunto: created.asunto,
      cuerpoSnippet: created.cuerpo.slice(0, 280),
    } satisfies TicketCreatedEvent);

    return this.toTicketResponse(created);
  }

  async listForCaller(caller: AuthenticatedUser, params: ListParams): Promise<TicketListResponse> {
    if (caller.role === 'empleado') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'AUTH_ROLE_FORBIDDEN',
        'No tenés permisos para listar todos los tickets.',
      );
    }

    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const tenantId = new Types.ObjectId(caller.tenantId);
    const filter: QueryFilter<TicketDocument> = { tenantId };

    if (caller.role === 'agente' || caller.role === 'lider') {
      // AGE/LID solo ven tickets de sus áreas. Si no tienen áreas, lista vacía.
      if (caller.areaIds.length === 0) {
        return { items: [], nextCursor: null };
      }
      filter.areaId = {
        $in: caller.areaIds.map((id) => new Types.ObjectId(id)),
      };
    }

    if (params.estado && params.estado.length > 0) {
      filter.estado = { $in: params.estado };
    }
    if (params.prioridad && params.prioridad.length > 0) {
      filter.prioridad = { $in: params.prioridad };
    }
    if (params.areaId && params.areaId.length > 0) {
      // ADM puede filtrar por cualquier área. LID puede filtrar **dentro
      // de las que lidera** (intersección, no reemplazo) — antes el
      // filtro de query reemplazaba el del rol y permitía a un líder
      // listar tickets de áreas ajenas pasando `?areaId=...`. AGE no
      // expone este filtro en la UI; el back lo ignora silenciosamente.
      const requested = params.areaId.map((id) => new Types.ObjectId(id));
      if (caller.role === 'admin') {
        filter.areaId = { $in: requested };
      } else if (caller.role === 'lider') {
        const allowed = new Set(caller.areaIds);
        const intersected = requested.filter((oid) => allowed.has(oid.toString()));
        if (intersected.length === 0) {
          // El líder pidió áreas que no lidera: lista vacía.
          return { items: [], nextCursor: null };
        }
        filter.areaId = { $in: intersected };
      }
    }
    if (params.assignedToMe) {
      filter.assignedAgentId = new Types.ObjectId(caller.userId);
    }
    if (params.requesterId && (caller.role === 'admin' || caller.role === 'lider')) {
      filter.requesterId = new Types.ObjectId(params.requesterId);
    }
    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }

    const docs = await this.ticketModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((d) => this.toTicketListItem(d)),
      nextCursor: hasMore && last ? this.encodeCursor(last._id) : null,
    };
  }

  async listMine(caller: AuthenticatedUser, params: ListParams): Promise<TicketListResponse> {
    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const filter: QueryFilter<TicketDocument> = {
      tenantId: new Types.ObjectId(caller.tenantId),
      requesterId: new Types.ObjectId(caller.userId),
    };
    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }
    const docs = await this.ticketModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    return {
      items: page.map((d) => this.toTicketListItem(d)),
      nextCursor: hasMore && last ? this.encodeCursor(last._id) : null,
    };
  }

  async getByIdForCaller(caller: AuthenticatedUser, id: string): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    this.assertCanRead(caller, ticket);
    return this.toTicketResponse(ticket);
  }

  // -------- transiciones --------

  /** Toma un ticket. Solo desde `escalado`. Atómico para evitar races. */
  async take(caller: AuthenticatedUser, id: string): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    this.assertOperatesOnArea(caller, ticket);
    this.stateMachine.assertTransition(ticket.estado, 'en_progreso');

    if (ticket.estado !== 'escalado') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_TRANSITION_INVALID',
        'Solo se pueden tomar tickets en estado escalado.',
      );
    }

    const agentObjectId = new Types.ObjectId(caller.userId);
    // updateOne condicionado al estado: si dos agentes corren `take` a la
    // vez, solo uno modifica el doc; el segundo recibe `matchedCount=0`.
    const result = await this.ticketModel
      .updateOne(
        { _id: ticket._id, estado: 'escalado' },
        {
          $set: {
            estado: 'en_progreso',
            assignedAgentId: agentObjectId,
            lastAssignedAgentId: agentObjectId,
          },
        },
      )
      .exec();

    if (result.matchedCount === 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_ALREADY_TAKEN',
        'Otro agente tomó este ticket primero.',
      );
    }

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketTaken',
      fromEstado: 'escalado',
      toEstado: 'en_progreso',
      extra: { agentId: agentObjectId.toString() },
      content: 'El agente tomó el ticket.',
    });

    if (ticket.areaId) {
      this.events.emit(NOTIFICATION_EVENTS.TicketAssigned, {
        tenantId: ticket.tenantId.toString(),
        ticketId: ticket._id.toString(),
        agentId: caller.userId,
        assignedBy: caller.userId, // self-assign: el listener filtra esta combinación
        areaId: ticket.areaId.toString(),
      } satisfies TicketAssignedEvent);
    }

    return this.toTicketResponse(await this.findOrFail(caller.tenantId, id));
  }

  async resolve(
    caller: AuthenticatedUser,
    id: string,
    input: ResolveTicket,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    this.assertOperatesOnArea(caller, ticket);
    this.stateMachine.assertTransition(ticket.estado, 'cerrado');

    // Solo el agente asignado, el líder del área o un admin resuelven.
    if (caller.role === 'agente' && ticket.assignedAgentId?.toString() !== caller.userId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TICKET_NOT_ASSIGNED_TO_CALLER',
        'Solo el agente asignado puede resolver este ticket.',
      );
    }

    const fromEstado = ticket.estado;
    ticket.estado = 'cerrado';
    ticket.resolutionType = 'manual';
    ticket.resolvedBy = new Types.ObjectId(caller.userId);
    ticket.resolvedAt = new Date();
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketResolved',
      fromEstado,
      toEstado: 'cerrado',
      extra: { enviadoPorCorreo: input.enviarPorCorreo, resolvedBy: caller.userId },
      content: input.nota,
    });

    this.events.emit(NOTIFICATION_EVENTS.TicketResolved, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      requesterId: ticket.requesterId.toString(),
      resolvedBy: caller.userId,
      nota: input.nota,
    } satisfies TicketResolvedEvent);

    return this.toTicketResponse(ticket);
  }

  async cancel(
    caller: AuthenticatedUser,
    id: string,
    input: CancelTicket,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    if (ticket.requesterId.toString() !== caller.userId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TICKET_NOT_OWNER',
        'Solo el solicitante puede cancelar el ticket.',
      );
    }

    if (!this.stateMachine.isTransitionAllowed(ticket.estado, 'cancelado')) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_NOT_CANCELABLE',
        'El ticket ya no se puede cancelar.',
      );
    }

    const fromEstado = ticket.estado;
    ticket.estado = 'cancelado';
    ticket.cancelledBy = new Types.ObjectId(caller.userId);
    ticket.cancelledAt = new Date();
    ticket.cancelReason = input.motivo;
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketCancelled',
      fromEstado,
      toEstado: 'cancelado',
      content: input.motivo,
    });

    return this.toTicketResponse(ticket);
  }

  async reopen(
    caller: AuthenticatedUser,
    id: string,
    input: ReopenTicket,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    if (ticket.requesterId.toString() !== caller.userId) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TICKET_NOT_OWNER',
        'Solo el solicitante puede reabrir el ticket.',
      );
    }

    if (ticket.estado !== 'cerrado') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_TRANSITION_INVALID',
        'Solo se pueden reabrir tickets cerrados.',
      );
    }

    if (ticket.closedDefinitivelyAt) {
      // El cron de SLA marcó el ticket como cierre definitivo tras
      // `slaAutoCloseDays` sin actividad. La gracia ya expiró por el
      // path lento; este check es la versión rápida y explícita.
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_REOPEN_GRACE_EXPIRED',
        'El ticket fue cerrado definitivamente y no admite reapertura.',
      );
    }

    if (!ticket.resolvedAt) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_REOPEN_GRACE_EXPIRED',
        'El ticket no tiene fecha de resolución registrada.',
      );
    }

    // TODO: usar horas hábiles del tenant. Wallclock simple por ahora.
    const graceMs = REOPEN_GRACE_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - ticket.resolvedAt.getTime() > graceMs) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_REOPEN_GRACE_EXPIRED',
        'Pasó la ventana de gracia para reabrir el ticket.',
      );
    }

    // Si había agente, vuelve a `en_progreso` con ese mismo agente. Si era
    // cierre auto (sin agente), pasa a `escalado` para que un agente lo tome.
    const targetState: EstadoTicket = ticket.lastAssignedAgentId ? 'en_progreso' : 'escalado';

    this.stateMachine.assertTransition('cerrado', 'reabierto');
    this.stateMachine.assertTransition('reabierto', targetState);

    ticket.estado = targetState;
    ticket.assignedAgentId = ticket.lastAssignedAgentId;
    ticket.resolvedBy = null;
    ticket.resolvedAt = null;
    ticket.resolutionType = null;
    ticket.reopenCount += 1;
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketReopened',
      fromEstado: 'cerrado',
      toEstado: targetState,
      extra: { reopenCount: ticket.reopenCount },
      content: input.motivo,
    });

    this.events.emit(NOTIFICATION_EVENTS.TicketReopened, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      reopenCount: ticket.reopenCount,
      lastAssignedAgentId: ticket.lastAssignedAgentId
        ? ticket.lastAssignedAgentId.toString()
        : null,
      motivo: input.motivo,
    } satisfies TicketReopenedEvent);

    return this.toTicketResponse(ticket);
  }

  async assignAgent(
    caller: AuthenticatedUser,
    id: string,
    input: AssignAgent,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);
    this.assertOperatesOnArea(caller, ticket);

    if (ticket.estado !== 'escalado' && ticket.estado !== 'en_progreso') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_TRANSITION_INVALID',
        'Solo se puede reasignar un ticket escalado o en progreso.',
      );
    }

    const agent = await this.userModel
      .findOne({
        _id: this.toObjectId(input.agentId, 'TICKET_AGENT_INVALID'),
        tenantId: ticket.tenantId,
        active: true,
        role: 'agente',
      })
      .exec();
    if (!agent) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'TICKET_AGENT_INVALID',
        'El usuario indicado no es un agente activo.',
      );
    }

    if (!ticket.areaId) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_AREA_REQUIRED',
        'El ticket debe estar clasificado a un área antes de reasignar.',
      );
    }

    const agentInArea = agent.areaIds.some((a) => a.toString() === ticket.areaId?.toString());
    if (!agentInArea) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'TICKET_AGENT_NOT_IN_AREA',
        'El agente no pertenece al área del ticket.',
      );
    }

    const fromEstado = ticket.estado;
    if (ticket.estado === 'escalado') {
      this.stateMachine.assertTransition('escalado', 'en_progreso');
      ticket.estado = 'en_progreso';
    }
    ticket.assignedAgentId = agent._id;
    ticket.lastAssignedAgentId = agent._id;
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketAgentAssigned',
      fromEstado,
      toEstado: ticket.estado,
      extra: { agentId: agent._id.toString(), assignedBy: caller.userId },
      content: `Agente reasignado.`,
    });

    if (ticket.areaId) {
      this.events.emit(NOTIFICATION_EVENTS.TicketAssigned, {
        tenantId: ticket.tenantId.toString(),
        ticketId: ticket._id.toString(),
        agentId: agent._id.toString(),
        assignedBy: caller.userId,
        areaId: ticket.areaId.toString(),
      } satisfies TicketAssignedEvent);
    }

    return this.toTicketResponse(ticket);
  }

  async assignArea(
    caller: AuthenticatedUser,
    id: string,
    input: AssignArea,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);

    // LID solo puede mover tickets entre áreas que lidera (origen al menos).
    if (
      caller.role === 'lider' &&
      ticket.areaId &&
      !caller.areaIds.includes(ticket.areaId.toString())
    ) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TICKET_AREA_FORBIDDEN',
        'Solo podés reasignar tickets de áreas que liderás.',
      );
    }

    const targetArea = await this.areaModel
      .findOne({
        _id: this.toObjectId(input.areaId, 'TICKET_AREA_INVALID'),
        tenantId: ticket.tenantId,
        active: true,
      })
      .exec();
    if (!targetArea) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'TICKET_AREA_INVALID',
        'El área destino no existe o está inactiva.',
      );
    }

    // Reasignar entre áreas siempre vuelve a `escalado` y limpia agente.
    const fromEstado = ticket.estado;
    const fromAreaId = ticket.areaId?.toString() ?? null;
    if (ticket.estado !== 'escalado') {
      this.stateMachine.assertTransition(ticket.estado, 'escalado');
    }
    ticket.estado = 'escalado';
    ticket.areaId = targetArea._id;
    ticket.assignedAgentId = null;
    if (ticket.prioridad) {
      const opts = await this.businessHours.getOptsForTenant(ticket.tenantId);
      ticket.slaDeadline = calculateSlaDeadline(ticket.prioridad, targetArea.slas, opts);
      // El nuevo deadline reabre la ventana de alertas SLA — el cron debe
      // volver a notificar approaching/breach contra el plazo nuevo.
      ticket.slaApproachingNotifiedAt = null;
      ticket.slaBreachNotifiedAt = null;
    }
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketAreaReassigned',
      fromEstado,
      toEstado: 'escalado',
      extra: {
        fromAreaId,
        toAreaId: targetArea._id.toString(),
        reassignedBy: caller.userId,
      },
      content: input.motivo,
    });

    return this.toTicketResponse(ticket);
  }

  async classify(
    caller: AuthenticatedUser,
    id: string,
    input: ClassifyTicket,
  ): Promise<TicketResponse> {
    const ticket = await this.findOrFail(caller.tenantId, id);

    if (ticket.estado !== 'requiere_revision_clasificacion') {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_TRANSITION_INVALID',
        'Solo se puede clasificar un ticket en revisión.',
      );
    }

    const targetArea = await this.areaModel
      .findOne({
        _id: this.toObjectId(input.areaId, 'TICKET_AREA_INVALID'),
        tenantId: ticket.tenantId,
        active: true,
      })
      .exec();
    if (!targetArea) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'TICKET_AREA_INVALID',
        'El área destino no existe o está inactiva.',
      );
    }

    if (caller.role === 'lider' && !caller.areaIds.includes(targetArea._id.toString())) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'TICKET_AREA_FORBIDDEN',
        'Solo podés clasificar a áreas que liderás.',
      );
    }

    this.stateMachine.assertTransition('requiere_revision_clasificacion', 'escalado');
    ticket.estado = 'escalado';
    ticket.areaId = targetArea._id;
    ticket.prioridad = input.prioridad;
    const opts = await this.businessHours.getOptsForTenant(ticket.tenantId);
    ticket.slaDeadline = calculateSlaDeadline(input.prioridad, targetArea.slas, opts);
    // Primera asignación de deadline — los flags ya son null pero los
    // dejamos explícitos para que el cron los lea correctamente.
    ticket.slaApproachingNotifiedAt = null;
    ticket.slaBreachNotifiedAt = null;
    await ticket.save();

    await this.emitSystem({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketClassified',
      fromEstado: 'requiere_revision_clasificacion',
      toEstado: 'escalado',
      extra: {
        areaId: targetArea._id.toString(),
        prioridad: input.prioridad,
        classifiedBy: caller.userId,
      },
      content: input.motivo ?? `Clasificado a ${targetArea.name} (prioridad ${input.prioridad}).`,
    });

    return this.toTicketResponse(ticket);
  }

  // -------- helpers --------

  /**
   * Wrapper best-effort sobre `InteractionsService.appendSystemEvent`. Si la
   * persistencia de la interacción falla, lo loggeamos pero no abortamos la
   * operación principal — la mutación del ticket ya se persistió.
   */
  private async emitSystem(args: {
    tenantId: Types.ObjectId;
    ticketId: Types.ObjectId;
    eventName: string;
    fromEstado?: EstadoTicket;
    toEstado?: EstadoTicket;
    extra?: Record<string, unknown>;
    content: string;
  }): Promise<void> {
    try {
      await this.interactions.appendSystemEvent(args);
    } catch (err) {
      this.logger.warn(
        `No se pudo emitir interaction de sistema ${
          args.eventName
        } para ticketId=${args.ticketId.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async findOrFail(tenantId: string, id: string): Promise<TicketDocument> {
    const objectId = this.toObjectId(id, 'TICKET_NOT_FOUND');
    const doc = await this.ticketModel
      .findOne({ _id: objectId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return doc;
  }

  private assertCanRead(caller: AuthenticatedUser, ticket: TicketDocument): void {
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

  /**
   * Para acciones de gestión (take, resolve, assign-agent): el caller
   * debe operar sobre un área a la que pertenece (o ser admin).
   */
  private assertOperatesOnArea(caller: AuthenticatedUser, ticket: TicketDocument): void {
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

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
    }
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

  private toTicketResponse(doc: TicketDocument): TicketResponse {
    return {
      id: doc._id.toString(),
      shortCode: doc.shortCode,
      requesterId: doc.requesterId.toString(),
      asunto: doc.asunto,
      cuerpo: doc.cuerpo,
      estado: doc.estado,
      prioridad: doc.prioridad,
      areaId: doc.areaId ? doc.areaId.toString() : null,
      assignedAgentId: doc.assignedAgentId ? doc.assignedAgentId.toString() : null,
      lastAssignedAgentId: doc.lastAssignedAgentId ? doc.lastAssignedAgentId.toString() : null,
      tags: doc.tags,
      slaDeadline: doc.slaDeadline ? doc.slaDeadline.toISOString() : null,
      resolutionType: doc.resolutionType,
      resolvedBy: doc.resolvedBy ? doc.resolvedBy.toString() : null,
      resolvedAt: doc.resolvedAt ? doc.resolvedAt.toISOString() : null,
      cancelledBy: doc.cancelledBy ? doc.cancelledBy.toString() : null,
      cancelledAt: doc.cancelledAt ? doc.cancelledAt.toISOString() : null,
      cancelReason: doc.cancelReason,
      reopenCount: doc.reopenCount,
      closedDefinitivelyAt: doc.closedDefinitivelyAt
        ? doc.closedDefinitivelyAt.toISOString()
        : null,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private toTicketListItem(doc: TicketDocument): TicketListItem {
    return {
      id: doc._id.toString(),
      shortCode: doc.shortCode,
      requesterId: doc.requesterId.toString(),
      asunto: doc.asunto,
      estado: doc.estado,
      prioridad: doc.prioridad,
      areaId: doc.areaId ? doc.areaId.toString() : null,
      assignedAgentId: doc.assignedAgentId ? doc.assignedAgentId.toString() : null,
      slaDeadline: doc.slaDeadline ? doc.slaDeadline.toISOString() : null,
      resolutionType: doc.resolutionType,
      reopenCount: doc.reopenCount,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
