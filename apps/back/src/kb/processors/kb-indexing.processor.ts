import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KbIndexerService } from '../services/kb-indexer.service';
import { KB_INDEXING_QUEUE, KbIndexingJobData } from '../services/kb-indexing-queue.service';

/**
 * Worker BullMQ que consume la cola `kb-indexing`. Igual que
 * `ClassificationProcessor`, en este sprint corre embebido en el mismo
 * proceso del back (TODO: separar a `apps/back-worker` cuando llegue el
 * sprint de scale; el modelo de embeddings ocupa ~200 MB de RAM y conviene
 * aislarlo del HTTP server).
 */
@Processor(KB_INDEXING_QUEUE)
export class KbIndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(KbIndexingProcessor.name);

  constructor(private readonly indexer: KbIndexerService) {
    super();
  }

  async process(job: Job<KbIndexingJobData>): Promise<{ chunksCreated: number }> {
    const { tenantId, documentId, parentDocumentId, version } = job.data;
    this.logger.debug(
      `Procesando job de indexación KB documentId=${documentId} version=${version}`,
    );
    return this.indexer.indexDocumentVersion({
      tenantId,
      documentId,
      parentDocumentId,
      version,
    });
  }
}
