import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ClassificationOutcome =
  | 'ok'
  | 'low_confidence'
  | 'invalid_area'
  | 'validation_failure'
  | 'api_error'
  | 'content_insufficient';

@Schema({ collection: 'classifications', timestamps: { createdAt: true, updatedAt: false } })
export class Classification {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId!: Types.ObjectId;

  // El área se persiste como string (puede ser un ObjectId válido o un
  // valor "inválido" devuelto por la IA si el modelo alucina). Se guarda
  // tal cual vino para auditar; la transición del ticket usa una validación
  // post-Zod contra la colección `areas`.
  @Prop({ type: String, default: '' })
  area!: string;

  @Prop({
    type: String,
    enum: ['alta', 'media', 'baja'],
    default: 'media',
  })
  prioridad!: 'alta' | 'media' | 'baja';

  @Prop({ type: Number, required: true })
  confianza!: number;

  @Prop({ type: String, default: '' })
  resumen!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: String, required: true })
  modelo!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  @Prop({ type: Number, required: true })
  temperature!: number;

  @Prop({ type: Number, default: 0 })
  tokensInput!: number;

  @Prop({ type: Number, default: 0 })
  tokensInputCached!: number;

  @Prop({ type: Number, default: 0 })
  tokensOutput!: number;

  @Prop({ type: Number, default: 0 })
  latencyMs!: number;

  @Prop({ type: Number, default: 0 })
  retries!: number;

  @Prop({
    type: String,
    required: true,
    enum: [
      'ok',
      'low_confidence',
      'invalid_area',
      'validation_failure',
      'api_error',
      'content_insufficient',
    ],
  })
  outcome!: ClassificationOutcome;

  @Prop({ type: String, default: null })
  outcomeDetail!: string | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type ClassificationDocument = HydratedDocument<Classification>;
export const ClassificationSchema = SchemaFactory.createForClass(Classification);

ClassificationSchema.index({ tenantId: 1, ticketId: 1, createdAt: -1 });
ClassificationSchema.index({ tenantId: 1, outcome: 1, createdAt: -1 });
ClassificationSchema.index({ tenantId: 1, modelo: 1, promptVersion: 1 });
