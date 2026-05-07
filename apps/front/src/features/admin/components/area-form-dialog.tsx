import { zodResolver } from '@hookform/resolvers/zod';
import { createAreaSchema, updateAreaSchema, type Area } from '@tikora/core';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';
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
import { Textarea } from '../../../components/ui/textarea';
import { ApiError } from '../../../lib/api-client';
import { useCreateArea, useUpdateArea } from '../api/use-areas';

interface AreaFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, modo edición (solo nombre/descripción). */
  area?: Area;
}

// `z.input` mantiene el shape antes de los transforms/defaults del schema:
// es lo que el form maneja crudo. `parse(data)` los aplica antes de mandar.
type CreateValues = z.input<typeof createAreaSchema>;
type EditValues = z.input<typeof updateAreaSchema>;

const DEFAULT_SLAS = { alta: 4, media: 24, baja: 72 };

export function AreaFormDialog({ open, onOpenChange, area }: AreaFormDialogProps) {
  const isEdit = Boolean(area);
  const createMutation = useCreateArea();
  const updateMutation = useUpdateArea();

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createAreaSchema),
    defaultValues: {
      name: '',
      description: '',
      leaderIds: [],
      slas: DEFAULT_SLAS,
    },
  });

  const editForm = useForm<EditValues>({
    resolver: zodResolver(updateAreaSchema),
    defaultValues: {
      name: area?.name,
      description: area?.description,
    },
  });

  useEffect(() => {
    if (isEdit && area) {
      editForm.reset({ name: area.name, description: area.description });
    } else if (!isEdit) {
      createForm.reset({
        name: '',
        description: '',
        leaderIds: [],
        slas: DEFAULT_SLAS,
      });
    }
  }, [isEdit, area, editForm, createForm]);

  async function handleCreate(data: CreateValues) {
    try {
      const payload = createAreaSchema.parse(data);
      await createMutation.mutateAsync(payload);
      toast.success('Área creada.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el área.');
    }
  }

  async function handleEdit(data: EditValues) {
    if (!area) return;
    try {
      const payload = updateAreaSchema.parse(data);
      await updateMutation.mutateAsync({ id: area.id, input: payload });
      toast.success('Área actualizada.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el área.');
    }
  }

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar área' : 'Nueva área'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Cambios sobre el área seleccionada. Miembros y SLAs se gestionan desde el detalle.'
              : 'Creá un área. Después podrás asignar líderes, agentes y ajustar SLAs desde su detalle.'}
          </DialogDescription>
        </DialogHeader>

        {isEdit ? (
          <form
            id="area-form"
            className="flex flex-col gap-4"
            onSubmit={editForm.handleSubmit(handleEdit)}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-name">Nombre</Label>
              <Input id="area-name" {...editForm.register('name')} />
              <FieldError message={editForm.formState.errors.name?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-desc">Descripción</Label>
              <Textarea id="area-desc" rows={3} {...editForm.register('description')} />
              <FieldError message={editForm.formState.errors.description?.message} />
            </div>
          </form>
        ) : (
          <form
            id="area-form"
            className="flex flex-col gap-4"
            onSubmit={createForm.handleSubmit(handleCreate)}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-name-create">Nombre</Label>
              <Input id="area-name-create" autoFocus {...createForm.register('name')} />
              <FieldError message={createForm.formState.errors.name?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="area-desc-create">Descripción</Label>
              <Textarea id="area-desc-create" rows={3} {...createForm.register('description')} />
            </div>
            <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
              <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                SLAs por defecto (horas hábiles)
              </legend>
              <div className="grid grid-cols-3 gap-3">
                <SlaInput
                  label="Alta"
                  registration={createForm.register('slas.alta', { valueAsNumber: true })}
                  error={createForm.formState.errors.slas?.alta?.message}
                />
                <SlaInput
                  label="Media"
                  registration={createForm.register('slas.media', { valueAsNumber: true })}
                  error={createForm.formState.errors.slas?.media?.message}
                />
                <SlaInput
                  label="Baja"
                  registration={createForm.register('slas.baja', { valueAsNumber: true })}
                  error={createForm.formState.errors.slas?.baja?.message}
                />
              </div>
            </fieldset>
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="area-form" disabled={submitting}>
            {submitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear área'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface SlaInputProps {
  label: string;
  registration: ReturnType<ReturnType<typeof useForm<CreateValues>>['register']>;
  error?: string;
}

function SlaInput({ label, registration, error }: SlaInputProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      <Input type="number" min={1} max={720} {...registration} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}
