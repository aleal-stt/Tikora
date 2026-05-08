import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { AutoResponseService } from './auto-response.service';

const TENANT = new Types.ObjectId();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function asAgentOf(areaId: Types.ObjectId): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT.toString(),
    role: 'agente',
    areaIds: [areaId.toString()],
  };
}

function buildAi(overrides: Partial<Record<string, unknown>> = {}) {
  const id = new Types.ObjectId();
  const ticketId = new Types.ObjectId();
  const doc = {
    _id: id,
    tenantId: TENANT,
    ticketId,
    estado: 'sugerida' as
      | 'sugerida'
      | 'aprobada'
      | 'editada'
      | 'enviada'
      | 'descartada'
      | 'fallida',
    respondable: true,
    motivoNoRespondable: null as string | null,
    originalAiContent: 'Hola, estos son los pasos...',
    content: null as string | null,
    confianza: 0.92,
    sourceChunks: [],
    modelo: 'claude-sonnet-4-6',
    promptVersion: 'v1',
    temperature: 0.3,
    tokensInput: 100,
    tokensInputCached: 80,
    tokensOutput: 50,
    latencyMs: 800,
    approvedBy: null as Types.ObjectId | null,
    approvedAt: null as Date | null,
    editedBy: null as Types.ObjectId | null,
    editedAt: null as Date | null,
    diffSummary: null as string | null,
    discardedBy: null as Types.ObjectId | null,
    discardedAt: null as Date | null,
    discardReason: null as string | null,
    sentAt: null as Date | null,
    emailMessageId: null as string | null,
    failureReason: null as 'api_error' | 'validation_error' | null,
    failureDetail: null as string | null,
    reopenedAfterAutoResponse: false,
    createdAt: new Date('2026-05-08T10:00:00Z'),
    updatedAt: new Date('2026-05-08T10:00:00Z'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function buildTicket(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT,
    shortCode: 'TIK-100',
    requesterId: new Types.ObjectId(),
    asunto: 'No me anda la VPN',
    cuerpo: 'Detalle del problema',
    estado: 'escalado' as 'escalado' | 'cerrado' | 'en_progreso',
    areaId: new Types.ObjectId(),
    resolutionType: null as null | 'manual' | 'auto',
    resolvedBy: null as Types.ObjectId | null,
    resolvedAt: null as Date | null,
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function buildHarness(
  opts: {
    ai?: ReturnType<typeof buildAi> | null;
    ticket?: ReturnType<typeof buildTicket> | null;
    requester?: { email: string; fullName: string } | null;
    emailFails?: boolean;
  } = {},
) {
  const aiResponseModel = {
    findOne: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(opts.ai ?? null),
    })),
  };
  const ticketModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket ?? null),
    })),
  };
  const userModel = {
    findById: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(opts.requester ?? null),
    })),
  };
  const kbDocumentModel = {
    find: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  };
  const kbChunkModel = {
    find: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    })),
  };
  const email = {
    sendAutoResponseEmail: opts.emailFails
      ? vi.fn().mockRejectedValue(new Error('SMTP down'))
      : vi.fn().mockResolvedValue({ messageId: 'msg-123' }),
  };
  const interactions = {
    appendSystemEvent: vi.fn().mockResolvedValue({}),
  };
  const events = { emit: vi.fn() };

  const service = new AutoResponseService(
    aiResponseModel as unknown as ConstructorParameters<typeof AutoResponseService>[0],
    ticketModel as unknown as ConstructorParameters<typeof AutoResponseService>[1],
    userModel as unknown as ConstructorParameters<typeof AutoResponseService>[2],
    kbDocumentModel as unknown as ConstructorParameters<typeof AutoResponseService>[3],
    kbChunkModel as unknown as ConstructorParameters<typeof AutoResponseService>[4],
    email as unknown as ConstructorParameters<typeof AutoResponseService>[5],
    interactions as unknown as ConstructorParameters<typeof AutoResponseService>[6],
    events as unknown as ConstructorParameters<typeof AutoResponseService>[7],
  );
  return { service, email, events, interactions, aiResponseModel, ticketModel };
}

