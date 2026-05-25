import type { McpKey } from '@tikora/core';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog';
import { ApiError } from '../../../lib/api-client';
import { useRegenerateMcpKey } from '../api/use-mcp-keys';
import { RevealedSecretPanel } from './revealed-secret-panel';

interface RegenerateMcpKeyDialogProps {
  target: McpKey | null;
  onClose: () => void;
}

/**
 * Diálogo de regeneración en dos pasos:
 *  1. Confirmación destructiva: la key actual queda inválida.
 *  2. Si la regeneración fue exitosa, muestra el nuevo secret una sola vez.
 *
 * El diálogo se abre cuando `target !== null`. Cuando el usuario cierra, el
 * caller pone target en null vía `onClose`.
 */
export function RegenerateMcpKeyDialog({ target, onClose }: RegenerateMcpKeyDialogProps) {
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const regenerateMutation = useRegenerateMcpKey();

  // Reset al cerrar.
  useEffect(() => {
    if (!target) setNewSecret(null);
  }, [target]);

  async function onConfirm() {
    if (!target) return;
    try {
      const response = await regenerateMutation.mutateAsync(target.id);
      setNewSecret(response.secret);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo regenerar la key.');
    }
  }

  const open = target !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        {newSecret === null ? (
          <>
            <DialogHeader>
              <DialogTitle>Regenerar key MCP</DialogTitle>
              <DialogDescription>
                {target ? (
                  <>
                    Vas a revocar &ldquo;{target.name}&rdquo; y generar una nueva con el mismo
                    nombre. La key anterior (prefijo{' '}
                    <code className="font-mono">{target.prefix}</code>) queda inválida de inmediato.
                    Esta acción no se puede deshacer.
                  </>
                ) : null}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="ghost"
                onClick={onClose}
                disabled={regenerateMutation.isPending}
              >
                Cancelar
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={onConfirm}
                disabled={regenerateMutation.isPending}
              >
                {regenerateMutation.isPending ? 'Regenerando…' : 'Regenerar'}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Guardá esta key ahora</DialogTitle>
              <DialogDescription>
                Es el secreto de la key regenerada. No se vuelve a mostrar; si lo perdés, tenés que
                regenerarla otra vez.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4">
              <RevealedSecretPanel secret={newSecret} />
            </div>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Listo, la guardé
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
