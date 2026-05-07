import type {
  Area,
  AreaListResponseFull,
  AreaListResponsePublic,
  CreateArea,
  Slas,
  UpdateArea,
  User,
} from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export interface ListAreasParams {
  cursor?: string;
  limit?: number;
}

function toQueryString(params: ListAreasParams): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * El back devuelve el shape "full" para LID/ADM y el "public" para EMP/AGE.
 * Como esta API se consume desde admin (lider/admin), tipamos al full;
 * el caller que necesite el public usa la versión genérica.
 */
export async function listAreasFull(params: ListAreasParams = {}) {
  return apiFetch<AreaListResponseFull>(`/areas${toQueryString(params)}`);
}

export async function listAreasPublic(params: ListAreasParams = {}) {
  return apiFetch<AreaListResponsePublic>(`/areas${toQueryString(params)}`);
}

export async function getArea(id: string) {
  return apiFetch<Area>(`/areas/${id}`);
}

export async function createArea(input: CreateArea) {
  return apiFetch<Area>('/areas', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateArea(id: string, input: UpdateArea) {
  return apiFetch<Area>(`/areas/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteArea(id: string) {
  return apiFetch<void>(`/areas/${id}`, { method: 'DELETE' });
}

export async function listAreaAgents(id: string) {
  return apiFetch<User[]>(`/areas/${id}/agents`);
}

export async function addAreaAgent(id: string, userId: string) {
  return apiFetch<Area>(`/areas/${id}/agents`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function removeAreaAgent(id: string, userId: string) {
  return apiFetch<void>(`/areas/${id}/agents/${userId}`, { method: 'DELETE' });
}

export async function addAreaLeader(id: string, userId: string) {
  return apiFetch<Area>(`/areas/${id}/leaders`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
}

export async function removeAreaLeader(id: string, userId: string) {
  return apiFetch<void>(`/areas/${id}/leaders/${userId}`, { method: 'DELETE' });
}

export async function updateAreaSlas(id: string, slas: Slas) {
  return apiFetch<Area>(`/areas/${id}/slas`, {
    method: 'PATCH',
    body: JSON.stringify({ slas }),
  });
}
