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

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateUser) => createUser(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}

export function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateUser }) => updateUser(id, input),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
      qc.invalidateQueries({ queryKey: usersKeys.detail(vars.id) });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: usersKeys.all });
    },
  });
}
