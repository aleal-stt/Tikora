import { BullModule } from '@nestjs/bullmq';
import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AiClientModule } from '../ai-client/ai-client.module';
import { AreasModule } from '../areas/areas.module';
import { CommonModule } from '../common/common.module';
import type { Env } from '../config/env.schema';
import { InteractionsModule } from '../interactions/interactions.module';
import { TicketsModule } from '../tickets/tickets.module';
import { ClassificationProcessor } from './processors/classification.processor';
import { Classification, ClassificationSchema } from './schemas/classification.schema';
import {
  CLASSIFICATION_QUEUE,
  ClassificationQueueService,
} from './services/classification-queue.service';
import { ClassificationService } from './services/classification.service';

@Module({
  imports: [
    // Conexión Redis global para BullMQ. La configuramos acá (no en
    // AppModule) para que solo la levante el módulo que realmente la usa,
    // evitando dependencia obligada de Redis en endpoints sin IA.
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: {
          // bullmq acepta un string URL directo en `connection`.
          url: config.get('REDIS_URL', { infer: true }),
        },
        prefix: config.get('REDIS_KEY_PREFIX', { infer: true }),
      }),
    }),
    BullModule.registerQueue({ name: CLASSIFICATION_QUEUE }),
    MongooseModule.forFeature([{ name: Classification.name, schema: ClassificationSchema }]),
    AiClientModule,
    AreasModule,
    // BusinessHoursService para calcular slaDeadline en horas hábiles
    // (decisión §10) al transicionar ticket → escalado/clasificado.
    CommonModule,
    // forwardRef bilateral con TicketsModule: el processor consume el
    // modelo Ticket (vía MongooseModule exportado) y `TicketsService`
    // encola jobs en esta cola.
    forwardRef(() => TicketsModule),
    InteractionsModule,
  ],
  providers: [ClassificationService, ClassificationQueueService, ClassificationProcessor],
  // Exportamos MongooseModule para que AutoResponseModule reciba el
  // modelo Classification al rehidratar la última clasificación del
  // ticket dentro del flujo de generación de auto-respuesta.
  exports: [ClassificationQueueService, MongooseModule],
})
export class ClassificationModule {}
