import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import type { InteractionsService } from '../../interactions/services/interactions.service';
import type { TicketsService } from '../../tickets/services/tickets.service';
import { buildAgregarMensajeATicketHandler } from './agregar-mensaje-a-ticket.tool';
import { buildCrearTicketHandler } from './crear-ticket.tool';
import { buildListarMisTicketsHandler } from './listar-mis-tickets.tool';
import { buildObtenerTicketHandler } from './obtener-ticket.tool';

function asEmpleado(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: new Types.ObjectId().toString(),
    role: 'empleado',
    areaIds: [],
  };
}

function ticketStub(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: new Types.ObjectId().toString(),
    shortCode: 'TIK-7',
    requesterId: 'r',
    asunto: 'Necesito reembolso',
    cuerpo: 'Detalle largo del cuerpo del ticket de prueba',
    estado: 'recibido',
    prioridad: null,
    areaId: null,
    assignedAgentId: null,
    lastAssignedAgentId: null,
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
    createdAt: new Date('2026-05-25T10:00:00.000Z').toISOString(),
    updatedAt: new Date('2026-05-25T10:00:00.000Z').toISOString(),
    ...overrides,
  };
}

describe('crear_ticket handler', () => {
  it('delega a tickets.create y devuelve structuredContent', async () => {
    const tickets = {
      create: vi.fn().mockResolvedValue(ticketStub({ shortCode: 'TIK-42', estado: 'recibido' })),
    } as unknown as TicketsService;

    const handler = buildCrearTicketHandler(asEmpleado(), tickets);
    const result = await handler({ asunto: 'Algo', cuerpo: 'Cuerpo del problema' });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({
      shortCode: 'TIK-42',
      estado: 'recibido',
    });
    expect(tickets.create).toHaveBeenCalledOnce();
  });

  it('devuelve isError cuando el service lanza ApiException', async () => {
    const tickets = {
      create: vi
        .fn()
        .mockRejectedValue(new ApiException(HttpStatus.BAD_REQUEST, 'BOOM', 'Cuerpo inválido.')),
    } as unknown as TicketsService;

    const result = await buildCrearTicketHandler(
      asEmpleado(),
      tickets,
    )({
      asunto: 'x',
      cuerpo: 'y',
    });

    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain('Cuerpo inválido');
  });
});

describe('listar_mis_tickets handler', () => {
  it('filtra por estado in-memory y respeta el límite', async () => {
    const tickets = {
      listMine: vi.fn().mockResolvedValue({
        items: [
          ticketStub({ estado: 'cerrado', shortCode: 'TIK-1' }),
          ticketStub({ estado: 'recibido', shortCode: 'TIK-2' }),
          ticketStub({ estado: 'cerrado', shortCode: 'TIK-3' }),
        ],
        nextCursor: null,
      }),
    } as unknown as TicketsService;

    const result = await buildListarMisTicketsHandler(
      asEmpleado(),
      tickets,
    )({
      estado: 'cerrado',
      limite: 5,
    });

    const structured = result.structuredContent as { tickets: { shortCode: string }[] };
    expect(structured.tickets.map((t) => t.shortCode)).toEqual(['TIK-1', 'TIK-3']);
  });

  it('mensaje claro cuando no hay resultados', async () => {
    const tickets = {
      listMine: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as TicketsService;

    const result = await buildListarMisTicketsHandler(asEmpleado(), tickets)({ limite: 10 });
    expect((result.content[0] as { text: string }).text).toContain('No tenés tickets');
  });
});

describe('obtener_ticket handler', () => {
  it('arma historial y detecta la última respuesta del agente', async () => {
    const ticketId = new Types.ObjectId().toString();
    const tickets = {
      getByIdForCaller: vi.fn().mockResolvedValue(ticketStub({ id: ticketId })),
    } as unknown as TicketsService;
    const interactions = {
      listForTicket: vi.fn().mockResolvedValue({
        items: [
          {
            id: '1',
            type: 'sistema',
            content: 'Ticket creado',
            authorId: 'sys',
            createdAt: '2026-05-25T10:00:00.000Z',
          },
          {
            id: '2',
            type: 'agente',
            content: 'Te respondo con la solución X',
            authorId: 'agt',
            createdAt: '2026-05-25T11:00:00.000Z',
          },
          {
            id: '3',
            type: 'usuario',
            content: 'Gracias',
            authorId: 'usr',
            createdAt: '2026-05-25T12:00:00.000Z',
          },
        ],
        nextCursor: null,
      }),
    } as unknown as InteractionsService;

    const result = await buildObtenerTicketHandler(
      asEmpleado(),
      tickets,
      interactions,
    )({
      ticketId,
    });

    const structured = result.structuredContent as {
      historial: Array<{ tipo: string }>;
      ultimaRespuestaAgente: { contenido: string } | null;
    };
    expect(structured.historial).toHaveLength(3);
    expect(structured.historial[0]?.tipo).toBe('cambio_estado');
    expect(structured.ultimaRespuestaAgente?.contenido).toBe('Te respondo con la solución X');
  });

  it('ultimaRespuestaAgente es null si no hay respuesta de agente', async () => {
    const tickets = {
      getByIdForCaller: vi.fn().mockResolvedValue(ticketStub()),
    } as unknown as TicketsService;
    const interactions = {
      listForTicket: vi.fn().mockResolvedValue({ items: [], nextCursor: null }),
    } as unknown as InteractionsService;

    const result = await buildObtenerTicketHandler(
      asEmpleado(),
      tickets,
      interactions,
    )({
      ticketId: new Types.ObjectId().toString(),
    });

    expect(
      (result.structuredContent as { ultimaRespuestaAgente: unknown }).ultimaRespuestaAgente,
    ).toBeNull();
  });
});

describe('agregar_mensaje_a_ticket handler', () => {
  it('bloquea tickets cerrados', async () => {
    const tickets = {
      getByIdForCaller: vi.fn().mockResolvedValue(ticketStub({ estado: 'cerrado' })),
    } as unknown as TicketsService;
    const interactions = {
      createForCaller: vi.fn(),
    } as unknown as InteractionsService;

    const result = await buildAgregarMensajeATicketHandler(
      asEmpleado(),
      tickets,
      interactions,
    )({
      ticketId: new Types.ObjectId().toString(),
      texto: 'Hola',
    });

    expect(result.isError).toBe(true);
    expect(interactions.createForCaller).not.toHaveBeenCalled();
  });

  it('crea interaction tipo usuario cuando el ticket está abierto', async () => {
    const tickets = {
      getByIdForCaller: vi.fn().mockResolvedValue(ticketStub({ estado: 'en_progreso' })),
    } as unknown as TicketsService;
    const interactions = {
      createForCaller: vi.fn().mockResolvedValue({}),
    } as unknown as InteractionsService;

    const result = await buildAgregarMensajeATicketHandler(
      asEmpleado(),
      tickets,
      interactions,
    )({
      ticketId: new Types.ObjectId().toString(),
      texto: 'Agrego info',
    });

    expect(result.isError).toBeUndefined();
    expect(interactions.createForCaller).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      { type: 'usuario', content: 'Agrego info' },
    );
  });
});
