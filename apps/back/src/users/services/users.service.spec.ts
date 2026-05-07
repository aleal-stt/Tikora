import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { UsersService } from './users.service';

const TENANT_ID = new Types.ObjectId();

const ADMIN_AREAS: string[] = [];
const LEADER_AREA_A = new Types.ObjectId().toString();
const LEADER_AREA_B = new Types.ObjectId().toString();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: ADMIN_AREAS,
  };
}

function asLeader(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'lider',
    areaIds: [LEADER_AREA_A, LEADER_AREA_B],
  };
}

function buildUserDoc(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    email: 'agente@empresa.com',
    fullName: 'Agente Test',
    passwordHash: 'hash',
    role: 'agente',
    areaIds: [new Types.ObjectId(LEADER_AREA_A)],
    active: true,
    mustChangePassword: false,
    lastLoginAt: null,
    failedLoginAttempts: 0,
    lockedUntil: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function buildHarness(
  opts: {
    existingByEmail?: ReturnType<typeof buildUserDoc> | null;
    existingById?: ReturnType<typeof buildUserDoc> | null;
  } = {},
) {
  const findOneCalls: unknown[] = [];

  const userModel = {
    findOne: vi.fn((filter: { email?: string; _id?: Types.ObjectId }) => {
      findOneCalls.push(filter);
      const result = filter.email ? opts.existingByEmail ?? null : opts.existingById ?? null;
      return { exec: vi.fn().mockResolvedValue(result) };
    }),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
      return buildUserDoc({
        ...data,
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }),
    find: vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue([]) }),
      }),
    })),
    countDocuments: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(0) })),
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
    findOneAndUpdate: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(null),
    })),
  };

  const passwords = {
    hash: vi.fn().mockResolvedValue('new-hash'),
    compare: vi.fn().mockResolvedValue(true),
  };

  const emails = {
    sendWelcomeEmail: vi.fn().mockResolvedValue(undefined),
  };

  const service = new UsersService(userModel as never, passwords as never, emails as never);

  return { service, userModel, passwords, emails, findOneCalls };
}

describe('UsersService.createForCaller', () => {
  it('admin crea un agente y dispara el welcome email', async () => {
    const { service, emails } = buildHarness();
    const created = await service.createForCaller(asAdmin(), {
      email: 'nuevo@empresa.com',
      fullName: 'Nuevo',
      role: 'agente',
      areaIds: [LEADER_AREA_A],
      temporaryPassword: 'TempPass1234',
    });

    expect(created.role).toBe('agente');
    expect(created.mustChangePassword).toBe(true);
    expect(emails.sendWelcomeEmail).toHaveBeenCalledTimes(1);
  });

  it('rechaza email duplicado con USER_EMAIL_DUPLICATE', async () => {
    const { service } = buildHarness({ existingByEmail: buildUserDoc() });

    try {
      await service.createForCaller(asAdmin(), {
        email: 'agente@empresa.com',
        fullName: 'Otro',
        role: 'agente',
        areaIds: [LEADER_AREA_A],
        temporaryPassword: 'TempPass1234',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_EMAIL_DUPLICATE',
      });
    }
  });

  it('LID intentando crear admin recibe USER_ROLE_FORBIDDEN', async () => {
    const { service } = buildHarness();

    try {
      await service.createForCaller(asLeader(), {
        email: 'a@b.com',
        fullName: 'X',
        role: 'admin',
        areaIds: [],
        temporaryPassword: 'TempPass1234',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_ROLE_FORBIDDEN',
      });
    }
  });

  it('LID asignando un agente fuera de sus áreas recibe USER_AREA_FORBIDDEN', async () => {
    const { service } = buildHarness();
    const ajeno = new Types.ObjectId().toString();

    try {
      await service.createForCaller(asLeader(), {
        email: 'a@b.com',
        fullName: 'X',
        role: 'agente',
        areaIds: [ajeno],
        temporaryPassword: 'TempPass1234',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_AREA_FORBIDDEN',
      });
    }
  });

  it('rechaza empleado con áreas (USER_ROLE_AREAS_MISMATCH)', async () => {
    const { service } = buildHarness();

    try {
      await service.createForCaller(asAdmin(), {
        email: 'a@b.com',
        fullName: 'X',
        role: 'empleado',
        areaIds: [LEADER_AREA_A],
        temporaryPassword: 'TempPass1234',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_ROLE_AREAS_MISMATCH',
      });
    }
  });

  it('rechaza agente sin áreas (USER_ROLE_AREAS_MISMATCH)', async () => {
    const { service } = buildHarness();

    try {
      await service.createForCaller(asAdmin(), {
        email: 'a@b.com',
        fullName: 'X',
        role: 'agente',
        areaIds: [],
        temporaryPassword: 'TempPass1234',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_ROLE_AREAS_MISMATCH',
      });
    }
  });
});

