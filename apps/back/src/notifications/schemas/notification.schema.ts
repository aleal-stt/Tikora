import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

@Schema({ collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  recipientId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', default: null })
  ticketId!: Types.ObjectId | null;

  // Snapshot del evento para renderizar la notificación sin tocar otras
  // colecciones. Forma libre — el cliente conoce la estructura por `type`.
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  payload!: Record<string, unknown>;

  @Prop({ type: Boolean, required: true, default: false })
  read!: boolean;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ tenantId: 1, recipientId: 1, read: 1, createdAt: -1 });
NotificationSchema.index({ tenantId: 1, recipientId: 1, type: 1, createdAt: -1 });
