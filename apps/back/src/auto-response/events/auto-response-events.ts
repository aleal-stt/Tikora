import { NOTIFICATION_EVENTS } from '../../notifications/events/notification-events';

/**
 * Alias del subset de `NOTIFICATION_EVENTS` que pertenecen al dominio de
 * auto-respuesta. Las constantes apuntan al mismo string de evento del
 * bus — usar este alias dentro del módulo deja el código auto-explicativo
 * sin duplicar el catálogo.
 *
 * Las **interfaces** de cada evento (`AiResponseSuggestedEvent`, etc.)
 * viven en `notifications/events/notification-events.ts` junto a las del
 * resto del bus para que los suscriptores (listener de notifications,
 * métricas, SSE) compartan un único shape.
 */
export const AUTO_RESPONSE_EVENTS = {
  AiResponseGenerationRequested: 'AiResponseGenerationRequested',
  AiResponseSuggested: NOTIFICATION_EVENTS.AiResponseSuggested,
  AiResponseApproved: NOTIFICATION_EVENTS.AiResponseApproved,
  AiResponseSent: NOTIFICATION_EVENTS.AiResponseSent,
  AiResponseDiscarded: NOTIFICATION_EVENTS.AiResponseDiscarded,
  AiResponseFailed: NOTIFICATION_EVENTS.AiResponseFailed,
} as const;

export interface AiResponseGenerationRequestedEvent {
  tenantId: string;
  ticketId: string;
  classificationId: string;
}

// Re-export de las interfaces del catálogo central — los servicios del
// módulo importan desde acá por proximidad semántica.
export type {
  AiResponseSuggestedEvent,
  AiResponseApprovedEvent,
  AiResponseSentEvent,
  AiResponseDiscardedEvent,
  AiResponseFailedEvent,
} from '../../notifications/events/notification-events';
