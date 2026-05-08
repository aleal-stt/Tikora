import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  AutoResponseGeneratorService,
  GenerateOutcome,
} from '../services/auto-response-generator.service';
import { AUTO_RESPONSE_QUEUE, AutoResponseJobData } from '../services/auto-response-queue.service';

/**
 * Worker BullMQ que consume la cola `auto-response`. Idéntico patrón al
 * `KbIndexingProcessor` y `ClassificationProcessor` — corre embebido en
 * el mismo proceso que el back en MVP; cuando se separe a worker
 * dedicado, este archivo se mueve sin tocar el resto.
 */
@Processor(AUTO_RESPONSE_QUEUE)
export class AutoResponseProcessor extends WorkerHost {
  private readonly logger = new Logger(AutoResponseProcessor.name);

  constructor(private readonly generator: AutoResponseGeneratorService) {
    super();
  }

  async process(job: Job<AutoResponseJobData>): Promise<GenerateOutcome> {
    const { ticketId } = job.data;
    this.logger.debug(`Procesando job de auto-respuesta ticketId=${ticketId}`);
    return this.generator.generate(ticketId);
  }
}
