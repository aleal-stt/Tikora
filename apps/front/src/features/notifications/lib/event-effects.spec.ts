import { QueryClient } from '@tanstack/react-query';
import type { Notification } from '@tikora/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyEventEffects } from './event-effects';

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n_1',
    recipientId: 'u_1',
    type: 'TicketCreated',
    ticketId: 't_1',
    payload: {},
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('applyEventEffects', () => {
  let qc: QueryClient;
  let invalidateSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    qc = new QueryClient();
    invalidateSpy = vi.spyOn(qc, 'invalidateQueries') as unknown as ReturnType<typeof vi.fn>;
  });

  it('TicketCreated invalida detail y mine', () => {
    applyEventEffects(qc, buildNotification({ type: 'TicketCreated', ticketId: 'abc' }));
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['tickets', 'detail', 'abc']);
    expect(keys).toContainEqual(['tickets', 'mine']);
    expect(keys).toContainEqual(['notifications']);
  });

  it('InteractionAdded invalida detail e interactions del ticket', () => {
    applyEventEffects(qc, buildNotification({ type: 'InteractionAdded', ticketId: 'abc' }));
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['tickets', 'detail', 'abc']);
    expect(keys).toContainEqual(['tickets', 'interactions', 'abc']);
  });

  it('AiResponseSuggested invalida ai-response by-ticket', () => {
    applyEventEffects(qc, buildNotification({ type: 'AiResponseSuggested', ticketId: 'abc' }));
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['ai-response', 'by-ticket', 'abc']);
  });

  it('AiResponseFailed invalida ai-response failed-by-ticket', () => {
    applyEventEffects(qc, buildNotification({ type: 'AiResponseFailed', ticketId: 'abc' }));
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['ai-response', 'failed-by-ticket', 'abc']);
  });

  it('SlaBreach invalida list e detail', () => {
    applyEventEffects(qc, buildNotification({ type: 'SlaBreach', ticketId: 'abc' }));
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['tickets', 'detail', 'abc']);
    expect(keys).toContainEqual(['tickets', 'list']);
  });

  it('sin ticketId no rompe (TicketClosedDefinitively puede llegar sin él)', () => {
    expect(() =>
      applyEventEffects(
        qc,
        buildNotification({ type: 'TicketClosedDefinitively', ticketId: null }),
      ),
    ).not.toThrow();
    // Igualmente invalida la rama de notificaciones.
    const keys = invalidateSpy.mock.calls.map((c) => (c[0] as { queryKey: unknown[] })?.queryKey);
    expect(keys).toContainEqual(['notifications']);
  });
});
