import type { ClassificationFeedback, CreateClassificationFeedback } from '@tikora/core';
import { ApiError, apiFetch } from '../../../lib/api-client';

/**
 * Lee el feedback de clasificación del ticket. 404 → null para que el
 * componente muestre el form vacío sin tratarlo como error.
 */
export async function getClassificationFeedback(
  ticketId: string,
): Promise<ClassificationFeedback | null> {
  try {
    return await apiFetch<ClassificationFeedback>(`/tickets/${ticketId}/classification-feedback`);
  } catch (err) {
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) return null;
    throw err;
  }
}

export async function upsertClassificationFeedback(
  ticketId: string,
  input: CreateClassificationFeedback,
): Promise<ClassificationFeedback> {
  return apiFetch<ClassificationFeedback>(`/tickets/${ticketId}/classification-feedback`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
