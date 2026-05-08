import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { KbScope } from '@tikora/core';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Documento de la base de conocimiento. Cada edición crea una **versión
 * nueva** que comparte `parentDocumentId` con la anterior — así el
 * "documento" desde el punto de vista del usuario es el conjunto de
 * versiones agrupadas por `parentDocumentId`. Solo una versión puede
 * estar `active: true` a la vez (controlado en el processor de
 * indexación al hacer el swap atómico).
 *
 * Match con `tikora-data-model.md` §3.10.
 */
@Schema({ collection: 'kb_documents', timestamps: true })
export class KbDocument {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  title!: string;

  @Prop({ type: String, required: true })
  content!: string;

  @Prop({ type: String, required: true, enum: ['global', 'area'] })
  scope!: KbScope;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Area' }], default: [] })
  areaIds!: Types.ObjectId[];

  @Prop({ type: Number, required: true, min: 1 })
  version!: number;

  @Prop({ type: Boolean, required: true, default: false })
  active!: boolean;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  uploadedBy!: Types.ObjectId;

  /**
   * Apunta al `_id` del primer documento de la cadena de versiones. La v1
   * tiene `parentDocumentId === _id` (se setea post-insert). Permite
   * agrupar versiones sin tener que mantener un mapa aparte.
   */
  @Prop({ type: Types.ObjectId, ref: 'KbDocument', required: true, index: true })
  parentDocumentId!: Types.ObjectId;

  @Prop({ type: Date, default: null })
  deletedAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type KbDocumentDocument = HydratedDocument<KbDocument>;
export const KbDocumentSchema = SchemaFactory.createForClass(KbDocument);

// Listar versiones de un documento lógico ordenadas de más nueva a más vieja.
KbDocumentSchema.index({ tenantId: 1, parentDocumentId: 1, version: -1 });
// Listado por scope/áreas activos del tenant — pivote del listado paginado.
KbDocumentSchema.index({ tenantId: 1, scope: 1, areaIds: 1, active: 1 });
// Soft-delete: filtrar lo "no borrado" con un compuesto que aproveche el
// patrón `deletedAt: null`.
KbDocumentSchema.index({ tenantId: 1, deletedAt: 1 });
