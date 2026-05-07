import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@tikora/core';
import type { Request } from 'express';
import { ApiException } from '../../common/exceptions/api.exception';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedUser } from '../types/auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Sin metadata `@Roles(...)` el endpoint pasa por defecto. Cualquier
    // restricción adicional (área, ownership) la hace el service.
    if (!required || required.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    if (!req.user) {
      // JwtAuthGuard debería haber poblado `user`. Defensivo por si el
      // orden de guards cambia o un endpoint @Public usa @Roles por error.
      throw new ApiException(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Autenticación requerida.');
    }

    if (!required.includes(req.user.role)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'AUTH_ROLE_FORBIDDEN',
        'No tenés permisos para esta acción.',
      );
    }

    return true;
  }
}
