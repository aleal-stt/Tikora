import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailModule } from '../email/email.module';
import { TicketsModule } from '../tickets/tickets.module';
import { UsersModule } from '../users/users.module';
import { InteractionsController } from './controllers/interactions.controller';
import { Interaction, InteractionSchema } from './schemas/interaction.schema';
import { InteractionsService } from './services/interactions.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Interaction.name, schema: InteractionSchema }]),
    // forwardRef rompe el ciclo: TicketsModule también nos importa para
    // emitir interacciones de sistema en cada transición.
    forwardRef(() => TicketsModule),
    // Necesarios para que el agente pueda mandar la respuesta por mail al
    // solicitante (interaction type=agente con enviarPorCorreo=true).
    EmailModule,
    UsersModule,
  ],
  controllers: [InteractionsController],
  providers: [InteractionsService],
  exports: [InteractionsService],
})
export class InteractionsModule {}
