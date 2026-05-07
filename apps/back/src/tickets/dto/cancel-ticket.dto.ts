import { cancelTicketSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CancelTicketDto extends createZodDto(cancelTicketSchema) {}
