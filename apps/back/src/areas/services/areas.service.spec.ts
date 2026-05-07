import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { AreasService } from './areas.service';

const TENANT_ID = new Types.ObjectId();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function asLeaderOf(areaId: Types.ObjectId): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'lider',
    areaIds: [areaId.toString()],
  };
}

function buildAreaDoc(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    name: 'Soporte TI',
    description: '',
    agentIds: [] as Types.ObjectId[],
    leaderIds: [] as Types.ObjectId[],
    slas: { alta: 4, media: 24, baja: 48 },
    active: true,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

function buildUserDoc(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    email: 'agente@empresa.com',
    fullName: 'Agente',
    role: 'agente',
    areaIds: [] as Types.ObjectId[],
    active: true,
    ...overrides,
  };
}

interface HarnessOpts {
  area?: ReturnType<typeof buildAreaDoc> | null;
  user?: ReturnType<typeof buildUserDoc> | null;
  duplicateAreaByName?: ReturnType<typeof buildAreaDoc> | null;
  leadersFound?: ReturnType<typeof buildUserDoc>[];
  agentsList?: ReturnType<typeof buildUserDoc>[];
}

function buildHarness(opts: HarnessOpts = {}) {
  const areaModel = {
    findOne: vi.fn((filter: Record<string, unknown>) => ({
      exec: vi.fn().mockResolvedValue(
        // findOne con `name` es el chequeo de duplicado; con `_id` es findOrFail.
        'name' in filter && filter['name'] !== undefined
          ? opts.duplicateAreaByName ?? null
          : opts.area ?? null,
      ),
    })),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) =>
      buildAreaDoc({
        ...data,
        _id: new Types.ObjectId(),
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ),
    find: vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue([]) }),
      }),
      exec: vi.fn().mockResolvedValue([]),
    })),
    countDocuments: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(0) })),
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
    updateMany: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
  };

  const userModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(opts.user ?? null) })),
    find: vi.fn((filter: { role?: string }) => ({
      exec: vi
        .fn()
        .mockResolvedValue(
          filter.role === 'lider' ? opts.leadersFound ?? [] : opts.agentsList ?? [],
        ),
    })),
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
    updateMany: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
  };

  const service = new AreasService(areaModel as never, userModel as never);
  return { service, areaModel, userModel };
}

describe('AreasService.create', () => {
  it('admin crea un área válida', async () => {
    const { service } = buildHarness();
    const result = await service.create(asAdmin(), {
      name: 'Soporte TI',
      description: '',
      leaderIds: [],
      slas: { alta: 4, media: 24, baja: 48 },
    });
    expect(result.name).toBe('Soporte TI');
    expect(result.active).toBe(true);
  });

  it('rechaza nombre duplicado activo (AREA_NAME_DUPLICATE)', async () => {
    const dup = buildAreaDoc();
    const { service } = buildHarness({ duplicateAreaByName: dup });
    try {
      await service.create(asAdmin(), {
        name: 'Soporte TI',
        description: '',
        leaderIds: [],
        slas: { alta: 4, media: 24, baja: 48 },
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.CONFLICT);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_NAME_DUPLICATE',
      });
    }
  });

  it('rechaza líder con rol incorrecto (AREA_LEADER_INVALID)', async () => {
    // userModel.find devuelve [] por default → no hay líderes válidos
    const { service } = buildHarness({ leadersFound: [] });
    try {
      await service.create(asAdmin(), {
        name: 'Soporte TI',
        description: '',
        leaderIds: [new Types.ObjectId().toString()],
        slas: { alta: 4, media: 24, baja: 48 },
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_LEADER_INVALID',
      });
    }
  });
});

