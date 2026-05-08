import { updateKbDocumentSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class UpdateKbDocumentDto extends createZodDto(updateKbDocumentSchema) {}
