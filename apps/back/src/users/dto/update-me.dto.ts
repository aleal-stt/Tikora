import { updateMeSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class UpdateMeDto extends createZodDto(updateMeSchema) {}
