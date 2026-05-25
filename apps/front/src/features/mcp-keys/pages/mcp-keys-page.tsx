import { ArrowPathIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import type { McpKey } from '@tikora/core';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card';
import { Skeleton } from '../../../components/ui/skeleton';
import { ApiError } from '../../../lib/api-client';
import { ConfirmDialog } from '../../admin/components/confirm-dialog';
import { useMcpKeys, useRevokeMcpKey } from '../api/use-mcp-keys';
import { CreateMcpKeyDialog } from '../components/create-mcp-key-dialog';
import { RegenerateMcpKeyDialog } from '../components/regenerate-mcp-key-dialog';

const dateFormatter = new Intl.DateTimeFormat('es-AR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function formatDate(value: string | null): string {
  if (!value) return '—';
  return dateFormatter.format(new Date(value));
}

export function McpKeysPage() {
  const keysQuery = useMcpKeys();
  const revokeMutation = useRevokeMcpKey();

  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<McpKey | null>(null);
  const [regenerating, setRegenerating] = useState<McpKey | null>(null);

  async function confirmRevoke() {
    if (!revoking) return;
    try {
      await revokeMutation.mutateAsync(revoking.id);
      toast.success('Key revocada.');
      setRevoking(null);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo revocar la key.');
    }
  }

  const items = keysQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Claves MCP</h1>
          <p className="text-sm text-slate-500">
            Conectá Claude (en WhatsApp u otros clientes MCP) con tu cuenta de Tikora.
          </p>
        </div>
        <Button onClick={() => setCreating(true)}>
          <PlusIcon className="h-4 w-4" />
          Nueva key
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Tus keys activas</CardTitle>
          <CardDescription>
            {keysQuery.isLoading
              ? 'Cargando keys…'
              : `${items.length} key${items.length === 1 ? '' : 's'} activa${
                  items.length === 1 ? '' : 's'
                }. Máximo 5 por usuario.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {keysQuery.isLoading ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ) : keysQuery.isError ? (
            <p className="text-sm text-red-600">
              No se pudieron cargar las keys.{' '}
              {keysQuery.error instanceof ApiError ? keysQuery.error.message : ''}
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-slate-500">
              Todavía no generaste ninguna key. Apretá &ldquo;Nueva key&rdquo; para arrancar.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-slate-200">
              {items.map((key) => (
                <li key={key.id} className="flex items-center justify-between gap-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-slate-900">{key.name}</div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span>
                        Prefijo: <code className="font-mono">{key.prefix}…</code>
                      </span>
                      <span>Creada: {formatDate(key.createdAt)}</span>
                      <span>Último uso: {formatDate(key.lastUsedAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRegenerating(key)}
                      title="Revoca la actual y genera una nueva con el mismo nombre"
                    >
                      <ArrowPathIcon className="h-4 w-4" />
                      Regenerar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRevoking(key)}
                      disabled={revokeMutation.isPending}
                    >
                      <TrashIcon className="h-4 w-4" />
                      Revocar
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <CreateMcpKeyDialog open={creating} onOpenChange={setCreating} />

      <RegenerateMcpKeyDialog target={regenerating} onClose={() => setRegenerating(null)} />

      <ConfirmDialog
        open={revoking !== null}
        onOpenChange={(open) => !open && setRevoking(null)}
        title="Revocar key MCP"
        description={
          revoking
            ? `La key "${revoking.name}" queda inválida de inmediato. Esta acción no se puede deshacer.`
            : ''
        }
        confirmLabel="Revocar"
        variant="destructive"
        loading={revokeMutation.isPending}
        onConfirm={confirmRevoke}
      />
    </div>
  );
}
