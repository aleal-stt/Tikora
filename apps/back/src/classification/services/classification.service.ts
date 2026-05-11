import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { classificationOutputSchema, type ClassificationOutput } from '@tikora/core';
import { Model, Types } from 'mongoose';
import {
  AiClientService,
  AiClientUnavailableError,
} from '../../ai-client/services/ai-client.service';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import { BusinessHoursService } from '../../common/business-hours.service';
import type { Env } from '../../config/env.schema';
import { InteractionsService } from '../../interactions/services/interactions.service';
import {
  NOTIFICATION_EVENTS,
  TicketClassifiedEvent,
  TicketRequiresClassificationReviewEvent,
} from '../../notifications/events/notification-events';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import { calculateSlaDeadline } from '../../tickets/tickets.sla';
import { renderClassificationPromptV1 } from '../prompts/classification-prompt-v1';
import {
  Classification,
  ClassificationDocument,
  ClassificationOutcome,
} from '../schemas/classification.schema';

const MIN_CONTENT_CHARS = 10;

interface ClassifyResult {
  outcome: ClassificationOutcome;
  finalEstado: 'escalado' | 'requiere_revision_clasificacion';
}

/**
 * Orquestador del pipeline de clasificación. Lo invoca el processor
 * BullMQ por cada ticket nuevo. Cualquier rama de error termina con un
 * documento `Classification` persistido + el ticket en
 * `requiere_revision_clasificacion` (fallback humano según `tikora-ia.md` §5.6).
 */
