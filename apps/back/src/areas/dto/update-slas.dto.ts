import { updateSlasSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class UpdateSlasDto extends createZodDto(updateSlasSchema) {}
