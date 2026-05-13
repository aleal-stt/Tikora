import type { AiMetricsQuery, AiMetricsResponse } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

function toQueryString(query: AiMetricsQuery): string {
  const search = new URLSearchParams();
  if (query.from) search.set('from', query.from);
  if (query.to) search.set('to', query.to);
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function getAdminAiMetrics(query: AiMetricsQuery) {
  return apiFetch<AiMetricsResponse>(`/admin/ai-metrics${toQueryString(query)}`);
}
