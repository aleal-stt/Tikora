import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';

export type InteractionType = 'usuario' | 'agente' | 'ia' | 'sistema';

@Schema({ collection: 'interactions', timestamps: { createdAt: true, updatedAt: false } })
export class Interaction {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['usuario', 'agente', 'ia', 'sistema'],
  })
  type!: InteractionType;

  // null para `sistema` e `ia`. Las interacciones de usuario y agente
  // siempre tienen autor.
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  authorId!: Types.ObjectId | null;

  @Prop({ type: String, required: true })
  content!: string;

  // Schema flexible: la forma exacta vive en `@tikora/core/interactions.ts`
  // discriminada por `type`. Mongoose la guarda como subdoc abierto.
  @Prop({ type: SchemaTypes.Mixed, default: {} })
  metadata!: Record<string, unknown>;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type InteractionDocument = HydratedDocument<Interaction>;
export const InteractionSchema = SchemaFactory.createForClass(Interaction);

InteractionSchema.index({ tenantId: 1, ticketId: 1, createdAt: 1 });
InteractionSchema.index({ tenantId: 1, authorId: 1, createdAt: -1 });