describe('UsersService.updatePassword', () => {
  it('rechaza con USER_PASSWORD_MISMATCH si la password actual no coincide', async () => {
    const target = buildUserDoc();
    const { service, passwords } = buildHarness({ existingById: target });
    passwords.compare.mockResolvedValue(false);
    const caller = asAdmin();
    caller.userId = target._id.toString();

    try {
      await service.updatePassword(caller, 'mala', 'NuevaPass99');
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.UNAUTHORIZED);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_PASSWORD_MISMATCH',
      });
    }
  });

  it('actualiza el hash y limpia mustChangePassword cuando la actual es correcta', async () => {
    const target = buildUserDoc({ mustChangePassword: true });
    const { service, passwords } = buildHarness({ existingById: target });
    passwords.compare.mockResolvedValue(true);
    passwords.hash.mockResolvedValue('hash-nuevo');
    const caller = asAdmin();
    caller.userId = target._id.toString();

    await service.updatePassword(caller, 'Vieja12345', 'NuevaPass99');

    expect(target.passwordHash).toBe('hash-nuevo');
    expect(target.mustChangePassword).toBe(false);
    expect(target.save).toHaveBeenCalled();
  });
});

describe('UsersService.softDeleteForCaller', () => {
  it('bloquea el self-delete', async () => {
    const target = buildUserDoc();
    const { service } = buildHarness({ existingById: target });
    const caller = asAdmin();
    caller.userId = target._id.toString();

    try {
      await service.softDeleteForCaller(caller, target._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_SELF_DELETE_FORBIDDEN',
      });
    }
  });

  it('marca active=false en el target', async () => {
    const target = buildUserDoc();
    const { service } = buildHarness({ existingById: target });

    await service.softDeleteForCaller(asAdmin(), target._id.toString());

    expect(target.active).toBe(false);
    expect(target.save).toHaveBeenCalled();
  });
});

describe('UsersService.updateProfile', () => {
  it('cambia el fullName del propio usuario', async () => {
    const target = buildUserDoc({ fullName: 'Viejo' });
    const { service } = buildHarness({ existingById: target });
    const caller = asAdmin();
    caller.userId = target._id.toString();

    const result = await service.updateProfile(caller, 'Nuevo Nombre');

    expect(target.fullName).toBe('Nuevo Nombre');
    expect(result.fullName).toBe('Nuevo Nombre');
  });
});

describe('UsersService.listForCaller', () => {
  it('un líder sin áreas recibe lista vacía', async () => {
    const { service } = buildHarness();
    const caller = asLeader();
    caller.areaIds = [];

    const result = await service.listForCaller(caller, { limit: 50 });

    expect(result).toEqual({ items: [], nextCursor: null });
  });
});

describe('UsersService.updateForCaller', () => {
  it('LID no puede modificar usuarios fuera de sus áreas', async () => {
    const ajeno = new Types.ObjectId();
    const target = buildUserDoc({ areaIds: [ajeno] });
    const { service } = buildHarness({ existingById: target });

    try {
      await service.updateForCaller(asLeader(), target._id.toString(), {
        fullName: 'Otro',
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_AREA_FORBIDDEN',
      });
    }
  });

  it('LID no puede promover a líder', async () => {
    const target = buildUserDoc();
    const { service } = buildHarness({ existingById: target });

    try {
      await service.updateForCaller(asLeader(), target._id.toString(), {
        role: 'lider',
        areaIds: [LEADER_AREA_A],
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_ROLE_FORBIDDEN',
      });
    }
  });

  it('admin puede actualizar cualquier campo', async () => {
    const target = buildUserDoc({ fullName: 'Original' });
    const { service } = buildHarness({ existingById: target });

    const result = await service.updateForCaller(asAdmin(), target._id.toString(), {
      fullName: 'Editado',
      active: false,
    });

    expect(result.fullName).toBe('Editado');
    expect(result.active).toBe(false);
  });
});
