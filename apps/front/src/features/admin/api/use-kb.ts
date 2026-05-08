import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateKbDocument, UpdateKbDocument } from '@tikora/core';
import {
  activateKbDocumentVersion,
  createKbDocument,
  deleteKbDocument,
  getKbDocument,
  listKbDocumentVersions,
  listKbDocuments,
  updateKbDocument,
  type ListKbDocumentsParams,
} from './kb-api';

export const kbKeys = {
  all: ['kb-documents'] as const,
  list: (params: ListKbDocumentsParams) => ['kb-documents', 'list', params] as const,
  detail: (id: string) => ['kb-documents', 'detail', id] as const,
  versions: (id: string) => ['kb-documents', 'versions', id] as const,
};

export function useKbDocuments(params: ListKbDocumentsParams = {}) {
  return useQuery({
    queryKey: kbKeys.list(params),
    queryFn: () => listKbDocuments(params),
  });
}

export function useKbDocument(id: string | undefined) {
  return useQuery({
    queryKey: kbKeys.detail(id ?? ''),
    queryFn: () => getKbDocument(id as string),
    enabled: Boolean(id),
  });
}

export function useKbDocumentVersions(id: string | undefined) {
  return useQuery({
    queryKey: kbKeys.versions(id ?? ''),
    queryFn: () => listKbDocumentVersions(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateKb() {
  const qc = useQueryClient();
  return (id?: string) => {
    qc.invalidateQueries({ queryKey: kbKeys.all });
    if (id) {
      qc.invalidateQueries({ queryKey: kbKeys.detail(id) });
      qc.invalidateQueries({ queryKey: kbKeys.versions(id) });
    }
  };
}

export function useCreateKbDocument() {
  const invalidate = useInvalidateKb();
  return useMutation({
    mutationFn: (input: CreateKbDocument) => createKbDocument(input),
    onSuccess: () => invalidate(),
  });
}

export function useUpdateKbDocument() {
  const invalidate = useInvalidateKb();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateKbDocument }) =>
      updateKbDocument(id, input),
    // El PUT crea una versión nueva con `active:false` y devuelve esa
    // versión. Invalidamos lista + el `parentDocumentId` (que es el
    // mismo que devuelve `data.parentDocumentId`) para que ambas
    // pantallas — listado y drawer de versiones — refresquen.
    onSuccess: (data, vars) => {
      invalidate(vars.id);
      invalidate(data.parentDocumentId);
    },
  });
}

export function useDeleteKbDocument() {
  const invalidate = useInvalidateKb();
  return useMutation({
    mutationFn: (id: string) => deleteKbDocument(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}

export function useActivateKbDocumentVersion() {
  const invalidate = useInvalidateKb();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      activateKbDocumentVersion(id, version),
    onSuccess: (data) => {
      // El swap afecta a todas las versiones del parentDocumentId,
      // así que invalidamos por el padre lógico.
      invalidate(data.parentDocumentId);
    },
  });
}
