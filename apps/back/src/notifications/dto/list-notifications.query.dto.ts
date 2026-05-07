import { notificationEventTypeSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const listNotificationsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  read: z.preprocess((v) => (typeof v === 'string' ? v === 'true' : v), z.boolean().optional()),
  type: notificationEventTypeSchema.optional(),
});

export class ListNotificationsQueryDto extends createZodDto(listNotificationsQuerySchema) {}
