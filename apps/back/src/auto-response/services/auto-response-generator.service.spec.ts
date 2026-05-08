import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import { AiClientUnavailableError } from '../../ai-client/services/ai-client.service';
import { AutoResponseGeneratorService } from './auto-response-generator.service';

const TENANT = new Types.ObjectId();
const AREA = new Types.ObjectId();

function buildTicket() {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT,
    areaId: AREA,
    asunto: 'Consulta',
    cuerpo: 'Texto del ticket',
  };
}

function buildClassification(ticketId: Types.ObjectId) {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT,
    ticketId,
    confianza: 0.9,
  };
}

function buildHit(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chunkId: new Types.ObjectId().toString(),
    documentId: new Types.ObjectId().toString(),
    parentDocumentId: new Types.ObjectId().toString(),
    documentVersion: 1,
    position: 0,
    content: 'Contenido del chunk',
    score: 0.9,
    documentTitle: 'Doc',
    scope: 'global' as const,
    ...overrides,
  };
}

interface ConfigDefaults {
  RESPONSE_PROMPT_VERSION: string;
  LLM_MODEL_RESPONSE: string;
  LLM_TEMP_RESPONSE: number;
  LLM_MAX_TOKENS_RESPONSE: number;
  LLM_PROMPT_CACHE_ENABLED: boolean;
  AI_PHASE: number;
  UMBRAL_AUTO_AUTONOMA: number;
  AUTO_AUTONOMA_SAMPLE_RATE: number;
}

interface HarnessOpts {
  ticket?: ReturnType<typeof buildTicket> | null;
  classification?: ReturnType<typeof buildClassification> | null;
  hits?: ReturnType<typeof buildHit>[];
  aiClient?: { isEnabled: boolean; throwError?: Error };
  configOverrides?: Partial<ConfigDefaults>;
  /** Confianza que devuelve el modelo en su salida estructurada. */
  confianza?: number;
  /** Si el delivery autónomo debe simular éxito o falla. Default true. */
  deliveryOk?: boolean;
}

function buildHarness(opts: HarnessOpts = {}) {
  const ticketModel = {
    findById: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket === undefined ? buildTicket() : opts.ticket),
    })),
  };

  const classificationModel = {
    findOne: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue(
          opts.classification === undefined
            ? buildClassification(new Types.ObjectId())
            : opts.classification,
        ),
    })),
  };

  // Cada doc creado lleva su propio `save` para que el flujo Fase 3
  // pueda mutar `estado`/`content` y persistir sin romper.
  const created: Array<Record<string, unknown> & { save: ReturnType<typeof vi.fn> }> = [];
  const aiResponseModel = {
    create: vi.fn(async (doc: Record<string, unknown>) => {
      const save = vi.fn().mockImplementation(async function (this: unknown) {
        return this;
      });
      const persisted = { ...doc, _id: new Types.ObjectId(), save };
      created.push(persisted);
      return persisted;
    }),
  };

  const aiClient = {
    isEnabled: vi.fn().mockReturnValue(opts.aiClient?.isEnabled ?? true),
    generateStructured: opts.aiClient?.throwError
      ? vi.fn().mockRejectedValue(opts.aiClient.throwError)
      : vi.fn().mockResolvedValue({
          parsed: {
            respondable: true,
            respuesta: 'Hola',
            confianza: opts.confianza ?? 0.9,
            sources: [{ chunkIndex: 1, usedFor: 'cita' }],
          },
          tokensInput: 100,
          tokensInputCached: 0,
          tokensOutput: 50,
          latencyMs: 800,
          retries: 0,
        }),
  };

  const kbSearch = {
    search: vi.fn().mockResolvedValue(opts.hits ?? [buildHit()]),
  };

  const defaults: ConfigDefaults = {
    RESPONSE_PROMPT_VERSION: 'v1',
    LLM_MODEL_RESPONSE: 'gemini-2.5-flash',
    LLM_TEMP_RESPONSE: 0.3,
    LLM_MAX_TOKENS_RESPONSE: 4096,
    LLM_PROMPT_CACHE_ENABLED: false,
    AI_PHASE: 2,
    UMBRAL_AUTO_AUTONOMA: 0.9,
    AUTO_AUTONOMA_SAMPLE_RATE: 0.1,
  };
  const merged: ConfigDefaults = { ...defaults, ...opts.configOverrides };
  const config = {
    get: vi.fn((key: keyof ConfigDefaults) => merged[key]),
  };

  const events = { emit: vi.fn() };

  const autoResponse = {
    deliverAndClose: vi.fn().mockResolvedValue(opts.deliveryOk ?? true),
  };

  const service = new AutoResponseGeneratorService(
    ticketModel as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[0],
    classificationModel as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[1],
    aiResponseModel as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[2],
    aiClient as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[3],
    kbSearch as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[4],
    config as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[5],
    events as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[6],
    autoResponse as unknown as ConstructorParameters<typeof AutoResponseGeneratorService>[7],
  );

  return {
    service,
    ticketModel,
    classificationModel,
    aiResponseModel,
    aiClient,
    events,
    created,
    autoResponse,
  };
}

