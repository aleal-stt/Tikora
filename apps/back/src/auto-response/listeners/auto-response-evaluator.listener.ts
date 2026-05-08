import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import type { Env } from '../../config/env.schema';
import {
  NOTIFICATION_EVENTS,
  TicketClassifiedEvent,
} from '../../notifications/events/notification-events';
import { AutoResponseQueueService } from '../services/auto-response-queue.service';

/**
 * Evalúa las **3 pre-condiciones** de auto-respuesta documentadas en
 * `tikora-ia.md` §7.1 ante cada `TicketClassified`:
 *
 *   1. `prioridad === 'baja'`.
 *   2. `confianza ≥ UMBRAL_CONFIANZA_CLASIFICACION`.
 *   3. (la tercera, "match en KB", la valida el processor — no podemos
 *      saberlo sin embeber + buscar).
 *
 * Si las dos primeras pasan, encolamos el job; el processor verifica la
 * tercera y descarta si no hay match suficiente. Cortocircuita en orden
 * para no encolar trabajo de alta prioridad o baja confianza que no va
 * a generar nada.
 *
 * Activación por fase (`AI_PHASE`):
 * - Fase 1 (default): el listener no hace nada — el flujo de
 *   auto-respuesta queda construido pero apagado, según `tikora-ia.md` §3.
 * - Fase 2/3: encola siempre que pasen las pre-condiciones.
 */
@Injectable()
export class AutoResponseEvaluatorListener {
  private readonly logger = new Logger(AutoResponseEvaluatorListener.name);

  constructor(
    private readonly queue: AutoResponseQueueService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @OnEvent(NOTIFICATION_EVENTS.TicketClassified)
  async onTicketClassified(event: TicketClassifiedEvent): Promise<void> {
    const phase = this.config.get('AI_PHASE', { infer: true });
    if (phase < 2) {
      // Fase 1: el módulo está construido pero no genera. Logueamos a
      // debug para diagnóstico sin inflar logs de info.
      this.logger.debug(
        `AI_PHASE=${phase}, auto-respuesta deshabilitada (ticketId=${event.ticketId}).`,
      );
      return;
    }

    if (event.prioridad !== 'baja') {
      this.logger.debug(
        `Pre-condición fallida (prioridad=${event.prioridad}) para ticketId=${event.ticketId}, escalada normal.`,
      );
      return;
    }

    const umbral = this.config.get('UMBRAL_CONFIANZA_CLASIFICACION', { infer: true });
    if (event.confianza < umbral) {
      this.logger.debug(
        `Pre-condición fallida (confianza=${event.confianza.toFixed(
          2,
        )} < ${umbral}) para ticketId=${event.ticketId}, escalada normal.`,
      );
      return;
    }

    try {
      await this.queue.enqueue(event.ticketId);
    } catch (err) {
      // No revertimos el TicketClassified — el ticket sigue su flujo
      // normal. La auto-respuesta es best-effort.
      this.logger.warn(
        `No se pudo encolar auto-respuesta ticketId=${event.ticketId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
