import { loginRequestSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class LoginDto extends createZodDto(loginRequestSchema) {}
