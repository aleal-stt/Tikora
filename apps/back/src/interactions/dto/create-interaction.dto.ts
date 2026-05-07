import { createInteractionSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateInteractionDto extends createZodDto(createInteractionSchema) {}
