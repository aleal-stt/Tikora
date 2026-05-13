import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiCallLog, AiCallLogSchema } from './schemas/ai-call-log.schema';
import { AiCallLogService } from './services/ai-call-log.service';
import { AiClientService } from './services/ai-client.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: AiCallLog.name, schema: AiCallLogSchema }])],
  providers: [AiClientService, AiCallLogService],
  // Re-exportamos el MongooseModule de AiCallLog para que módulos consumidores
  // (ej. MetricsModule) puedan inyectar el model directamente en read-only sin
  // tener que registrar el schema dos veces.
  exports: [AiClientService, MongooseModule],
})
export class AiClientModule {}
