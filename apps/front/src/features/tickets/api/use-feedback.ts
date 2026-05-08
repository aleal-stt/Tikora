import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateClassificationFeedback } from '@tikora/core';
import { getClassificationFeedback, upsertClassificationFeedback } from './feedback-api';

export const feedbackKeys = {
  classification: (ticketId: string) => ['feedback', 'classification', ticketId] as const,
};

export function useClassificationFeedback(ticketId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: feedbackKeys.classification(ticketId ?? ''),
    queryFn: () => getClassificationFeedback(ticketId as string),
    enabled: Boolean(ticketId) && enabled,
  });
}

export function useUpsertClassificationFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ticketId, input }: { ticketId: string; input: CreateClassificationFeedback }) =>
      upsertClassificationFeedback(ticketId, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: feedbackKeys.classification(vars.ticketId) });
      // El back espeja `classificationFeedbackId` en el ticket; refrescamos.
      qc.invalidateQueries({ queryKey: ['tickets', 'detail', vars.ticketId] });
    },
  });
}
