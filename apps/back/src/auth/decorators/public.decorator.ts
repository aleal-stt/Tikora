import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marca un endpoint como público. El `JwtAuthGuard` global lo deja pasar
 * sin verificar `Authorization`. Usar exclusivamente para `/auth/login`,
 * `/auth/refresh`, `/auth/logout` y `/health`.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
