import { createMcpKeySchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateMcpKeyDto extends createZodDto(createMcpKeySchema) {}
