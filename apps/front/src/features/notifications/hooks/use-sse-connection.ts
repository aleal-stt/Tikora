import { useQueryClient } from '@tanstack/react-query';
import { notificationSchema, type Notification, type NotificationEventType } from '@tikora/core';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { toast } from 'sonner';
import { SseClient, type SseFrame } from '../../../lib/sse-client';
import { useAuthStore } from '../../../stores/auth.store';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { getUnreadCount, listNotifications } from '../api/notifications-api';
import { notificationsKeys } from '../api/use-notifications';
import { applyEventEffects } from '../lib/event-effects';
import { formatNotificationMessage, severityFor } from '../lib/notification-formatters';

/**
 * Hook global que monta la conexión SSE única (decisión §23). Se llama
 * una sola vez desde `AppShell` cuando el usuario está autenticado.
 *
 * Responsabilidades:
 *   1. Abrir y mantener el stream con reconexión automática.
 *   2. Al recibir `ready`, hidratar el store con las últimas 50 notifs
 *      y el unread count (decisión: sync inicial al conectar).
 *   3. Al recibir un evento de notificación: parsear → store → effects
 *      (invalidate queries) → toast (suprimido si estoy viendo el
 *      ticket afectado).
 *   4. Cerrar el stream al desmontar o al perder autenticación.
 */
export function useSseConnection(): void {
  const qc = useQueryClient();
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const location = useLocation();
  // El path actual lo leemos por ref para que cada frame consulte el
  // último valor sin necesidad de recrear el SseClient en cada nav.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const setSseStatus = useNotificationsStore((s) => s.setSseStatus);
  const setHeartbeat = useNotificationsStore((s) => s.setHeartbeat);
  const setUnreadCount = useNotificationsStore((s) => s.setUnreadCount);
  const hydrateRecent = useNotificationsStore((s) => s.hydrateRecent);
  const prependNotification = useNotificationsStore((s) => s.prependNotification);
  const resetStore = useNotificationsStore((s) => s.reset);

  useEffect(() => {
    if (status !== 'authenticated' || !userId) {
      return;
    }

    const client = new SseClient({
      onStatus: (s) => setSseStatus(s),
      onFrame: (frame) => handleFrame(frame),
    });

    async function handleReady(): Promise<void> {
      // Sync inicial: pull las últimas 50 + count. Cubre el gap entre
      // reconexiones, así no perdemos notifs creadas mientras el SSE
      // estaba caído.
      try {
        const [list, countRes] = await Promise.all([
          listNotifications({ limit: 50 }),
          getUnreadCount(),
        ]);
        hydrateRecent(list.items);
        setUnreadCount(countRes.count);
      } catch {
        // Si el sync falla no interrumpimos la sesión: el SSE sigue
        // funcionando para los eventos nuevos.
      }
      qc.invalidateQueries({ queryKey: notificationsKeys.all });
    }

    function handleFrame(frame: SseFrame): void {
      if (frame.type === 'ready') {
        void handleReady();
        return;
      }
      if (frame.type === 'heartbeat') {
        setHeartbeat(Date.now());
        return;
      }
      // El resto son eventos de notificación: parsear con Zod y procesar.
      const parsed = notificationSchema.safeParse(frame.data);
      if (!parsed.success) return;
      processNotification(parsed.data);
    }

    function processNotification(notification: Notification): void {
      prependNotification(notification);
      applyEventEffects(qc, notification);
      // Toast suprimido si estoy mirando el ticket afectado.
      if (shouldSuppressToast(notification, pathRef.current)) return;
      emitToast(notification);
    }

    setSseStatus('connecting');
    void client.connect();

    return () => {
      client.disconnect();
      resetStore();
    };
  }, [
    status,
    userId,
    qc,
    setSseStatus,
    setHeartbeat,
    setUnreadCount,
    hydrateRecent,
    prependNotification,
    resetStore,
  ]);
}

function shouldSuppressToast(notification: Notification, pathname: string): boolean {
  if (!notification.ticketId) return false;
  return pathname === `/tickets/${notification.ticketId}`;
}

function emitToast(notification: Notification): void {
  const message = formatNotificationMessage(notification);
  const severity = severityFor(notification.type as NotificationEventType);
  switch (severity) {
    case 'success':
      toast.success(message);
      return;
    case 'warning':
      toast.warning(message);
      return;
    case 'error':
      toast.error(message);
      return;
    default:
      toast.info(message);
  }
}
