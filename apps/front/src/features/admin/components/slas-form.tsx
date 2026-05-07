import { zodResolver } from '@hookform/resolvers/zod';
import { slasSchema, type Slas } from '@tikora/core';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { ApiError } from '../../../lib/api-client';
import { useUpdateAreaSlas } from '../api/use-areas';

interface SlasFormProps {
  areaId: string;
  initialSlas: Slas;
}

/**
 * Formulario para editar SLAs de un área. Se monta dentro del detalle
 * (o de un dialog desde la pantalla resumen). El submit recae sobre
 * `useUpdateAreaSlas` que invalida el detalle para reflejar cambios.
 */
export function SlasForm({ areaId, initialSlas }: SlasFormProps) {
  const mutation = useUpdateAreaSlas();
  const form = useForm<Slas>({
    resolver: zodResolver(slasSchema),
    defaultValues: initialSlas,
  });

  useEffect(() => {
    form.reset(initialSlas);
  }, [form, initialSlas]);

  async function onSubmit(values: Slas) {
    try {
      await mutation.mutateAsync({ id: areaId, slas: values });
      toast.success('SLAs actualizados.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudieron actualizar los SLAs.');
    }
  }

  return (
    <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SlaField
          label="Alta"
          registration={form.register('alta', { valueAsNumber: true })}
          error={form.formState.errors.alta?.message}
        />
        <SlaField
          label="Media"
          registration={form.register('media', { valueAsNumber: true })}
          error={form.formState.errors.media?.message}
        />
        <SlaField
          label="Baja"
          registration={form.register('baja', { valueAsNumber: true })}
          error={form.formState.errors.baja?.message}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={mutation.isPending || !form.formState.isDirty}>
          {mutation.isPending ? 'Guardando…' : 'Guardar SLAs'}
        </Button>
      </div>
    </form>
  );
}

interface SlaFieldProps {
  label: string;
  registration: ReturnType<ReturnType<typeof useForm<Slas>>['register']>;
  error?: string;
}

function SlaField({ label, registration, error }: SlaFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label} (horas)</Label>
      <Input type="number" min={1} max={720} {...registration} />
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
