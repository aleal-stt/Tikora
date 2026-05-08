import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiClientModule } from '../ai-client/ai-client.module';
import { ClassificationModule } from '../classification/classification.module';
import type { Env } from '../config/env.schema';
import { EmailModule } from '../email/email.module';
import { InteractionsModule } from '../interactions/interactions.module';
import { KbModule } from '../kb/kb.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { AiResponsesController } from './controllers/ai-responses.controller';
import { AutoResponseEvaluatorListener } from './listeners/auto-response-evaluator.listener';
import { AutoResponseProcessor } from './processors/auto-response.processor';
import { AiResponse, AiResponseSchema } from './schemas/ai-response.schema';
import { AutoResponseGeneratorService } from './services/auto-response-generator.service';
import {
  AUTO_RESPONSE_QUEUE,
  AutoResponseQueueService,
} from './services/auto-response-queue.service';
import { AutoResponseService } from './services/auto-response.service';

/**
 * Módulo de auto-respuesta (Fase 2+). Conecta:
 *
 * - El listener que reacciona a `TicketClassified`.
 * - La cola/processor que generan la respuesta IA usando RAG sobre KB.
 * - El controller que expone el flujo de aprobación humana.
 *
 * En `AI_PHASE=1` el módulo se carga pero el listener cortocircuita
 * antes de encolar, así que no consume API ni cuotas.
 */
@Module({
  imports: [
    // BullMQ root + cola del módulo. Misma config que `kb` y
    // `classification` — apuntan al mismo Redis.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        prefix: config.get('REDIS_KEY_PREFIX', { infer: true }),
      }),
    }),
    BullModule.registerQueue({ name: AUTO_RESPONSE_QUEUE }),
    MongooseModule.forFeature([{ name: AiResponse.name, schema: AiResponseSchema }]),
    AiClientModule,
    EmailModule,
    InteractionsModule,
    // Modelos que usamos vía MongooseModule reexportado:
    // - TicketsModule: Ticket
    // - UsersModule: User
    // - KbModule: KbChunk + KbDocument + KbSearchService
    // - ClassificationModule: Classification
    TicketsModule,
    UsersModule,
    KbModule,
    ClassificationModule,
  ],
  controllers: [AiResponsesController],
  providers: [
    AutoResponseService,
    AutoResponseGeneratorService,
    AutoResponseQueueService,
    AutoResponseProcessor,
    AutoResponseEvaluatorListener,
  ],
})
export class AutoResponseModule {}
