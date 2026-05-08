import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

export const AUTO_RESPONSE_QUEUE = 'auto-response';

export interface AutoResponseJobData {
  ticketId: string;
}

/**
 * Productor de jobs de generación de auto-respuesta. Lo invoca el
 * listener `AutoResponseEvaluatorListener` cuando un `TicketClassified`
 * supera las pre-condiciones (prioridad baja + alta confianza).
 *
 * El job es ligero (solo lleva `ticketId`) — toda la lógica vive en el
 * processor que rehidrata ticket + classification + busca KB + llama IA.
 */
@Injectable()
export class AutoResponseQueueService {
  private readonly logger = new Logger(AutoResponseQueueService.name);

  constructor(@InjectQueue(AUTO_RESPONSE_QUEUE) private readonly queue: Queue) {}

  async enqueue(ticketId: string): Promise<void> {
    await this.queue.add('generate', { ticketId } satisfies AutoResponseJobData, {
      // El AiClientService ya maneja retries de errores transitorios
      // de Anthropic. BullMQ retries cubren fallas de Mongo/Redis/red
      // entre el processor y los servicios que orquesta.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
    this.logger.debug(`Job de auto-respuesta encolado ticketId=${ticketId}`);
  }
}
