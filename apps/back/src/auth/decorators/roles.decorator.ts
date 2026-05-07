import { SetMetadata } from '@nestjs/common';
import type { Role } from '@tikora/core';

export const ROLES_KEY = 'roles';

/**
 * Restringe un endpoint a la lista de roles indicada.
 * Si no se aplica, el endpoint es accesible para cualquier rol autenticado
 * (la autenticación la sigue exigiendo `JwtAuthGuard`).
 *
 * @example
 *   @Roles('admin', 'lider')
 *   @Get('/users')
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
