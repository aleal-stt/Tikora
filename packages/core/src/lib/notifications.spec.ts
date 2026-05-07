import {
  notificationEventTypeSchema,
  notificationSchema,
  unreadCountResponseSchema,
} from './notifications';

describe('notifications contracts', () => {
  it('lista cerrada de event types incluye los 7 del Sprint 9', () => {
    [
      'TicketCreated',
      'TicketClassified',
      'TicketRequiresClassificationReview',
      'TicketAssigned',
      'TicketResolved',
      'TicketReopened',
      'InteractionAdded',
    ].forEach((t) => {
      expect(notificationEventTypeSchema.safeParse(t).success).toBe(true);
    });
  });

  it('rechaza event type fuera del catálogo', () => {
    expect(notificationEventTypeSchema.safeParse('AiResponseSent').success).toBe(false);
  });

  it('valida una notification con payload arbitrario', () => {
    const result = notificationSchema.safeParse({
      id: 'n_1',
      recipientId: 'u_1',
      type: 'TicketAssigned',
      ticketId: 't_1',
      payload: { ticketId: 't_1', shortCode: 'TIK-7', agentId: 'u_2' },
      read: false,
      readAt: null,
      createdAt: '2026-05-07T15:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('unreadCountResponseSchema rechaza count negativo', () => {
    expect(unreadCountResponseSchema.safeParse({ count: -1 }).success).toBe(false);
  });
});
