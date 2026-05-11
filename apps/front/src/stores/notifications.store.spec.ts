import type { Notification } from '@tikora/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { useNotificationsStore } from './notifications.store';

function buildNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n_1',
    recipientId: 'u_1',
    type: 'TicketCreated',
    ticketId: 't_1',
    payload: { shortCode: 'TIK-1', asunto: 'algo' },
    read: false,
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('useNotificationsStore', () => {
  beforeEach(() => {
    useNotificationsStore.getState().reset();
  });

  it('prependNotification agrega al inicio y aumenta unread si no estaba leída', () => {
    useNotificationsStore.getState().prependNotification(buildNotification({ id: 'a' }));
    useNotificationsStore.getState().prependNotification(buildNotification({ id: 'b' }));
    const state = useNotificationsStore.getState();
    expect(state.recent.map((n) => n.id)).toEqual(['b', 'a']);
    expect(state.unreadCount).toBe(2);
  });

  it('una notificación ya leída no incrementa unreadCount', () => {
    useNotificationsStore
      .getState()
      .prependNotification(buildNotification({ id: 'a', read: true }));
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });

  it('si llega una notificación duplicada (mismo id), reemplaza y no duplica', () => {
    const store = useNotificationsStore.getState();
    store.prependNotification(buildNotification({ id: 'a', payload: { v: 1 } }));
    store.prependNotification(buildNotification({ id: 'a', payload: { v: 2 } }));
    const state = useNotificationsStore.getState();
    expect(state.recent).toHaveLength(1);
    expect((state.recent[0]?.payload as { v: number }).v).toBe(2);
  });

  it('markRecentRead baja unreadCount solo si la notif no estaba leída', () => {
    const store = useNotificationsStore.getState();
    store.prependNotification(buildNotification({ id: 'a' }));
    store.prependNotification(buildNotification({ id: 'b' }));
    store.markRecentRead('a');
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
    // Volverla a marcar es idempotente.
    store.markRecentRead('a');
    expect(useNotificationsStore.getState().unreadCount).toBe(1);
  });

  it('markAllRecentRead marca todas y deja unreadCount en 0', () => {
    const store = useNotificationsStore.getState();
    store.prependNotification(buildNotification({ id: 'a' }));
    store.prependNotification(buildNotification({ id: 'b' }));
    store.markAllRecentRead();
    const state = useNotificationsStore.getState();
    expect(state.recent.every((n) => n.read)).toBe(true);
    expect(state.unreadCount).toBe(0);
  });

  it('recent está capeado a 50', () => {
    const store = useNotificationsStore.getState();
    for (let i = 0; i < 60; i += 1) {
      store.prependNotification(buildNotification({ id: `n_${i}` }));
    }
    expect(useNotificationsStore.getState().recent).toHaveLength(50);
  });

  it('hydrateRecent reemplaza la lista', () => {
    const store = useNotificationsStore.getState();
    store.prependNotification(buildNotification({ id: 'old' }));
    store.hydrateRecent([buildNotification({ id: 'h1' }), buildNotification({ id: 'h2' })]);
    expect(useNotificationsStore.getState().recent.map((n) => n.id)).toEqual(['h1', 'h2']);
  });

  it('setUnreadCount nunca baja de 0', () => {
    useNotificationsStore.getState().setUnreadCount(-3);
    expect(useNotificationsStore.getState().unreadCount).toBe(0);
  });
});
