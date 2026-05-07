import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { NotificationEventsListener } from './notification-events.listener';

const TENANT_ID = new Types.ObjectId();

interface FakeArea {
  _id: Types.ObjectId;
  agentIds: Types.ObjectId[];
  leaderIds: Types.ObjectId[];
}

function buildHarness(opts: { area?: FakeArea | null; admins?: Types.ObjectId[] } = {}) {
  const notifications = {
    create: vi.fn(),
    createMany: vi.fn().mockImplementation(async (inputs: Array<Record<string, unknown>>) =>
      inputs.map((i, idx) => ({
        ...i,
        _id: new Types.ObjectId(),
        createdAt: new Date(`2026-05-07T15:0${idx}:00.000Z`),
        recipientId: i.recipientId,
        type: i.type,
        ticketId: i.ticketId,
        payload: i.payload,
        read: false,
        readAt: null,
      })),
    ),
  };
  const sseHub = {
    push: vi.fn(),
    register: vi.fn(),
    connectionCount: vi.fn(),
  };
  const areaModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(opts.area ?? null) })),
  };
  const userModel = {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue((opts.admins ?? []).map((id) => ({ _id: id }))),
    })),
  };

  const listener = new NotificationEventsListener(
    notifications as never,
    sseHub as never,
    areaModel as never,
    userModel as never,
  );

  return { listener, notifications, sseHub, areaModel, userModel };
}

describe('NotificationEventsListener', () => {
  it('TicketCreated → notifica al solicitante', async () => {
    const { listener, notifications, sseHub } = buildHarness();
    const requesterId = new Types.ObjectId().toString();

    await listener.onTicketCreated({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      shortCode: 'TIK-1',
      requesterId,
      asunto: 'Algo',
      cuerpoSnippet: 'cuerpo',
    });

    expect(notifications.createMany).toHaveBeenCalledTimes(1);
    const calls = notifications.createMany.mock.calls[0]?.[0] as Array<{
      recipientId: Types.ObjectId;
      type: string;
    }>;
    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe('TicketCreated');
    expect(calls[0].recipientId.toString()).toBe(requesterId);
    expect(sseHub.push).toHaveBeenCalledWith(requesterId, expect.any(Object));
  });

  it('TicketClassified → notifica a todos los agentes del área', async () => {
    const areaId = new Types.ObjectId();
    const agent1 = new Types.ObjectId();
    const agent2 = new Types.ObjectId();
    const { listener, notifications } = buildHarness({
      area: {
        _id: areaId,
        agentIds: [agent1, agent2],
        leaderIds: [],
      },
    });

    await listener.onTicketClassified({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      classificationId: new Types.ObjectId().toString(),
      areaId: areaId.toString(),
      prioridad: 'alta',
      confianza: 0.95,
      resumen: 'algo',
      tags: [],
      modelo: 'claude',
      promptVersion: 'v1',
    });

    const inputs = notifications.createMany.mock.calls[0]?.[0] as Array<{
      recipientId: Types.ObjectId;
    }>;
    expect(inputs).toHaveLength(2);
    const recipientIds = inputs.map((i) => i.recipientId.toString());
    expect(recipientIds).toContain(agent1.toString());
    expect(recipientIds).toContain(agent2.toString());
  });

  it('TicketAssigned → no notifica si caller=agente (self-assign)', async () => {
    const { listener, notifications } = buildHarness();
    const agentId = new Types.ObjectId().toString();
    const areaId = new Types.ObjectId().toString();

    await listener.onTicketAssigned({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      agentId,
      assignedBy: agentId, // self-assign
      areaId,
    });

    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('TicketAssigned → notifica al agente cuando alguien más lo asignó', async () => {
    const { listener, notifications } = buildHarness();
    const agentId = new Types.ObjectId().toString();
    const liderId = new Types.ObjectId().toString();

    await listener.onTicketAssigned({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      agentId,
      assignedBy: liderId,
      areaId: new Types.ObjectId().toString(),
    });

    const inputs = notifications.createMany.mock.calls[0]?.[0] as Array<{
      recipientId: Types.ObjectId;
    }>;
    expect(inputs).toHaveLength(1);
    expect(inputs[0].recipientId.toString()).toBe(agentId);
  });

  it('InteractionAdded → filtra al autor de la lista de participantes', async () => {
    const { listener, notifications } = buildHarness();
    const author = new Types.ObjectId().toString();
    const otherParticipant = new Types.ObjectId().toString();

    await listener.onInteractionAdded({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      interactionId: new Types.ObjectId().toString(),
      authorId: author,
      type: 'agente',
      contentSnippet: 'hola',
      participantIds: [author, otherParticipant],
    });

    const inputs = notifications.createMany.mock.calls[0]?.[0] as Array<{
      recipientId: Types.ObjectId;
    }>;
    expect(inputs).toHaveLength(1);
    expect(inputs[0].recipientId.toString()).toBe(otherParticipant);
  });

  it('TicketRequiresClassificationReview sin área cae en admins del tenant', async () => {
    const adminId = new Types.ObjectId();
    const { listener, notifications, userModel } = buildHarness({
      admins: [adminId],
    });

    await listener.onRequiresReview({
      tenantId: TENANT_ID.toString(),
      ticketId: new Types.ObjectId().toString(),
      suggestedAreaId: null,
      outcome: 'api_error',
      outcomeDetail: 'algo',
    });

    expect(userModel.find).toHaveBeenCalled();
    const inputs = notifications.createMany.mock.calls[0]?.[0] as Array<{
      recipientId: Types.ObjectId;
    }>;
    expect(inputs[0].recipientId.toString()).toBe(adminId.toString());
  });
});
