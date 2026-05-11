import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AiClientUnavailableError } from '../../ai-client/services/ai-client.service';
import { ApiException } from '../../common/exceptions/api.exception';
import { HttpStatus } from '@nestjs/common';
import { ClassificationService } from './classification.service';

const TENANT_ID = new Types.ObjectId();

interface FakeTicket {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  estado: string;
  cuerpo: string;
  asunto: string;
  prioridad: string | null;
  areaId: Types.ObjectId | null;
  tags: string[];
  slaDeadline: Date | null;
  save: ReturnType<typeof vi.fn>;
}

interface FakeArea {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  active: boolean;
  name: string;
  description: string;
  slas: { alta: number; media: number; baja: number };
}

function buildTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  const doc: FakeTicket = {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    estado: 'recibido',
    cuerpo: 'Tengo un problema con mi VPN, no puedo conectarme.',
    asunto: 'VPN no conecta',
    prioridad: null,
    areaId: null,
    tags: [],
    slaDeadline: null,
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function buildArea(overrides: Partial<FakeArea> = {}): FakeArea {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    active: true,
    name: 'Soporte TI',
    description: 'Tickets de hardware, software, accesos.',
    slas: { alta: 4, media: 24, baja: 48 },
    ...overrides,
  };
}

interface HarnessOpts {
  ticket?: FakeTicket | null;
  areas?: FakeArea[];
  aiEnabled?: boolean;
  aiResponse?:
    | {
        parsed: {
          area: string;
          prioridad: 'alta' | 'media' | 'baja';
          confianza: number;
          resumen: string;
          tags: string[];
        };
        tokensInput?: number;
        tokensInputCached?: number;
        tokensOutput?: number;
        latencyMs?: number;
        retries?: number;
      }
    | { error: Error };
}

function buildHarness(opts: HarnessOpts) {
  const ticketModel = {
    findById: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket ?? null),
    })),
  };
  const areaModel = {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.areas ?? []),
    })),
  };
  const classificationModel = {
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    })),
  };
  const aiClient = {
    isEnabled: vi.fn().mockReturnValue(opts.aiEnabled ?? true),
    generateStructured: vi.fn().mockImplementation(async () => {
      if (!opts.aiResponse) throw new Error('aiResponse no configurado en el harness');
      if ('error' in opts.aiResponse) throw opts.aiResponse.error;
      return {
        parsed: opts.aiResponse.parsed,
        text: '',
        tokensInput: opts.aiResponse.tokensInput ?? 100,
        tokensInputCached: opts.aiResponse.tokensInputCached ?? 0,
        tokensOutput: opts.aiResponse.tokensOutput ?? 50,
        latencyMs: opts.aiResponse.latencyMs ?? 1234,
        retries: opts.aiResponse.retries ?? 0,
      };
    }),
  };
  const interactions = {
    appendSystemEvent: vi.fn().mockResolvedValue(undefined),
  };
  const events = {
    emit: vi.fn(),
  };
  const config = {
    get: (key: string) => {
      const map: Record<string, unknown> = {
        CLASSIFICATION_PROMPT_VERSION: 'v1',
        LLM_MODEL_CLASSIFICATION: 'claude-haiku-4-5-20251001',
        LLM_TEMP_CLASSIFICATION: 0,
        LLM_MAX_TOKENS_CLASSIFICATION: 1024,
        LLM_PROMPT_CACHE_ENABLED: true,
        UMBRAL_CONFIANZA_CLASIFICACION: 0.7,
      };
      return map[key];
    },
  };

  // Stub de BusinessHoursService — opts BA constantes; el cálculo
  // exacto está cubierto en business-hours.spec.ts.
  const businessHours = {
    getOptsForTenant: vi.fn().mockResolvedValue({
      timezone: 'America/Argentina/Buenos_Aires',
      dayStart: { hour: 7, minute: 0 },
      dayEnd: { hour: 18, minute: 0 },
    }),
    optsFromSettings: vi.fn(),
  };

  const service = new ClassificationService(
    ticketModel as never,
    areaModel as never,
    classificationModel as never,
    aiClient as never,
    config as never,
    businessHours as never,
    interactions as never,
    events as never,
  );

  return {
    service,
    ticketModel,
    areaModel,
    classificationModel,
    aiClient,
    interactions,
    events,
  };
}

