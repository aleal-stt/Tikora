import { useQuery } from '@tanstack/react-query';
import type { AiMetricsQuery } from '@tikora/core';
import { getAdminAiMetrics } from './ai-metrics-api';

export const aiMetricsKeys = {
  all: ['ai-metrics'] as const,
  range: (query: AiMetricsQuery) => ['ai-metrics', query] as const,
};

export function useAdminAiMetrics(query: AiMetricsQuery, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: aiMetricsKeys.range(query),
    queryFn: () => getAdminAiMetrics(query),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
}
