import { EllipsisVerticalIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { User } from '@tikora/core';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import { Skeleton } from '../../../components/ui/skeleton';
import { ApiError } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';
import { useAreas } from '../api/use-areas';
import { useDeleteUser, useUsers } from '../api/use-users';
import { ConfirmDialog } from '../components/confirm-dialog';
import { RoleBadge } from '../components/role-badge';
import { UserFormDialog } from '../components/user-form-dialog';

export function UsuariosPage() {
  const callerRole = useAuthStore((s) => s.user?.role);
  const callerAreaIds = useAuthStore((s) => s.user?.areaIds ?? []);
  const isAdmin = callerRole === 'admin';

  const usersQuery = useUsers({ limit: 50 });
  const areasQuery = useAreas({ limit: 100 });
  const deleteMutation = useDeleteUser();

  const [editing, setEditing] = useState<User | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<User | null>(null);

  // Para un líder, las áreas asignables son las que él lidera (su user.areaIds).
  // El admin puede asignar cualquier área del tenant.
  const assignableAreas = useMemo(() => {
    const all = areasQuery.data?.items ?? [];
    if (isAdmin) return all;
    const allowed = new Set(callerAreaIds);
    return all.filter((a) => allowed.has(a.id));
  }, [areasQuery.data, isAdmin, callerAreaIds]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Usuario eliminado.');
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el usuario.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Usuarios</h1>
          <p className="text-sm text-slate-500">Alta, edición y baja de usuarios del tenant.</p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon className="h-4 w-4" />
          Nuevo usuario
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>
            {usersQuery.isLoading
              ? 'Cargando usuarios…'
              : `${usersQuery.data?.items.length ?? 0} usuario(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {usersQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : usersQuery.isError ? (
            <p className="text-sm text-red-600">No pudimos cargar los usuarios.</p>
          ) : (usersQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay usuarios todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-slate-200 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Nombre</th>
                    <th className="py-2">Email</th>
                    <th className="py-2">Rol</th>
                    <th className="py-2">Áreas</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {usersQuery.data?.items.map((u) => (
                    <UserRow
                      key={u.id}
                      user={u}
                      areas={areasQuery.data?.items ?? []}
                      canDelete={isAdmin && u.id !== useAuthStore.getState().user?.id}
                      onEdit={() => setEditing(u)}
                      onDelete={() => setDeleting(u)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <UserFormDialog open={creating} onOpenChange={setCreating} areas={assignableAreas} />
      <UserFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        user={editing ?? undefined}
        areas={assignableAreas}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Eliminar usuario?"
        description={
          deleting
            ? `El usuario ${deleting.fullName} no podrá iniciar sesión. Esta acción es reversible reactivando el usuario.`
            : ''
        }
        confirmLabel="Eliminar"
        variant="destructive"
        loading={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

interface UserRowProps {
  user: User;
  areas: { id: string; name: string }[];
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function UserRow({ user, areas, canDelete, onEdit, onDelete }: UserRowProps) {
  const areaNames = user.areaIds
    .map((id) => areas.find((a) => a.id === id)?.name)
    .filter(Boolean)
    .join(', ');

  return (
    <tr>
      <td className="py-2 font-medium text-slate-900">{user.fullName}</td>
      <td className="py-2 text-slate-600">{user.email}</td>
      <td className="py-2">
        <RoleBadge value={user.role} />
      </td>
      <td className="py-2 text-slate-600">{areaNames || '—'}</td>
      <td className="py-2">
        <span className={user.active ? 'text-emerald-700' : 'text-slate-500'}>
          {user.active ? 'Activo' : 'Inactivo'}
        </span>
      </td>
      <td className="py-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" aria-label="Acciones">
              <EllipsisVerticalIcon className="h-5 w-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>Editar</DropdownMenuItem>
            {canDelete && (
              <DropdownMenuItem destructive onSelect={onDelete}>
                Eliminar
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}
