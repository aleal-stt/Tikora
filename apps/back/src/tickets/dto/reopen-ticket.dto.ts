import { reopenTicketSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class ReopenTicketDto extends createZodDto(reopenTicketSchema) {}
