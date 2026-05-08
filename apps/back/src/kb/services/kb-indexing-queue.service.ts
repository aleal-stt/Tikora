import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';

export const KB_INDEXING_QUEUE = 'kb-indexing';

export interface KbIndexingJobData {
  tenantId: string;
  documentId: string;
  parentDocumentId: string;
  /**
   * Versión del documento que el processor debe activar al terminar.
   * El job verifica que la versión sigue existiendo antes de tocar nada
   * (defensa contra job stale tras un rollback manual).
   */
  version: number;
}

/**
 * Productor de jobs de indexación de KB. El `enqueue` lo invoca
 * `KbService` después de persistir un `KbDocument` en `active:false` —
 * el processor genera los chunks + embeddings y al terminar hace el swap
 * a `active:true` en una operación bulk.
 */
@Injectable()
export class KbIndexingQueueService {
  private readonly logger = new Logger(KbIndexingQueueService.name);

  constructor(@InjectQueue(KB_INDEXING_QUEUE) private readonly queue: Queue) {}

  async enqueue(data: KbIndexingJobData): Promise<void> {
    await this.queue.add('index', data satisfies KbIndexingJobData, {
      // Reintentos por errores transitorios de Mongo o de descarga del
      // modelo. Backoff agresivo porque la carga del modelo puede tardar
      // 10-20s con cache miss.
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: { age: 24 * 60 * 60, count: 1000 },
      removeOnFail: { age: 7 * 24 * 60 * 60 },
    });
    this.logger.debug(
      `Job de indexación encolado documentId=${data.documentId} version=${data.version}`,
    );
  }
}
