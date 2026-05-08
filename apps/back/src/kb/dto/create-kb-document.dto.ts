import { createKbDocumentSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateKbDocumentDto extends createZodDto(createKbDocumentSchema) {}
