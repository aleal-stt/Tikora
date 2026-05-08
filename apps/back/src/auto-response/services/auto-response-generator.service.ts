import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { autoResponseOutputSchema, type AutoResponseOutput } from '@tikora/core';
import { Model, Types } from 'mongoose';
import { AiClientService } from '../../ai-client/services/ai-client.service';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  Classification,
  ClassificationDocument,
} from '../../classification/schemas/classification.schema';
import type { Env } from '../../config/env.schema';
import { KbSearchHit, KbSearchService } from '../../kb/services/kb-search.service';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import {
  AUTO_RESPONSE_EVENTS,
  AiResponseApprovedEvent,
  AiResponseFailedEvent,
  AiResponseSuggestedEvent,
} from '../events/auto-response-events';
import { buildResponseUserMessage, renderResponsePromptV1 } from '../prompts/response-prompt-v1';
import { AiResponse, AiResponseDocument } from '../schemas/ai-response.schema';
import { AutoResponseService } from './auto-response.service';

export interface GenerateOutcome {
  outcome:
    | 'suggested'
    | 'sent_autonomous'
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
    private readonly autoResponse: AutoResponseService,
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
      // Sin LLM client no podemos siquiera intentar — notificamos al
      // admin pero no persistimos AiResponse: no hay metadata útil
      // (sin model resuelto, sin KB hits, sin latencia) y la causa raíz
      // suele ser config (`LLM_API_KEY` faltante), no un error de la run.
      this.emitFailed(ticket, 'api_error', 'LLM client no inicializado.');
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
          tenantId: ticket.tenantId.toString(),
          ticketId: ticket._id.toString(),
          promptVersion,
          purpose: 'auto-response',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      // El AiClient lanza ApiException con `code: 'AI_OUTPUT_INVALID'`
      // cuando el schema no se cumple tras los reintentos correctivos
      // (→ validation_error) y `code: 'AI_API_ERROR'` cuando se agotan
      // los retries por errores transitorios (→ api_error). Cualquier
      // otra excepción cae en api_error por defecto.
      const reason: 'api_error' | 'validation_error' =
        this.errorCode(err) === 'AI_OUTPUT_INVALID' ? 'validation_error' : 'api_error';
      await this.persistFailure({
        ticket,
        hits,
        model,
        promptVersion,
        temperature,
        reason,
        detail: message,
      });
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

    // 6) Fase 3 — auto-envío autónomo. Si la confianza supera el umbral
    //    y la corrida no cae en el sampling de QA, saltamos directo a
    //    `enviada` sin pasar por aprobación humana. Si el delivery
    //    falla (correo caído, etc.), revertimos a `sugerida` para que
    //    un humano pueda aprobar manualmente — la red de seguridad
    //    descrita en `tikora-ia.md` §7.7.
    if (this.shouldAutoSend(parsed.confianza)) {
      const sent = await this.tryAutonomousDelivery(persisted, ticket);
      if (sent) {
        this.logger.log(
          `Auto-respuesta enviada autónomamente ticketId=${ticketOid.toString()} confianza=${parsed.confianza.toFixed(
            2,
          )} chunks=${hits.length}`,
        );
        return { outcome: 'sent_autonomous', aiResponseId: persisted._id.toString() };
      }
      // Delivery falló — el persisted ya quedó en `sugerida` (revert).
      // Caemos al path normal de Fase 2.
    }

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
   * `tikora-ia.md` §7.7 — auto-envío autónomo cuando se cumple:
   *   1. `AI_PHASE === 3`
   *   2. `confianza ≥ UMBRAL_AUTO_AUTONOMA`
   *   3. La corrida no cae en el sampling de QA (`AUTO_AUTONOMA_SAMPLE_RATE`)
   *
   * El sample rate dicta qué fracción de respuestas elegibles igual
   * pasan por humano para muestreo de calidad continuo. Sample = 0.1
   * → 10% pasa por humano, 90% se envía solo.
   */
  private shouldAutoSend(confianza: number): boolean {
    const phase = this.config.get('AI_PHASE', { infer: true });
    if (phase < 3) return false;
    const umbral = this.config.get('UMBRAL_AUTO_AUTONOMA', { infer: true });
    if (confianza < umbral) return false;
    const sampleRate = this.config.get('AUTO_AUTONOMA_SAMPLE_RATE', { infer: true });
    // `Math.random()` < sampleRate ⇒ el ticket cae en el sampling y NO
    // se auto-envía. El comportamiento es estadístico — los tests usan
    // `vi.spyOn(Math, 'random')` para hacerlo determinístico.
    if (Math.random() < sampleRate) return false;
    return true;
  }

