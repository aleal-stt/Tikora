import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AreasModule } from '../areas/areas.module';
import type { Env } from '../config/env.schema';
import { KbController } from './controllers/kb.controller';
import { EMBEDDING_PROVIDER } from './embeddings/embedding-provider';
import { TransformersEmbeddingProvider } from './embeddings/transformers-embedding.provider';
import { KbIndexingProcessor } from './processors/kb-indexing.processor';
import { KbChunk, KbChunkSchema } from './schemas/kb-chunk.schema';
import { KbDocument, KbDocumentSchema } from './schemas/kb-document.schema';
import { KbIndexerService } from './services/kb-indexer.service';
import { KB_INDEXING_QUEUE, KbIndexingQueueService } from './services/kb-indexing-queue.service';
import { KbService } from './services/kb.service';

@Module({
  imports: [
    // BullMQ root config — duplicado del de classification, necesario porque
    // cada módulo registra su propia cola y bullmq exige forRoot por root
    // injection. El ConfigService es el mismo singleton, así que apuntan al
    // mismo Redis (mismo prefix también).
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
        prefix: config.get('REDIS_KEY_PREFIX', { infer: true }),
      }),
    }),
    BullModule.registerQueue({ name: KB_INDEXING_QUEUE }),
    MongooseModule.forFeature([
      { name: KbDocument.name, schema: KbDocumentSchema },
      { name: KbChunk.name, schema: KbChunkSchema },
    ]),
    // Necesitamos el modelo Area para validar `areaIds` al crear/editar
    // documentos. AreasModule ya exporta MongooseModule.
    AreasModule,
  ],
  controllers: [KbController],
  providers: [
    KbService,
    KbIndexerService,
    KbIndexingQueueService,
    KbIndexingProcessor,
    {
      // Provider de embeddings detrás del token DI: cualquier consumidor
      // (KbIndexerService ahora, KbSearchService en Sprint C) lo recibe
      // por el token y queda desacoplado de la implementación concreta.
      provide: EMBEDDING_PROVIDER,
      useClass: TransformersEmbeddingProvider,
    },
  ],
  // Exportamos el indexer + queue para que el comando `reindex-kb` y el
  // futuro Sprint C los puedan reutilizar sin duplicar config de cola.
  exports: [KbService, KbIndexerService, KbIndexingQueueService, EMBEDDING_PROVIDER],
})
export class KbModule {}
