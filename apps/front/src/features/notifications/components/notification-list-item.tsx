import type { Notification } from '@tikora/core';
import { formatNotificationMessage, severityFor } from '../lib/notification-formatters';
import { cn } from '../../../lib/utils';

interface NotificationListItemProps {
  notification: Notification;
  onClick: (notification: Notification) => void;
}

const SEVERITY_DOT: Record<ReturnType<typeof severityFor>, string> = {
  info: 'bg-blue-500',
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  error: 'bg-red-500',
};

export function NotificationListItem({ notification, onClick }: NotificationListItemProps) {
  const message = formatNotificationMessage(notification);
  const severity = severityFor(notification.type);
  const createdAt = new Date(notification.createdAt);

  return (
    <button
      type="button"
      onClick={() => onClick(notification)}
      className={cn(
        'flex w-full items-start gap-3 border-b border-slate-100 px-3 py-2.5 text-left text-sm transition-colors last:border-b-0 hover:bg-slate-50',
        !notification.read && 'bg-blue-50/40',
      )}
    >
      <span
        aria-hidden
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEVERITY_DOT[severity])}
      />
      <span className="flex-1 space-y-0.5">
        <span
          className={cn('block leading-snug text-slate-900', !notification.read && 'font-medium')}
        >
          {message}
        </span>
        <span className="block text-xs text-slate-500">{formatRelative(createdAt)}</span>
      </span>
    </button>
  );
}

function formatRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `hace ${days} d`;
  return date.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}
