import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AreasModule } from '../areas/areas.module';
import { SseTicketsModule } from '../sse-tickets/sse-tickets.module';
import { UsersModule } from '../users/users.module';
import { NotificationsController } from './controllers/notifications.controller';
import { SseStreamController } from './controllers/sse-stream.controller';
import { Notification, NotificationSchema } from './schemas/notification.schema';
import { NotificationEventsListener } from './services/notification-events.listener';
import { NotificationsService } from './services/notifications.service';
import { SseHub } from './services/sse-hub.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Notification.name, schema: NotificationSchema }]),
    // Necesitamos los modelos Area y User para resolver recipients
    // (agentes/líderes del área, admins del tenant).
    AreasModule,
    UsersModule,
    SseTicketsModule,
  ],
  controllers: [NotificationsController, SseStreamController],
  providers: [NotificationsService, SseHub, NotificationEventsListener],
  exports: [NotificationsService],
})
export class NotificationsModule {}
