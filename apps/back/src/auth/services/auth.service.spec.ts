import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import { AuthService } from './auth.service';

const TENANT_ID = new Types.ObjectId();
const USER_ID = new Types.ObjectId();

const ENV = {
  LOGIN_MAX_FAILED_ATTEMPTS: 5,
  LOGIN_LOCKOUT_MINUTES: 15,
  JWT_ACCESS_EXPIRES_IN: '15m',
};

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: USER_ID,
    tenantId: TENANT_ID,
    email: 'agente@empresa.com',
    fullName: 'Agente Test',
    passwordHash: 'hash-pretendido',
    role: 'agente',
    areaIds: [new Types.ObjectId()],
    active: true,
    mustChangePassword: false,
    failedLoginAttempts: 0,
    lockedUntil: null,
    ...overrides,
  };
}

function buildHarness(userOverrides?: Partial<Record<string, unknown>>) {
  const user = userOverrides === null ? null : buildUser(userOverrides);

  const users = {
    findByEmail: vi.fn().mockResolvedValue(user),
    findById: vi.fn().mockResolvedValue(user),
    recordSuccessfulLogin: vi.fn().mockResolvedValue(undefined),
    incrementFailedLogin: vi.fn().mockResolvedValue(1),
    lockUntil: vi.fn().mockResolvedValue(undefined),
  };
  const tenants = { getDefaultTenantId: vi.fn().mockResolvedValue(TENANT_ID) };
  const passwords = { compare: vi.fn().mockResolvedValue(true) };
  const refreshTokens = {
    issue: vi.fn().mockResolvedValue({
      token: 'refresh.jwt',
      expiresAt: new Date(Date.now() + 7 * 86400 * 1000),
    }),
    rotate: vi.fn(),
    revoke: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  };
  const jwt = { signAsync: vi.fn().mockResolvedValue('access.jwt') };
  const config = { get: (key: keyof typeof ENV) => ENV[key] };

  const service = new AuthService(
    users as never,
    tenants as never,
    passwords as never,
    refreshTokens as never,
    jwt as never,
    config as never,
  );

  return { service, users, tenants, passwords, refreshTokens, jwt };
}

describe('AuthService.login', () => {
  it('emite tokens y mappea al usuario público cuando las credenciales son correctas', async () => {
    const { service, users, refreshTokens, jwt } = buildHarness();

    const result = await service.login({
      email: 'Agente@Empresa.com',
      password: 'correcta',
      userAgent: null,
      ip: null,
    });

    expect(result.response.accessToken).toBe('access.jwt');
    expect(result.response.user).toMatchObject({
      id: USER_ID.toString(),
      email: 'agente@empresa.com',
      role: 'agente',
    });
    expect(result.refresh.token).toBe('refresh.jwt');
    expect(users.recordSuccessfulLogin).toHaveBeenCalledWith(USER_ID);
    expect(refreshTokens.issue).toHaveBeenCalled();
    expect(jwt.signAsync).toHaveBeenCalled();
  });

  it('lanza AUTH_INVALID_CREDENTIALS cuando el usuario no existe', async () => {
    const { service } = buildHarness(null as never);

    await expect(
      service.login({ email: 'no@existe.com', password: 'x', userAgent: null, ip: null }),
    ).rejects.toMatchObject({
      getStatus: expect.any(Function),
    });

    try {
      await service.login({ email: 'no@existe.com', password: 'x', userAgent: null, ip: null });
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    }
  });

  it('lanza AUTH_USER_INACTIVE cuando la cuenta está desactivada', async () => {
    const { service } = buildHarness({ active: false });

    try {
      await service.login({ email: 'a@b.com', password: 'x', userAgent: null, ip: null });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect((err as ApiException).getResponse()).toMatchObject({ code: 'AUTH_USER_INACTIVE' });
    }
  });

  it('rechaza con AUTH_INVALID_CREDENTIALS sin distinguir cuando la cuenta está bloqueada', async () => {
    const future = new Date(Date.now() + 60_000);
    const { service, passwords } = buildHarness({ lockedUntil: future });

    try {
      await service.login({ email: 'a@b.com', password: 'x', userAgent: null, ip: null });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AUTH_INVALID_CREDENTIALS',
      });
    }
    // No verificamos password si la cuenta está bloqueada — evita timing leaks.
    expect(passwords.compare).not.toHaveBeenCalled();
  });

  it('incrementa el contador de intentos fallidos y lockea al alcanzar el umbral', async () => {
    const { service, users, passwords } = buildHarness();
    passwords.compare.mockResolvedValue(false);
    users.incrementFailedLogin.mockResolvedValue(ENV.LOGIN_MAX_FAILED_ATTEMPTS);

    await expect(
      service.login({ email: 'a@b.com', password: 'mala', userAgent: null, ip: null }),
    ).rejects.toBeInstanceOf(ApiException);

    expect(users.incrementFailedLogin).toHaveBeenCalledWith(USER_ID);
    expect(users.lockUntil).toHaveBeenCalledTimes(1);
    const firstCall = users.lockUntil.mock.calls[0];
    expect(firstCall).toBeDefined();
    const until = firstCall?.[1] as Date;
    expect(until).toBeInstanceOf(Date);
    expect(until.getTime()).toBeGreaterThan(Date.now());
  });

  it('no lockea si el contador está debajo del umbral', async () => {
    const { service, users, passwords } = buildHarness();
    passwords.compare.mockResolvedValue(false);
    users.incrementFailedLogin.mockResolvedValue(1);

    await expect(
      service.login({ email: 'a@b.com', password: 'mala', userAgent: null, ip: null }),
    ).rejects.toBeInstanceOf(ApiException);

    expect(users.lockUntil).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rota el refresh y emite un nuevo access cuando el usuario sigue activo', async () => {
    const { service, refreshTokens } = buildHarness();
    refreshTokens.rotate.mockResolvedValue({
      token: 'new.refresh',
      expiresAt: new Date(Date.now() + 86_400_000),
      userId: USER_ID,
      tenantId: TENANT_ID,
    });

    const result = await service.refresh('old.refresh', { userAgent: null, ip: null });

    expect(result.accessToken).toBe('access.jwt');
    expect(result.refresh.token).toBe('new.refresh');
  });

  it('si el usuario fue desactivado, mata la cadena y rechaza', async () => {
    const { service, refreshTokens } = buildHarness({ active: false });
    refreshTokens.rotate.mockResolvedValue({
      token: 'new.refresh',
      expiresAt: new Date(Date.now() + 86_400_000),
      userId: USER_ID,
      tenantId: TENANT_ID,
    });

    await expect(
      service.refresh('old.refresh', { userAgent: null, ip: null }),
    ).rejects.toBeInstanceOf(ApiException);

    expect(refreshTokens.revokeAllForUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe('AuthService.logout', () => {
  it('revoca el refresh recibido', async () => {
    const { service, refreshTokens } = buildHarness();

    await service.logout('some.refresh');

    expect(refreshTokens.revoke).toHaveBeenCalledWith('some.refresh');
  });

  it('es no-op si la cookie no llega', async () => {
    const { service, refreshTokens } = buildHarness();

    await service.logout(undefined);

    expect(refreshTokens.revoke).not.toHaveBeenCalled();
  });
});
