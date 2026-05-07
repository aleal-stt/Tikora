import { classifyTicketSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class ClassifyTicketDto extends createZodDto(classifyTicketSchema) {}
