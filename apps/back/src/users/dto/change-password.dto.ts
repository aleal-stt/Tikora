import { changePasswordSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
