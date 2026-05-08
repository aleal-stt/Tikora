import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import { ReopenFromEmailController } from './reopen-from-email.controller';

const PAYLOAD = {
  ticketId: '69fe000000000000000000aa',
  requesterId: '69fe000000000000000000bb',
  aiResponseId: '69fe000000000000000000cc',
  tenantId: '69fe000000000000000000dd',
  shortCode: 'TIK-9',
};

interface HarnessOpts {
  /** Si verify lanza, simulamos token inválido. */
  verifyThrows?: boolean;
  /** payload distinto al default. */
  payload?: typeof PAYLOAD;
  /** reopen mock — éxito por default. */
  reopenResult?: unknown;
  reopenThrows?: Error;
  updateOneThrows?: Error;
}

function buildHarness(opts: HarnessOpts = {}) {
  const tokens = {
    sign: vi.fn(),
    verify: vi.fn().mockImplementation(() => {
      if (opts.verifyThrows) throw new Error('jwt expired');
      return opts.payload ?? PAYLOAD;
    }),
  };

  const reopenSpy = vi
    .fn()
    .mockImplementation(
      opts.reopenThrows
        ? () => Promise.reject(opts.reopenThrows)
        : () => Promise.resolve(opts.reopenResult ?? { id: PAYLOAD.ticketId, estado: 'reabierto' }),
    );
  const tickets = { reopen: reopenSpy };

  const updateOne = opts.updateOneThrows
    ? vi.fn().mockRejectedValue(opts.updateOneThrows)
    : vi.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 });
  const aiResponseModel = { updateOne };

  const controller = new ReopenFromEmailController(
    tokens as never,
    tickets as never,
    aiResponseModel as never,
  );
  return { controller, tokens, tickets, aiResponseModel };
}

describe('ReopenFromEmailController', () => {
  it('happy path: verify token, llama reopen con caller del solicitante y marca AiResponse', async () => {
    const { controller, tickets, aiResponseModel } = buildHarness();

    const result = await controller.reopen(PAYLOAD.ticketId, { token: 'tok' });

    expect(tickets.reopen).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: PAYLOAD.requesterId,
        tenantId: PAYLOAD.tenantId,
        role: 'empleado',
      }),
      PAYLOAD.ticketId,
      expect.objectContaining({ motivo: expect.stringContaining('insuficiente') }),
    );
    expect(aiResponseModel.updateOne).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ id: PAYLOAD.ticketId });
  });

  it('mapea token inválido a 401 sin llamar al reopen', async () => {
    const { controller, tickets } = buildHarness({ verifyThrows: true });

    const err = await controller.reopen(PAYLOAD.ticketId, { token: 'bad' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
    expect(tickets.reopen).not.toHaveBeenCalled();
  });

  it('rechaza con 403 si el ticketId del path no coincide con el del token', async () => {
    const { controller, tickets } = buildHarness();
    const otherTicketId = '69fe000000000000000000ff';
    const err = await controller.reopen(otherTicketId, { token: 'tok' }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiException);
    expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(tickets.reopen).not.toHaveBeenCalled();
  });

  it('si updateOne del flag falla, igual devuelve el reopen — el flag es best effort', async () => {
    const { controller } = buildHarness({
      updateOneThrows: new Error('mongo down'),
    });
    const result = await controller.reopen(PAYLOAD.ticketId, { token: 'tok' });
    expect(result).toMatchObject({ id: PAYLOAD.ticketId });
  });

  it('propaga error de reopen tal cual (estado inválido, gracia expirada, etc.)', async () => {
    const reopenError = new Error('TICKET_TRANSITION_INVALID');
    const { controller } = buildHarness({ reopenThrows: reopenError });
    const err = await controller.reopen(PAYLOAD.ticketId, { token: 'tok' }).catch((e) => e);
    expect(err).toBe(reopenError);
  });
});
