import { updateUserSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
