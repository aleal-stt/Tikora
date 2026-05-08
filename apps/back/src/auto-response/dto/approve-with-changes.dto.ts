import { approveWithChangesSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class ApproveWithChangesDto extends createZodDto(approveWithChangesSchema) {}
