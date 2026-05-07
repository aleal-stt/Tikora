import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AreasModule } from '../areas/areas.module';
import { CountersModule } from '../counters/counters.module';
import { UsersModule } from '../users/users.module';
import { TicketsController } from './controllers/tickets.controller';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketStateMachineService } from './services/ticket-state-machine.service';
import { TicketsService } from './services/tickets.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Ticket.name, schema: TicketSchema }]),
    // Recibimos User y Area models vía los exports de MongooseModule
    // de cada módulo (sin inyectar sus services — evita acoplar).
    UsersModule,
    AreasModule,
    CountersModule,
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketStateMachineService],
  exports: [TicketsService],
})
export class TicketsModule {}