describe('AutoResponseGeneratorService — failure persistence', () => {
  it('persiste AiResponse con estado=fallida y emite AiResponseFailed cuando se agotan los retries (api_error)', async () => {
    const ticket = buildTicket();
    const apiError = new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_API_ERROR',
      'No se pudo contactar al modelo de IA.',
    );
    const { service, aiResponseModel, events, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      aiClient: { isEnabled: true, throwError: apiError },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('api_error');
    expect(aiResponseModel.create).toHaveBeenCalledTimes(1);
    const persisted = created[0];
    expect(persisted?.estado).toBe('fallida');
    expect(persisted?.failureReason).toBe('api_error');
    expect(persisted?.failureDetail).toContain('No se pudo contactar');
    expect(persisted?.respondable).toBe(false);
    expect(persisted?.originalAiContent).toBeNull();
    // Mantenemos los chunks recuperados para auditoría — la búsqueda
    // no fue lo que falló, fue la llamada al LLM.
    const sourceChunks = persisted?.sourceChunks as Array<unknown>;
    expect(Array.isArray(sourceChunks)).toBe(true);
    expect(sourceChunks.length).toBeGreaterThan(0);

    const failedEmit = events.emit.mock.calls.find((c) => c[0] === 'AiResponseFailed');
    expect(failedEmit).toBeDefined();
    expect(failedEmit?.[1]).toMatchObject({ reason: 'api_error' });
  });

  it('persiste con failureReason=validation_error cuando el output queda fuera de schema tras retries', async () => {
    const ticket = buildTicket();
    const validationError = new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AI_OUTPUT_INVALID',
      'La salida del modelo no respetó el schema esperado.',
    );
    const { service, aiResponseModel, events, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      aiClient: { isEnabled: true, throwError: validationError },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('validation_error');
    expect(aiResponseModel.create).toHaveBeenCalledTimes(1);
    expect(created[0]?.estado).toBe('fallida');
    expect(created[0]?.failureReason).toBe('validation_error');

    const failedEmit = events.emit.mock.calls.find((c) => c[0] === 'AiResponseFailed');
    expect(failedEmit?.[1]).toMatchObject({ reason: 'validation_error' });
  });

  it('cuando AiClient queda deshabilitado no busca KB ni persiste — el job sale temprano', async () => {
    const ticket = buildTicket();
    const { service, aiResponseModel, events } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      aiClient: { isEnabled: false },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('api_error');
    // No persistimos doc — no llegamos a tener ni KB ni intento de llamada.
    // El admin igual queda enterado vía el evento.
    expect(aiResponseModel.create).not.toHaveBeenCalled();
    const failedEmit = events.emit.mock.calls.find((c) => c[0] === 'AiResponseFailed');
    expect(failedEmit?.[1]).toMatchObject({ reason: 'api_error' });
  });

  it('clasifica AiClientUnavailableError lanzado en mitad del flujo como api_error y persiste', async () => {
    const ticket = buildTicket();
    const { service, aiResponseModel, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      aiClient: {
        isEnabled: true,
        throwError: new AiClientUnavailableError('LLM client no inicializado.'),
      },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('api_error');
    expect(aiResponseModel.create).toHaveBeenCalledTimes(1);
    expect(created[0]?.failureReason).toBe('api_error');
  });
});

describe('AutoResponseGeneratorService — Fase 3 (auto-envío autónomo)', () => {
  beforeEach(() => {
    // Por default, fuera de sampling (random alto) — los tests que
    // necesiten el sampling lo overridean explícitamente.
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('envía autónomamente cuando AI_PHASE=3, confianza ≥ umbral y no cae en sampling', async () => {
    const ticket = buildTicket();
    const { service, autoResponse, events, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      confianza: 0.95,
      configOverrides: { AI_PHASE: 3, UMBRAL_AUTO_AUTONOMA: 0.9 },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('sent_autonomous');
    // El AiResponse pasó por aprobada antes del delivery.
    expect(created[0]?.estado).toBe('aprobada');
    expect(created[0]?.content).toBe('Hola');
    expect(autoResponse.deliverAndClose).toHaveBeenCalledTimes(1);
    expect(autoResponse.deliverAndClose).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      null,
      true,
    );
    // Evento de aprobación con approvedBy='system' para distinguir origen.
    const approved = events.emit.mock.calls.find((c) => c[0] === 'AiResponseApproved');
    expect(approved?.[1]).toMatchObject({ approvedBy: 'system', edited: false });
    // El path autónomo NO emite AiResponseSuggested — eso es solo
    // cuando queda como pendiente de revisión humana.
    const suggested = events.emit.mock.calls.find((c) => c[0] === 'AiResponseSuggested');
    expect(suggested).toBeUndefined();
  });

  it('cae en sampling de QA y deja la respuesta como sugerida (red de seguridad)', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0); // siempre cae en sampling
    const ticket = buildTicket();
    const { service, autoResponse, events, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      confianza: 0.95,
      configOverrides: {
        AI_PHASE: 3,
        UMBRAL_AUTO_AUTONOMA: 0.9,
        AUTO_AUTONOMA_SAMPLE_RATE: 0.1,
      },
    });

    const result = await service.generate(ticket._id.toString());

    expect(result.outcome).toBe('suggested');
    expect(autoResponse.deliverAndClose).not.toHaveBeenCalled();
    expect(created[0]?.estado).toBe('sugerida');
    const suggested = events.emit.mock.calls.find((c) => c[0] === 'AiResponseSuggested');
    expect(suggested).toBeDefined();
  });

  it('confianza por debajo del umbral autónomo deja la respuesta como sugerida', async () => {
    const ticket = buildTicket();
    const { service, autoResponse, created } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      confianza: 0.85,
      configOverrides: { AI_PHASE: 3, UMBRAL_AUTO_AUTONOMA: 0.9 },
    });

    const result = await service.generate(ticket._id.toString());
    expect(result.outcome).toBe('suggested');
    expect(autoResponse.deliverAndClose).not.toHaveBeenCalled();
    expect(created[0]?.estado).toBe('sugerida');
  });

  it('en AI_PHASE=2 nunca auto-envía aunque la confianza supere el umbral', async () => {
    const ticket = buildTicket();
    const { service, autoResponse } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      confianza: 0.99,
      configOverrides: { AI_PHASE: 2, UMBRAL_AUTO_AUTONOMA: 0.9 },
    });

    const result = await service.generate(ticket._id.toString());
    expect(result.outcome).toBe('suggested');
    expect(autoResponse.deliverAndClose).not.toHaveBeenCalled();
  });

  it('si el delivery autónomo falla, revierte a sugerida (red de seguridad)', async () => {
    const ticket = buildTicket();
    const { service, autoResponse, created, events } = buildHarness({
      ticket,
      classification: buildClassification(ticket._id),
      confianza: 0.95,
      configOverrides: { AI_PHASE: 3, UMBRAL_AUTO_AUTONOMA: 0.9 },
      deliveryOk: false,
    });

    const result = await service.generate(ticket._id.toString());
    expect(result.outcome).toBe('suggested');
    expect(autoResponse.deliverAndClose).toHaveBeenCalledTimes(1);
    expect(created[0]?.estado).toBe('sugerida');
    expect(created[0]?.content).toBeNull();
    // El humano todavía debe poder verla — emitimos AiResponseSuggested.
    const suggested = events.emit.mock.calls.find((c) => c[0] === 'AiResponseSuggested');
    expect(suggested).toBeDefined();
  });
});
