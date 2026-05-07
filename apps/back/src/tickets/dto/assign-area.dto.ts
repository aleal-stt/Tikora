import { assignAreaSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class AssignAreaDto extends createZodDto(assignAreaSchema) {}
