import { ClockIcon, EllipsisVerticalIcon, PlusIcon } from '@heroicons/react/24/outline';
import type { KbDocumentListItem, KbScope } from '@tikora/core';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '../../../components/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { Skeleton } from '../../../components/ui/skeleton';
import { ApiError } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';
import { useAreas } from '../api/use-areas';
import { useDeleteKbDocument, useKbDocuments } from '../api/use-kb';
import { ConfirmDialog } from '../components/confirm-dialog';
import { KbFormDialog } from '../components/kb-form-dialog';
import { KbVersionsDialog } from '../components/kb-versions-dialog';

type ScopeFilter = 'all' | 'global' | 'area';

export function KbPage() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>('all');

  // Filtros: el back ya restringe por tenant + (para LID) por áreas que
  // lidera. El front solo controla los filtros visibles del usuario.
  const listParams = useMemo(
    () => ({
      limit: 100,
      ...(scopeFilter !== 'all' ? { scope: scopeFilter as KbScope } : {}),
    }),
    [scopeFilter],
  );
  const docsQuery = useKbDocuments(listParams);
  const areasQuery = useAreas({ limit: 100 });
  const deleteMutation = useDeleteKbDocument();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<KbDocumentListItem | null>(null);
  const [deleting, setDeleting] = useState<KbDocumentListItem | null>(null);
  const [showingVersions, setShowingVersions] = useState<KbDocumentListItem | null>(null);

  // Index de áreas para resolver IDs → nombres en la tabla.
  const areaNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const area of areasQuery.data?.items ?? []) {
      map.set(area.id, area.name);
    }
    return map;
  }, [areasQuery.data?.items]);

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await deleteMutation.mutateAsync(deleting.id);
      toast.success('Documento eliminado.');
      setDeleting(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo eliminar el documento.');
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Base de conocimiento</h1>
          <p className="text-sm text-slate-500">
            Documentos consultables por la IA al generar auto-respuestas. Cada edición crea una
            nueva versión y la deja activa cuando termina la indexación.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon className="h-4 w-4" />
          Nuevo documento
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado</CardTitle>
          <CardDescription>
            {docsQuery.isLoading
              ? 'Cargando documentos…'
              : `${docsQuery.data?.items.length ?? 0} documento(s)`}
          </CardDescription>
          <div className="flex items-center gap-3 pt-2">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              Alcance
              <Select value={scopeFilter} onValueChange={(v) => setScopeFilter(v as ScopeFilter)}>
                <SelectTrigger className="h-8 w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="global">Global</SelectItem>
                  <SelectItem value="area">Por área</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
        </CardHeader>
        <CardContent>
          {docsQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : docsQuery.isError ? (
            <p className="text-sm text-red-600">No pudimos cargar los documentos.</p>
          ) : (docsQuery.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-slate-500">
              {scopeFilter === 'all'
                ? 'Todavía no hay documentos.'
                : 'No hay documentos con ese alcance.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full divide-y divide-slate-200 text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-2">Título</th>
                    <th className="py-2">Alcance</th>
                    <th className="py-2">Áreas</th>
                    <th className="py-2">Versión</th>
                    <th className="py-2">Estado</th>
                    <th className="py-2">Actualizado</th>
                    <th className="py-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {docsQuery.data?.items.map((doc) => (
                    <tr key={doc.id}>
                      <td className="py-2 font-medium text-slate-900">{doc.title}</td>
                      <td className="py-2">
                        <Badge tone={doc.scope === 'global' ? 'info' : 'neutral'}>
                          {doc.scope === 'global' ? 'Global' : 'Por área'}
                        </Badge>
                      </td>
                      <td className="py-2 text-slate-600">
                        {doc.scope === 'global' ? (
                          <span className="text-slate-400">—</span>
                        ) : (
                          doc.areaIds.map((id) => areaNameById.get(id) ?? id.slice(-6)).join(', ')
                        )}
                      </td>
                      <td className="py-2 tabular-nums text-slate-600">v{doc.version}</td>
                      <td className="py-2">
                        {doc.active ? (
                          <Badge tone="success">Activa</Badge>
                        ) : (
                          <Badge tone="warning">
                            <ClockIcon className="mr-1 h-3 w-3" />
                            Indexando
                          </Badge>
                        )}
                      </td>
                      <td className="py-2 text-slate-500">
                        {new Date(doc.updatedAt).toLocaleDateString('es-AR', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                        })}
                      </td>
                      <td className="py-2 text-right">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="sm" variant="ghost" aria-label="Acciones">
                              <EllipsisVerticalIcon className="h-5 w-5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setShowingVersions(doc)}>
                              Ver versiones
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setEditing(doc)}>
                              Editar (crear v{doc.version + 1})
                            </DropdownMenuItem>
                            <DropdownMenuItem destructive onSelect={() => setDeleting(doc)}>
                              Eliminar
                            </DropdownMenuItem>
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

      <KbFormDialog open={creating} onOpenChange={setCreating} />
      <KbFormDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        document={editing ?? undefined}
      />
      <KbVersionsDialog
        open={Boolean(showingVersions)}
        onOpenChange={(open) => !open && setShowingVersions(null)}
        document={showingVersions ?? undefined}
        canActivate={isAdmin}
      />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="¿Eliminar documento?"
        description={
          deleting
            ? `El documento "${deleting.title}" y todas sus versiones quedarán inactivos. La auto-respuesta dejará de citarlo. Es soft-delete: se puede recuperar manualmente desde la base si fuera necesario.`
            : ''
        }
        confirmLabel="Eliminar"
        loading={deleteMutation.isPending}
        onConfirm={confirmDelete}
      />
    </div>
  );
}
