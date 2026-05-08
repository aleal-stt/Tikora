import { zodResolver } from '@hookform/resolvers/zod';
import {
  KB_MAX_BYTES,
  createKbDocumentSchema,
  updateKbDocumentSchema,
  type KbDocumentListItem,
} from '@tikora/core';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
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
import { useAuthStore } from '../../../stores/auth.store';
import { useAreas } from '../api/use-areas';
import { getKbDocument } from '../api/kb-api';
import { useCreateKbDocument, useUpdateKbDocument } from '../api/use-kb';
import { AreaMultiSelect } from './area-multi-select';
import { useQuery } from '@tanstack/react-query';

interface KbFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Si viene, modo edición (PUT crea v+1). Como el listado solo tiene
   * `KbDocumentListItem` sin `content`, lo pedimos por aparte cuando se
   * abre el dialog.
   */
  document?: KbDocumentListItem;
}

type CreateValues = z.input<typeof createKbDocumentSchema>;
type EditValues = z.input<typeof updateKbDocumentSchema>;

const EMPTY_CREATE: CreateValues = {
  title: '',
  content: '',
  scope: 'global',
  areaIds: [],
};

export function KbFormDialog({ open, onOpenChange, document }: KbFormDialogProps) {
  const isEdit = Boolean(document);
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const callerAreaIds = useAuthStore((s) => s.user?.areaIds ?? []);

  const createMutation = useCreateKbDocument();
  const updateMutation = useUpdateKbDocument();
  const areasQuery = useAreas({ limit: 100 });

  // Para editar necesitamos el `content` completo del documento; el
  // listado lo omite. Solo se dispara cuando estamos en modo edición y
  // el dialog está abierto.
  const documentId = document?.id;
  const detailQuery = useQuery({
    queryKey: ['kb-documents', 'detail', documentId ?? ''],
    queryFn: () => getKbDocument(documentId as string),
    enabled: open && isEdit && Boolean(documentId),
  });

  const createForm = useForm<CreateValues>({
    resolver: zodResolver(createKbDocumentSchema),
    defaultValues: EMPTY_CREATE,
  });

  const editForm = useForm<EditValues>({
    resolver: zodResolver(updateKbDocumentSchema),
    defaultValues: {
      title: document?.title ?? '',
      content: '',
      areaIds: document?.areaIds ?? [],
    },
  });

  // Reset cuando cambia el documento o el modo. En edición esperamos a
  // que llegue el detalle con el `content` para poblar el form.
  useEffect(() => {
    if (!open) return;
    if (isEdit && detailQuery.data) {
      editForm.reset({
        title: detailQuery.data.title,
        content: detailQuery.data.content,
        areaIds: detailQuery.data.areaIds,
      });
    } else if (!isEdit) {
      createForm.reset(EMPTY_CREATE);
    }
  }, [open, isEdit, detailQuery.data, createForm, editForm]);

  // Áreas elegibles según rol del caller.
  const eligibleAreas = useMemo(() => {
    const all = areasQuery.data?.items ?? [];
    if (isAdmin) return all;
    const allowed = new Set(callerAreaIds);
    return all.filter((a) => allowed.has(a.id));
  }, [areasQuery.data?.items, isAdmin, callerAreaIds]);

  const submitting = createMutation.isPending || updateMutation.isPending;

  async function handleCreate(data: CreateValues) {
    try {
      const payload = createKbDocumentSchema.parse(data);
      await createMutation.mutateAsync(payload);
      toast.success('Documento creado. Se está indexando…');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el documento.');
    }
  }

  async function handleEdit(data: EditValues) {
    if (!document) return;
    try {
      const payload = updateKbDocumentSchema.parse(data);
      await updateMutation.mutateAsync({ id: document.id, input: payload });
      toast.success(`Versión ${document.version + 1} creada. Se está indexando…`);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el documento.');
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? `Editar "${document?.title ?? 'documento'}"` : 'Nuevo documento'}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? `La edición crea la versión ${
                  (document?.version ?? 0) + 1
                } y la deja activa cuando termina la indexación. Las versiones anteriores se conservan accesibles.`
              : 'Markdown soportado. Al guardar se chunkea, se generan embeddings y queda activo en la base de conocimiento.'}
          </DialogDescription>
        </DialogHeader>

        {isEdit ? (
          detailQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-slate-500">Cargando contenido…</p>
          ) : detailQuery.isError ? (
            <p className="py-8 text-center text-sm text-red-600">No pudimos cargar el documento.</p>
          ) : (
            <EditForm
              form={editForm}
              onSubmit={handleEdit}
              eligibleAreas={eligibleAreas}
              currentScope={detailQuery.data?.scope ?? 'global'}
            />
          )
        ) : (
          <CreateForm form={createForm} onSubmit={handleCreate} eligibleAreas={eligibleAreas} />
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="kb-form" disabled={submitting}>
            {submitting ? 'Guardando…' : isEdit ? 'Guardar como nueva versión' : 'Crear documento'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// -------- subcomponentes para no inflar el dialog principal --------

interface CreateFormProps {
  form: ReturnType<typeof useForm<CreateValues>>;
  onSubmit: (data: CreateValues) => void | Promise<void>;
  eligibleAreas: { id: string; name: string }[];
}

function CreateForm({ form, onSubmit, eligibleAreas }: CreateFormProps) {
  const scope = form.watch('scope');
  return (
    <form id="kb-form" className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="kb-title-create">Título</Label>
        <Input id="kb-title-create" autoFocus {...form.register('title')} />
        <FieldError message={form.formState.errors.title?.message} />
      </div>

      <fieldset className="flex flex-col gap-2 rounded-md border border-slate-200 p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Alcance
        </legend>
        <Controller
          control={form.control}
          name="scope"
          render={({ field }) => (
            <div className="flex gap-4">
              <ScopeRadio
                checked={field.value === 'global'}
                value="global"
                onChange={() => {
                  field.onChange('global');
                  form.setValue('areaIds', []);
                }}
                label="Global"
                description="Aplica a tickets de cualquier área."
              />
              <ScopeRadio
                checked={field.value === 'area'}
                value="area"
                onChange={() => field.onChange('area')}
                label="Por área"
                description="Solo se cita para tickets de las áreas elegidas."
              />
            </div>
          )}
        />
        {scope === 'area' && (
          <div className="flex flex-col gap-2 pt-2">
            <Label className="text-xs">Áreas (al menos una)</Label>
            <Controller
              control={form.control}
              name="areaIds"
              render={({ field }) => (
                <AreaMultiSelect
                  options={eligibleAreas}
                  value={field.value ?? []}
                  onChange={field.onChange}
                />
              )}
            />
            <FieldError message={form.formState.errors.areaIds?.message} />
          </div>
        )}
      </fieldset>

      <ContentEditor
        register={form.register('content')}
        value={form.watch('content') ?? ''}
        error={form.formState.errors.content?.message}
      />
    </form>
  );
}

interface EditFormProps {
  form: ReturnType<typeof useForm<EditValues>>;
  onSubmit: (data: EditValues) => void | Promise<void>;
  eligibleAreas: { id: string; name: string }[];
  currentScope: 'global' | 'area';
}

function EditForm({ form, onSubmit, eligibleAreas, currentScope }: EditFormProps) {
  return (
    <form id="kb-form" className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
      <div className="flex flex-col gap-2">
        <Label htmlFor="kb-title-edit">Título</Label>
        <Input id="kb-title-edit" {...form.register('title')} />
        <FieldError message={form.formState.errors.title?.message} />
      </div>

      {/*
        Scope no se puede cambiar en edición (decisión documentada en
        tikora-api.md §9.2). Lo mostramos como info inerte y, si es de
        área, permitimos editar `areaIds`.
      */}
      <div className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-600">
        <span>
          Alcance:{' '}
          <strong className="text-slate-900">
            {currentScope === 'global' ? 'Global' : 'Por área'}
          </strong>
        </span>
        <span className="text-xs text-slate-400">No editable</span>
      </div>

      {currentScope === 'area' && (
        <div className="flex flex-col gap-2">
          <Label className="text-xs">Áreas asignadas</Label>
          <Controller
            control={form.control}
            name="areaIds"
            render={({ field }) => (
              <AreaMultiSelect
                options={eligibleAreas}
                value={field.value ?? []}
                onChange={field.onChange}
              />
            )}
          />
        </div>
      )}

      <ContentEditor
        register={form.register('content')}
        value={form.watch('content') ?? ''}
        error={form.formState.errors.content?.message}
      />
    </form>
  );
}

interface ContentEditorProps {
  register: ReturnType<ReturnType<typeof useForm>['register']>;
  value: string;
  error?: string;
}

function ContentEditor({ register, value, error }: ContentEditorProps) {
  const [showPreview, setShowPreview] = useState(false);
  const bytes = new TextEncoder().encode(value).byteLength;
  const overLimit = bytes > KB_MAX_BYTES;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <Label htmlFor="kb-content">Contenido (Markdown)</Label>
        <button
          type="button"
          className="text-xs text-blue-700 hover:underline"
          onClick={() => setShowPreview((v) => !v)}
        >
          {showPreview ? 'Editar' : 'Previsualizar'}
        </button>
      </div>
      {showPreview ? (
        <div className="min-h-72 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
          <pre className="whitespace-pre-wrap font-sans text-slate-700">{value || '—'}</pre>
        </div>
      ) : (
        <Textarea id="kb-content" rows={14} className="font-mono text-xs" {...register} />
      )}
      <div className="flex items-center justify-between text-xs">
        <FieldError message={error} />
        <span className={overLimit ? 'text-red-600' : 'text-slate-500'}>
          {(bytes / 1024).toFixed(1)} / {(KB_MAX_BYTES / 1024).toFixed(0)} KB
        </span>
      </div>
    </div>
  );
}

interface ScopeRadioProps {
  value: 'global' | 'area';
  checked: boolean;
  onChange: () => void;
  label: string;
  description: string;
}

function ScopeRadio({ value, checked, onChange, label, description }: ScopeRadioProps) {
  return (
    <label className="flex flex-1 cursor-pointer items-start gap-2 rounded-md border border-slate-200 p-3 hover:bg-slate-50">
      <input
        type="radio"
        name="scope"
        value={value}
        checked={checked}
        onChange={onChange}
        className="mt-0.5"
      />
      <div className="flex flex-col">
        <span className="text-sm font-medium text-slate-900">{label}</span>
        <span className="text-xs text-slate-500">{description}</span>
      </div>
    </label>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}
