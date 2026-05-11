import type { Notification } from '@tikora/core';
import { describe, expect, it } from 'vitest';
import { formatNotificationMessage, severityFor } from './notification-formatters';

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

describe('formatNotificationMessage', () => {
  it('TicketCreated incluye shortCode y asunto', () => {
    const message = formatNotificationMessage(
      buildNotification({
        type: 'TicketCreated',
        payload: { shortCode: 'TIK-42', asunto: 'No tengo internet' },
      }),
    );
    expect(message).toContain('TIK-42');
    expect(message).toContain('No tengo internet');
  });

  it('TicketCreated sin asunto solo muestra el shortCode', () => {
    const message = formatNotificationMessage(
      buildNotification({ type: 'TicketCreated', payload: { shortCode: 'TIK-1' } }),
    );
    expect(message).toBe('Tu ticket TIK-1 fue creado');
  });

  it('AiResponseSuggested muestra confianza redondeada', () => {
    const message = formatNotificationMessage(
      buildNotification({
        type: 'AiResponseSuggested',
        payload: { shortCode: 'TIK-7', confianza: 0.876 },
      }),
    );
    expect(message).toContain('TIK-7');
    expect(message).toContain('88%');
  });

  it('SlaApproaching muestra remainingMinutes', () => {
    const message = formatNotificationMessage(
      buildNotification({
        type: 'SlaApproaching',
        payload: { shortCode: 'TIK-3', remainingMinutes: 17 },
      }),
    );
    expect(message).toContain('17 min');
  });

  it('cae al ticketId recortado si no hay shortCode', () => {
    const message = formatNotificationMessage(
      buildNotification({
        type: 'TicketResolved',
        ticketId: '69fe050734dd5c5b51a82355',
        payload: {},
      }),
    );
    expect(message).toContain('#a82355');
  });

  it('InteractionAdded distingue agente vs solicitante', () => {
    const m1 = formatNotificationMessage(
      buildNotification({
        type: 'InteractionAdded',
        payload: { shortCode: 'TIK-1', authorType: 'agente', contentSnippet: 'hola' },
      }),
    );
    const m2 = formatNotificationMessage(
      buildNotification({
        type: 'InteractionAdded',
        payload: { shortCode: 'TIK-1', authorType: 'usuario', contentSnippet: 'hola' },
      }),
    );
    expect(m1).toContain('el agente');
    expect(m2).toContain('el solicitante');
  });
});

describe('severityFor', () => {
  it('mapea los tipos a la severidad correcta', () => {
    expect(severityFor('TicketResolved')).toBe('success');
    expect(severityFor('SlaBreach')).toBe('error');
    expect(severityFor('SlaApproaching')).toBe('warning');
    expect(severityFor('TicketCreated')).toBe('info');
    expect(severityFor('AiResponseFailed')).toBe('error');
  });
});
