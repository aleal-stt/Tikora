import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { autoResponseOutputSchema, type AutoResponseOutput } from '@tikora/core';
import { Model, Types } from 'mongoose';
import {
  AiClientService,
  AiClientUnavailableError,
} from '../../ai-client/services/ai-client.service';
import {
  Classification,
  ClassificationDocument,
} from '../../classification/schemas/classification.schema';
import type { Env } from '../../config/env.schema';
import { KbSearchHit, KbSearchService } from '../../kb/services/kb-search.service';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import {
  AUTO_RESPONSE_EVENTS,
  AiResponseFailedEvent,
  AiResponseSuggestedEvent,
} from '../events/auto-response-events';
import { buildResponseUserMessage, renderResponsePromptV1 } from '../prompts/response-prompt-v1';
import { AiResponse, AiResponseDocument } from '../schemas/ai-response.schema';

export interface GenerateOutcome {
  outcome:
    | 'suggested'
    | 'no_kb_match'
    | 'not_respondable'
    | 'api_error'
    | 'validation_error'
    | 'skipped';
  aiResponseId?: string;
}

/**
 * Orquestador de la generación de auto-respuesta. Match con
 * `tikora-ia.md` §7.2.
 *
 * Flujo:
 *
 *   1. Cargar ticket + classification.
 *   2. Buscar chunks relevantes en KB (`KbSearchService` ya filtra por
 *      umbral). Si vacío → `no_kb_match`, escalada normal.
 *   3. Armar user message con fragmentos numerados + system prompt.
 *   4. Llamar `aiClient.generateStructured(autoResponseOutputSchema)`.
 *   5. Persistir `AiResponse` con `estado:'sugerida'`.
 *   6. Emitir `AiResponseSuggested` (notifica agentes del área).
 *
 * Si el modelo devuelve `respondable:false`, persistimos igual el
 * documento (con `content:null` y `motivoNoRespondable`) pero **no**
 * lo dejamos en estado `sugerida` — emitimos `AiResponseFailed`
 * porque no hay nada que aprobar; el ticket sigue su flujo normal.
 */
