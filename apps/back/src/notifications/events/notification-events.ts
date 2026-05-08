import type { NotificationEventType, Prioridad } from '@tikora/core';

/**
 * Tabla de constantes de eventos. Usar las claves al emitir/escuchar
 * para evitar typos y centralizar los nombres en un solo lugar.
 */
export const NOTIFICATION_EVENTS = {
  TicketCreated: 'TicketCreated',
  TicketClassified: 'TicketClassified',
  TicketRequiresClassificationReview: 'TicketRequiresClassificationReview',
  TicketAssigned: 'TicketAssigned',
  TicketResolved: 'TicketResolved',
  TicketReopened: 'TicketReopened',
  InteractionAdded: 'InteractionAdded',
  // Eventos de auto-respuesta — se emiten desde `auto-response/services/*`
  // pero los suscriptores (notifications listener, métricas) los buscan
  // por estas claves para mantener un único catálogo de nombres.
  AiResponseSuggested: 'AiResponseSuggested',
  AiResponseApproved: 'AiResponseApproved',
  AiResponseSent: 'AiResponseSent',
  AiResponseDiscarded: 'AiResponseDiscarded',
  AiResponseFailed: 'AiResponseFailed',
} as const satisfies Record<NotificationEventType, NotificationEventType>;

interface BaseEvent {
  tenantId: string;
  ticketId: string;
}

export interface TicketCreatedEvent extends BaseEvent {
  shortCode: string;
  requesterId: string;
  asunto: string;
  cuerpoSnippet: string;
}

export interface TicketClassifiedEvent extends BaseEvent {
  classificationId: string;
  areaId: string;
  prioridad: Prioridad;
  confianza: number;
  resumen: string;
  tags: string[];
  modelo: string;
  promptVersion: string;
}

export interface TicketRequiresClassificationReviewEvent extends BaseEvent {
  /** Área sugerida por la IA (puede ser null si la sugerencia fue inválida). */
  suggestedAreaId: string | null;
  outcome: string;
  outcomeDetail: string | null;
}

export interface TicketAssignedEvent extends BaseEvent {
  agentId: string;
  assignedBy: string;
  areaId: string;
}

export interface TicketResolvedEvent extends BaseEvent {
  requesterId: string;
  resolvedBy: string;
  nota: string;
}

export interface TicketReopenedEvent extends BaseEvent {
  reopenCount: number;
  lastAssignedAgentId: string | null;
  motivo: string;
}

export interface InteractionAddedEvent extends BaseEvent {
  interactionId: string;
  authorId: string;
  type: 'usuario' | 'agente';
  contentSnippet: string;
  /** Pre-resueltos por el productor para que el listener no necesite mirar la DB. */
  participantIds: string[];
}

// -------- auto-respuesta (Fase 2+) --------
//
// Las constantes están en `NOTIFICATION_EVENTS` arriba; las interfaces
// viven acá para mantener un único catálogo del shape de cada evento del
// bus, igual que hacen los eventos de tickets. El módulo `auto-response`
// los importa para emitir; este listener los importa para suscribirse.

export interface AiResponseSuggestedEvent extends BaseEvent {
  aiResponseId: string;
  /** Área del ticket — el listener resuelve a quién notificar. */
  areaId: string;
  confianza: number;
}

export interface AiResponseApprovedEvent extends BaseEvent {
  aiResponseId: string;
  approvedBy: string;
  edited: boolean;
}

export interface AiResponseSentEvent extends BaseEvent {
  aiResponseId: string;
  /** Solicitante del ticket — para notificar el cierre. */
  requesterId: string;
  emailMessageId: string | null;
}

export interface AiResponseDiscardedEvent extends BaseEvent {
  aiResponseId: string;
  discardedBy: string;
  motivo: string;
}

export interface AiResponseFailedEvent extends BaseEvent {
  reason: 'no_kb_match' | 'not_respondable' | 'api_error' | 'validation_error';
  detail: string | null;
}
