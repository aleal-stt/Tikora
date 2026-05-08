import type { AiResponseEventType } from '@tikora/core';

/**
 * Catálogo de eventos del módulo `auto-response`. Match con
 * `tikora-events.md` §3.4. Los eventos `Suggested`/`Approved`/`Sent`/
 * `Discarded`/`Failed` están además en `notificationEventTypeSchema`
 * porque disparan notificación al usuario.
 */
export const AUTO_RESPONSE_EVENTS = {
  AiResponseGenerationRequested: 'AiResponseGenerationRequested',
  AiResponseSuggested: 'AiResponseSuggested',
  AiResponseApproved: 'AiResponseApproved',
  AiResponseSent: 'AiResponseSent',
  AiResponseDiscarded: 'AiResponseDiscarded',
  AiResponseFailed: 'AiResponseFailed',
} as const satisfies Record<AiResponseEventType, AiResponseEventType>;

interface BaseAutoResponseEvent {
  tenantId: string;
  ticketId: string;
}

export interface AiResponseGenerationRequestedEvent extends BaseAutoResponseEvent {
  classificationId: string;
}

export interface AiResponseSuggestedEvent extends BaseAutoResponseEvent {
  aiResponseId: string;
  /** Área del ticket — el listener lo usa para resolver agentes/líder a notificar. */
  areaId: string;
  confianza: number;
}

export interface AiResponseApprovedEvent extends BaseAutoResponseEvent {
  aiResponseId: string;
  approvedBy: string;
  edited: boolean;
}

export interface AiResponseSentEvent extends BaseAutoResponseEvent {
  aiResponseId: string;
  /** Solicitante del ticket — para notificar el cierre. */
  requesterId: string;
  emailMessageId: string | null;
}

export interface AiResponseDiscardedEvent extends BaseAutoResponseEvent {
  aiResponseId: string;
  discardedBy: string;
  motivo: string;
}

export interface AiResponseFailedEvent extends BaseAutoResponseEvent {
  reason: 'no_kb_match' | 'not_respondable' | 'api_error' | 'validation_error';
  detail: string | null;
}
