import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listAreasQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export class ListAreasQueryDto extends createZodDto(listAreasQuerySchema) {}
