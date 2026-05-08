import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { FeedbackVeredicto, Prioridad } from '@tikora/core';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Feedback estructurado del agente sobre la clasificación que hizo la IA.
 *
 * Match con `tikora-data-model.md` §3.14. Único por ticket: el endpoint
 * de creación funciona como upsert — si ya existía un feedback, se
 * sobrescribe (el agente puede cambiar de opinión).
 */
@Schema({ collection: 'feedback_classification', timestamps: true })
export class ClassificationFeedback {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Classification', required: true })
  classificationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['correcta', 'area_incorrecta', 'prioridad_incorrecta', 'ambas_incorrectas'],
  })
  veredicto!: FeedbackVeredicto;

  @Prop({ type: Types.ObjectId, ref: 'Area', default: null })
  areaCorrectaId!: Types.ObjectId | null;

  @Prop({ type: String, enum: ['alta', 'media', 'baja', null], default: null })
  prioridadCorrecta!: Prioridad | null;

  @Prop({ type: String, default: null })
  comentario!: string | null;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type ClassificationFeedbackDocument = HydratedDocument<ClassificationFeedback>;
export const ClassificationFeedbackSchema = SchemaFactory.createForClass(ClassificationFeedback);

// Único por ticket (la doc dice "se sobrescribe"). Implementamos el
// upsert en el service; el índice impide duplicados de carrera.
ClassificationFeedbackSchema.index({ tenantId: 1, ticketId: 1 }, { unique: true });
ClassificationFeedbackSchema.index({ tenantId: 1, classificationId: 1 });
ClassificationFeedbackSchema.index({ tenantId: 1, veredicto: 1, createdAt: -1 });
