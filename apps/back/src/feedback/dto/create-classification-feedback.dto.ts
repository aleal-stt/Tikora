import { createClassificationFeedbackSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateClassificationFeedbackDto extends createZodDto(
  createClassificationFeedbackSchema,
) {}
