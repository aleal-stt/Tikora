import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const streamQuerySchema = z.object({
  ticket: z.string().min(1, 'ticket es obligatorio'),
});

export class StreamQueryDto extends createZodDto(streamQuerySchema) {}
