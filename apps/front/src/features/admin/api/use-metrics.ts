import { useQuery } from '@tanstack/react-query';
import type { AreaMetricsQuery } from '@tikora/core';
import { getAreaMetrics } from './metrics-api';

export const metricsKeys = {
  all: ['metrics'] as const,
  area: (areaId: string, query: AreaMetricsQuery) => ['metrics', 'area', areaId, query] as const,
};

export function useAreaMetrics(areaId: string | undefined, query: AreaMetricsQuery) {
  return useQuery({
    queryKey: metricsKeys.area(areaId ?? '', query),
    queryFn: () => getAreaMetrics(areaId as string, query),
    enabled: Boolean(areaId),
    // El back ya devuelve null para AI-related metrics hasta que haya
    // datos. Tratamos el null como dato estable, no error de fetch.
    staleTime: 30_000,
  });
}
