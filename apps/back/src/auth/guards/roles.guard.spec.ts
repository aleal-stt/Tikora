import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import type { AuthenticatedUser } from '../types/auth.types';
import { RolesGuard } from './roles.guard';

function ctxWith(user?: AuthenticatedUser) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as never;
}

function reflectorReturning(roles?: string[]) {
  const r = new Reflector();
  r.getAllAndOverride = (() => roles) as Reflector['getAllAndOverride'];
  return r;
}

const baseUser: AuthenticatedUser = {
  userId: 'u1',
  tenantId: 't1',
  role: 'agente',
  areaIds: [],
};

describe('RolesGuard', () => {
  it('permite el endpoint si no se aplicó @Roles', () => {
    const guard = new RolesGuard(reflectorReturning(undefined));
    expect(guard.canActivate(ctxWith(baseUser))).toBe(true);
  });

  it('permite cuando el rol del usuario está en la lista', () => {
    const guard = new RolesGuard(reflectorReturning(['agente', 'admin']));
    expect(guard.canActivate(ctxWith(baseUser))).toBe(true);
  });

  it('rechaza con AUTH_ROLE_FORBIDDEN cuando el rol no está en la lista', () => {
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(() => guard.canActivate(ctxWith(baseUser))).toThrow(ApiException);
  });

  it('rechaza con AUTH_REQUIRED cuando no hay request.user', () => {
    const guard = new RolesGuard(reflectorReturning(['admin']));
    expect(() => guard.canActivate(ctxWith(undefined))).toThrow(ApiException);
  });
});
