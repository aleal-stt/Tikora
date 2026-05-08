import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUser, UpdateUser } from '@tikora/core';
import {
  createUser,
  deleteUser,
  getUser,
  listUsers,
  updateUser,
  type ListUsersParams,
} from './users-api';

export const usersKeys = {
  all: ['users'] as const,
  list: (params: ListUsersParams) => ['users', 'list', params] as const,
  detail: (id: string) => ['users', 'detail', id] as const,
};

export function useUsers(params: ListUsersParams = {}) {
  return useQuery({
    queryKey: usersKeys.list(params),
    queryFn: () => listUsers(params),
  });
}

export function useUser(id: string | undefined) {
  return useQuery({
    queryKey: usersKeys.detail(id ?? ''),
    queryFn: () => getUser(id as string),
    enabled: Boolean(id),
  });
}

/**
 * Las mutations de usuarios afectan también a `areas` por la sincronización
 * bidireccional del back: cuando un user pasa a `areaIds: [X]`, el back
 * actualiza `Area.agentIds` (o `leaderIds`) y viceversa. Sin invalidar
 * `areas` el listado mostraría agentes/líderes fantasma o faltantes hasta
 * que `staleTime` venza.
 */
function useInvalidateUserAndAreas() {
  const qc = useQueryClient();
  return (userId?: string) => {
    qc.invalidateQueries({ queryKey: usersKeys.all });
    if (userId) qc.invalidateQueries({ queryKey: usersKeys.detail(userId) });
    qc.invalidateQueries({ queryKey: ['areas'] });
  };
}

export function useCreateUser() {
  const invalidate = useInvalidateUserAndAreas();
  return useMutation({
    mutationFn: (input: CreateUser) => createUser(input),
    onSuccess: (data) => invalidate(data.id),
  });
}

export function useUpdateUser() {
  const invalidate = useInvalidateUserAndAreas();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUser }) => updateUser(id, input),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUserAndAreas();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: (_data, id) => invalidate(id),
  });
}
