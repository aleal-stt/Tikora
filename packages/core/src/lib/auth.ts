import { z } from 'zod';

export const roleSchema = z.enum(['empleado', 'agente', 'lider', 'admin']);
export type Role = z.infer<typeof roleSchema>;

export const userPublicSchema = z.object({
  id: z.string(),
  email: z.string(),
  fullName: z.string(),
  role: roleSchema,
  areaIds: z.array(z.string()),
});
export type UserPublic = z.infer<typeof userPublicSchema>;

export const loginRequestSchema = z.object({
  // El preprocess corre antes de la validación de formato: tolera
  // espacios accidentales y mayúsculas que vienen del browser/teclado.
  email: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v),
    z.email({ message: 'Email inválido' }),
  ),
  password: z.string().min(1, 'La contraseña es obligatoria'),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const loginResponseSchema = z.object({
  accessToken: z.string(),
  user: userPublicSchema,
});
export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const refreshResponseSchema = z.object({
  accessToken: z.string(),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;
