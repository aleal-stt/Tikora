import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { KbScope } from '@tikora/core';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Chunk vectorizado de un documento de KB. Cada documento se parte en
 * varios chunks de 200-1000 tokens con overlap de ~100; cada chunk
 * persiste su propio embedding de 384 dims (multilingual-e5-small) y
 * espeja `scope`/`areaIds`/`active` del documento padre para que el
 * `$vectorSearch` pueda filtrar sin un `$lookup`.
 *
 * Match con `tikora-data-model.md` §3.11 y `tikora-embeddings.md` §8.1.
 *
 * Importante: las búsquedas vectoriales **siempre** llevan filtros
 * `tenantId` y `active: true` — están listados como filtros del índice
 * de Atlas y son obligatorios para que la query no exponga datos de otros
 * tenants ni de versiones obsoletas (ver `tikora-embeddings.md` §9.3).
 */
@Schema({ collection: 'kb_chunks', timestamps: { createdAt: true, updatedAt: false } })
export class KbChunk {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  /** Versión específica del documento al que pertenece el chunk. */
  @Prop({ type: Types.ObjectId, ref: 'KbDocument', required: true })
  documentId!: Types.ObjectId;

  /** Espejo del `parentDocumentId` del documento — facilita queries por "documento lógico". */
  @Prop({ type: Types.ObjectId, ref: 'KbDocument', required: true })
  parentDocumentId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  documentVersion!: number;

  /** Posición 0-based del chunk dentro del documento. Ordena el listado al rehidratar. */
  @Prop({ type: Number, required: true, min: 0 })
  position!: number;

  /** Texto del chunk SIN el prefijo `passage:` — el prefijo lo agrega el provider al embeber. */
  @Prop({ type: String, required: true })
  content!: string;

  /**
   * Vector denso de 384 floats normalizados (longitud 1). Sin él, el chunk
   * está incompleto y el cron de consistencia (Sprint Maintenance) lo
   * marca para reindex.
   */
  @Prop({ type: [Number], required: true })
  embedding!: number[];

  @Prop({ type: String, required: true, enum: ['global', 'area'] })
  scope!: KbScope;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Area' }], default: [] })
  areaIds!: Types.ObjectId[];

  @Prop({ type: Boolean, required: true, default: false })
  active!: boolean;

  /**
   * Tamaño del chunk en tokens según el tokenizer del modelo. Sirve para
   * diagnóstico (chunks demasiado chicos = chunker mal calibrado) y para
   * estimar costo de prompts en Sprint C (cuántos tokens inyectamos al LLM).
   */
  @Prop({ type: Number, required: true, min: 0 })
  tokensCount!: number;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type KbChunkDocument = HydratedDocument<KbChunk>;
export const KbChunkSchema = SchemaFactory.createForClass(KbChunk);

// Único: dos chunks no pueden tener la misma posición dentro de la misma
// versión de documento. Si el processor reintenta, este índice protege la
// idempotencia.
KbChunkSchema.index({ tenantId: 1, documentId: 1, position: 1 }, { unique: true });

// Filtro principal del listado / cleanup: chunks activos por documento lógico.
KbChunkSchema.index({ tenantId: 1, parentDocumentId: 1, active: 1 });

// Borrado por documento (al hard-delete del padre o reindex).
KbChunkSchema.index({ documentId: 1 });

// Cron de retención: barre chunks `active:false` con `createdAt` viejo.
KbChunkSchema.index({ active: 1, createdAt: 1 });
