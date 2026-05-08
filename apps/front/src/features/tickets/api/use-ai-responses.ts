import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApproveWithChanges, DiscardAiResponse } from '@tikora/core';
import {
  approveAiResponse,
  approveAiResponseWithChanges,
  discardAiResponse,
  getTicketAiResponse,
} from './ai-responses-api';

export const aiResponseKeys = {
  byTicket: (ticketId: string) => ['ai-response', 'by-ticket', ticketId] as const,
};

/**
 * Hook que devuelve la sugerencia vigente del ticket. `data` es `null`
 * cuando no hay sugerencia (404 silencioso), o el objeto AiResponse
 * cuando sí. La query solo se dispara con un ticketId truthy.
 */
export function useTicketAiResponse(ticketId: string | undefined) {
  return useQuery({
    queryKey: aiResponseKeys.byTicket(ticketId ?? ''),
    queryFn: () => getTicketAiResponse(ticketId as string),
    enabled: Boolean(ticketId),
  });
}

function useInvalidateForTicket() {
  const qc = useQueryClient();
  return (ticketId: string) => {
    qc.invalidateQueries({ queryKey: aiResponseKeys.byTicket(ticketId) });
    // El estado del ticket cambia (cierra a `cerrado` con resolutionType=auto
    // tras aprobar, o vuelve a `escalado` tras descartar) y la lista de
    // interacciones gana entradas de sistema. Invalidamos ambos para que
    // la pantalla refresque.
    qc.invalidateQueries({ queryKey: ['tickets', 'detail', ticketId] });
    qc.invalidateQueries({ queryKey: ['tickets', 'interactions', ticketId] });
    // Invalida cualquier ['tickets', ...] (lista, mine, etc.) — react-query
    // trata el queryKey como prefix.
    qc.invalidateQueries({ queryKey: ['tickets'] });
  };
}

export function useApproveAiResponse() {
  const invalidate = useInvalidateForTicket();
  return useMutation({
    mutationFn: ({ id }: { id: string; ticketId: string }) => approveAiResponse(id),
    onSuccess: (_data, vars) => invalidate(vars.ticketId),
  });
}

export function useApproveAiResponseWithChanges() {
  const invalidate = useInvalidateForTicket();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; ticketId: string; input: ApproveWithChanges }) =>
      approveAiResponseWithChanges(id, input),
    onSuccess: (_data, vars) => invalidate(vars.ticketId),
  });
}

export function useDiscardAiResponse() {
  const invalidate = useInvalidateForTicket();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; ticketId: string; input: DiscardAiResponse }) =>
      discardAiResponse(id, input),
    onSuccess: (_data, vars) => invalidate(vars.ticketId),
  });
}
