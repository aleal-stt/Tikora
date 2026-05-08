import type { AreaMetricsQuery, AreaMetricsResponse } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

function toQueryString(query: AreaMetricsQuery): string {
  const search = new URLSearchParams();
  if (query.from) search.set('from', query.from);
  if (query.to) search.set('to', query.to);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function getAreaMetrics(areaId: string, query: AreaMetricsQuery) {
  return apiFetch<AreaMetricsResponse>(`/areas/${areaId}/metrics${toQueryString(query)}`);
}
