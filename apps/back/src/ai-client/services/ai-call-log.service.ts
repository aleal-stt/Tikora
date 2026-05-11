import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  AiCallLog,
  AiCallLogDocument,
  AiCallOutcome,
  AiCallPurpose,
} from '../schemas/ai-call-log.schema';

export interface RecordCallParams {
  tenantId: string;
  ticketId: string | null;
  purpose: AiCallPurpose;
  modelo: string;
  promptVersion: string;
  temperature: number;
  maxTokens: number;
  tokensInput: number;
  tokensInputCached: number;
  tokensOutput: number;
  latencyMs: number;
  retries: number;
  outcome: AiCallOutcome;
  errorCode: string | null;
  errorMessage: string | null;
}

/**
 * Persistencia de `ai_call_logs`. Lo separamos del `AiClientService`
 * para que la lógica de la llamada al LLM no dependa del modelo
 * Mongoose: el client puede correr aún sin Mongo (tests unitarios) y
 * el log se silencia.
 *
 * Append-only — nunca actualiza ni borra. Si el insert falla, lo
 * logueamos a warn pero no propagamos: el caller no debe perder la
 * llamada al LLM solo porque el log de auditoría falló.
 */
@Injectable()
export class AiCallLogService {
  private readonly logger = new Logger(AiCallLogService.name);

  constructor(@InjectModel(AiCallLog.name) private readonly model: Model<AiCallLogDocument>) {}

  async record(params: RecordCallParams): Promise<void> {
    try {
      // `tenantId` siempre debe ser un ObjectId válido — si no lo es,
      // hay un bug aguas arriba y queremos que el try/catch lo capture.
      // `ticketId` sí puede ser null (llamadas sin ticket asociado).
      await this.model.create({
        tenantId: new Types.ObjectId(params.tenantId),
        ticketId: params.ticketId ? this.toOidOrNull(params.ticketId) : null,
        purpose: params.purpose,
        modelo: params.modelo,
        promptVersion: params.promptVersion,
        temperature: params.temperature,
        maxTokens: params.maxTokens,
        tokensInput: params.tokensInput,
        tokensInputCached: params.tokensInputCached,
        tokensOutput: params.tokensOutput,
        latencyMs: params.latencyMs,
        retries: params.retries,
        outcome: params.outcome,
        errorCode: params.errorCode,
        errorMessage: params.errorMessage ? this.truncate(params.errorMessage, 1000) : null,
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo persistir ai_call_log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private toOidOrNull(id: string): Types.ObjectId | null {
    try {
      return new Types.ObjectId(id);
    } catch {
      return null;
    }
  }

  private truncate(text: string, max: number): string {
    return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
  }
}
