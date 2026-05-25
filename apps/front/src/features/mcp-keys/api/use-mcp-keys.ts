import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateMcpKey } from '@tikora/core';
import { createMcpKey, listMcpKeys, revokeMcpKey } from './mcp-keys-api';

export const mcpKeysKeys = {
  all: ['mcp-keys'] as const,
  list: () => ['mcp-keys', 'list'] as const,
};

export function useMcpKeys() {
  return useQuery({
    queryKey: mcpKeysKeys.list(),
    queryFn: () => listMcpKeys(),
  });
}

export function useCreateMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMcpKey) => createMcpKey(input),
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpKeysKeys.all }),
  });
}

export function useRevokeMcpKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => revokeMcpKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: mcpKeysKeys.all }),
  });
}
