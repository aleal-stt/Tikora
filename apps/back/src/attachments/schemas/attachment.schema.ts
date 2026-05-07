import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'attachments', timestamps: { createdAt: true, updatedAt: false } })
export class Attachment {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploaderId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  originalName!: string;

  @Prop({ type: String, required: true })
  storedName!: string;

  @Prop({ type: String, required: true })
  mimeType!: string;

  @Prop({ type: Number, required: true })
  sizeBytes!: number;

  @Prop({ type: String, required: true })
  storagePath!: string;

  @Prop({
    type: String,
    required: true,
    enum: ['local'],
    default: 'local',
  })
  storageProvider!: 'local';

  @Prop({ type: String, required: true })
  checksum!: string;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type AttachmentDocument = HydratedDocument<Attachment>;
export const AttachmentSchema = SchemaFactory.createForClass(Attachment);

AttachmentSchema.index({ tenantId: 1, ticketId: 1 });
AttachmentSchema.index({ checksum: 1 });
