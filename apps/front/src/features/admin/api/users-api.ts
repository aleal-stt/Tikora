import type { CreateUser, UpdateUser, User, UserListResponse } from '@tikora/core';
import { apiFetch } from '../../../lib/api-client';

export interface ListUsersParams {
  cursor?: string;
  limit?: number;
}

function toQueryString(params: ListUsersParams): string {
  const search = new URLSearchParams();
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.limit !== undefined) search.set('limit', String(params.limit));
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

export async function listUsers(params: ListUsersParams = {}) {
  return apiFetch<UserListResponse>(`/users${toQueryString(params)}`);
}

export async function getUser(id: string) {
  return apiFetch<User>(`/users/${id}`);
}

export async function createUser(input: CreateUser) {
  return apiFetch<User>('/users', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function updateUser(id: string, input: UpdateUser) {
  return apiFetch<User>(`/users/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export async function deleteUser(id: string) {
  return apiFetch<void>(`/users/${id}`, { method: 'DELETE' });
}