describe('AreasService.softDelete', () => {
  it('rechaza si el área tiene miembros (AREA_HAS_MEMBERS)', async () => {
    const area = buildAreaDoc({ agentIds: [new Types.ObjectId()] });
    const { service } = buildHarness({ area });
    try {
      await service.softDelete(asAdmin(), area._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_HAS_MEMBERS',
      });
    }
  });

  it('marca active=false cuando el área está vacía', async () => {
    const area = buildAreaDoc();
    const { service } = buildHarness({ area });
    await service.softDelete(asAdmin(), area._id.toString());
    expect(area.active).toBe(false);
    expect(area.save).toHaveBeenCalled();
  });
});

describe('AreasService.addAgent', () => {
  it('espeja el alta en area.agentIds y user.areaIds', async () => {
    const area = buildAreaDoc();
    const user = buildUserDoc({ role: 'agente' });
    const { service, areaModel, userModel } = buildHarness({ area, user });

    await service.addAgent(asAdmin(), area._id.toString(), user._id.toString());

    expect(areaModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: area._id }),
      expect.objectContaining({ $addToSet: { agentIds: user._id } }),
    );
    expect(userModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: user._id }),
      expect.objectContaining({ $addToSet: { areaIds: area._id } }),
    );
  });

  it('rechaza si el usuario no tiene rol agente (USER_ROLE_MISMATCH)', async () => {
    const area = buildAreaDoc();
    const user = buildUserDoc({ role: 'empleado' });
    const { service } = buildHarness({ area, user });

    try {
      await service.addAgent(asAdmin(), area._id.toString(), user._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'USER_ROLE_MISMATCH',
      });
    }
  });

  it('un líder que no lidera el área recibe AREA_NOT_MANAGED_BY_LEADER', async () => {
    const area = buildAreaDoc();
    const user = buildUserDoc({ role: 'agente' });
    const { service } = buildHarness({ area, user });
    const otroLider = asLeaderOf(new Types.ObjectId());

    try {
      await service.addAgent(otroLider, area._id.toString(), user._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_NOT_MANAGED_BY_LEADER',
      });
    }
  });
});

describe('AreasService.updateSlas', () => {
  it('actualiza slas del área', async () => {
    const area = buildAreaDoc();
    const { service } = buildHarness({ area });
    const result = await service.updateSlas(asAdmin(), area._id.toString(), {
      alta: 8,
      media: 48,
      baja: 96,
    });
    expect(result.slas).toEqual({ alta: 8, media: 48, baja: 96 });
  });
});

describe('AreasService.listForCaller', () => {
  it('admin recibe la forma completa', async () => {
    const { service, areaModel } = buildHarness();
    const docs = [buildAreaDoc({ name: 'A' }), buildAreaDoc({ name: 'B' })];
    areaModel.find = vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue(docs) }),
      }),
      exec: vi.fn().mockResolvedValue(docs),
    }));

    const result = (await service.listForCaller(asAdmin(), {
      limit: 50,
    })) as { items: Array<Record<string, unknown>> };
    expect(result.items.length).toBe(2);
    expect(result.items[0]).toHaveProperty('agentIds');
    expect(result.items[0]).toHaveProperty('slas');
  });

  it('empleado recibe la forma pública (sin agentIds ni slas)', async () => {
    const { service, areaModel } = buildHarness();
    const docs = [buildAreaDoc()];
    areaModel.find = vi.fn(() => ({
      sort: () => ({
        limit: () => ({ exec: vi.fn().mockResolvedValue(docs) }),
      }),
      exec: vi.fn().mockResolvedValue(docs),
    }));

    const empleado: AuthenticatedUser = {
      userId: 'u1',
      tenantId: TENANT_ID.toString(),
      role: 'empleado',
      areaIds: [],
    };
    const result = (await service.listForCaller(empleado, { limit: 50 })) as {
      items: Array<Record<string, unknown>>;
    };
    expect(result.items[0]).toHaveProperty('id');
    expect(result.items[0]).toHaveProperty('name');
    expect(result.items[0]).not.toHaveProperty('agentIds');
    expect(result.items[0]).not.toHaveProperty('slas');
  });
});
