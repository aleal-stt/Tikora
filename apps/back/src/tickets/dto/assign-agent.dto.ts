import { assignAgentSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class AssignAgentDto extends createZodDto(assignAgentSchema) {}
