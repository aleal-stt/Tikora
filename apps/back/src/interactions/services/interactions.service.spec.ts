import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { InteractionsService } from './interactions.service';

const TENANT_ID = new Types.ObjectId();

function asEmpleado(userId: Types.ObjectId): AuthenticatedUser {
  return {
    userId: userId.toString(),
    tenantId: TENANT_ID.toString(),
    role: 'empleado',
    areaIds: [],
  };
}

function asAgenteWithArea(areaId: string): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'agente',
    areaIds: [areaId],
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

interface FakeTicket {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  requesterId: Types.ObjectId;
  areaId: Types.ObjectId | null;
}

function buildHarness(ticket: FakeTicket | null) {
  const interactionModel = {
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    })),
    find: vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue([]) }),
      }),
    })),
  };

  const ticketModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(ticket) })),
  };

  const service = new InteractionsService(interactionModel as never, ticketModel as never);

  return { service, interactionModel, ticketModel };
}

describe('InteractionsService.createForCaller', () => {
  it('OWN puede crear interacción type=usuario', async () => {
    const requesterId = new Types.ObjectId();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId,
      areaId: null,
    };
    const { service, interactionModel } = buildHarness(ticket);

    const result = await service.createForCaller(asEmpleado(requesterId), ticket._id.toString(), {
      type: 'usuario',
      content: 'Probé reiniciar y sigue.',
    });

    expect(result.type).toBe('usuario');
    expect(interactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'usuario',
        ticketId: ticket._id,
      }),
    );
  });

  it('OWN no puede crear interacción type=agente', async () => {
    const requesterId = new Types.ObjectId();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId,
      areaId: null,
    };
    const { service } = buildHarness(ticket);

    try {
      await service.createForCaller(asEmpleado(requesterId), ticket._id.toString(), {
        type: 'agente',
        content: 'hola',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'INTERACTION_TYPE_FORBIDDEN',
      });
    }
  });

  it('un caller que no es OWN no puede crear type=usuario', async () => {
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId: new Types.ObjectId(), // distinto del caller
      areaId: null,
    };
    const { service } = buildHarness(ticket);

    try {
      await service.createForCaller(asAdmin(), ticket._id.toString(), {
        type: 'usuario',
        content: 'hola',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'INTERACTION_TYPE_FORBIDDEN',
      });
    }
  });

  it('agente fuera del área del ticket no puede crear type=agente', async () => {
    const ticketAreaId = new Types.ObjectId();
    const otraArea = new Types.ObjectId().toString();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId: new Types.ObjectId(),
      areaId: ticketAreaId,
    };
    const { service } = buildHarness(ticket);

    try {
      await service.createForCaller(asAgenteWithArea(otraArea), ticket._id.toString(), {
        type: 'agente',
        content: 'pasa al usuario',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_AREA_FORBIDDEN',
      });
    }
  });

  it('agente del área crea type=agente con metadata enviadoPorCorreo', async () => {
    const ticketAreaId = new Types.ObjectId();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId: new Types.ObjectId(),
      areaId: ticketAreaId,
    };
    const { service, interactionModel } = buildHarness(ticket);

    const result = await service.createForCaller(
      asAgenteWithArea(ticketAreaId.toString()),
      ticket._id.toString(),
      { type: 'agente', content: 'Te llamo en 5.', enviarPorCorreo: true },
    );

    expect(result.type).toBe('agente');
    expect(interactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { enviadoPorCorreo: true },
      }),
    );
  });
});

describe('InteractionsService.appendSystemEvent', () => {
  it('crea interacción type=sistema con authorId null y metadata', async () => {
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId: new Types.ObjectId(),
      areaId: null,
    };
    const { service, interactionModel } = buildHarness(ticket);

    await service.appendSystemEvent({
      tenantId: ticket.tenantId,
      ticketId: ticket._id,
      eventName: 'TicketTaken',
      fromEstado: 'escalado',
      toEstado: 'en_progreso',
      content: 'agente tomó el ticket',
    });

    expect(interactionModel.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'sistema',
        authorId: null,
        metadata: expect.objectContaining({
          eventName: 'TicketTaken',
          fromEstado: 'escalado',
          toEstado: 'en_progreso',
        }),
      }),
    );
  });
});

describe('InteractionsService.listForTicket', () => {
  it('un agente fuera del área no puede leer el timeline', async () => {
    const ticketAreaId = new Types.ObjectId();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId: new Types.ObjectId(),
      areaId: ticketAreaId,
    };
    const otraArea = new Types.ObjectId().toString();
    const { service } = buildHarness(ticket);

    try {
      await service.listForTicket(asAgenteWithArea(otraArea), ticket._id.toString(), { limit: 50 });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'TICKET_FORBIDDEN',
      });
    }
  });

  it('OWN puede leer el timeline aunque el ticket no tenga área asignada', async () => {
    const requesterId = new Types.ObjectId();
    const ticket: FakeTicket = {
      _id: new Types.ObjectId(),
      tenantId: TENANT_ID,
      requesterId,
      areaId: null,
    };
    const { service } = buildHarness(ticket);

    const result = await service.listForTicket(asEmpleado(requesterId), ticket._id.toString(), {
      limit: 50,
    });
    expect(result.items).toEqual([]);
    expect(result.nextCursor).toBeNull();
  });
});
