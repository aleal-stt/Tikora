import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { Readable } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { AttachmentsService } from './attachments.service';

const TENANT_ID = new Types.ObjectId();

function asEmpleado(userId?: Types.ObjectId): AuthenticatedUser {
  return {
    userId: (userId ?? new Types.ObjectId()).toString(),
    tenantId: TENANT_ID.toString(),
    role: 'empleado',
    areaIds: [],
  };
}

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: [],
  };
}

interface FakeTicket {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  requesterId: Types.ObjectId;
  areaId: Types.ObjectId | null;
  estado: string;
}

function buildTicket(overrides: Partial<FakeTicket> = {}): FakeTicket {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    requesterId: new Types.ObjectId(),
    areaId: null,
    estado: 'requiere_revision_clasificacion',
    ...overrides,
  };
}

interface HarnessOpts {
  ticket?: FakeTicket | null;
  attachment?: {
    _id: Types.ObjectId;
    storagePath: string;
    mimeType: string;
    sizeBytes: number;
    originalName: string;
    ticketId: Types.ObjectId;
    tenantId: Types.ObjectId;
    uploaderId: Types.ObjectId;
    createdAt: Date;
  } | null;
  attachmentCount?: number;
}

function buildHarness(opts: HarnessOpts = {}) {
  const attachmentModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.attachment ?? null),
    })),
    countDocuments: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.attachmentCount ?? 0),
    })),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      _id: new Types.ObjectId(),
      createdAt: new Date(),
    })),
    deleteOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
  };

  const ticketModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket ?? null),
    })),
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
  };

  const storage = {
    write: vi.fn().mockImplementation(async (args: { storedName: string }) => ({
      storagePath: `tenant/ticket/${args.storedName}`,
    })),
    read: vi.fn().mockImplementation(async () => Readable.from(['contenido'])),
    delete: vi.fn().mockResolvedValue(undefined),
  };

  const service = new AttachmentsService(
    attachmentModel as never,
    ticketModel as never,
    storage as never,
  );

  return { service, attachmentModel, ticketModel, storage };
}

describe('AttachmentsService.upload', () => {
  it('OWN sube un PNG y se persiste con sync al ticket', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const { service, attachmentModel, ticketModel, storage } = buildHarness({ ticket });

    const result = await service.upload(asEmpleado(requesterId), ticket._id.toString(), {
      buffer: Buffer.from([1, 2, 3]),
      originalName: 'screenshot.png',
      mimeType: 'image/png',
      sizeBytes: 3,
    });

    expect(result.mimeType).toBe('image/png');
    expect(result.originalName).toBe('screenshot.png');
    expect(storage.write).toHaveBeenCalledTimes(1);
    expect(attachmentModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ checksum: expect.any(String) }),
    );
    expect(ticketModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ticket._id }),
      expect.objectContaining({
        $addToSet: expect.objectContaining({ attachmentIds: expect.any(Types.ObjectId) }),
      }),
    );
  });

  it('rechaza un MIME no permitido (ATTACHMENT_TYPE_FORBIDDEN)', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const { service } = buildHarness({ ticket });

    try {
      await service.upload(asEmpleado(requesterId), ticket._id.toString(), {
        buffer: Buffer.from([1]),
        originalName: 'x.exe',
        mimeType: 'application/x-msdownload',
        sizeBytes: 1,
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.UNPROCESSABLE_ENTITY);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'ATTACHMENT_TYPE_FORBIDDEN',
      });
    }
  });

  it('rechaza si supera el límite de tamaño', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const { service } = buildHarness({ ticket });

    try {
      await service.upload(asEmpleado(requesterId), ticket._id.toString(), {
        buffer: Buffer.alloc(1),
        originalName: 'big.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10 * 1024 * 1024 + 1,
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'ATTACHMENT_TOO_LARGE',
      });
    }
  });

  it('rechaza si el ticket ya tiene 5 adjuntos (ATTACHMENT_LIMIT_EXCEEDED)', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const { service } = buildHarness({ ticket, attachmentCount: 5 });

    try {
      await service.upload(asEmpleado(requesterId), ticket._id.toString(), {
        buffer: Buffer.from([1]),
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      });
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'ATTACHMENT_LIMIT_EXCEEDED',
      });
    }
  });

  it('rollbackea el binario si falla el insert de metadata', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const { service, attachmentModel, storage } = buildHarness({ ticket });
    attachmentModel.create.mockRejectedValueOnce(new Error('mongo down'));

    await expect(
      service.upload(asEmpleado(requesterId), ticket._id.toString(), {
        buffer: Buffer.from([1]),
        originalName: 'x.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
      }),
    ).rejects.toThrow('mongo down');

    expect(storage.delete).toHaveBeenCalledTimes(1);
  });
});

