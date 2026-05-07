import { z } from 'zod';

/**
 * Catálogo de eventos que pueden generar una notificación + push SSE.
 * Subset del catálogo completo de `tikora-events.md` §2 — los demás se
 * agregan a medida que se cablean los productores correspondientes.
 */
export const notificationEventTypeSchema = z.enum([
  'TicketCreated',
  'TicketClassified',
  'TicketRequiresClassificationReview',
  'TicketAssigned',
  'TicketResolved',
  'TicketReopened',
  'InteractionAdded',
]);
export type NotificationEventType = z.infer<typeof notificationEventTypeSchema>;

export const notificationSchema = z.object({
  id: z.string(),
  recipientId: z.string(),
  type: notificationEventTypeSchema,
  ticketId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  read: z.boolean(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof notificationSchema>;

export const notificationListResponseSchema = z.object({
  items: z.array(notificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationListResponse = z.infer<typeof notificationListResponseSchema>;

export const unreadCountResponseSchema = z.object({
  count: z.number().int().nonnegative(),
});
export type UnreadCountResponse = z.infer<typeof unreadCountResponseSchema>;
