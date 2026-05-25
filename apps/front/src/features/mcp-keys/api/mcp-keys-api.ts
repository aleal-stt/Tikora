import type { CreateMcpKey, CreateMcpKeyResponse, McpKeyListResponse } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export async function listMcpKeys() {
  return apiFetch<McpKeyListResponse>('/me/mcp-keys');
}

export async function createMcpKey(input: CreateMcpKey) {
  return apiFetch<CreateMcpKeyResponse>('/me/mcp-keys', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function revokeMcpKey(id: string) {
  return apiFetch<void>(`/me/mcp-keys/${id}`, { method: 'DELETE' });
}

export async function regenerateMcpKey(id: string) {
  return apiFetch<CreateMcpKeyResponse>(`/me/mcp-keys/${id}/regenerate`, {
    method: 'POST',
  });
}
