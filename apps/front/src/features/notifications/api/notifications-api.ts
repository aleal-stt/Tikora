import type { Notification, NotificationListResponse, UnreadCountResponse } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export interface ListNotificationsParams {
  cursor?: string;
  limit?: number;
  read?: boolean;
  type?: string;
}

export async function listNotifications(
  params: ListNotificationsParams = {},
): Promise<NotificationListResponse> {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.read !== undefined) search.set('read', String(params.read));
  if (params.type) search.set('type', params.type);
  const qs = search.toString();
  return apiFetch<NotificationListResponse>(`/notifications${qs ? `?${qs}` : ''}`);
}

export async function getUnreadCount(): Promise<UnreadCountResponse> {
  return apiFetch<UnreadCountResponse>('/notifications/unread-count');
}

export async function markNotificationRead(id: string): Promise<Notification> {
  return apiFetch<Notification>(`/notifications/${id}/read`, { method: 'PATCH' });
}

export async function markAllNotificationsRead(): Promise<{ updated: number }> {
  return apiFetch<{ updated: number }>('/notifications/read-all', { method: 'PATCH' });
}

export interface SseTicketResponse {
  ticket: string;
  expiresAt: string;
}

/**
 * Pide un ticket de vida corta (single-use, ~90s) para abrir el stream SSE.
 * `EventSource` no permite headers, así que el ticket viaja en query param.
 * Decisión §25.
 */
export async function fetchSseTicket(): Promise<SseTicketResponse> {
  return apiFetch<SseTicketResponse>('/auth/sse-ticket', { method: 'POST' });
}
