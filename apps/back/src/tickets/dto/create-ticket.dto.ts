import { createTicketSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateTicketDto extends createZodDto(createTicketSchema) {}
