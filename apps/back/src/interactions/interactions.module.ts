import { forwardRef, Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketsModule } from '../tickets/tickets.module';
import { InteractionsController } from './controllers/interactions.controller';
import { Interaction, InteractionSchema } from './schemas/interaction.schema';
import { InteractionsService } from './services/interactions.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Interaction.name, schema: InteractionSchema }]),
    // forwardRef rompe el ciclo: TicketsModule también nos importa para
    // emitir interacciones de sistema en cada transición.
    forwardRef(() => TicketsModule),
  ],
  controllers: [InteractionsController],
  providers: [InteractionsService],
  exports: [InteractionsService],
})
export class InteractionsModule {}