  /**
   * Intenta el envío autónomo: marca la `AiResponse` como `aprobada`
   * por sistema y delega al `AutoResponseService.deliverAndClose`. Si
   * el delivery falla (sin requester, email caído), revertimos los
   * cambios para que la `AiResponse` vuelva a `sugerida` y el flujo
   * de Fase 2 pueda recogerla.
   */
  private async tryAutonomousDelivery(
    ai: AiResponseDocument,
    ticket: TicketDocument,
  ): Promise<boolean> {
    ai.estado = 'aprobada';
    ai.approvedBy = null;
    ai.approvedAt = new Date();
    ai.content = ai.originalAiContent;
    await ai.save();

    // Equivalente al `AiResponseApproved` que emite el flujo manual
    // — consumidores de métricas verán siempre el evento, con
    // `approvedBy: 'system'` distinguiendo el origen autónomo.
    this.events.emit(AUTO_RESPONSE_EVENTS.AiResponseApproved, {
      tenantId: ai.tenantId.toString(),
      ticketId: ai.ticketId.toString(),
      aiResponseId: ai._id.toString(),
      approvedBy: 'system',
      edited: false,
    } satisfies AiResponseApprovedEvent);

    const delivered = await this.autoResponse.deliverAndClose(ai, ticket, null, true);
    if (delivered) return true;

    // Revert para que la `AiResponse` vuelva a `sugerida` y el panel
    // de aprobación humana la levante. No tocamos `originalAiContent`
    // — sigue siendo la propuesta del modelo.
    ai.estado = 'sugerida';
    ai.approvedBy = null;
    ai.approvedAt = null;
    ai.content = null;
    await ai.save();
    this.logger.warn(`Auto-envío falló para ticketId=${ticket._id.toString()}, vuelve a sugerida.`);
    return false;
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

  /**
   * Devuelve el `code` estable de un error si viene de una `ApiException`
   * (formato `tikora-api.md` §1). Para cualquier otra cosa devuelve null —
   * el caller decide cómo clasificar.
   */
  private errorCode(err: unknown): string | null {
    if (err instanceof ApiException) {
      const body = err.getResponse();
      if (body && typeof body === 'object' && 'code' in body) {
        const code = (body as { code: unknown }).code;
        if (typeof code === 'string') return code;
      }
    }
    return null;
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

  /**
   * Persiste un `AiResponse` con `estado: 'fallida'` cuando agotamos
   * retries del LLM o el output sigue inválido tras los reintentos
   * correctivos. Sirve solo de auditoría: el ticket queda en `escalado`
   * y no es accionable desde el panel de "Sugerencia IA"
   * (`getCurrentForTicket` filtra `fallida`). Si por algo el insert mismo
   * falla, lo logueamos y seguimos — el evento `AiResponseFailed` igual
   * notifica al admin, así que la falla queda visible incluso sin doc.
   */
  private async persistFailure(args: {
    ticket: TicketDocument;
    hits: KbSearchHit[];
    model: string;
    promptVersion: string;
    temperature: number;
    reason: 'api_error' | 'validation_error';
    detail: string;
  }): Promise<void> {
    try {
      await this.aiResponseModel.create({
        tenantId: args.ticket.tenantId,
        ticketId: args.ticket._id as Types.ObjectId,
        estado: 'fallida',
        respondable: false,
        motivoNoRespondable: null,
        originalAiContent: null,
        content: null,
        confianza: 0,
        sourceChunks: this.toSourceChunks(args.hits, []),
        modelo: args.model,
        promptVersion: args.promptVersion,
        temperature: args.temperature,
        // Sin output: tokens y latencia son los del último intento perdido,
        // no los tenemos en la firma del catch (el AiClient no los expone
        // en el error). Quedan en 0 y el `failureDetail` lleva el mensaje.
        tokensInput: 0,
        tokensInputCached: 0,
        tokensOutput: 0,
        latencyMs: 0,
        failureReason: args.reason,
        failureDetail: args.detail,
      });
    } catch (err) {
      this.logger.error(
        `No se pudo persistir AiResponse fallida ticketId=${args.ticket._id.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
