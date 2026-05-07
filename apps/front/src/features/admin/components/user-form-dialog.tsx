import { zodResolver } from '@hookform/resolvers/zod';
import { createUserSchema, updateUserSchema, type Area, type Role, type User } from '@tikora/core';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select';
import { ApiError } from '../../../lib/api-client';
import { useAuthStore } from '../../../stores/auth.store';
import { useCreateUser, useUpdateUser } from '../api/use-users';
import { AreaMultiSelect } from './area-multi-select';

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si viene, modo edición; si no, alta. */
  user?: User;
  /** Áreas disponibles. El caller pasa solo las que el editor puede gestionar. */
  areas: Pick<Area, 'id' | 'name'>[];
}

// Reusamos los schemas de @tikora/core. `z.input` (no `z.infer`) preserva
// el shape pre-transform que es lo que el form maneja antes de submit
// (ej. email como string crudo, areaIds opcional por el `default([])`).
const createFormSchema = createUserSchema;
const editFormSchema = updateUserSchema;

type CreateFormValues = z.input<typeof createFormSchema>;
type EditFormValues = z.input<typeof editFormSchema>;

/** Roles que un líder puede asignar. Admin puede asignar todos. */
const LEADER_ASSIGNABLE_ROLES: Role[] = ['empleado', 'agente'];
const ALL_ROLES: Role[] = ['empleado', 'agente', 'lider', 'admin'];

export function UserFormDialog({ open, onOpenChange, user, areas }: UserFormDialogProps) {
  const callerRole = useAuthStore((s) => s.user?.role);
  const isEdit = Boolean(user);
  const assignableRoles = callerRole === 'admin' ? ALL_ROLES : LEADER_ASSIGNABLE_ROLES;

  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();

  const createForm = useForm<CreateFormValues>({
    resolver: zodResolver(createFormSchema),
    defaultValues: {
      email: '',
      fullName: '',
      role: 'empleado',
      areaIds: [],
      temporaryPassword: '',
    },
  });

  const editForm = useForm<EditFormValues>({
    resolver: zodResolver(editFormSchema),
    defaultValues: {
      fullName: user?.fullName,
      role: user?.role,
      areaIds: user?.areaIds,
      active: user?.active,
    },
  });

  // Repuebla el form de edición cuando cambia el user objetivo (al abrir
  // sobre un row distinto sin desmontar el componente).
  useEffect(() => {
    if (isEdit && user) {
      editForm.reset({
        fullName: user.fullName,
        role: user.role,
        areaIds: user.areaIds,
        active: user.active,
      });
    } else if (!isEdit) {
      createForm.reset({
        email: '',
        fullName: '',
        role: 'empleado',
        areaIds: [],
        temporaryPassword: '',
      });
    }
  }, [isEdit, user, editForm, createForm]);

  async function handleCreate(data: CreateFormValues) {
    try {
      // `parse` aplica los transforms del schema (trim, lowercase del email,
      // default de areaIds) — el back recibe la forma normalizada.
      const payload = createFormSchema.parse(data);
      await createMutation.mutateAsync(payload);
      toast.success('Usuario creado.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo crear el usuario.');
    }
  }

  async function handleEdit(data: EditFormValues) {
    if (!user) return;
    try {
      const payload = editFormSchema.parse(data);
      await updateMutation.mutateAsync({ id: user.id, input: payload });
      toast.success('Usuario actualizado.');
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'No se pudo actualizar el usuario.');
    }
  }

  const submitting = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar usuario' : 'Nuevo usuario'}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? 'Cambios sobre el usuario seleccionado.'
              : 'El usuario recibirá una contraseña temporal y deberá cambiarla en su primer login.'}
          </DialogDescription>
        </DialogHeader>

        {isEdit ? (
          <form
            id="user-form"
            className="flex flex-col gap-4"
            onSubmit={editForm.handleSubmit(handleEdit)}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName">Nombre completo</Label>
              <Input id="fullName" {...editForm.register('fullName')} />
              <FieldError message={editForm.formState.errors.fullName?.message} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Rol</Label>
              <Select
                value={editForm.watch('role')}
                onValueChange={(value) => editForm.setValue('role', value as Role)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un rol" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={editForm.formState.errors.role?.message} />
            </div>

            <div className="flex flex-col gap-2">
              <Label>Áreas asignadas</Label>
              <AreaMultiSelect
                options={areas}
                value={editForm.watch('areaIds') ?? []}
                onChange={(next) => editForm.setValue('areaIds', next)}
              />
              <FieldError message={editForm.formState.errors.areaIds?.message} />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={editForm.watch('active') ?? false}
                onChange={(e) => editForm.setValue('active', e.target.checked)}
                className="h-4 w-4 rounded border-slate-300"
              />
              Usuario activo
            </label>
          </form>
        ) : (
          <form
            id="user-form"
            className="flex flex-col gap-4"
            onSubmit={createForm.handleSubmit(handleCreate)}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" {...createForm.register('email')} />
              <FieldError message={createForm.formState.errors.email?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="fullName-create">Nombre completo</Label>
              <Input id="fullName-create" {...createForm.register('fullName')} />
              <FieldError message={createForm.formState.errors.fullName?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Rol</Label>
              <Select
                value={createForm.watch('role')}
                onValueChange={(value) => createForm.setValue('role', value as Role)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Seleccioná un rol" />
                </SelectTrigger>
                <SelectContent>
                  {assignableRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError message={createForm.formState.errors.role?.message} />
            </div>
            <div className="flex flex-col gap-2">
              <Label>Áreas asignadas</Label>
              <AreaMultiSelect
                options={areas}
                value={createForm.watch('areaIds') ?? []}
                onChange={(next) => createForm.setValue('areaIds', next)}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="temporaryPassword">Contraseña temporal</Label>
              <Input
                id="temporaryPassword"
                type="password"
                autoComplete="new-password"
                {...createForm.register('temporaryPassword')}
              />
              <FieldError message={createForm.formState.errors.temporaryPassword?.message} />
            </div>
          </form>
        )}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button type="submit" form="user-form" disabled={submitting}>
            {submitting ? 'Guardando…' : isEdit ? 'Guardar cambios' : 'Crear usuario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const ROLE_LABEL: Record<Role, string> = {
  empleado: 'Empleado',
  agente: 'Agente',
  lider: 'Líder',
  admin: 'Admin',
};

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-red-600">{message}</p>;
}
