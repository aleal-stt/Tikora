import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TicketsModule } from '../tickets/tickets.module';
import { AttachmentsController } from './controllers/attachments.controller';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { AttachmentsService } from './services/attachments.service';
import { ATTACHMENT_STORAGE } from './storage/attachment-storage.interface';
import { LocalDiskStorage } from './storage/local-disk.storage';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Attachment.name, schema: AttachmentSchema }]),
    // TicketsModule exporta el modelo Ticket vía MongooseModule. No
    // necesitamos su service, así que no hace falta forwardRef.
    TicketsModule,
  ],
  controllers: [AttachmentsController],
  providers: [
    AttachmentsService,
    LocalDiskStorage,
    // Bind del adapter activo. Cuando llegue S3 se reemplaza acá sin
    // tocar al `AttachmentsService` (DIP).
    { provide: ATTACHMENT_STORAGE, useExisting: LocalDiskStorage },
  ],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
