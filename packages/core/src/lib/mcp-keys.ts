import { z } from 'zod';

const trimmedRange = (label: string, min: number, max: number) =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(min, `${label} debe tener al menos ${min} caracteres`)
        .max(max, `${label} no puede superar los ${max} caracteres`),
    );

/** Forma de la key expuesta al cliente. Nunca incluye el secreto completo ni el hash. */
export const mcpKeySchema = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  lastUsedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type McpKey = z.infer<typeof mcpKeySchema>;

export const mcpKeyListResponseSchema = z.object({
  items: z.array(mcpKeySchema),
});
export type McpKeyListResponse = z.infer<typeof mcpKeyListResponseSchema>;

/** Body de POST /api/v1/me/mcp-keys. */
export const createMcpKeySchema = z.object({
  name: trimmedRange('El nombre', 1, 80),
});
export type CreateMcpKey = z.infer<typeof createMcpKeySchema>;

/**
 * Respuesta al crear la key. `secret` se devuelve **una sola vez** —
 * el cliente debe guardarlo en el momento; en consultas posteriores
 * solo está disponible el `prefix` para identificarla.
 */
export const createMcpKeyResponseSchema = z.object({
  key: mcpKeySchema,
  secret: z.string(),
});
export type CreateMcpKeyResponse = z.infer<typeof createMcpKeyResponseSchema>;
