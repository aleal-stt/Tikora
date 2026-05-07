import { TrashIcon, UserPlusIcon } from '@heroicons/react/24/outline';
import type { User } from '@tikora/core';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { ApiError } from '../../../lib/api-client';

interface MembersPanelProps {
  /** Título del panel ("Agentes", "Líderes"). */
  title: string;
  /** Roles aceptados como miembros. Filtra el dropdown de candidatos. */
  acceptedRoles: User['role'][];
  /** Miembros actuales del área. */
  members: User[];
  /** Universo de usuarios candidatos (lista global del admin). */
  allUsers: User[];
  /** Si false, esconde acciones de mutación (vista solo lectura). */
  canMutate: boolean;
  loading?: boolean;
  onAdd: (userId: string) => Promise<unknown>;
  onRemove: (userId: string) => Promise<unknown>;
}

export function MembersPanel({
  title,
  acceptedRoles,
  members,
  allUsers,
  canMutate,
  loading,
  onAdd,
  onRemove,
}: MembersPanelProps) {
  const [selectedToAdd, setSelectedToAdd] = useState<string>('');

  const memberIds = useMemo(() => new Set(members.map((m) => m.id)), [members]);
  const candidates = useMemo(
    () =>
      allUsers.filter((u) => !memberIds.has(u.id) && acceptedRoles.includes(u.role) && u.active),
    [allUsers, memberIds, acceptedRoles],
  );

  async function handleAdd() {
    if (!selectedToAdd) return;
    try {
      await onAdd(selectedToAdd);
      toast.success('Miembro agregado.');
      setSelectedToAdd('');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo agregar el miembro.');
    }
  }

  async function handleRemove(userId: string, fullName: string) {
    try {
      await onRemove(userId);
      toast.success(`${fullName} removido.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo remover el miembro.');
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <span className="text-xs text-slate-500">{members.length} miembro(s)</span>
      </div>

      {canMutate && (
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Select
              value={selectedToAdd}
              onValueChange={setSelectedToAdd}
              disabled={candidates.length === 0 || loading}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={
                    candidates.length === 0 ? 'Sin candidatos disponibles' : 'Elegí un usuario…'
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.fullName} · {u.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={handleAdd} disabled={!selectedToAdd || loading}>
            <UserPlusIcon className="h-4 w-4" />
            Agregar
          </Button>
        </div>
      )}

      {members.length === 0 ? (
        <p className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-xs text-slate-500">
          No hay {title.toLowerCase()} todavía.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
          {members.map((m) => (
            <li key={m.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="font-medium text-slate-900">{m.fullName}</div>
                <div className="text-xs text-slate-500">{m.email}</div>
              </div>
              {canMutate && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Quitar ${m.fullName}`}
                  onClick={() => handleRemove(m.id, m.fullName)}
                  disabled={loading}
                >
                  <TrashIcon className="h-4 w-4 text-red-600" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
