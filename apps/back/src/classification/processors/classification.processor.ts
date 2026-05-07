import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  CLASSIFICATION_QUEUE,
  ClassificationJobData,
} from '../services/classification-queue.service';
import { ClassificationService } from '../services/classification.service';

/**
 * Worker BullMQ que consume la cola `classification`. En este sprint
 * corre embebido en el mismo proceso que el back (TODO: separar a
 * `apps/back-worker` cuando llegue el sprint de scale).
 */
@Processor(CLASSIFICATION_QUEUE)
export class ClassificationProcessor extends WorkerHost {
  private readonly logger = new Logger(ClassificationProcessor.name);

  constructor(private readonly classification: ClassificationService) {
    super();
  }

  async process(job: Job<ClassificationJobData>): Promise<{ outcome: string }> {
    const { ticketId } = job.data;
    this.logger.debug(`Procesando job de clasificación ticketId=${ticketId}`);
    const result = await this.classification.classify(ticketId);
    return { outcome: result.outcome };
  }
}
