import { estadoTicketSchema, prioridadSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Express deserializa `?key=a&key=b` como `['a','b']` y `?key=a` como `'a'`.
// Normalizamos a array siempre para que el schema valide uniforme.
const asArray = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : v !== undefined ? [v] : undefined),
    z.array(item).optional(),
  );

const asBoolean = z.preprocess(
  (v) => (typeof v === 'string' ? v === 'true' : v),
  z.boolean().optional(),
);

const listTicketsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  estado: asArray(estadoTicketSchema),
  prioridad: asArray(prioridadSchema),
  areaId: asArray(z.string()),
  assignedToMe: asBoolean,
  requesterId: z.string().optional(),
});

export class ListTicketsQueryDto extends createZodDto(listTicketsQuerySchema) {}
