import type { Notification } from '@tikora/core';
import { create } from 'zustand';

type SseStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'disconnected';

interface NotificationsState {
  /** Estado de la conexión SSE global. */
  sseStatus: SseStatus;
  /** Timestamp del último heartbeat recibido; null si no se recibió ninguno. */
  lastHeartbeatAt: number | null;
  /** Cantidad de notificaciones sin leer del usuario actual. */
  unreadCount: number;
  /**
   * Cache liviano de las últimas 50 notificaciones recibidas en esta sesión.
   * Sirve para mostrar el dropdown sin pegarle a la API en cada apertura.
   * El histórico completo se trae bajo demanda desde GET /notifications.
   */
  recent: Notification[];

  setSseStatus: (status: SseStatus) => void;
  setHeartbeat: (ts: number) => void;
  setUnreadCount: (count: number) => void;
  prependNotification: (notification: Notification) => void;
  markRecentRead: (id: string) => void;
  markAllRecentRead: () => void;
  hydrateRecent: (items: Notification[]) => void;
  reset: () => void;
}

const RECENT_CAP = 50;

export const useNotificationsStore = create<NotificationsState>((set) => ({
  sseStatus: 'idle',
  lastHeartbeatAt: null,
  unreadCount: 0,
  recent: [],

  setSseStatus: (sseStatus) => set({ sseStatus }),
  setHeartbeat: (ts) => set({ lastHeartbeatAt: ts }),
  setUnreadCount: (count) => set({ unreadCount: Math.max(0, count) }),

  prependNotification: (notification) =>
    set((state) => {
      const filtered = state.recent.filter((n) => n.id !== notification.id);
      return {
        recent: [notification, ...filtered].slice(0, RECENT_CAP),
        unreadCount: notification.read ? state.unreadCount : state.unreadCount + 1,
      };
    }),

  markRecentRead: (id) =>
    set((state) => {
      let wasUnread = false;
      const recent = state.recent.map((n) => {
        if (n.id !== id) return n;
        if (!n.read) wasUnread = true;
        return { ...n, read: true, readAt: new Date().toISOString() };
      });
      return {
        recent,
        unreadCount: wasUnread ? Math.max(0, state.unreadCount - 1) : state.unreadCount,
      };
    }),

  markAllRecentRead: () =>
    set((state) => ({
      recent: state.recent.map((n) =>
        n.read ? n : { ...n, read: true, readAt: new Date().toISOString() },
      ),
      unreadCount: 0,
    })),

  hydrateRecent: (items) =>
    set({
      recent: items.slice(0, RECENT_CAP),
    }),

  reset: () =>
    set({
      sseStatus: 'idle',
      lastHeartbeatAt: null,
      unreadCount: 0,
      recent: [],
    }),
}));
