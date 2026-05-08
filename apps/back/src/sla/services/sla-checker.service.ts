import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import type { Env } from '../../config/env.schema';
import {
  NOTIFICATION_EVENTS,
  SlaApproachingEvent,
  SlaBreachEvent,
  TicketClosedDefinitivelyEvent,
} from '../../notifications/events/notification-events';
import { Tenant, TenantDocument } from '../../tenants/schemas/tenant.schema';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';

export interface SlaTickResult {
  approachingEmitted: number;
  breachEmitted: number;
  definitivelyClosed: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;
const MS_PER_MIN = 60 * 1000;

/**
 * Lógica del cron de SLA. Una corrida (`tick`) hace tres barridos
 * independientes y acotados por `SLA_BATCH_SIZE`:
 *
 *  1. **Approaching**: tickets activos con `slaDeadline` dentro de la
 *     ventana de umbral y sin marca previa → `SlaApproaching` + flag.
 *  2. **Breach**: tickets activos vencidos sin marca previa →
 *     `SlaBreach` + flag.
 *  3. **Auto-close definitivo**: tickets `cerrado` cuyo `resolvedAt` es
 *     anterior a `now - slaAutoCloseDays` (config del tenant) y que
 *     todavía no fueron marcados como cierre definitivo.
 *
 * El flag de cada paso se actualiza en el mismo `findOneAndUpdate` que
 * persiste el estado, así dos corridas concurrentes no duplican
 * notificaciones (la query filtra por flag null y el update gana al
 * primer ejecutor).
 *
 * **Cálculo de umbrales:** wallclock — `calculateSlaDeadline` ya guarda
 * el deadline como timestamp wallclock (TODO de horas hábiles vive en
 * `tickets.sla.ts`). El % restante se computa contra el SLA total de la
 * prioridad expresado en horas wallclock.
 *
 * Match con `tikora-events.md` §3.3 y `decisiones-tecnicas.md` §10.
 */
@Injectable()
export class SlaCheckerService {
  private readonly logger = new Logger(SlaCheckerService.name);

  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>,
    private readonly config: ConfigService<Env, true>,
    private readonly events: EventEmitter2,
  ) {}

  /**
   * Una corrida completa del cron. Devuelve cuántos eventos emitió de
   * cada tipo — útil para tests y para loguear progreso.
   */
  async tick(now: Date = new Date()): Promise<SlaTickResult> {
    const batchSize = this.config.get('SLA_BATCH_SIZE', { infer: true });
    const threshold = this.config.get('SLA_APPROACHING_THRESHOLD_PERCENT', { infer: true });

    const [approachingEmitted, breachEmitted, definitivelyClosed] = await Promise.all([
      this.checkApproaching(now, threshold, batchSize),
      this.checkBreach(now, batchSize),
      this.checkAutoClose(now, batchSize),
    ]);

    if (approachingEmitted + breachEmitted + definitivelyClosed > 0) {
      this.logger.log(
        `SLA tick: approaching=${approachingEmitted} breach=${breachEmitted} closed=${definitivelyClosed}`,
      );
    }
    return { approachingEmitted, breachEmitted, definitivelyClosed };
  }

  /**
   * Tickets activos cuyo deadline cae dentro de la ventana de umbral
   * (≤ `threshold` % del SLA total restante) y que aún no fueron
   * notificados. La consulta usa el SLA total del área para calcular la
   * ventana — por eso necesita el área cargada.
   */
  private async checkApproaching(now: Date, threshold: number, batchSize: number): Promise<number> {
    // Buscamos candidatos: activos, con deadline futuro, sin flag previo.
    // La ventana exacta (≤ threshold % restante) la evaluamos contra cada
    // ticket porque depende del SLA del área y la prioridad.
    const candidates = await this.ticketModel
      .find({
        estado: { $in: ['escalado', 'en_progreso'] },
        slaDeadline: { $ne: null, $gt: now },
        slaApproachingNotifiedAt: null,
      })
      .limit(batchSize)
      .exec();

    let emitted = 0;
    for (const ticket of candidates) {
      if (!ticket.slaDeadline || !ticket.areaId || !ticket.prioridad) continue;
      const totalMs = await this.totalSlaMsFor(ticket);
      if (totalMs === null || totalMs <= 0) continue;
      const remainingMs = ticket.slaDeadline.getTime() - now.getTime();
      // Si remainingMs/totalMs > threshold, no estamos en ventana todavía.
      if (remainingMs > totalMs * threshold) continue;

      // Marca atómica: `slaApproachingNotifiedAt: null` en el filtro
      // garantiza que solo el primer ejecutor que llegue actualice el
      // doc. Si pierde la carrera, no emite.
      const updated = await this.ticketModel.findOneAndUpdate(
        { _id: ticket._id, slaApproachingNotifiedAt: null },
        { $set: { slaApproachingNotifiedAt: now } },
        { new: false },
      );
      if (!updated) continue;

      this.events.emit(NOTIFICATION_EVENTS.SlaApproaching, {
        tenantId: ticket.tenantId.toString(),
        ticketId: ticket._id.toString(),
        agentId: ticket.assignedAgentId?.toString() ?? null,
        areaId: ticket.areaId.toString(),
        prioridad: ticket.prioridad,
        slaDeadline: ticket.slaDeadline.toISOString(),
        remainingMinutes: Math.max(0, Math.floor(remainingMs / MS_PER_MIN)),
      } satisfies SlaApproachingEvent);
      emitted += 1;
    }
    return emitted;
  }

