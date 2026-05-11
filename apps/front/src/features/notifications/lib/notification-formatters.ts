import type { Notification, NotificationEventType } from '@tikora/core';

/**
 * Helpers para extraer campos del `payload` genérico de Notification.
 *
 * Las notificaciones del back llevan un `payload: Record<string, unknown>`
 * cuyos campos varían por `type`. Centralizamos acá las lecturas seguras
 * para que el resto del front no haga casts ad hoc.
 */

function readString(payload: unknown, key: string): string | null {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
}

function readNumber(payload: unknown, key: string): number | null {
  if (payload && typeof payload === 'object' && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

const SEVERITY: Record<NotificationEventType, 'info' | 'success' | 'warning' | 'error'> = {
  TicketCreated: 'info',
  TicketClassified: 'info',
  TicketRequiresClassificationReview: 'warning',
  TicketAssigned: 'info',
  TicketResolved: 'success',
  TicketReopened: 'warning',
  TicketClosedDefinitively: 'info',
  InteractionAdded: 'info',
  AiResponseSuggested: 'info',
  AiResponseApproved: 'success',
  AiResponseSent: 'success',
  AiResponseDiscarded: 'info',
  AiResponseFailed: 'error',
  SlaApproaching: 'warning',
  SlaBreach: 'error',
};

export function severityFor(type: NotificationEventType): 'info' | 'success' | 'warning' | 'error' {
  return SEVERITY[type] ?? 'info';
}

/**
 * Construye el mensaje legible que se muestra como toast y como label
 * del item en la campanita. El `shortCode` viene en el payload de los
 * eventos donde aplica; cuando falta se usa el `ticketId` recortado.
 */
export function formatNotificationMessage(notification: Notification): string {
  const { type, payload, ticketId } = notification;
  const shortCode = readString(payload, 'shortCode');
  const ref = shortCode ?? (ticketId ? `#${ticketId.slice(-6)}` : '');

  switch (type) {
    case 'TicketCreated': {
      const asunto = readString(payload, 'asunto');
      return asunto ? `Tu ticket ${ref} fue creado: ${asunto}` : `Tu ticket ${ref} fue creado`;
    }
    case 'TicketClassified': {
      const resumen = readString(payload, 'resumen');
      const prioridad = readString(payload, 'prioridad');
      const prio = prioridad ? ` (prioridad ${prioridad})` : '';
      return resumen
        ? `Nuevo ticket en tu área${prio}: ${resumen}`
        : `Nuevo ticket en tu área${prio}`;
    }
    case 'TicketRequiresClassificationReview': {
      const outcome = readString(payload, 'outcome') ?? 'sin clasificación';
      return `Ticket ${ref} requiere revisión de clasificación (${outcome})`;
    }
    case 'TicketAssigned':
      return `Te asignaron el ticket ${ref}`;
    case 'TicketResolved': {
      return `Tu ticket ${ref} fue resuelto`;
    }
    case 'TicketReopened': {
      const motivo = readString(payload, 'motivo');
      return motivo ? `Reabrieron el ticket ${ref}: ${motivo}` : `Reabrieron el ticket ${ref}`;
    }
    case 'TicketClosedDefinitively':
      return `Ticket ${ref} cerrado definitivamente`;
    case 'InteractionAdded': {
      const snippet = readString(payload, 'contentSnippet');
      const author = readString(payload, 'authorType');
      const who =
        author === 'agente'
          ? 'el agente'
          : author === 'usuario'
          ? 'el solicitante'
          : 'un participante';
      return snippet
        ? `Nuevo comentario de ${who} en ${ref}: ${snippet}`
        : `Nuevo comentario de ${who} en ${ref}`;
    }
    case 'AiResponseSuggested': {
      const confianza = readNumber(payload, 'confianza');
      const pct = confianza !== null ? ` (confianza ${Math.round(confianza * 100)}%)` : '';
      return `Respuesta de IA lista para revisar en ${ref}${pct}`;
    }
    case 'AiResponseApproved':
      return `Auto-respuesta aprobada para ${ref}`;
    case 'AiResponseSent':
      return `Auto-respuesta enviada al solicitante de ${ref}`;
    case 'AiResponseDiscarded':
      return `Auto-respuesta descartada para ${ref}`;
    case 'AiResponseFailed': {
      const reason = readString(payload, 'reason') ?? 'error';
      return `Falló la generación de auto-respuesta en ${ref} (${reason})`;
    }
    case 'SlaApproaching': {
      const remaining = readNumber(payload, 'remainingMinutes');
      return remaining !== null
        ? `SLA de ${ref} vence en ${remaining} min`
        : `SLA de ${ref} por vencer`;
    }
    case 'SlaBreach': {
      const overdue = readNumber(payload, 'overdueMinutes');
      return overdue !== null
        ? `SLA de ${ref} vencido hace ${overdue} min`
        : `SLA de ${ref} vencido`;
    }
    default:
      return `Notificación: ${type}`;
  }
}
