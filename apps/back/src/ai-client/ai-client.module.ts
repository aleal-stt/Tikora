import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AiCallLog, AiCallLogSchema } from './schemas/ai-call-log.schema';
import { AiCallLogService } from './services/ai-call-log.service';
import { AiClientService } from './services/ai-client.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: AiCallLog.name, schema: AiCallLogSchema }])],
  providers: [AiClientService, AiCallLogService],
  exports: [AiClientService],
})
export class AiClientModule {}
