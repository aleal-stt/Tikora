import { Module } from '@nestjs/common';
import { SseTicketsService } from './services/sse-tickets.service';

@Module({
  providers: [SseTicketsService],
  exports: [SseTicketsService],
})
export class SseTicketsModule {}
