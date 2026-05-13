import { aiMetricsQuerySchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class AiMetricsQueryDto extends createZodDto(aiMetricsQuerySchema) {}
