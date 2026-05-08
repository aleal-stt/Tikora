import type {
  CreateKbDocument,
  KbDocument,
  KbDocumentListResponse,
  KbDocumentVersionsResponse,
  KbScope,
  UpdateKbDocument,
} from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export interface ListKbDocumentsParams {
  cursor?: string;
  limit?: number;
  scope?: KbScope;
  /** Múltiples áreas: el back acepta `?areaId=a&areaId=b`. */
  areaId?: string[];
}

function toQueryString(params: ListKbDocumentsParams): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  if (params.scope) search.set('scope', params.scope);
  if (params.areaId) {
    for (const id of params.areaId) {
      search.append('areaId', id);
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

/**
 * Listado paginado de documentos KB. El back filtra automáticamente por
 * tenant y, para LID, restringe a globales + áreas que lidera.
 */
export async function listKbDocuments(params: ListKbDocumentsParams = {}) {
  return apiFetch<KbDocumentListResponse>(`/kb-documents${toQueryString(params)}`);
}

export async function getKbDocument(id: string) {
  return apiFetch<KbDocument>(`/kb-documents/${id}`);
}

export async function createKbDocument(input: CreateKbDocument) {
  return apiFetch<KbDocument>('/kb-documents', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateKbDocument(id: string, input: UpdateKbDocument) {
  return apiFetch<KbDocument>(`/kb-documents/${id}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  });
}

export async function deleteKbDocument(id: string) {
  return apiFetch<void>(`/kb-documents/${id}`, { method: 'DELETE' });
}

export async function listKbDocumentVersions(id: string) {
  return apiFetch<KbDocumentVersionsResponse>(`/kb-documents/${id}/versions`);
}

export async function activateKbDocumentVersion(id: string, version: number) {
  return apiFetch<KbDocument>(`/kb-documents/${id}/versions/${version}/activate`, {
    method: 'POST',
  });
}
