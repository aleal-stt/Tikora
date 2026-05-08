import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const reopenFromEmailSchema = z.object({
  token: z.string().min(20, 'Token inválido'),
});

export class ReopenFromEmailDto extends createZodDto(reopenFromEmailSchema) {}
