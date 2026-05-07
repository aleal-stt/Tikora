import { Module } from '@nestjs/common';
import { AiClientService } from './services/ai-client.service';

@Module({
  providers: [AiClientService],
  exports: [AiClientService],
})
export class AiClientModule {}
