import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { KbService } from './kb.service';

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

function asAgente(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'agente',
    areaIds: [],
  };
}

function buildKbDoc(overrides: Partial<Record<string, unknown>> = {}) {
  const id = new Types.ObjectId();
  const doc = {
    _id: id,
    tenantId: TENANT_ID,
    title: 'Doc',
    content: '# Hola\n\nUn párrafo.',
    scope: 'global' as 'global' | 'area',
    areaIds: [] as Types.ObjectId[],
    version: 1,
    active: true,
    uploadedBy: new Types.ObjectId(),
    parentDocumentId: id,
    deletedAt: null as Date | null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

interface HarnessOpts {
  doc?: ReturnType<typeof buildKbDoc> | null;
  /** Áreas que `assertAreasExistAndAllowedForCaller` debe encontrar como activas. */
  foundAreas?: { _id: Types.ObjectId }[];
  /** Lista que devuelve `find()` paginado (sin el +1 hasMore). */
  listFound?: ReturnType<typeof buildKbDoc>[];
  versions?: ReturnType<typeof buildKbDoc>[];
}

function buildHarness(opts: HarnessOpts = {}) {
  const documentModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.doc ?? null),
    })),
    findById: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.doc ?? null),
    })),
    find: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(opts.versions ?? opts.listFound ?? []),
    })),
    create: vi.fn(async (data: Record<string, unknown>) => buildKbDoc(data)),
    updateMany: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    })),
    updateOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    })),
  };

  const chunkModel = {
    updateMany: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({ modifiedCount: 1 }),
    })),
    deleteMany: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({ deletedCount: 1 }),
    })),
  };

  const areaModel = {
    find: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue(opts.foundAreas ?? []),
    })),
  };

  const queue = { enqueue: vi.fn().mockResolvedValue(undefined) };
  const events = { emit: vi.fn() };

  // Casting a `unknown` y luego a los tipos esperados — es el patrón
  // estándar para harness de mocks parciales sin tener que reimplementar
  // cada método de Mongoose.
  const service = new KbService(
    documentModel as unknown as ConstructorParameters<typeof KbService>[0],
    chunkModel as unknown as ConstructorParameters<typeof KbService>[1],
    areaModel as unknown as ConstructorParameters<typeof KbService>[2],
    queue as unknown as ConstructorParameters<typeof KbService>[3],
    events as unknown as ConstructorParameters<typeof KbService>[4],
  );

  return { service, documentModel, chunkModel, areaModel, queue, events };
}