@Injectable()
export class ClassificationService {
  private readonly logger = new Logger(ClassificationService.name);

  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(Classification.name)
    private readonly classificationModel: Model<ClassificationDocument>,
    private readonly aiClient: AiClientService,
    private readonly config: ConfigService<Env, true>,
    private readonly businessHours: BusinessHoursService,
    @Inject(forwardRef(() => InteractionsService))
    private readonly interactions: InteractionsService,
    private readonly events: EventEmitter2,
  ) {}

  async classify(ticketId: string): Promise<ClassifyResult> {
    const ticket = await this.ticketModel.findById(new Types.ObjectId(ticketId)).exec();
    if (!ticket) {
      // El ticket pudo haberse cancelado entre el encolado y el job; no
      // hay nada que clasificar. No persistimos Classification (sin ticketId
      // válido al cual atar la auditoría).
      this.logger.warn(`classify: ticket ${ticketId} no encontrado, ignorando job.`);
      return { outcome: 'api_error', finalEstado: 'requiere_revision_clasificacion' };
    }

    if (ticket.estado !== 'recibido') {
      // Doble-encolado o cambio de estado mientras el job esperaba: no
      // re-clasificamos un ticket ya transicionado.
      this.logger.warn(
        `classify: ticket ${ticketId} en estado ${ticket.estado}, no se reclasifica.`,
      );
      return { outcome: 'api_error', finalEstado: 'requiere_revision_clasificacion' };
    }

    if (ticket.cuerpo.trim().length < MIN_CONTENT_CHARS) {
      return this.persistAndFallback(ticket, {
        outcome: 'content_insufficient',
        outcomeDetail: 'El cuerpo del ticket es demasiado corto.',
      });
    }

    if (!this.aiClient.isEnabled()) {
      return this.persistAndFallback(ticket, {
        outcome: 'api_error',
        outcomeDetail: 'AiClient deshabilitado (sin API key).',
      });
    }

    const areas = await this.areaModel.find({ tenantId: ticket.tenantId, active: true }).exec();
    if (areas.length === 0) {
      return this.persistAndFallback(ticket, {
        outcome: 'invalid_area',
        outcomeDetail: 'No hay áreas activas configuradas en el tenant.',
      });
    }

    const promptVersion = this.config.get('CLASSIFICATION_PROMPT_VERSION', { infer: true });
    const model = this.config.get('LLM_MODEL_CLASSIFICATION', { infer: true });
    const temperature = this.config.get('LLM_TEMP_CLASSIFICATION', { infer: true });
    const maxTokens = this.config.get('LLM_MAX_TOKENS_CLASSIFICATION', { infer: true });
    const cacheEnabled = this.config.get('LLM_PROMPT_CACHE_ENABLED', { infer: true });

    const systemPrompt = renderClassificationPromptV1(
      areas.map((a) => ({
        id: a._id.toString(),
        name: a.name,
        description: a.description,
      })),
    );

    try {
      const result = await this.aiClient.generateStructured<ClassificationOutput>({
        model,
        systemPrompt,
        userMessage: this.buildUserMessage(ticket),
        maxTokens,
        temperature,
        cacheSystemPrompt: cacheEnabled,
        outputSchema: classificationOutputSchema,
        metadata: {
          tenantId: ticket.tenantId.toString(),
          ticketId: ticket._id.toString(),
          promptVersion,
          purpose: 'classification',
        },
      });

      const normalized = this.normalize(result.parsed);
      const targetArea = areas.find((a) => a._id.toString() === normalized.area);

      if (!targetArea) {
        return this.persistAndFallback(ticket, {
          outcome: 'invalid_area',
          outcomeDetail: `Área devuelta por la IA no existe: ${normalized.area}`,
          aiOutput: normalized,
          modelo: model,
          promptVersion,
          temperature,
          tokens: result,
        });
      }

      const umbral = this.config.get('UMBRAL_CONFIANZA_CLASIFICACION', { infer: true });
      if (normalized.confianza < umbral) {
        return this.persistAndFallback(ticket, {
          outcome: 'low_confidence',
          outcomeDetail: `Confianza ${normalized.confianza.toFixed(2)} < umbral ${umbral}`,
          aiOutput: normalized,
          modelo: model,
          promptVersion,
          temperature,
          tokens: result,
        });
      }

      // Camino feliz: confianza alta + área válida.
      const classification = await this.classificationModel.create({
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
        area: normalized.area,
        prioridad: normalized.prioridad,
        confianza: normalized.confianza,
        resumen: normalized.resumen,
        tags: normalized.tags,
        modelo: model,
        promptVersion,
        temperature,
        tokensInput: result.tokensInput,
        tokensInputCached: result.tokensInputCached,
        tokensOutput: result.tokensOutput,
        latencyMs: result.latencyMs,
        retries: result.retries,
        outcome: 'ok',
        outcomeDetail: null,
      });

      ticket.estado = 'clasificado';
      ticket.areaId = targetArea._id;
      ticket.prioridad = normalized.prioridad;
      ticket.tags = Array.from(new Set([...ticket.tags, ...normalized.tags]));
      const slaOpts = await this.businessHours.getOptsForTenant(ticket.tenantId);
      ticket.slaDeadline = calculateSlaDeadline(normalized.prioridad, targetArea.slas, slaOpts);
      await ticket.save();

      ticket.estado = 'escalado';
      await ticket.save();

      await this.emitClassifiedEvent(ticket, {
        outcome: 'ok',
        confianza: normalized.confianza,
        toEstado: 'escalado',
        areaName: targetArea.name,
      });

      this.events.emit(NOTIFICATION_EVENTS.TicketClassified, {
        tenantId: ticket.tenantId.toString(),
        ticketId: ticket._id.toString(),
        classificationId: classification._id.toString(),
        areaId: targetArea._id.toString(),
        prioridad: normalized.prioridad,
        confianza: normalized.confianza,
        resumen: normalized.resumen,
        tags: normalized.tags,
        modelo: model,
        promptVersion,
      } satisfies TicketClassifiedEvent);

      return { outcome: 'ok', finalEstado: 'escalado' };
    } catch (err) {
      if (err instanceof AiClientUnavailableError) {
        return this.persistAndFallback(ticket, {
          outcome: 'api_error',
          outcomeDetail: 'AiClient no disponible.',
        });
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(`classify: error IA para ticketId=${ticketId}: ${message}`);
      return this.persistAndFallback(ticket, {
        outcome: this.outcomeFromError(err),
        outcomeDetail: message,
      });
    }
  }

  // -------- helpers --------

  private buildUserMessage(ticket: TicketDocument): string {
    return `Asunto: ${ticket.asunto}\n\nCuerpo:\n${ticket.cuerpo}`;
  }

  private normalize(output: ClassificationOutput): ClassificationOutput {
    return {
      ...output,
      tags: Array.from(
        new Set(output.tags.map((t) => t.trim().toLowerCase()).filter(Boolean)),
      ).slice(0, 5),
    };
  }

  private outcomeFromError(err: unknown): ClassificationOutcome {
    if (err && typeof err === 'object' && 'getResponse' in err) {
      const body = (err as { getResponse: () => unknown }).getResponse();
      if (body && typeof body === 'object' && 'code' in body) {
        const code = (body as { code: string }).code;
        if (code === 'AI_OUTPUT_INVALID') return 'validation_failure';
        if (code === 'AI_API_ERROR') return 'api_error';
      }
    }
    return 'api_error';
  }

  /**
   * Persiste un `Classification` con el outcome dado y transiciona el
   * ticket a `requiere_revision_clasificacion`. Centraliza la rama de
   * fallback para que cada error tenga un audit trail consistente.
   */
  private async persistAndFallback(
    ticket: TicketDocument,
    args: {
      outcome: ClassificationOutcome;
      outcomeDetail: string;
      aiOutput?: ClassificationOutput;
      modelo?: string;
      promptVersion?: string;
      temperature?: number;
      tokens?: {
        tokensInput: number;
        tokensInputCached: number;
        tokensOutput: number;
        latencyMs: number;
        retries: number;
      };
    },
  ): Promise<ClassifyResult> {
    const promptVersion =
      args.promptVersion ?? this.config.get('CLASSIFICATION_PROMPT_VERSION', { infer: true });
    const modelo = args.modelo ?? this.config.get('LLM_MODEL_CLASSIFICATION', { infer: true });
    const temperature =
      args.temperature ?? this.config.get('LLM_TEMP_CLASSIFICATION', { infer: true });

    await this.classificationModel.create({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      area: args.aiOutput?.area ?? '',
      prioridad: args.aiOutput?.prioridad ?? 'media',
      confianza: args.aiOutput?.confianza ?? 0,
      resumen: args.aiOutput?.resumen ?? '',
      tags: args.aiOutput?.tags ?? [],
      modelo,
      promptVersion,
      temperature,
      tokensInput: args.tokens?.tokensInput ?? 0,
      tokensInputCached: args.tokens?.tokensInputCached ?? 0,
      tokensOutput: args.tokens?.tokensOutput ?? 0,
      latencyMs: args.tokens?.latencyMs ?? 0,
      retries: args.tokens?.retries ?? 0,
      outcome: args.outcome,
      outcomeDetail: args.outcomeDetail,
    });

    ticket.estado = 'requiere_revision_clasificacion';
    await ticket.save();

    await this.emitClassifiedEvent(ticket, {
      outcome: args.outcome,
      confianza: args.aiOutput?.confianza ?? null,
      toEstado: 'requiere_revision_clasificacion',
    });

    this.events.emit(NOTIFICATION_EVENTS.TicketRequiresClassificationReview, {
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      suggestedAreaId: args.aiOutput?.area ?? null,
      outcome: args.outcome,
      outcomeDetail: args.outcomeDetail,
    } satisfies TicketRequiresClassificationReviewEvent);

    return { outcome: args.outcome, finalEstado: 'requiere_revision_clasificacion' };
  }

  private async emitClassifiedEvent(
    ticket: TicketDocument,
    extra: {
      outcome: string;
      confianza: number | null;
      toEstado: string;
      /** Nombre del área asignada — solo presente en el happy path. */
      areaName?: string;
    },
  ): Promise<void> {
    try {
      await this.interactions.appendSystemEvent({
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
        eventName: 'TicketClassifiedByAi',
        fromEstado: 'recibido',
        toEstado: extra.toEstado,
        extra: {
          outcome: extra.outcome,
          confianza: extra.confianza,
          ...(extra.areaName ? { areaName: extra.areaName } : {}),
        },
        content: this.buildEventContent(extra.outcome, extra.toEstado, extra.areaName),
      });
    } catch (err) {
      this.logger.warn(
        `No se pudo emitir interaction TicketClassifiedByAi para ticketId=${ticket._id.toString()}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private buildEventContent(outcome: string, toEstado: string, areaName?: string): string {
    if (outcome === 'ok') {
      // Si llegamos al happy path siempre tenemos `areaName`. Defensivo
      // por si un caller futuro emite `ok` sin pasarlo: caemos al texto
      // genérico anterior.
      return areaName
        ? `IA clasificó el ticket y lo escaló al área "${areaName}".`
        : 'IA clasificó el ticket y lo escaló al área correspondiente.';
    }
    if (outcome === 'low_confidence')
      return 'IA tuvo baja confianza — el ticket espera revisión humana.';
    if (outcome === 'invalid_area')
      return 'IA devolvió un área inválida — el ticket espera revisión humana.';
    if (outcome === 'content_insufficient')
      return 'El cuerpo es demasiado corto para clasificar — revisión humana.';
    if (outcome === 'validation_failure')
      return 'IA devolvió un output mal formado — revisión humana.';
    return `IA no disponible — revisión humana (estado final: ${toEstado}).`;
  }
}
