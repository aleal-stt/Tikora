import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { TicketStateMachineService } from './ticket-state-machine.service';
import { TicketsService } from './tickets.service';

const TENANT_ID = new Types.ObjectId();

function asEmpleado(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'empleado',
    areaIds: [],
  };
}

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function asAgente(areaId: string): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'agente',
    areaIds: [areaId],
  };
}

function buildTicketDoc(overrides: Partial<Record<string, unknown>> = {}) {
  // Tipamos los campos opcionales como uniones para que el test pueda
  // asignar `new ObjectId(...)` sobre lo que arrancó como `null`.
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    shortCode: 'TIK-1',
    requesterId: new Types.ObjectId(),
    asunto: 'Algo',
    cuerpo: 'Cuerpo de prueba',
    estado: 'requiere_revision_clasificacion',
    prioridad: null as 'alta' | 'media' | 'baja' | null,
    areaId: null as Types.ObjectId | null,
    classificationId: null as Types.ObjectId | null,
    autoResponseId: null as Types.ObjectId | null,
    assignedAgentId: null as Types.ObjectId | null,
    lastAssignedAgentId: null as Types.ObjectId | null,
    attachmentIds: [],
    tags: [],
    slaDeadline: null,
    resolutionType: null,
    resolvedBy: null,
    resolvedAt: null,
    cancelledBy: null,
    cancelledAt: null,
    cancelReason: null,
    reopenCount: 0,
    closedDefinitivelyAt: null,
    classificationFeedbackId: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

interface HarnessOpts {
  ticket?: ReturnType<typeof buildTicketDoc> | null;
  user?: {
    _id: Types.ObjectId;
    areaIds: Types.ObjectId[];
    role: string;
    tenantId: Types.ObjectId;
    active: boolean;
  } | null;
  area?: {
    _id: Types.ObjectId;
    tenantId: Types.ObjectId;
    active: boolean;
    slas: { alta: number; media: number; baja: number };
  } | null;
  takeMatched?: boolean;
  aiPhase?: number;
}

function buildHarness(opts: HarnessOpts = {}) {
  const ticketModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket ?? null),
    })),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) =>
      buildTicketDoc({
        ...data,
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    find: vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue([]) }),
      }),
    })),
    updateOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({
        matchedCount: opts.takeMatched === false ? 0 : 1,
      }),
    })),
  };

  const userModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(opts.user ?? null) })),
  };

  const areaModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(opts.area ?? null) })),
  };

  const counters = {
    nextTicketShortCode: vi.fn().mockResolvedValue('TIK-42'),
  };

  const stateMachine = new TicketStateMachineService();

  const config = {
    get: (key: string) => (key === 'AI_PHASE' ? opts.aiPhase ?? 1 : undefined),
  };

  // Mock de InteractionsService: capturamos los appendSystemEvent para que los
  // tests puedan aseverar qué eventos emitió cada transición.
  const interactions = {
    appendSystemEvent: vi.fn().mockResolvedValue(undefined),
  };

  // Mock de la cola de clasificación. Por default `enqueue` resuelve OK,
  // simulando que Redis está disponible y el job quedó en cola.
  const classificationQueue = {
    enqueue: vi.fn().mockResolvedValue(undefined),
  };

  // Stub del EventEmitter2: solo necesitamos que `emit` exista; los tests
  // que verifican eventos espían directamente sobre `events.emit`.
  const events = {
    emit: vi.fn(),
  };

  // Stub de BusinessHoursService: devuelve opts BA constantes. Los
  // tests verifican que `calculateSlaDeadline` se llamó; no nos
  // importa el cálculo exacto del deadline acá (cubierto en
  // business-hours.spec.ts).
  const businessHours = {
    getOptsForTenant: vi.fn().mockResolvedValue({
      timezone: 'America/Argentina/Buenos_Aires',
      dayStart: { hour: 7, minute: 0 },
      dayEnd: { hour: 18, minute: 0 },
    }),
    optsFromSettings: vi.fn(),
  };

  const service = new TicketsService(
    ticketModel as never,
    userModel as never,
    areaModel as never,
    counters as never,
    stateMachine,
    config as never,
    businessHours as never,
    interactions as never,
    classificationQueue as never,
    events as never,
  );

  return {
    service,
    ticketModel,
    userModel,
    areaModel,
    counters,
    interactions,
    classificationQueue,
    events,
  };
}

