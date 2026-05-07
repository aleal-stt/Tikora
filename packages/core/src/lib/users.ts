import { z } from 'zod';
import { roleSchema } from './auth';

// Política de contraseñas reutilizable. La validación de complejidad
// vive en el contrato compartido para que back y front la aplique antes
// de pegarle a la red — feedback inmediato al usuario y mismo criterio.
const passwordPolicy = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres')
  .regex(/[A-Za-z]/, 'Debe contener al menos una letra')
  .regex(/[0-9]/, 'Debe contener al menos un número');

const trimmedNonEmpty = (label: string) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(z.string().min(1, `${label} es obligatorio`));

const emailField = z.preprocess(
  (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
  z.email({ message: 'Email inválido' }),
);

/** Forma del usuario expuesta al cliente. Excluye `passwordHash` y los campos de lockout (privados del backend). */
export const userSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  areaIds: z.array(z.string()),
  active: z.boolean(),
  mustChangePassword: z.boolean(),
  lastLoginAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type User = z.infer<typeof userSchema>;

/** Body de POST /users. */
export const createUserSchema = z.object({
  email: emailField,
  fullName: trimmedNonEmpty('El nombre'),
  role: roleSchema,
  areaIds: z.array(z.string()).default([]),
  temporaryPassword: passwordPolicy,
});
export type CreateUser = z.infer<typeof createUserSchema>;

/**
 * Body de PATCH /users/:id. Todos los campos opcionales pero al menos uno
 * debe venir — si no, no hay nada que actualizar.
 */
export const updateUserSchema = z
  .object({
    fullName: trimmedNonEmpty('El nombre').optional(),
    role: roleSchema.optional(),
    areaIds: z.array(z.string()).optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.values(data).some((v) => v !== undefined), {
    message: 'Hay que enviar al menos un campo a actualizar',
  });
export type UpdateUser = z.infer<typeof updateUserSchema>;

/** Body de PATCH /users/me — solo se permite editar el nombre propio. */
export const updateMeSchema = z.object({
  fullName: trimmedNonEmpty('El nombre'),
});
export type UpdateMe = z.infer<typeof updateMeSchema>;

/** Body de PATCH /users/me/password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'La contraseña actual es obligatoria'),
    newPassword: passwordPolicy,
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'La contraseña nueva debe ser distinta de la actual',
    path: ['newPassword'],
  });
export type ChangePassword = z.infer<typeof changePasswordSchema>;

/** Response paginada de GET /users. */
export const userListResponseSchema = z.object({
  items: z.array(userSchema),
  nextCursor: z.string().nullable(),
});
export type UserListResponse = z.infer<typeof userListResponseSchema>;
