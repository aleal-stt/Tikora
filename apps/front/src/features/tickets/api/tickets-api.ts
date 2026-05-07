import type {
  AssignAgent,
  AssignArea,
  CancelTicket,
  ClassifyTicket,
  CreateInteraction,
  CreateTicket,
  Interaction,
  InteractionListResponse,
  ReopenTicket,
  ResolveTicket,
  Ticket,
  TicketListResponse,
} from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export interface ListTicketsParams {
  cursor?: string;
  limit?: number;
  estado?: string[];
  prioridad?: string[];
  areaId?: string[];
  assignedToMe?: boolean;
  requesterId?: string;
}

function toQueryString(params: object): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) search.append(key, String(v));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function listMisTickets(params: ListTicketsParams = {}) {
  return apiFetch<TicketListResponse>(`/tickets/me${toQueryString(params)}`);
}

export async function listTickets(params: ListTicketsParams = {}) {
  return apiFetch<TicketListResponse>(`/tickets${toQueryString(params)}`);
}

export async function getTicket(id: string) {
  return apiFetch<Ticket>(`/tickets/${id}`);
}

export async function createTicket(input: CreateTicket) {
  return apiFetch<Ticket>('/tickets', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function takeTicket(id: string) {
  return apiFetch<Ticket>(`/tickets/${id}/take`, { method: 'PATCH' });
}

export async function resolveTicket(id: string, input: ResolveTicket) {
  return apiFetch<Ticket>(`/tickets/${id}/resolve`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function cancelTicket(id: string, input: CancelTicket) {
  return apiFetch<Ticket>(`/tickets/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function reopenTicket(id: string, input: ReopenTicket) {
  return apiFetch<Ticket>(`/tickets/${id}/reopen`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function assignAgent(id: string, input: AssignAgent) {
  return apiFetch<Ticket>(`/tickets/${id}/assign-agent`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function assignArea(id: string, input: AssignArea) {
  return apiFetch<Ticket>(`/tickets/${id}/assign-area`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function classifyTicket(id: string, input: ClassifyTicket) {
  return apiFetch<Ticket>(`/tickets/${id}/classification`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function listInteractions(
  ticketId: string,
  params: { cursor?: string; limit?: number } = {},
) {
  return apiFetch<InteractionListResponse>(
    `/tickets/${ticketId}/interactions${toQueryString(params)}`,
  );
}

export async function addInteraction(ticketId: string, input: CreateInteraction) {
  return apiFetch<Interaction>(`/tickets/${ticketId}/interactions`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
