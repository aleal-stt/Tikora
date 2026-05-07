import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelTicket,
  CreateInteraction,
  CreateTicket,
  ReopenTicket,
  ResolveTicket,
} from '@tikora/core';
import {
  addInteraction,
  cancelTicket,
  createTicket,
  getTicket,
  listInteractions,
  listMisTickets,
  listTickets,
  reopenTicket,
  resolveTicket,
  takeTicket,
  type ListTicketsParams,
} from './tickets-api';

const ticketsKeys = {
  all: ['tickets'] as const,
  list: (params: ListTicketsParams) => ['tickets', 'list', params] as const,
  mine: (params: ListTicketsParams) => ['tickets', 'mine', params] as const,
  detail: (id: string) => ['tickets', 'detail', id] as const,
  interactions: (ticketId: string) => ['tickets', 'interactions', ticketId] as const,
};

export function useMisTickets(params: ListTicketsParams = {}) {
  return useQuery({
    queryKey: ticketsKeys.mine(params),
    queryFn: () => listMisTickets(params),
  });
}

export function useBandeja(params: ListTicketsParams = {}) {
  return useQuery({
    queryKey: ticketsKeys.list(params),
    queryFn: () => listTickets(params),
  });
}

export function useTicket(id: string) {
  return useQuery({
    queryKey: ticketsKeys.detail(id),
    queryFn: () => getTicket(id),
    enabled: Boolean(id),
  });
}

export function useInteractions(ticketId: string) {
  return useQuery({
    queryKey: ticketsKeys.interactions(ticketId),
    queryFn: () => listInteractions(ticketId, { limit: 100 }),
    enabled: Boolean(ticketId),
  });
}

/**
 * Helper para invalidar listas + detalle tras una mutación. Lo usamos
 * en cada acción que cambia el estado del ticket. El back ya emite
 * SSE para sincronizar otros clientes; localmente refetcheamos.
 */
function useInvalidateTicket() {
  const qc = useQueryClient();
  return (ticketId: string) => {
    qc.invalidateQueries({ queryKey: ticketsKeys.all });
    qc.invalidateQueries({ queryKey: ticketsKeys.detail(ticketId) });
    qc.invalidateQueries({ queryKey: ticketsKeys.interactions(ticketId) });
  };
}

export function useCreateTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTicket) => createTicket(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ticketsKeys.all });
    },
  });
}

export function useTakeTicket(ticketId: string) {
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: () => takeTicket(ticketId),
    onSuccess: () => invalidate(ticketId),
  });
}

export function useResolveTicket(ticketId: string) {
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (input: ResolveTicket) => resolveTicket(ticketId, input),
    onSuccess: () => invalidate(ticketId),
  });
}

export function useCancelTicket(ticketId: string) {
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (input: CancelTicket) => cancelTicket(ticketId, input),
    onSuccess: () => invalidate(ticketId),
  });
}

export function useReopenTicket(ticketId: string) {
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (input: ReopenTicket) => reopenTicket(ticketId, input),
    onSuccess: () => invalidate(ticketId),
  });
}

export function useAddInteraction(ticketId: string) {
  const invalidate = useInvalidateTicket();
  return useMutation({
    mutationFn: (input: CreateInteraction) => addInteraction(ticketId, input),
    onSuccess: () => invalidate(ticketId),
  });
}