@Injectable()
export class AutoResponseGeneratorService {
  private readonly logger = new Logger(AutoResponseGeneratorService.name);

  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Classification.name)
    private readonly classificationModel: Model<ClassificationDocument>,
    @InjectModel(AiResponse.name) private readonly aiResponseModel: Model<AiResponseDocument>,
    private readonly aiClient: AiClientService,
    private readonly kbSearch: KbSearchService,
    private readonly config: ConfigService<Env, true>,
    private readonly events: EventEmitter2,
  ) {}

  async generate(ticketId: string): Promise<GenerateOutcome> {
    const ticket = await this.ticketModel.findById(new Types.ObjectId(ticketId)).exec();
    if (!ticket) {
      this.logger.warn(`generate: ticket ${ticketId} no encontrado, ignorando job.`);
      return { outcome: 'skipped' };
    }
    if (!ticket.areaId) {
      // El ticket pasó el filtro de pre-condiciones (TicketClassified
      // implica área asignada), pero defensa por si alguien encoló a mano.
      this.logger.warn(`generate: ticket ${ticketId} sin areaId, no se puede buscar KB.`);
      return { outcome: 'skipped' };
    }
    if (!this.aiClient.isEnabled()) {
      this.logger.warn(`generate: AiClient deshabilitado, no genero auto-respuesta.`);
      return { outcome: 'api_error' };
    }

    // Tomamos la última classification del ticket (en MVP debería haber
    // exactamente una, pero por defensa ordenamos desc).
    const classification = await this.classificationModel
      .findOne({ ticketId: ticket._id })
      .sort({ createdAt: -1 })
      .exec();
    if (!classification) {
      this.logger.warn(`generate: ticket ${ticketId} sin classification, skip.`);
      return { outcome: 'skipped' };
    }

    // 2) Búsqueda KB — `KbSearchService` ya filtra por umbral.
    const hits = await this.kbSearch.search({
      tenantId: ticket.tenantId.toString(),
      areaId: ticket.areaId.toString(),
      query: `${ticket.asunto}\n\n${ticket.cuerpo}`,
    });
    if (hits.length === 0) {
      this.emitFailed(ticket, 'no_kb_match', null);
      return { outcome: 'no_kb_match' };
    }

    // 3) Armar prompt
    const userMessage = buildResponseUserMessage({
      asunto: ticket.asunto,
      cuerpo: ticket.cuerpo,
      fragments: hits.map((h, i) => ({
        index: i + 1,
        documentId: h.documentId,
        position: h.position,
        score: h.score,
        content: h.content,
      })),
    });

    const systemPrompt = renderResponsePromptV1();
    const promptVersion = this.config.get('RESPONSE_PROMPT_VERSION', { infer: true });
    const model = this.config.get('LLM_MODEL_RESPONSE', { infer: true });
    const temperature = this.config.get('LLM_TEMP_RESPONSE', { infer: true });
    const maxTokens = this.config.get('LLM_MAX_TOKENS_RESPONSE', { infer: true });
    const cacheEnabled = this.config.get('LLM_PROMPT_CACHE_ENABLED', { infer: true });

    // 4) Llamada al modelo
    let result;
    try {
      result = await this.aiClient.generateStructured<AutoResponseOutput>({
        model,
        systemPrompt,
        userMessage,
        maxTokens,
        temperature,
        cacheSystemPrompt: cacheEnabled,
        outputSchema: autoResponseOutputSchema,
        metadata: {
          ticketId: ticket._id.toString(),
          promptVersion,
          purpose: 'auto-response',
        },
      });
    } catch (err) {
      if (err instanceof AiClientUnavailableError) {
        this.emitFailed(ticket, 'api_error', err.message);
        return { outcome: 'api_error' };
      }
      const message = err instanceof Error ? err.message : String(err);
      // El AiClient lanza ApiException en errores de validación/transporte.
      // Distinguimos por nombre de clase de error.
      const reason = /AI_OUTPUT_INVALID/i.test(message) ? 'validation_error' : 'api_error';
      this.emitFailed(ticket, reason, message);
      this.logger.warn(`generate: error de AiClient ticketId=${ticket._id.toString()}: ${message}`);
      return { outcome: reason };
    }

    // 5) Persistir AiResponse
    const parsed = result.parsed;
    const tenantOid = ticket.tenantId;
    const ticketOid = ticket._id as Types.ObjectId;

    if (!parsed.respondable) {
      // El modelo determinó que no puede responder con la KB. Lo
      // registramos para auditoría pero no lo dejamos como `sugerida`
      // — no hay nada que un humano pueda aprobar.
      const persisted = await this.aiResponseModel.create({
        tenantId: tenantOid,
        ticketId: ticketOid,
        estado: 'descartada',
        respondable: false,
        motivoNoRespondable: parsed.motivo,
        originalAiContent: null,
        content: null,
        confianza: parsed.confianza,
        sourceChunks: this.toSourceChunks(hits, []),
        modelo: model,
        promptVersion,
        temperature,
        tokensInput: result.tokensInput,
        tokensInputCached: result.tokensInputCached,
        tokensOutput: result.tokensOutput,
        latencyMs: result.latencyMs,
      });
      this.emitFailed(ticket, 'not_respondable', parsed.motivo);
      return { outcome: 'not_respondable', aiResponseId: persisted._id.toString() };
    }

    const persisted = await this.aiResponseModel.create({
      tenantId: tenantOid,
      ticketId: ticketOid,
      estado: 'sugerida',
      respondable: true,
      motivoNoRespondable: null,
      originalAiContent: parsed.respuesta,
      content: null,
      confianza: parsed.confianza,
      sourceChunks: this.toSourceChunks(hits, parsed.sources),
      modelo: model,
      promptVersion,
      temperature,
      tokensInput: result.tokensInput,
      tokensInputCached: result.tokensInputCached,
      tokensOutput: result.tokensOutput,
      latencyMs: result.latencyMs,
    });

    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseSuggested, {
      tenantId: tenantOid.toString(),
      ticketId: ticketOid.toString(),
      aiResponseId: persisted._id.toString(),
      areaId: ticket.areaId.toString(),
      confianza: parsed.confianza,
    } satisfies AiResponseSuggestedEvent);

    this.logger.log(
      `Auto-respuesta sugerida ticketId=${ticketOid.toString()} confianza=${parsed.confianza.toFixed(
        2,
      )} chunks=${hits.length}`,
    );
    return { outcome: 'suggested', aiResponseId: persisted._id.toString() };
  }

  /**
   * Mapea los hits de la KB a la estructura embebida `AiResponse.sourceChunks`.
   * El argumento `modelSources` (lo que devolvió el LLM en `output.sources`)
   * contribuye el `usedFor` por cada chunk que el modelo citó. Si el modelo
   * no citó un chunk pero igual lo recuperamos, lo guardamos con `usedFor`
   * vacío — sigue siendo útil para auditoría ("la búsqueda lo encontró pero
   * el modelo no lo usó").
   */
  private toSourceChunks(
    hits: KbSearchHit[],
    modelSources: { chunkIndex: number; usedFor: string }[],
  ): {
    chunkId: Types.ObjectId;
    documentId: Types.ObjectId;
    parentDocumentId: Types.ObjectId;
    position: number;
    score: number;
    usedFor: string;
  }[] {
    const usedForByIndex = new Map(modelSources.map((s) => [s.chunkIndex, s.usedFor]));
    return hits.map((h, i) => ({
      chunkId: new Types.ObjectId(h.chunkId),
      documentId: new Types.ObjectId(h.documentId),
      parentDocumentId: new Types.ObjectId(h.parentDocumentId),
      position: h.position,
      score: h.score,
      usedFor: usedForByIndex.get(i + 1) ?? '',
    }));
  }

  private emitFailed(
    ticket: TicketDocument,
    reason: AiResponseFailedEvent['reason'],
    detail: string | null,
  ): void {
    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseFailed, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      reason,
      detail,
    } satisfies AiResponseFailedEvent);
  }
}
