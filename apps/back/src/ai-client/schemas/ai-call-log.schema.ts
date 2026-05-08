import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AiCallPurpose = 'classification' | 'auto-response' | 'review';
export type AiCallOutcome = 'ok' | 'validation_failure' | 'api_error';

/**
 * Log estructurado de cada llamada al LLM.
 *
 * Match con `tikora-data-model.md` §3.16. La colección es **append-only**:
 * cada llamada genera un documento, no se actualizan ni borran. Sirve a
 * dos propósitos:
 *
 * 1. Auditoría: poder reconstruir qué pasó cuando un admin investiga una
 *    falla. El `errorMessage` y `outcome` cuentan la historia incluso
 *    cuando el `AiResponse` no se persistió.
 * 2. Costos / observabilidad: tokens, latencia y retries por tenant para
 *    proyectar consumo.
 *
 * No persistimos prompt ni respuesta completos — el doc de modelo dice
 * que vivirían en logs `debug` por volumen. Si en el futuro se necesita
 * trazabilidad granular, los `promptHash`/`responseHash` permiten
 * correlacionar con el log file por sha256.
 */
@Schema({ collection: 'ai_call_logs', timestamps: { createdAt: true, updatedAt: false } })
export class AiCallLog {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', default: null })
  ticketId!: Types.ObjectId | null;

  @Prop({
    type: String,
    required: true,
    enum: ['classification', 'auto-response', 'review'],
  })
  purpose!: AiCallPurpose;

  @Prop({ type: String, required: true })
  modelo!: string;

  @Prop({ type: String, required: true })
  promptVersion!: string;

  @Prop({ type: Number, required: true })
  temperature!: number;

  @Prop({ type: Number, required: true })
  maxTokens!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensInput!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensInputCached!: number;

  @Prop({ type: Number, required: true, default: 0 })
  tokensOutput!: number;

  @Prop({ type: Number, required: true, default: 0 })
  latencyMs!: number;

  @Prop({ type: Number, required: true, default: 0 })
  retries!: number;

  @Prop({
    type: String,
    required: true,
    enum: ['ok', 'validation_failure', 'api_error'],
  })
  outcome!: AiCallOutcome;

  /**
   * Code estable cuando hay error (ApiException.code, AiClientUnavailableError, etc.).
   * Null cuando outcome=ok.
   */
  @Prop({ type: String, default: null })
  errorCode!: string | null;

  @Prop({ type: String, default: null })
  errorMessage!: string | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type AiCallLogDocument = HydratedDocument<AiCallLog>;
export const AiCallLogSchema = SchemaFactory.createForClass(AiCallLog);

// Listado por tenant + tiempo (operativo).
AiCallLogSchema.index({ tenantId: 1, createdAt: -1 });
// Filtrado por purpose+outcome (cuántos validation_failures de classification, etc).
AiCallLogSchema.index({ tenantId: 1, purpose: 1, outcome: 1, createdAt: -1 });
// Búsqueda por ticket — útil al investigar un caso puntual.
AiCallLogSchema.index({ tenantId: 1, ticketId: 1 });
