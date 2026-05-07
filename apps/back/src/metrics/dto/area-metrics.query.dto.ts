import { areaMetricsQuerySchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class AreaMetricsQueryDto extends createZodDto(areaMetricsQuerySchema) {}
