import { Module } from '@nestjs/common';
import { AreasModule } from '../areas/areas.module';
import { TicketsModule } from '../tickets/tickets.module';
import { MetricsController } from './controllers/metrics.controller';
import { MetricsService } from './services/metrics.service';

@Module({
  imports: [
    // Importamos los módulos que ya exportan `MongooseModule` con los
    // schemas Area y Ticket. No tomamos sus services — solo necesitamos
    // los models para correr aggregates en read-only.
    AreasModule,
    TicketsModule,
  ],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
