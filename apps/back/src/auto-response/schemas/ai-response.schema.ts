import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import type { AiResponseEstado } from '@tikora/core';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Source enriquecido del chunk citado por la respuesta IA. Subdocumento
 * embebido (sin _id propio); el `chunkId` referencia a `kb_chunks`.
 */
@Schema({ _id: false })
export class AiResponseSourceChunk {
  @Prop({ type: Types.ObjectId, ref: 'KbChunk', required: true })
  chunkId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KbDocument', required: true })
  documentId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'KbDocument', required: true })
  parentDocumentId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 0 })
  position!: number;

  /** Score de similitud devuelto por `$vectorSearch` (cosine, 0-1). */
  @Prop({ type: Number, required: true })
  score!: number;

  /** Descripción libre que devolvió el modelo en `usedFor`. */
  @Prop({ type: String, required: true })
  usedFor!: string;
}

export const AiResponseSourceChunkSchema = SchemaFactory.createForClass(AiResponseSourceChunk);

/**
 * Respuesta generada por la IA para un ticket. Una sola activa por
 * ticket: si se descarta, se puede generar una nueva. Inmutable salvo
 * por las transiciones explícitas del agente (aprobar / editar /
 * descartar / enviar).
 *
 * Match con `tikora-data-model.md` §3.12.
 */
@Schema({ collection: 'ai_responses', timestamps: true })
export class AiResponse {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', required: true })
  ticketId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: ['sugerida', 'aprobada', 'editada', 'enviada', 'descartada'],
  })
  estado!: AiResponseEstado;

  /**
   * `respondable: false` significa que el modelo determinó que la KB
   * no alcanza para responder con confianza. En ese caso `content` y
   * `originalAiContent` quedan `null` y `motivoNoRespondable` lleva
   * la justificación del modelo.
   */
  @Prop({ type: Boolean, required: true })
  respondable!: boolean;

  @Prop({ type: String, default: null })
  motivoNoRespondable!: string | null;

  /** Texto que la IA propuso. Nunca se sobreescribe — auditoría. */
  @Prop({ type: String, default: null })
  originalAiContent!: string | null;

  /**
   * Texto final enviado al usuario. Si la respuesta se aprobó sin
   * cambios coincide con `originalAiContent`; si se editó, refleja la
   * versión humana.
   */
  @Prop({ type: String, default: null })
  content!: string | null;

  /** Confianza reportada por el modelo (0-1). */
  @Prop({ type: Number, required: true })
  confianza!: number;

  @Prop({ type: [AiResponseSourceChunkSchema], default: [] })
  sourceChunks!: AiResponseSourceChunk[];

  // Trazabilidad del modelo + prompt
  @Prop({ type: String, required: true })
  modelo!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  @Prop({ type: Number, required: true })
  temperature!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensInput!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensInputCached!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensOutput!: number;

  @Prop({ type: Number, required: true, default: 0 })
  latencyMs!: number;

  // Acciones del agente (Fase 2). Cualquiera puede ser null si todavía
  // no ocurrió (estado=sugerida).
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  approvedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  approvedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  editedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  editedAt!: Date | null;

  /**
   * Resumen del diff entre `originalAiContent` y `content` cuando hubo
   * edición. Útil para reportes de "qué tanto está cambiando el agente
   * la salida del modelo" sin tener que re-diffear todo a posteriori.
   */
  @Prop({ type: String, default: null })
  diffSummary!: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  discardedBy!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  discardedAt!: Date | null;

  @Prop({ type: String, default: null })
  discardReason!: string | null;

  // Envío del correo (estado=enviada).
  @Prop({ type: Date, default: null })
  sentAt!: Date | null;

  @Prop({ type: String, default: null })
  emailMessageId!: string | null;

  /** Flag para Fase 3: si el solicitante reabre el ticket tras la auto-respuesta. */
  @Prop({ type: Boolean, default: false })
  reopenedAfterAutoResponse!: boolean;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type AiResponseDocument = HydratedDocument<AiResponse>;
export const AiResponseSchema = SchemaFactory.createForClass(AiResponse);

// Listado / detalle por ticket — el endpoint `GET /tickets/:id/ai-response`
// busca la última no descartada por aquí.
AiResponseSchema.index({ tenantId: 1, ticketId: 1, createdAt: -1 });
// Métricas y filtros operativos por estado.
AiResponseSchema.index({ tenantId: 1, estado: 1, createdAt: -1 });
// A/B de prompts y modelos a futuro.
AiResponseSchema.index({ tenantId: 1, modelo: 1, promptVersion: 1 });