describe('TicketsService.create', () => {
  it('crea en `recibido` y encola job de clasificación cuando AI_PHASE>=1', async () => {
    const { service, counters, classificationQueue } = buildHarness({ aiPhase: 1 });
    const result = await service.create(asEmpleado(), {
      asunto: 'Asunto válido',
      cuerpo: 'Cuerpo con suficiente texto',
    });
    expect(result.estado).toBe('recibido');
    expect(result.shortCode).toBe('TIK-42');
    expect(counters.nextTicketShortCode).toHaveBeenCalledTimes(1);
    expect(classificationQueue.enqueue).toHaveBeenCalledTimes(1);
    expect(classificationQueue.enqueue).toHaveBeenCalledWith(expect.any(String));
  });

  it('si el encolado falla, cae a `requiere_revision_clasificacion` (fallback humano)', async () => {
    const { service, classificationQueue } = buildHarness({ aiPhase: 1 });
    classificationQueue.enqueue.mockRejectedValueOnce(new Error('redis down'));

    const result = await service.create(asEmpleado(), {
      asunto: 'Asunto válido',
      cuerpo: 'Cuerpo con suficiente texto',
    });
    expect(result.estado).toBe('requiere_revision_clasificacion');
  });
});

describe('TicketsService.take', () => {
  it('rechaza si el ticket no está escalado (TICKET_TRANSITION_INVALID)', async () => {
    const ticket = buildTicketDoc({ estado: 'en_progreso' });
    const areaId = new Types.ObjectId().toString();
    ticket.areaId = new Types.ObjectId(areaId);
    const { service } = buildHarness({ ticket });

    try {
      await service.take(asAgente(areaId), ticket._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_TRANSITION_INVALID',
      });
    }
  });

  it('rechaza con TICKET_ALREADY_TAKEN cuando otro agente lo tomó primero', async () => {
    const areaId = new Types.ObjectId();
    const ticket = buildTicketDoc({ estado: 'escalado', areaId });
    const { service } = buildHarness({ ticket, takeMatched: false });

    try {
      await service.take(asAgente(areaId.toString()), ticket._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_ALREADY_TAKEN',
      });
    }
  });

  it('un agente que no pertenece al área recibe TICKET_AREA_FORBIDDEN', async () => {
    const ticket = buildTicketDoc({
      estado: 'escalado',
      areaId: new Types.ObjectId(),
    });
    const otherArea = new Types.ObjectId().toString();
    const { service } = buildHarness({ ticket });

    try {
      await service.take(asAgente(otherArea), ticket._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_AREA_FORBIDDEN',
      });
    }
  });
});

describe('TicketsService.cancel', () => {
  it('solo el solicitante puede cancelar (TICKET_NOT_OWNER)', async () => {
    const ticket = buildTicketDoc({ estado: 'requiere_revision_clasificacion' });
    const { service } = buildHarness({ ticket });

    try {
      await service.cancel(asAdmin(), ticket._id.toString(), {
        motivo: 'porque sí',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_NOT_OWNER',
      });
    }
  });

  it('rechaza cancelar un ticket en en_progreso (TICKET_NOT_CANCELABLE)', async () => {
    const requester = asEmpleado();
    const ticket = buildTicketDoc({
      estado: 'en_progreso',
      requesterId: new Types.ObjectId(requester.userId),
    });
    const { service } = buildHarness({ ticket });

    try {
      await service.cancel(requester, ticket._id.toString(), {
        motivo: 'cambié de opinión',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_NOT_CANCELABLE',
      });
    }
  });

  it('cancela exitosamente desde requiere_revision_clasificacion', async () => {
    const requester = asEmpleado();
    const ticket = buildTicketDoc({
      estado: 'requiere_revision_clasificacion',
      requesterId: new Types.ObjectId(requester.userId),
    });
    const { service } = buildHarness({ ticket });

    const result = await service.cancel(requester, ticket._id.toString(), {
      motivo: 'ya lo resolví',
    });
    expect(result.estado).toBe('cancelado');
    expect(result.cancelReason).toBe('ya lo resolví');
  });
});

describe('TicketsService.reopen', () => {
  it('rechaza si pasó la ventana de gracia (TICKET_REOPEN_GRACE_EXPIRED)', async () => {
    const requester = asEmpleado();
    const oldDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000); // 6 días atrás
    const ticket = buildTicketDoc({
      estado: 'cerrado',
      requesterId: new Types.ObjectId(requester.userId),
      resolvedAt: oldDate,
    });
    const { service } = buildHarness({ ticket });

    try {
      await service.reopen(requester, ticket._id.toString(), { motivo: 'volvió' });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_REOPEN_GRACE_EXPIRED',
      });
    }
  });

  it('reabre y vuelve al último agente cuando había uno asignado', async () => {
    const requester = asEmpleado();
    const lastAgent = new Types.ObjectId();
    const ticket = buildTicketDoc({
      estado: 'cerrado',
      requesterId: new Types.ObjectId(requester.userId),
      resolvedAt: new Date(),
      lastAssignedAgentId: lastAgent,
    });
    const { service } = buildHarness({ ticket });

    const result = await service.reopen(requester, ticket._id.toString(), {
      motivo: 'volvió el problema',
    });
    expect(result.estado).toBe('en_progreso');
    expect(result.assignedAgentId).toBe(lastAgent.toString());
    expect(result.reopenCount).toBe(1);
  });
});

