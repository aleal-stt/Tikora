import { Module } from '@nestjs/common';
import { AiClientModule } from '../ai-client/ai-client.module';
import { AreasModule } from '../areas/areas.module';
import { TicketsModule } from '../tickets/tickets.module';
import { AdminAiMetricsController } from './controllers/admin-ai-metrics.controller';
import { MetricsController } from './controllers/metrics.controller';
import { AdminAiMetricsService } from './services/admin-ai-metrics.service';
import { MetricsService } from './services/metrics.service';

@Module({
  imports: [
    // Importamos los módulos que ya exportan `MongooseModule` con los
    // schemas Area, Ticket y AiCallLog. No tomamos sus services — solo
    // necesitamos los models para correr aggregates en read-only.
    AreasModule,
    TicketsModule,
    AiClientModule,
  ],
  controllers: [MetricsController, AdminAiMetricsController],
  providers: [MetricsService, AdminAiMetricsService],
})
export class MetricsModule {}