describe('AttachmentsService.delete', () => {
  function buildAttachmentDoc(ticketId: Types.ObjectId) {
    return {
      _id: new Types.ObjectId(),
      ticketId,
      tenantId: TENANT_ID,
      uploaderId: new Types.ObjectId(),
      originalName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      storagePath: 'tenant/ticket/abc.pdf',
      createdAt: new Date(),
    };
  }

  it('OWN puede borrar antes de que el ticket sea tomado', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId, estado: 'escalado' });
    const attachment = buildAttachmentDoc(ticket._id);
    const { service, attachmentModel, ticketModel, storage } = buildHarness({
      ticket,
      attachment,
    });

    await service.delete(asEmpleado(requesterId), ticket._id.toString(), attachment._id.toString());

    expect(attachmentModel.deleteOne).toHaveBeenCalled();
    expect(ticketModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ _id: ticket._id }),
      expect.objectContaining({
        $pull: expect.objectContaining({ attachmentIds: attachment._id }),
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith(attachment.storagePath);
  });

  it('OWN no puede borrar después de que el ticket fue tomado', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId, estado: 'en_progreso' });
    const attachment = buildAttachmentDoc(ticket._id);
    const { service } = buildHarness({ ticket, attachment });

    try {
      await service.delete(
        asEmpleado(requesterId),
        ticket._id.toString(),
        attachment._id.toString(),
      );
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'ATTACHMENT_DELETE_FORBIDDEN',
      });
    }
  });

  it('un caller que no es OWN ni ADM recibe ATTACHMENT_DELETE_FORBIDDEN', async () => {
    const ticket = buildTicket({ estado: 'escalado' });
    const attachment = buildAttachmentDoc(ticket._id);
    const { service } = buildHarness({ ticket, attachment });

    try {
      await service.delete(asEmpleado(), ticket._id.toString(), attachment._id.toString());
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'ATTACHMENT_DELETE_FORBIDDEN',
      });
    }
  });

  it('ADM puede borrar incluso después de que el ticket fue tomado', async () => {
    const ticket = buildTicket({ estado: 'en_progreso' });
    const attachment = buildAttachmentDoc(ticket._id);
    const { service, attachmentModel } = buildHarness({ ticket, attachment });

    await service.delete(asAdmin(), ticket._id.toString(), attachment._id.toString());
    expect(attachmentModel.deleteOne).toHaveBeenCalled();
  });
});

describe('AttachmentsService.download', () => {
  it('devuelve stream y attachment cuando el caller tiene permisos', async () => {
    const requesterId = new Types.ObjectId();
    const ticket = buildTicket({ requesterId });
    const attachment = {
      _id: new Types.ObjectId(),
      ticketId: ticket._id,
      tenantId: TENANT_ID,
      uploaderId: new Types.ObjectId(),
      originalName: 'x.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 100,
      storagePath: 'tenant/ticket/abc.pdf',
      createdAt: new Date(),
    };
    const { service, storage } = buildHarness({ ticket, attachment });

    const result = await service.download(
      asEmpleado(requesterId),
      ticket._id.toString(),
      attachment._id.toString(),
    );
    expect(result.attachment.storagePath).toBe('tenant/ticket/abc.pdf');
    expect(storage.read).toHaveBeenCalledWith('tenant/ticket/abc.pdf');
  });
});
