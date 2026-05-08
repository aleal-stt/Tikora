import { discardAiResponseSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class DiscardAiResponseDto extends createZodDto(discardAiResponseSchema) {}
