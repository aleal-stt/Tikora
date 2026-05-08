import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { TicketClassifiedEvent } from '../../notifications/events/notification-events';
import { AutoResponseEvaluatorListener } from './auto-response-evaluator.listener';

const TENANT_ID = new Types.ObjectId().toString();
const TICKET_ID = new Types.ObjectId().toString();

function buildEvent(overrides: Partial<TicketClassifiedEvent> = {}): TicketClassifiedEvent {
  return {
    tenantId: TENANT_ID,
    ticketId: TICKET_ID,
    classificationId: new Types.ObjectId().toString(),
    areaId: new Types.ObjectId().toString(),
    prioridad: 'baja',
    confianza: 0.9,
    resumen: 'algo',
    tags: [],
    modelo: 'claude-haiku',
    promptVersion: 'v1',
    ...overrides,
  };
}

interface ConfigBy {
  AI_PHASE: number;
  UMBRAL_CONFIANZA_CLASIFICACION: number;
}

function buildHarness(configValues: Partial<ConfigBy> = {}) {
  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn((key: keyof ConfigBy) => {
      const defaults: ConfigBy = {
        AI_PHASE: 2,
        UMBRAL_CONFIANZA_CLASIFICACION: 0.7,
      };
      return { ...defaults, ...configValues }[key];
    }),
  };
  const listener = new AutoResponseEvaluatorListener(
    queue as unknown as ConstructorParameters<typeof AutoResponseEvaluatorListener>[0],
    config as unknown as ConstructorParameters<typeof AutoResponseEvaluatorListener>[1],
  );
  return { listener, queue };
}

describe('AutoResponseEvaluatorListener', () => {
  it('encola job cuando prioridad=baja y confianza alta y AI_PHASE>=2', async () => {
    const { listener, queue } = buildHarness();
    await listener.onTicketClassified(buildEvent({ prioridad: 'baja', confianza: 0.85 }));
    expect(queue.enqueue).toHaveBeenCalledWith(TICKET_ID);
  });

  it('NO encola si AI_PHASE=1 (módulo apagado)', async () => {
    const { listener, queue } = buildHarness({ AI_PHASE: 1 });
    await listener.onTicketClassified(buildEvent({ prioridad: 'baja', confianza: 0.95 }));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('NO encola si prioridad=alta', async () => {
    const { listener, queue } = buildHarness();
    await listener.onTicketClassified(buildEvent({ prioridad: 'alta' }));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('NO encola si prioridad=media', async () => {
    const { listener, queue } = buildHarness();
    await listener.onTicketClassified(buildEvent({ prioridad: 'media' }));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('NO encola si confianza por debajo del umbral', async () => {
    const { listener, queue } = buildHarness({ UMBRAL_CONFIANZA_CLASIFICACION: 0.7 });
    await listener.onTicketClassified(buildEvent({ confianza: 0.69 }));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });

  it('NO propaga error si la cola falla — el ticket sigue su flujo', async () => {
    const { listener, queue } = buildHarness();
    queue.enqueue.mockRejectedValueOnce(new Error('redis down'));
    await expect(listener.onTicketClassified(buildEvent())).resolves.toBeUndefined();
  });

  it('cortocircuita en orden: prioridad antes que confianza', async () => {
    const { listener, queue } = buildHarness();
    // Prioridad alta + confianza alta — falla la primera condición.
    await listener.onTicketClassified(buildEvent({ prioridad: 'alta', confianza: 0.99 }));
    expect(queue.enqueue).not.toHaveBeenCalled();
  });
});
