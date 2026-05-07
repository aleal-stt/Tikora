import { EllipsisVerticalIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { Area } from '@tikora/core';
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
import { useAreas, useDeleteArea } from '../api/use-areas';
import { AreaFormDialog } from '../components/area-form-dialog';
import { ConfirmDialog } from '../components/confirm-dialog';

export function AreasPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const areasQuery = useAreas({ limit: 100 });
  const deleteMutation = useDeleteArea();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Area | null>(null);
  const [deleting, setDeleting] = useState<Area | null>(null);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Área eliminada.');
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el área.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Áreas</h1>
          <p className="text-sm text-slate-500">Gestión de áreas, sus líderes, agentes y SLAs.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreating(true)}>
            <PlusIcon className="h-4 w-4" />
            Nueva área
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>
            {areasQuery.isLoading
              ? 'Cargando áreas…'
              : `${areasQuery.data?.items.length ?? 0} área(s)`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {areasQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : areasQuery.isError ? (
            <p className="text-sm text-red-600">No pudimos cargar las áreas.</p>
          ) : (areasQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">No hay áreas todavía.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-slate-200 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Nombre</th>
                    <th className="py-2">Descripción</th>
                    <th className="py-2">Agentes</th>
                    <th className="py-2">Líderes</th>
                    <th className="py-2">SLAs (A/M/B)</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {areasQuery.data?.items.map((area) => (
                    <tr key={area.id}>
                      <td className="py-2 font-medium">
                        <Link
                          to={`/admin/areas/${area.id}`}
                          className="text-blue-700 hover:underline"
                        >
                          {area.name}
                        </Link>
                      </td>
                      <td className="py-2 text-slate-600">
                        {area.description || <span className="text-slate-400">—</span>}
                      </td>
                      <td className="py-2 text-slate-600">{area.agentIds.length}</td>
                      <td className="py-2 text-slate-600">{area.leaderIds.length}</td>
                      <td className="py-2 tabular-nums text-slate-600">
                        {area.slas.alta}h / {area.slas.media}h / {area.slas.baja}h
                      </td>
                      <td className="py-2">
                        <span className={area.active ? 'text-emerald-700' : 'text-slate-500'}>
                          {area.active ? 'Activa' : 'Inactiva'}
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
                            <DropdownMenuItem asChild>
                              <Link to={`/admin/areas/${area.id}`}>Ver detalle</Link>
                            </DropdownMenuItem>
                            {isAdmin && (
                              <>
                                <DropdownMenuItem onSelect={() => setEditing(area)}>
                                  Editar
                                </DropdownMenuItem>
                                <DropdownMenuItem destructive onSelect={() => setDeleting(area)}>
                                  Eliminar
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <AreaFormDialog open={creating} onOpenChange={setCreating} />
      <AreaFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        area={editing ?? undefined}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Eliminar área?"
        description={
          deleting
            ? `El área "${deleting.name}" quedará desactivada. Los tickets ya asignados se mantienen pero no se podrá rutear nuevos a ella.`
            : ''
        }
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
