import { BellIcon } from '@heroicons/react/24/outline';
import type { Notification } from '@tikora/core';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { useNotificationsStore } from '../../../stores/notifications.store';
import { cn } from '../../../lib/utils';
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useUnreadCount,
} from '../api/use-notifications';
import { NotificationListItem } from './notification-list-item';

/**
 * Campanita global en el topbar. Combina dos fuentes:
 *   - Store de Zustand (`recent`, `unreadCount`): se actualiza en
 *     tiempo real cuando llegan eventos por SSE.
 *   - TanStack Query (`useUnreadCount`): sync inicial y fallback si el
 *     SSE se cae. Se invalida desde `applyEventEffects`.
 *
 * Click en un item:
 *   - Marca como leída en el back y en el store.
 *   - Navega al ticket afectado (si la notif tiene `ticketId`).
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const recent = useNotificationsStore((s) => s.recent);
  const unreadCountStore = useNotificationsStore((s) => s.unreadCount);
  const sseStatus = useNotificationsStore((s) => s.sseStatus);
  const markRecentRead = useNotificationsStore((s) => s.markRecentRead);
  const markAllRecentRead = useNotificationsStore((s) => s.markAllRecentRead);

  // El store maneja el contador en tiempo real; la query es respaldo si
  // el SSE estuvo caído. Tomamos el máximo de ambos para evitar
  // sub-conteo justo después de la conexión inicial.
  const unreadQuery = useUnreadCount();
  const unreadCount = Math.max(unreadCountStore, unreadQuery.data?.count ?? 0);

  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const handleItemClick = (notification: Notification) => {
    if (!notification.read) {
      markRecentRead(notification.id);
      markReadMutation.mutate(notification.id);
    }
    if (notification.ticketId) {
      navigate(`/tickets/${notification.ticketId}`);
    }
  };

  const handleMarkAll = () => {
    markAllRecentRead();
    markAllReadMutation.mutate();
  };

  const showBadge = unreadCount > 0;
  const badgeText = unreadCount > 99 ? '99+' : String(unreadCount);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Notificaciones${showBadge ? ` (${unreadCount} sin leer)` : ''}`}
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <BellIcon className="h-5 w-5" />
          {showBadge && (
            <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-none text-white">
              {badgeText}
            </span>
          )}
          <span
            aria-hidden
            className={cn(
              'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full',
              sseStatus === 'connected' && 'bg-emerald-500',
              sseStatus === 'connecting' && 'bg-amber-400',
              sseStatus === 'reconnecting' && 'bg-amber-400 animate-pulse',
              (sseStatus === 'disconnected' || sseStatus === 'idle') && 'bg-slate-300',
            )}
          />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <span className="text-sm font-semibold text-slate-900">Notificaciones</span>
          <button
            type="button"
            onClick={handleMarkAll}
            disabled={unreadCount === 0 || markAllReadMutation.isPending}
            className="text-xs text-blue-700 hover:underline disabled:cursor-not-allowed disabled:text-slate-400 disabled:no-underline"
          >
            Marcar todas como leídas
          </button>
        </div>
        <div className="max-h-96 overflow-y-auto">
          {recent.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-slate-500">
              No tenés notificaciones recientes.
            </p>
          ) : (
            recent.map((notification) => (
              <NotificationListItem
                key={notification.id}
                notification={notification}
                onClick={handleItemClick}
              />
            ))
          )}
        </div>
        {sseStatus !== 'connected' && sseStatus !== 'idle' && (
          <div className="border-t border-slate-100 bg-slate-50 px-3 py-1.5 text-center text-[11px] text-slate-500">
            {sseStatus === 'connecting' && 'Conectando…'}
            {sseStatus === 'reconnecting' && 'Reconectando…'}
            {sseStatus === 'disconnected' && 'Sin conexión en tiempo real'}
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