describe('TicketsService.classify', () => {
  it('rechaza si el ticket no está en revisión', async () => {
    const ticket = buildTicketDoc({ estado: 'escalado' });
    const { service } = buildHarness({ ticket });

    try {
      await service.classify(asAdmin(), ticket._id.toString(), {
        areaId: new Types.ObjectId().toString(),
        prioridad: 'alta',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_TRANSITION_INVALID',
      });
    }
  });

  it('clasifica y calcula slaDeadline desde slas del área', async () => {
    // Reloj fijo dentro de horario hábil ART (10:00 = 13:00 UTC, lunes
    // 2026-05-11). Si el test corre fuera de 07-18 ART el cálculo de
    // business-hours empuja el deadline al día hábil siguiente y rompe
    // la cota de "≤ now + 4h". Real timers se restauran al salir.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T13:00:00Z'));
    try {
      const ticket = buildTicketDoc({ estado: 'requiere_revision_clasificacion' });
      const area = {
        _id: new Types.ObjectId(),
        tenantId: TENANT_ID,
        active: true,
        slas: { alta: 4, media: 24, baja: 48 },
      };
      const { service } = buildHarness({ ticket, area });

      const result = await service.classify(asAdmin(), ticket._id.toString(), {
        areaId: area._id.toString(),
        prioridad: 'alta',
      });

      expect(result.estado).toBe('escalado');
      expect(result.prioridad).toBe('alta');
      expect(result.slaDeadline).not.toBeNull();
      const deadlineMs = new Date(result.slaDeadline as string).getTime();
      expect(deadlineMs).toBeGreaterThan(Date.now());
      expect(deadlineMs).toBeLessThanOrEqual(Date.now() + 4 * 60 * 60 * 1000 + 1000);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TicketsService — emisión de system interactions', () => {
  it('create emite TicketCreated con toEstado=`recibido` cuando se encola IA', async () => {
    const { service, interactions } = buildHarness({ aiPhase: 1 });
    await service.create(asEmpleado(), {
      asunto: 'Asunto válido',
      cuerpo: 'Cuerpo con suficiente texto',
    });
    expect(interactions.appendSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'TicketCreated',
        toEstado: 'recibido',
      }),
    );
  });

  it('cancel emite TicketCancelled con el motivo como content', async () => {
    const requester = asEmpleado();
    const ticket = buildTicketDoc({
      estado: 'requiere_revision_clasificacion',
      requesterId: new Types.ObjectId(requester.userId),
    });
    const { service, interactions } = buildHarness({ ticket });

    await service.cancel(requester, ticket._id.toString(), {
      motivo: 'ya lo resolví',
    });
    expect(interactions.appendSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'TicketCancelled',
        fromEstado: 'requiere_revision_clasificacion',
        toEstado: 'cancelado',
        content: 'ya lo resolví',
      }),
    );
  });

  it('classify emite TicketClassified con extra y content', async () => {
    const ticket = buildTicketDoc({ estado: 'requiere_revision_clasificacion' });
    const area = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      active: true,
      slas: { alta: 4, media: 24, baja: 48 },
      name: 'Soporte TI',
    };
    const { service, interactions } = buildHarness({ ticket, area: area as never });

    await service.classify(asAdmin(), ticket._id.toString(), {
      areaId: area._id.toString(),
      prioridad: 'alta',
      motivo: 'pertenece a TI',
    });
    expect(interactions.appendSystemEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: 'TicketClassified',
        fromEstado: 'requiere_revision_clasificacion',
        toEstado: 'escalado',
        content: 'pertenece a TI',
      }),
    );
  });

  it('si appendSystemEvent falla, la transición sigue exitosa', async () => {
    const requester = asEmpleado();
    const ticket = buildTicketDoc({
      estado: 'requiere_revision_clasificacion',
      requesterId: new Types.ObjectId(requester.userId),
    });
    const { service, interactions } = buildHarness({ ticket });
    interactions.appendSystemEvent.mockRejectedValueOnce(new Error('mongo down'));

    // El cancel debe completarse aunque la interacción falle (best-effort).
    const result = await service.cancel(requester, ticket._id.toString(), {
      motivo: 'ok',
    });
    expect(result.estado).toBe('cancelado');
  });
});
