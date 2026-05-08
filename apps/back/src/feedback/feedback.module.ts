import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Area, AreaSchema } from '../areas/schemas/area.schema';
import {
  Classification,
  ClassificationSchema,
} from '../classification/schemas/classification.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';
import { FeedbackController } from './controllers/feedback.controller';
import {
  ClassificationFeedback,
  ClassificationFeedbackSchema,
} from './schemas/classification-feedback.schema';
import { FeedbackService } from './services/feedback.service';

/**
 * Módulo standalone — `tikora-data-model.md` §3.14, `tikora-api.md` §14.
 *
 * Captura el feedback estructurado del agente sobre la clasificación IA.
 * No depende de `ClassificationModule`/`TicketsModule` directamente: sólo
 * importa los schemas Mongoose para no acoplarse a sus services.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: ClassificationFeedback.name, schema: ClassificationFeedbackSchema },
      { name: Ticket.name, schema: TicketSchema },
      { name: Classification.name, schema: ClassificationSchema },
      { name: Area.name, schema: AreaSchema },
    ]),
  ],
  controllers: [FeedbackController],
  providers: [FeedbackService],
})
export class FeedbackModule {}
