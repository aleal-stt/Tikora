import { areaMemberRefSchema } from '@tikora/core';
import { createZodDto } from 'nestjs-zod';

export class AreaMemberRefDto extends createZodDto(areaMemberRefSchema) {}