describe('KbService', () => {
  describe('listForCaller', () => {
    it('rechaza roles que no son lider ni admin', async () => {
      const { service } = buildHarness();
      await expect(service.listForCaller(asAgente(), { limit: 10 })).rejects.toMatchObject({
        getStatus: expect.any(Function),
      });
    });

    it('LID solo ve globales + áreas que lidera', async () => {
      const myArea = new Types.ObjectId();
      const { service, documentModel } = buildHarness({
        listFound: [
          buildKbDoc({ scope: 'global' }),
          buildKbDoc({ scope: 'area', areaIds: [myArea] }),
        ],
      });
      await service.listForCaller(asLeaderOf(myArea), { limit: 10 });
      const filter = documentModel.find.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(filter.tenantId).toBeDefined();
      expect(filter.active).toBe(true);
      expect(filter.deletedAt).toBeNull();
      expect(filter).toHaveProperty('$or');
    });

    it('ADM no aplica filtro de scope/area por defecto', async () => {
      const { service, documentModel } = buildHarness({ listFound: [] });
      await service.listForCaller(asAdmin(), { limit: 10 });
      const filter = documentModel.find.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(filter).not.toHaveProperty('$or');
    });
  });

  describe('create', () => {
    it('LID no puede crear documentos globales', async () => {
      const { service } = buildHarness();
      await expect(
        service.create(asLeaderOf(new Types.ObjectId()), {
          title: 'Doc',
          content: 'x',
          scope: 'global',
          areaIds: [],
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('LID no puede crear en áreas que no lidera', async () => {
      const myArea = new Types.ObjectId();
      const otherArea = new Types.ObjectId();
      const { service } = buildHarness({ foundAreas: [{ _id: otherArea }] });
      await expect(
        service.create(asLeaderOf(myArea), {
          title: 'Doc',
          content: 'x',
          scope: 'area',
          areaIds: [otherArea.toString()],
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('ADM crea v1 y encola job de indexación', async () => {
      const area = new Types.ObjectId();
      const { service, queue, events } = buildHarness({
        foundAreas: [{ _id: area }],
      });
      const result = await service.create(asAdmin(), {
        title: 'Doc',
        content: 'contenido',
        scope: 'area',
        areaIds: [area.toString()],
      });
      expect(result.version).toBe(1);
      expect(result.active).toBe(false);
      expect(queue.enqueue).toHaveBeenCalledWith(
        expect.objectContaining({ version: 1, tenantId: TENANT_ID.toString() }),
      );
      expect(events.emit).toHaveBeenCalledWith(
        'KbDocumentCreated',
        expect.objectContaining({ scope: 'area', version: 1 }),
      );
    });

    it('rechaza si las áreas no existen o están inactivas', async () => {
      const area = new Types.ObjectId();
      // foundAreas vacío → ninguna área pasa el filtro `active:true`.
      const { service } = buildHarness({ foundAreas: [] });
      await expect(
        service.create(asAdmin(), {
          title: 'Doc',
          content: 'x',
          scope: 'area',
          areaIds: [area.toString()],
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });
  });

  describe('update', () => {
    it('crea version+1 con active:false y encola job', async () => {
      const myArea = new Types.ObjectId();
      const current = buildKbDoc({
        scope: 'area',
        areaIds: [myArea],
        version: 3,
        parentDocumentId: new Types.ObjectId(),
      });
      const { service, queue } = buildHarness({
        doc: current,
        foundAreas: [{ _id: myArea }],
      });
      const result = await service.update(asLeaderOf(myArea), current._id.toString(), {
        title: 'Edit',
        content: 'nuevo contenido',
      });
      expect(result.version).toBe(4);
      expect(result.active).toBe(false);
      expect(queue.enqueue).toHaveBeenCalledWith(expect.objectContaining({ version: 4 }));
    });

    it('LID no puede editar documento global', async () => {
      const current = buildKbDoc({ scope: 'global', areaIds: [] });
      const { service } = buildHarness({ doc: current });
      await expect(
        service.update(asLeaderOf(new Types.ObjectId()), current._id.toString(), {
          title: 'Edit',
          content: 'x',
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('LID no puede editar documento de área que no lidera', async () => {
      const otherArea = new Types.ObjectId();
      const current = buildKbDoc({ scope: 'area', areaIds: [otherArea] });
      const { service } = buildHarness({ doc: current });
      await expect(
        service.update(asLeaderOf(new Types.ObjectId()), current._id.toString(), {
          title: 'Edit',
          content: 'x',
        }),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('rechaza si el documento no existe', async () => {
      const { service } = buildHarness({ doc: null });
      await expect(
        service.update(asAdmin(), new Types.ObjectId().toString(), {
          title: 'Edit',
          content: 'x',
        }),
      ).rejects.toMatchObject({ getStatus: expect.any(Function) });
    });
  });

  describe('softDelete', () => {
    it('marca todas las versiones como deletedAt + active:false', async () => {
      const current = buildKbDoc({ scope: 'global' });
      const { service, documentModel, chunkModel, events } = buildHarness({ doc: current });
      await service.softDelete(asAdmin(), current._id.toString());

      // Actualiza todas las versiones del parentDocumentId.
      expect(documentModel.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          parentDocumentId: current.parentDocumentId,
          deletedAt: null,
        }),
        expect.objectContaining({ $set: expect.objectContaining({ active: false }) }),
      );
      expect(chunkModel.updateMany).toHaveBeenCalled();
      expect(events.emit).toHaveBeenCalledWith('KbDocumentDeleted', expect.any(Object));
    });
  });

  describe('activateVersion', () => {
    it('solo ADM puede activar versión vieja', async () => {
      const current = buildKbDoc();
      const { service } = buildHarness({ doc: current });
      await expect(
        service.activateVersion(asLeaderOf(new Types.ObjectId()), current._id.toString(), 1),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('rechaza si la versión pedida no existe', async () => {
      const current = buildKbDoc();
      const harness = buildHarness({ doc: current });
      // findOne se llama dos veces: 1) findOrFail (devuelve current), 2) target version (null)
      let call = 0;
      harness.documentModel.findOne = vi.fn(() => {
        call++;
        return {
          exec: vi.fn().mockResolvedValue(call === 1 ? current : null),
        };
      });
      const err = await harness.service
        .activateVersion(asAdmin(), current._id.toString(), 99)
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });

  describe('getByIdForCaller', () => {
    it('LID no ve documentos de áreas que no lidera', async () => {
      const otherArea = new Types.ObjectId();
      const doc = buildKbDoc({ scope: 'area', areaIds: [otherArea] });
      const { service } = buildHarness({ doc });
      await expect(
        service.getByIdForCaller(asLeaderOf(new Types.ObjectId()), doc._id.toString()),
      ).rejects.toBeInstanceOf(ApiException);
    });

    it('LID ve documentos globales', async () => {
      const doc = buildKbDoc({ scope: 'global' });
      const { service } = buildHarness({ doc });
      const result = await service.getByIdForCaller(
        asLeaderOf(new Types.ObjectId()),
        doc._id.toString(),
      );
      expect(result.id).toBe(doc._id.toString());
    });

    it('rechaza documento soft-deleted como NOT_FOUND', async () => {
      const doc = buildKbDoc({ deletedAt: new Date() });
      const { service } = buildHarness({ doc });
      const err = await service.getByIdForCaller(asAdmin(), doc._id.toString()).catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.NOT_FOUND);
    });
  });
});