describe('ClassificationService.classify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('happy path: confianza alta + área válida → ticket escalado y Classification con outcome=ok', async () => {
    const ticket = buildTicket();
    const area = buildArea();
    const { service, classificationModel, interactions } = buildHarness({
      ticket,
      areas: [area],
      aiResponse: {
        parsed: {
          area: area._id.toString(),
          prioridad: 'media',
          confianza: 0.92,
          resumen: 'Usuario sin acceso a VPN',
          tags: ['vpn', 'red'],
        },
      },
    });

    const result = await service.classify(ticket._id.toString());

    expect(result.outcome).toBe('ok');
    expect(result.finalEstado).toBe('escalado');
    expect(ticket.estado).toBe('escalado');
    expect(ticket.areaId).toBe(area._id);
    expect(ticket.prioridad).toBe('media');
    expect(ticket.tags).toContain('vpn');
    expect(ticket.slaDeadline).toBeInstanceOf(Date);

    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'ok',
        area: area._id.toString(),
        prioridad: 'media',
        confianza: 0.92,
        modelo: 'claude-haiku-4-5-20251001',
        promptVersion: 'v1',
      }),
    );
    expect(interactions.appendSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'TicketClassifiedByAi',
        toEstado: 'escalado',
      }),
    );
  });

  it('confianza baja → ticket en requiere_revision_clasificacion con outcome=low_confidence', async () => {
    const ticket = buildTicket();
    const area = buildArea();
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [area],
      aiResponse: {
        parsed: {
          area: area._id.toString(),
          prioridad: 'baja',
          confianza: 0.45,
          resumen: 'consulta ambigua',
          tags: ['consulta'],
        },
      },
    });

    const result = await service.classify(ticket._id.toString());

    expect(result.outcome).toBe('low_confidence');
    expect(result.finalEstado).toBe('requiere_revision_clasificacion');
    expect(ticket.estado).toBe('requiere_revision_clasificacion');
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        outcome: 'low_confidence',
        confianza: 0.45,
      }),
    );
  });

  it('IA devuelve un area inexistente → outcome=invalid_area', async () => {
    const ticket = buildTicket();
    const area = buildArea();
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [area],
      aiResponse: {
        parsed: {
          area: new Types.ObjectId().toString(), // distinto del area real
          prioridad: 'alta',
          confianza: 0.95,
          resumen: 'urgencia',
          tags: [],
        },
      },
    });

    const result = await service.classify(ticket._id.toString());

    expect(result.outcome).toBe('invalid_area');
    expect(ticket.estado).toBe('requiere_revision_clasificacion');
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'invalid_area' }),
    );
  });

  it('cuerpo demasiado corto → no llama IA, outcome=content_insufficient', async () => {
    const ticket = buildTicket({ cuerpo: 'corto' });
    const { service, aiClient, classificationModel } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiResponse: {
        parsed: {
          area: 'x',
          prioridad: 'media',
          confianza: 0.9,
          resumen: '',
          tags: [],
        },
      },
    });

    const result = await service.classify(ticket._id.toString());

    expect(result.outcome).toBe('content_insufficient');
    expect(aiClient.generateStructured).not.toHaveBeenCalled();
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'content_insufficient' }),
    );
  });

  it('AiClient deshabilitado (sin API key) → outcome=api_error', async () => {
    const ticket = buildTicket();
    const { service, aiClient, classificationModel } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiEnabled: false,
      aiResponse: {
        parsed: { area: 'x', prioridad: 'media', confianza: 1, resumen: '', tags: [] },
      },
    });

    const result = await service.classify(ticket._id.toString());

    expect(result.outcome).toBe('api_error');
    expect(aiClient.generateStructured).not.toHaveBeenCalled();
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'api_error' }),
    );
  });

  it('error de API tras retries → outcome=api_error', async () => {
    const ticket = buildTicket();
    const apiError = new ApiException(
      HttpStatus.SERVICE_UNAVAILABLE,
      'AI_API_ERROR',
      'Anthropic caído.',
    );
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiResponse: { error: apiError },
    });

    const result = await service.classify(ticket._id.toString());
    expect(result.outcome).toBe('api_error');
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'api_error' }),
    );
  });

  it('AiClientUnavailableError lanzado por el service → outcome=api_error', async () => {
    const ticket = buildTicket();
    const { service } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiResponse: { error: new AiClientUnavailableError('no key') },
    });

    const result = await service.classify(ticket._id.toString());
    expect(result.outcome).toBe('api_error');
  });

  it('output invalid → outcome=validation_failure', async () => {
    const ticket = buildTicket();
    const validationError = new ApiException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      'AI_OUTPUT_INVALID',
      'JSON inválido.',
    );
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiResponse: { error: validationError },
    });

    const result = await service.classify(ticket._id.toString());
    expect(result.outcome).toBe('validation_failure');
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'validation_failure' }),
    );
  });

  it('ticket no encontrado → no persiste y retorna api_error', async () => {
    const { service, classificationModel } = buildHarness({
      ticket: null,
      areas: [],
      aiResponse: {
        parsed: { area: 'x', prioridad: 'media', confianza: 1, resumen: '', tags: [] },
      },
    });
    const result = await service.classify(new Types.ObjectId().toString());
    expect(result.outcome).toBe('api_error');
    expect(classificationModel.create).not.toHaveBeenCalled();
  });

  it('ticket no en estado `recibido` no se reclasifica', async () => {
    const ticket = buildTicket({ estado: 'escalado' });
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [buildArea()],
      aiResponse: {
        parsed: {
          area: 'x',
          prioridad: 'media',
          confianza: 0.9,
          resumen: '',
          tags: [],
        },
      },
    });

    const result = await service.classify(ticket._id.toString());
    expect(result.outcome).toBe('api_error');
    expect(ticket.save).not.toHaveBeenCalled();
    expect(classificationModel.create).not.toHaveBeenCalled();
  });

  it('sin áreas activas → outcome=invalid_area', async () => {
    const ticket = buildTicket();
    const { service, classificationModel } = buildHarness({
      ticket,
      areas: [],
      aiResponse: {
        parsed: { area: 'x', prioridad: 'media', confianza: 1, resumen: '', tags: [] },
      },
    });
    const result = await service.classify(ticket._id.toString());
    expect(result.outcome).toBe('invalid_area');
    expect(classificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: 'invalid_area' }),
    );
  });
});
