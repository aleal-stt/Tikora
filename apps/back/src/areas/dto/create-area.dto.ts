import { createAreaSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateAreaDto extends createZodDto(createAreaSchema) {}