  /**
   * Tickets activos cuyo deadline ya pasó y que no fueron notificados.
   * No requiere conocer el SLA total — basta con que `slaDeadline < now`.
   */
  private async checkBreach(now: Date, batchSize: number): Promise<number> {
    const candidates = await this.ticketModel
      .find({
        estado: { $in: ['escalado', 'en_progreso'] },
        slaDeadline: { $ne: null, $lte: now },
        slaBreachNotifiedAt: null,
      })
      .limit(batchSize)
      .exec();

    let emitted = 0;
    for (const ticket of candidates) {
      if (!ticket.slaDeadline || !ticket.areaId || !ticket.prioridad) continue;

      const updated = await this.ticketModel.findOneAndUpdate(
        { _id: ticket._id, slaBreachNotifiedAt: null },
        { $set: { slaBreachNotifiedAt: now } },
        { new: false },
      );
      if (!updated) continue;

      const overdueMs = now.getTime() - ticket.slaDeadline.getTime();
      const leaderIds = await this.leadersOf(ticket.areaId);

      this.events.emit(NOTIFICATION_EVENTS.SlaBreach, {
        tenantId: ticket.tenantId.toString(),
        ticketId: ticket._id.toString(),
        agentId: ticket.assignedAgentId?.toString() ?? null,
        areaId: ticket.areaId.toString(),
        leaderIds,
        prioridad: ticket.prioridad,
        slaDeadline: ticket.slaDeadline.toISOString(),
        overdueMinutes: Math.max(0, Math.floor(overdueMs / MS_PER_MIN)),
      } satisfies SlaBreachEvent);
      emitted += 1;
    }
    return emitted;
  }

  /**
   * Cierra definitivamente tickets `cerrado` cuyo `resolvedAt` es más
   * antiguo que `slaAutoCloseDays` (config del tenant). El estado del
   * ticket sigue siendo `cerrado` — solo seteamos `closedDefinitivelyAt`
   * que `tickets.service.reopen` consulta para bloquear reaperturas
   * tardías. El cálculo es wallclock (TODO horas hábiles).
   */
  private async checkAutoClose(now: Date, batchSize: number): Promise<number> {
    // Una sola pasada por tenant, en serie, para no leer N veces los
    // mismos settings. Si la lista de tenants crece mucho se puede
    // paralelizar.
    const tenants = await this.tenantModel.find({ active: true }).exec();
    let total = 0;
    for (const tenant of tenants) {
      const days = tenant.settings?.slaAutoCloseDays ?? 0;
      if (days <= 0) continue;
      const cutoff = new Date(now.getTime() - days * MS_PER_DAY);

      const candidates = await this.ticketModel
        .find({
          tenantId: tenant._id,
          estado: 'cerrado',
          resolvedAt: { $ne: null, $lte: cutoff },
          closedDefinitivelyAt: null,
        })
        .limit(batchSize)
        .exec();

      for (const ticket of candidates) {
        const updated = await this.ticketModel.findOneAndUpdate(
          { _id: ticket._id, closedDefinitivelyAt: null },
          { $set: { closedDefinitivelyAt: now } },
          { new: false },
        );
        if (!updated) continue;

        this.events.emit(NOTIFICATION_EVENTS.TicketClosedDefinitively, {
          tenantId: ticket.tenantId.toString(),
          ticketId: ticket._id.toString(),
          cerradoOriginalmenteAt: (ticket.resolvedAt as Date).toISOString(),
        } satisfies TicketClosedDefinitivelyEvent);
        total += 1;
      }
    }
    return total;
  }

  /**
   * Calcula el SLA total en ms para un ticket, leyendo `slas` del área.
   * Match con `calculateSlaDeadline` — usamos las mismas horas
   * configuradas en el área. Si no podemos resolver el área, devolvemos
   * `null` y el ticket se saltea en este tick.
   */
  private async totalSlaMsFor(ticket: TicketDocument): Promise<number | null> {
    if (!ticket.areaId || !ticket.prioridad) return null;
    const area = await this.areaModel
      .findOne({ _id: ticket.areaId, tenantId: ticket.tenantId })
      .select({ slas: 1 })
      .lean()
      .exec();
    if (!area?.slas) return null;
    const hours = area.slas[ticket.prioridad];
    if (typeof hours !== 'number' || hours <= 0) return null;
    return hours * MS_PER_HOUR;
  }

  private async leadersOf(areaId: Types.ObjectId): Promise<string[]> {
    const area = await this.areaModel
      .findOne({ _id: areaId })
      .select({ leaderIds: 1 })
      .lean()
      .exec();
    return area?.leaderIds?.map((id) => id.toString()) ?? [];
  }
}