describe('AutoResponseService', () => {
  describe('approve', () => {
    it('aprueba, envía correo y cierra el ticket con resolutionType=auto', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id });
      const { service, email, events } = buildHarness({
        ai,
        ticket,
        requester: { email: 'usuario@empresa.com', fullName: 'Usuario' },
      });
      const result = await service.approve(asAdmin(), ai._id.toString());

      expect(ai.estado).toBe('enviada');
      expect(ai.content).toBe(ai.originalAiContent);
      expect(ai.sentAt).toBeInstanceOf(Date);
      expect(ticket.estado).toBe('cerrado');
      expect(ticket.resolutionType).toBe('auto');
      expect(email.sendAutoResponseEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'usuario@empresa.com' }),
      );
      expect(events.emit).toHaveBeenCalledWith('AiResponseApproved', expect.any(Object));
      expect(events.emit).toHaveBeenCalledWith('AiResponseSent', expect.any(Object));
      expect(events.emit).toHaveBeenCalledWith('TicketResolved', expect.any(Object));
      expect(result.estado).toBe('enviada');
    });

    it('rechaza si la respuesta no es respondable', async () => {
      const ticket = buildTicket();
      const ai = buildAi({
        ticketId: ticket._id,
        respondable: false,
        originalAiContent: null,
      });
      const { service } = buildHarness({ ai, ticket });
      const err = await service.approve(asAdmin(), ai._id.toString()).catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
    });

    it('rechaza si la respuesta ya fue procesada', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id, estado: 'descartada' });
      const { service } = buildHarness({ ai, ticket });
      const err = await service.approve(asAdmin(), ai._id.toString()).catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('AGE solo puede aprobar tickets de áreas que opera', async () => {
      const otherArea = new Types.ObjectId();
      const ticket = buildTicket({ areaId: otherArea });
      const ai = buildAi({ ticketId: ticket._id });
      const { service } = buildHarness({ ai, ticket });
      const err = await service
        .approve(asAgentOf(new Types.ObjectId()), ai._id.toString())
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    });

    it('si el envío de email falla, deja la respuesta en aprobada (no rollback ni cierre)', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id });
      const { service, events } = buildHarness({
        ai,
        ticket,
        requester: { email: 'x@x.com', fullName: 'X' },
        emailFails: true,
      });
      await service.approve(asAdmin(), ai._id.toString());
      // Quedó aprobada (no enviada) y el ticket no se cerró.
      expect(ai.estado).toBe('aprobada');
      expect(ai.sentAt).toBeNull();
      expect(ticket.estado).not.toBe('cerrado');
      // No se emitió AiResponseSent ni TicketResolved.
      const eventNames = events.emit.mock.calls.map((c) => c[0]);
      expect(eventNames).toContain('AiResponseApproved');
      expect(eventNames).not.toContain('AiResponseSent');
      expect(eventNames).not.toContain('TicketResolved');
    });
  });

  describe('approveWithChanges', () => {
    it('persiste content editado, marca estado=editada y calcula diffSummary', async () => {
      const ticket = buildTicket();
      const ai = buildAi({
        ticketId: ticket._id,
        originalAiContent: 'Original.',
      });
      const { service } = buildHarness({
        ai,
        ticket,
        requester: { email: 'x@x.com', fullName: 'X' },
      });
      const result = await service.approveWithChanges(asAdmin(), ai._id.toString(), {
        respuestaFinal: 'Editado significativamente.',
      });
      expect(ai.editedBy).not.toBeNull();
      expect(ai.editedAt).toBeInstanceOf(Date);
      expect(ai.content).toBe('Editado significativamente.');
      // El diff summary se calcula y guarda — no nos importa el formato exacto,
      // solo que esté presente.
      expect(typeof ai.diffSummary).toBe('string');
      expect(ai.diffSummary?.length ?? 0).toBeGreaterThan(0);
      expect(result.estado).toBe('enviada');
    });
  });

  describe('discard', () => {
    it('marca descartada con motivo y emite evento + interaction de sistema', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id });
      const { service, events, interactions } = buildHarness({ ai, ticket });
      const result = await service.discard(asAdmin(), ai._id.toString(), {
        motivo: 'No contempla cuentas suspendidas',
      });
      expect(ai.estado).toBe('descartada');
      expect(ai.discardReason).toBe('No contempla cuentas suspendidas');
      expect(ai.discardedBy).not.toBeNull();
      expect(events.emit).toHaveBeenCalledWith('AiResponseDiscarded', expect.any(Object));
      expect(interactions.appendSystemEvent).toHaveBeenCalled();
      expect(result.estado).toBe('descartada');
    });
  });

  describe('getLatestFailedForTicket', () => {
    it('admin recibe la última fallida si existe', async () => {
      const ticket = buildTicket();
      const ai = buildAi({
        ticketId: ticket._id,
        estado: 'fallida',
        respondable: false,
        originalAiContent: null,
        failureReason: 'api_error',
        failureDetail: 'Gemini 503',
      });
      const { service } = buildHarness({ ai, ticket });
      const result = await service.getLatestFailedForTicket(asAdmin(), ticket._id.toString());
      expect(result?.estado).toBe('fallida');
      expect(result?.failureReason).toBe('api_error');
      expect(result?.failureDetail).toBe('Gemini 503');
    });

    it('admin recibe null si no hay fallida', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ai: null, ticket });
      const result = await service.getLatestFailedForTicket(asAdmin(), ticket._id.toString());
      expect(result).toBeNull();
    });

    it('AGE/LID reciben 403 — la falla es info de admin', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ticket });
      const err = await service
        .getLatestFailedForTicket(asAgentOf(new Types.ObjectId()), ticket._id.toString())
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('getCurrentForTicket', () => {
    it('devuelve null si la última está descartada', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id, estado: 'descartada' });
      const { service } = buildHarness({ ai, ticket });
      const result = await service.getCurrentForTicket(asAdmin(), ticket._id.toString());
      expect(result).toBeNull();
    });

    it('devuelve null si la última está fallida (audit-only, no accionable)', async () => {
      const ticket = buildTicket();
      const ai = buildAi({
        ticketId: ticket._id,
        estado: 'fallida',
        respondable: false,
        originalAiContent: null,
        failureReason: 'api_error',
        failureDetail: 'Gemini 503 tras 3 retries',
      });
      const { service } = buildHarness({ ai, ticket });
      const result = await service.getCurrentForTicket(asAdmin(), ticket._id.toString());
      expect(result).toBeNull();
    });

    it('devuelve la sugerida vigente', async () => {
      const ticket = buildTicket();
      const ai = buildAi({ ticketId: ticket._id, estado: 'sugerida' });
      const { service } = buildHarness({ ai, ticket });
      const result = await service.getCurrentForTicket(asAdmin(), ticket._id.toString());
      expect(result?.estado).toBe('sugerida');
    });
  });
});
