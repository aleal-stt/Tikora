import type { KbDocumentListItem } from '@tikora/core';
import { toast } from 'sonner';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { Skeleton } from '../../../components/ui/skeleton';
import { ApiError } from '../../../lib/api-client';
import { useActivateKbDocumentVersion, useKbDocumentVersions } from '../api/use-kb';

interface KbVersionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document?: KbDocumentListItem;
  /** El back exige rol admin para activar; mostramos el botón solo si lo es. */
  canActivate: boolean;
}

const dateFmt = new Intl.DateTimeFormat('es-AR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function KbVersionsDialog({
  open,
  onOpenChange,
  document,
  canActivate,
}: KbVersionsDialogProps) {
  const versionsQuery = useKbDocumentVersions(open && document ? document.id : undefined);
  const activateMutation = useActivateKbDocumentVersion();

  async function activate(version: number) {
    if (!document) return;
    try {
      await activateMutation.mutateAsync({ id: document.id, version });
      toast.success(`Versión ${version} activada.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo activar la versión.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Versiones de "{document?.title ?? 'documento'}"</DialogTitle>
          <DialogDescription>
            Cada edición crea una versión nueva. Solo una está activa a la vez — es la que usa la
            auto-respuesta al citar este documento.
            {canActivate
              ? ' Como admin podés revertir a una versión anterior con un clic.'
              : ' Solo un admin puede revertir a una versión anterior.'}
          </DialogDescription>
        </DialogHeader>

        {versionsQuery.isLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : versionsQuery.isError ? (
          <p className="py-4 text-sm text-red-600">No pudimos cargar las versiones.</p>
        ) : (versionsQuery.data?.items.length ?? 0) === 0 ? (
          <p className="py-4 text-sm text-slate-500">Sin versiones para mostrar.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {versionsQuery.data?.items.map((v) => (
              <li
                key={v.id}
                className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm"
              >
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className="font-medium tabular-nums text-slate-900">v{v.version}</span>
                    {v.active ? (
                      <Badge tone="success">Activa</Badge>
                    ) : (
                      <Badge tone="neutral">Histórica</Badge>
                    )}
                  </div>
                  <span className="text-xs text-slate-500">
                    Creada {dateFmt.format(new Date(v.createdAt))}
                  </span>
                </div>
                {canActivate && !v.active && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={activateMutation.isPending}
                    onClick={() => activate(v.version)}
                  >
                    Activar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
