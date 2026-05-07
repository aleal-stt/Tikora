import { createUserSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class CreateUserDto extends createZodDto(createUserSchema) {}
