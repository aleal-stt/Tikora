import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

export const CLASSIFICATION_QUEUE = 'classification';

export interface ClassificationJobData {
  ticketId: string;
}

/**
 * Productor de jobs de clasificación. El `enqueue` se invoca desde
 * `TicketsService.create` después de persistir el ticket en `recibido`.
 * Si la cola no está disponible (Redis caído), el método propaga el
 * error y el caller decide el fallback.
 */
@Injectable()
export class ClassificationQueueService {
  private readonly logger = new Logger(ClassificationQueueService.name);

  constructor(@InjectQueue(CLASSIFICATION_QUEUE) private readonly queue: Queue) {}

  async enqueue(ticketId: string): Promise<void> {
    await this.queue.add('classify', { ticketId } satisfies ClassificationJobData, {
      // Ya el AiClientService maneja retries por errores transitorios de
      // Anthropic. BullMQ retries cubren fallos infraestructurales (Redis,
      // Mongo). Backoff exponencial para no martillar en caso de outage.
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
    this.logger.debug(`Job de clasificación encolado para ticketId=${ticketId}`);
  }
}
