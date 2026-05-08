import type { AiResponse, ApproveWithChanges, DiscardAiResponse } from '@tikora/core';
import { ApiError, apiFetch } from '../../../lib/api-client';

/**
 * Devuelve la sugerencia IA vigente del ticket, o `null` si el back
 * responde 404 (no hay sugerida vigente). Tratamos el 404 como
 * "no encontrado" para que el `useQuery` quede en `data: null` en vez
 * de `isError: true` y el componente solo tenga que chequear si hay
 * sugerencia o no, sin lógica de error rojo.
 */
export async function getTicketAiResponse(ticketId: string): Promise<AiResponse | null> {
  try {
    return await apiFetch<AiResponse>(`/tickets/${ticketId}/ai-response`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function approveAiResponse(id: string) {
  return apiFetch<AiResponse>(`/ai-responses/${id}/approve`, {
    method: 'PATCH',
  });
}

export async function approveAiResponseWithChanges(id: string, input: ApproveWithChanges) {
  return apiFetch<AiResponse>(`/ai-responses/${id}/approve-with-changes`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function discardAiResponse(id: string, input: DiscardAiResponse) {
  return apiFetch<AiResponse>(`/ai-responses/${id}/discard`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
