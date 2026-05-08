import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateArea, Slas, UpdateArea } from '@tikora/core';
import {
  addAreaAgent,
  addAreaLeader,
  createArea,
  deleteArea,
  getArea,
  listAreaAgents,
  listAreasFull,
  removeAreaAgent,
  removeAreaLeader,
  updateArea,
  updateAreaSlas,
  type ListAreasParams,
} from './areas-api';

export const areasKeys = {
  all: ['areas'] as const,
  list: (params: ListAreasParams) => ['areas', 'list', params] as const,
  detail: (id: string) => ['areas', 'detail', id] as const,
  agents: (id: string) => ['areas', 'agents', id] as const,
};

export function useAreas(params: ListAreasParams = {}) {
  return useQuery({
    queryKey: areasKeys.list(params),
    queryFn: () => listAreasFull(params),
  });
}

export function useArea(id: string | undefined) {
  return useQuery({
    queryKey: areasKeys.detail(id ?? ''),
    queryFn: () => getArea(id as string),
    enabled: Boolean(id),
  });
}

export function useAreaAgents(id: string | undefined) {
  return useQuery({
    queryKey: areasKeys.agents(id ?? ''),
    queryFn: () => listAreaAgents(id as string),
    enabled: Boolean(id),
  });
}

function useInvalidateArea() {
  const qc = useQueryClient();
  return (id: string) => {
    qc.invalidateQueries({ queryKey: areasKeys.all });
    qc.invalidateQueries({ queryKey: areasKeys.detail(id) });
    qc.invalidateQueries({ queryKey: areasKeys.agents(id) });
  };
}

export function useCreateArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateArea) => createArea(input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: areasKeys.all });
    },
  });
}

export function useUpdateArea() {
  const invalidate = useInvalidateArea();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateArea }) => updateArea(id, input),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useDeleteArea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteArea(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: areasKeys.all });
    },
  });
}

/**
 * Las mutations de membership (agentes/líderes de un área) afectan al
 * `User.areaIds` por la sincronización bidireccional del back. Hay que
 * invalidar también `users` para que el listado de usuarios refresque
 * sus áreas asignadas sin esperar al stale.
 */
function useInvalidateAreaAndUsers() {
  const qc = useQueryClient();
  const invalidateArea = useInvalidateArea();
  return (areaId: string) => {
    invalidateArea(areaId);
    qc.invalidateQueries({ queryKey: ['users'] });
  };
}

export function useAddAreaAgent() {
  const invalidate = useInvalidateAreaAndUsers();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => addAreaAgent(id, userId),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useRemoveAreaAgent() {
  const invalidate = useInvalidateAreaAndUsers();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => removeAreaAgent(id, userId),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useAddAreaLeader() {
  const invalidate = useInvalidateAreaAndUsers();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => addAreaLeader(id, userId),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useRemoveAreaLeader() {
  const invalidate = useInvalidateAreaAndUsers();
  return useMutation({
    mutationFn: ({ id, userId }: { id: string; userId: string }) => removeAreaLeader(id, userId),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}

export function useUpdateAreaSlas() {
  const invalidate = useInvalidateArea();
  return useMutation({
    mutationFn: ({ id, slas }: { id: string; slas: Slas }) => updateAreaSlas(id, slas),
    onSuccess: (_data, vars) => invalidate(vars.id),
  });
}
