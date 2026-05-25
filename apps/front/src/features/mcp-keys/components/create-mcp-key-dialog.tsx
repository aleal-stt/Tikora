import { zodResolver } from '@hookform/resolvers/zod';
import { createMcpKeySchema, type CreateMcpKey } from '@tikora/core';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
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
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api-client';
import { useCreateMcpKey } from '../api/use-mcp-keys';
import { RevealedSecretPanel } from './revealed-secret-panel';

interface CreateMcpKeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Diálogo en dos pasos:
 *
 *  1. Formulario con `name`. Al confirmar, llama POST /me/mcp-keys.
 *  2. Si la creación fue exitosa, muestra el `secret` UNA SOLA VEZ con
 *     botón "Copiar" y advertencia destacada. El usuario tiene que
 *     guardarlo antes de cerrar — la API no expone el secreto nunca más.
 *
 * El estado del paso se resetea al cerrar el diálogo.
 */
export function CreateMcpKeyDialog({ open, onOpenChange }: CreateMcpKeyDialogProps) {
  const [revealedSecret, setRevealedSecret] = useState<string | null>(null);
  const createMutation = useCreateMcpKey();

  const form = useForm<CreateMcpKey>({
    resolver: zodResolver(createMcpKeySchema),
    defaultValues: { name: '' },
  });

  // Al cerrar el diálogo, reset completo del estado para que la próxima
  // apertura vuelva al paso 1 con campos vacíos.
  useEffect(() => {
    if (!open) {
      setRevealedSecret(null);
      form.reset({ name: '' });
    }
  }, [open, form]);

  async function onSubmit(values: CreateMcpKey) {
    try {
      const response = await createMutation.mutateAsync(values);
      setRevealedSecret(response.secret);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear la key.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {revealedSecret === null ? (
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <DialogHeader>
              <DialogTitle>Nueva key MCP</DialogTitle>
              <DialogDescription>
                Generá una API key para conectar Claude (en WhatsApp) con tu cuenta de Tikora. Podés
                tener hasta 5 keys activas.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4 flex flex-col gap-2">
              <Label htmlFor="mcp-key-name">Nombre</Label>
              <Input
                id="mcp-key-name"
                placeholder="Ej: Mi WhatsApp personal"
                autoFocus
                {...form.register('name')}
              />
              {form.formState.errors.name && (
                <p className="text-sm text-red-600">{form.formState.errors.name.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={createMutation.isPending}
              >
                Cancelar
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Generando…' : 'Generar key'}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Guardá esta key ahora</DialogTitle>
              <DialogDescription>
                Por seguridad, este secreto no se vuelve a mostrar. Si lo perdés, podés regenerarla
                desde la lista.
              </DialogDescription>
            </DialogHeader>
            <div className="my-4">
              <RevealedSecretPanel secret={revealedSecret} />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Listo, la guardé
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
