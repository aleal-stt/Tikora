import { kbScopeSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const asArray = <T extends z.ZodType>(item: T) =>
  z.preprocess(
    (v) => (Array.isArray(v) ? v : v !== undefined ? [v] : undefined),
    z.array(item).optional(),
  );

/**
 * Filtros del listado de KB. El backend siempre limita por `tenantId`
 * y, para LID, también por las áreas que lidera + globales.
 */
const listKbDocumentsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  scope: kbScopeSchema.optional(),
  areaId: asArray(z.string()),
});

export class ListKbDocumentsQueryDto extends createZodDto(listKbDocumentsQuerySchema) {}
