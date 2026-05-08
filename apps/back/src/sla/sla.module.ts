import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Area, AreaSchema } from '../areas/schemas/area.schema';
import { Tenant, TenantSchema } from '../tenants/schemas/tenant.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { SlaCheckerService } from './services/sla-checker.service';
import { SlaSchedulerService } from './services/sla-scheduler.service';

/**
 * Módulo SLA — `tikora-events.md` §3.3 + `decisiones-tecnicas.md` §10.
 *
 * Cron periódico (default cada 5 min, configurable por
 * `SLA_CRON_INTERVAL_MS`) que detecta tickets:
 *
 * - próximos a vencer (≤ `SLA_APPROACHING_THRESHOLD_PERCENT`)
 * - vencidos (`slaDeadline < now`)
 * - cerrados hace más de `slaAutoCloseDays` (config del tenant)
 *
 * Importa los modelos vía `MongooseModule.forFeature` para mantener la
 * lógica desacoplada de los services de tickets/areas/tenants. La
 * suscripción a `SlaApproaching`/`SlaBreach` la maneja el listener de
 * `notifications` (no se importa acá — es un consumidor del bus).
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: Area.name, schema: AreaSchema },
      { name: Tenant.name, schema: TenantSchema },
    ]),
  ],
  providers: [SlaCheckerService, SlaSchedulerService],
  exports: [SlaCheckerService],
})
export class SlaModule {}
