import { updateAreaSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class UpdateAreaDto extends createZodDto(updateAreaSchema) {}
