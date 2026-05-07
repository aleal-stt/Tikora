import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AreasModule } from '../areas/areas.module';
import { ClassificationModule } from '../classification/classification.module';
import { CountersModule } from '../counters/counters.module';
import { InteractionsModule } from '../interactions/interactions.module';
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
    // forwardRef bilateral con InteractionsModule: emitimos system events
    // al transicionar tickets, e InteractionsModule consulta nuestro
    // modelo Ticket para validar permisos.
    forwardRef(() => InteractionsModule),
    // forwardRef bilateral con ClassificationModule: encolamos jobs IA
    // al crear tickets; el processor consume el modelo Ticket exportado.
    forwardRef(() => ClassificationModule),
  ],
  controllers: [TicketsController],
  providers: [TicketsService, TicketStateMachineService],
  // Exportamos `MongooseModule` para que InteractionsModule y
  // ClassificationModule reciban el modelo Ticket sin tocar al service.
  exports: [TicketsService, MongooseModule],
})
export class TicketsModule {}
