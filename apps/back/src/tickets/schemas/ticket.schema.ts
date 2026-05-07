import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EstadoTicket =
  | 'recibido'
  | 'clasificado'
  | 'requiere_revision_clasificacion'
  | 'escalado'
  | 'en_progreso'
  | 'cerrado'
  | 'reabierto'
  | 'cancelado';

export type Prioridad = 'alta' | 'media' | 'baja';

@Schema({ collection: 'tickets', timestamps: true })
export class Ticket {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  shortCode!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  requesterId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  asunto!: string;

  @Prop({ type: String, required: true })
  cuerpo!: string;

  @Prop({
    type: String,
    required: true,
    enum: [
      'recibido',
      'clasificado',
      'requiere_revision_clasificacion',
      'escalado',
      'en_progreso',
      'cerrado',
      'reabierto',
      'cancelado',
    ],
  })
  estado!: EstadoTicket;

  @Prop({ type: String, enum: ['alta', 'media', 'baja'], default: null })
  prioridad!: Prioridad | null;

  @Prop({ type: Types.ObjectId, ref: 'Area', default: null })
  areaId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  classificationId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, default: null })
  autoResponseId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  assignedAgentId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  lastAssignedAgentId!: Types.ObjectId | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Attachment' }], default: [] })
  attachmentIds!: Types.ObjectId[];

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Date, default: null })
  slaDeadline!: Date | null;

  @Prop({ type: String, enum: ['manual', 'auto'], default: null })
  resolutionType!: 'manual' | 'auto' | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  resolvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  resolvedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  cancelledBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  cancelledAt!: Date | null;

  @Prop({ type: String, default: null })
  cancelReason!: string | null;

  @Prop({ type: Number, default: 0 })
  reopenCount!: number;

  @Prop({ type: Date, default: null })
  closedDefinitivelyAt!: Date | null;

  @Prop({ type: Types.ObjectId, default: null })
  classificationFeedbackId!: Types.ObjectId | null;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type TicketDocument = HydratedDocument<Ticket>;
export const TicketSchema = SchemaFactory.createForClass(Ticket);

TicketSchema.index({ tenantId: 1, shortCode: 1 }, { unique: true });
TicketSchema.index({ tenantId: 1, estado: 1, slaDeadline: 1 });
TicketSchema.index({ tenantId: 1, areaId: 1, estado: 1 });
TicketSchema.index({ tenantId: 1, requesterId: 1, createdAt: -1 });
TicketSchema.index({ tenantId: 1, assignedAgentId: 1, estado: 1 });
TicketSchema.index({ tenantId: 1, prioridad: 1, slaDeadline: 1 });
// Búsqueda full-text en español sobre asunto+cuerpo (sirve al filtro `q`).
TicketSchema.index({ asunto: 'text', cuerpo: 'text' }, { default_language: 'spanish' });
