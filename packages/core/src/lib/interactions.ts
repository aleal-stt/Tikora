import { z } from 'zod';

export const interactionTypeSchema = z.enum(['usuario', 'agente', 'ia', 'sistema']);
export type InteractionType = z.infer<typeof interactionTypeSchema>;

const usuarioMetadataSchema = z.object({
  canal: z.enum(['plataforma', 'correo']).optional(),
});

const agenteMetadataSchema = z.object({
  enviadoPorCorreo: z.boolean().optional(),
  correoMessageId: z.string().optional(),
});

const iaMetadataSchema = z.object({
  purpose: z.enum(['classification', 'auto-response']).optional(),
  aiCallLogId: z.string().optional(),
});

const sistemaMetadataSchema = z.object({
  eventName: z.string(),
  fromEstado: z.string().optional(),
  toEstado: z.string().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

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

const baseShape = {
  id: z.string(),
  ticketId: z.string(),
  authorId: z.string().nullable(),
  content: z.string(),
  createdAt: z.string(),
};

/**
 * Forma de respuesta de una interacción. La unión discriminada por
 * `type` permite al cliente tipar la `metadata` específica sin casts.
 */
export const interactionSchema = z.discriminatedUnion('type', [
  z.object({ ...baseShape, type: z.literal('usuario'), metadata: usuarioMetadataSchema }),
  z.object({ ...baseShape, type: z.literal('agente'), metadata: agenteMetadataSchema }),
  z.object({ ...baseShape, type: z.literal('ia'), metadata: iaMetadataSchema }),
  z.object({ ...baseShape, type: z.literal('sistema'), metadata: sistemaMetadataSchema }),
]);
export type Interaction = z.infer<typeof interactionSchema>;

/**
 * Body de POST /tickets/:id/interactions. Solo se admiten interacciones
 * de usuario y agente desde la API; `ia` y `sistema` las crea el backend.
 *
 * Es un `z.object` plano (no `discriminatedUnion`) porque `nestjs-zod`/
 * `createZodDto` no consumen bien tipos union. La forma efectiva por
 * type la decide el service según el caller.
 */
export const createInteractionSchema = z.object({
  type: z.enum(['usuario', 'agente']),
  content: trimmedRange('El contenido', 1, 5000),
  enviarPorCorreo: z.boolean().optional(),
});
export type CreateInteraction = z.infer<typeof createInteractionSchema>;

export const interactionListResponseSchema = z.object({
  items: z.array(interactionSchema),
  nextCursor: z.string().nullable(),
});
export type InteractionListResponse = z.infer<typeof interactionListResponseSchema>;
