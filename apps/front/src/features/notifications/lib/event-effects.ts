import type { QueryClient } from '@tanstack/react-query';
import type { Notification, NotificationEventType } from '@tikora/core';
import { aiResponseKeys } from '../../tickets/api/use-ai-responses';
import { ticketsKeys } from '../../tickets/api/use-tickets';
import { notificationsKeys } from '../api/use-notifications';

/**
 * Mapa de evento → queryKeys a invalidar cuando llega esa notificación
 * por SSE. Centralizado para no dispersar la lógica de refresh en cada
 * componente.
 *
 * Diseño:
 *   - Cada efecto recibe el queryClient y la notification.
 *   - Algunos efectos usan `ticketId` del propio notification; otros
 *     invalidan listas que no dependen de ticket (ej. bandeja).
 *   - Se prefiere invalidación granular (queryKey específica) sobre
 *     brute force, para no triplicar requests innecesarios.
 */

type Effect = (qc: QueryClient, notification: Notification) => void;

function invalidateDetailAndInbox(qc: QueryClient, notification: Notification): void {
  if (notification.ticketId) {
    qc.invalidateQueries({ queryKey: ticketsKeys.detail(notification.ticketId) });
  }
  // La bandeja se rebusca con filtros distintos según el caller; invalidar
  // por la rama 'list' alcanza para cubrir cualquier query con filtros.
  qc.invalidateQueries({ queryKey: ['tickets', 'list'] });
}

function invalidateDetailAndMine(qc: QueryClient, notification: Notification): void {
  if (notification.ticketId) {
    qc.invalidateQueries({ queryKey: ticketsKeys.detail(notification.ticketId) });
  }
  qc.invalidateQueries({ queryKey: ['tickets', 'mine'] });
}

const EFFECTS: Record<NotificationEventType, Effect> = {
  TicketCreated: invalidateDetailAndMine,
  TicketClassified: invalidateDetailAndInbox,
  TicketRequiresClassificationReview: invalidateDetailAndInbox,
  TicketAssigned: invalidateDetailAndInbox,
  TicketResolved: (qc, n) => {
    invalidateDetailAndMine(qc, n);
    qc.invalidateQueries({ queryKey: ['tickets', 'list'] });
  },
  TicketReopened: (qc, n) => {
    invalidateDetailAndInbox(qc, n);
    qc.invalidateQueries({ queryKey: ['tickets', 'mine'] });
  },
  TicketClosedDefinitively: invalidateDetailAndInbox,
  InteractionAdded: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: ticketsKeys.detail(n.ticketId) });
      qc.invalidateQueries({ queryKey: ticketsKeys.interactions(n.ticketId) });
    }
  },
  AiResponseSuggested: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: aiResponseKeys.byTicket(n.ticketId) });
      qc.invalidateQueries({ queryKey: ticketsKeys.detail(n.ticketId) });
    }
  },
  AiResponseApproved: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: aiResponseKeys.byTicket(n.ticketId) });
    }
  },
  AiResponseSent: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: aiResponseKeys.byTicket(n.ticketId) });
      qc.invalidateQueries({ queryKey: ticketsKeys.detail(n.ticketId) });
    }
  },
  AiResponseDiscarded: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: aiResponseKeys.byTicket(n.ticketId) });
    }
  },
  AiResponseFailed: (qc, n) => {
    if (n.ticketId) {
      qc.invalidateQueries({ queryKey: aiResponseKeys.failedByTicket(n.ticketId) });
      qc.invalidateQueries({ queryKey: ticketsKeys.detail(n.ticketId) });
    }
  },
  SlaApproaching: invalidateDetailAndInbox,
  SlaBreach: invalidateDetailAndInbox,
};

/**
 * Aplica las invalidaciones definidas para el evento de la notificación.
 * Siempre invalida también la rama de notificaciones (para mantener
 * sincronizada la lista completa que abre la campanita).
 */
export function applyEventEffects(qc: QueryClient, notification: Notification): void {
  const effect = EFFECTS[notification.type];
  if (effect) effect(qc, notification);
  qc.invalidateQueries({ queryKey: notificationsKeys.all });
}
