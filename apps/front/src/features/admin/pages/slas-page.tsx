import type { Area } from '@tikora/core';
import { useState } from 'react';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Skeleton } from '../../../components/ui/skeleton';
import { useAuthStore } from '../../../stores/auth.store';
import { useAreas } from '../api/use-areas';
import { SlasForm } from '../components/slas-form';

/**
 * Resumen de SLAs por área. Atajo del admin para no entrar al detalle por
 * cada una. Edición en dialog reutilizando `SlasForm`.
 */
export function SlasPage() {
  const callerRole = useAuthStore((s) => s.user?.role);
  const callerAreaIds = useAuthStore((s) => s.user?.areaIds ?? []);
  const isAdmin = callerRole === 'admin';

  const areasQuery = useAreas({ limit: 100 });
  const [editing, setEditing] = useState<Area | null>(null);

  function canEdit(area: Area) {
    return isAdmin || (callerRole === 'lider' && callerAreaIds.includes(area.id));
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">SLAs por área</h1>
        <p className="text-sm text-slate-500">
          Tiempos objetivo en horas hábiles. El SLA de un ticket nuevo se define al rutearlo.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>
            Tres prioridades: alta, media, baja. Los valores se aplican por defecto al ticket según
            su clasificación.
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
                    <th className="py-2">Área</th>
                    <th className="py-2 text-right">Alta</th>
                    <th className="py-2 text-right">Media</th>
                    <th className="py-2 text-right">Baja</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {areasQuery.data?.items.map((area) => (
                    <tr key={area.id}>
                      <td className="py-2 font-medium text-slate-900">{area.name}</td>
                      <td className="py-2 text-right tabular-nums">{area.slas.alta} h</td>
                      <td className="py-2 text-right tabular-nums">{area.slas.media} h</td>
                      <td className="py-2 text-right tabular-nums">{area.slas.baja} h</td>
                      <td className="py-2 text-right">
                        {canEdit(area) ? (
                          <Button size="sm" variant="secondary" onClick={() => setEditing(area)}>
                            Editar
                          </Button>
                        ) : (
                          <span className="text-xs text-slate-400">Sin permisos</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editing)} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>SLAs · {editing?.name ?? ''}</DialogTitle>
            <DialogDescription>
              Cambios aplican a tickets nuevos. Los tickets ya creados conservan su deadline.
            </DialogDescription>
          </DialogHeader>
          {editing && <SlasForm areaId={editing.id} initialSlas={editing.slas} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
