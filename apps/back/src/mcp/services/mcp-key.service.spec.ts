import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import {
  MCP_KEY_PREFIX,
  MCP_KEY_TOTAL_LENGTH,
  MCP_KEY_VISIBLE_PREFIX_LENGTH,
} from '../mcp.constants';
import { McpKeyService } from './mcp-key.service';

const TENANT_ID = new Types.ObjectId();

function asEmpleado(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'empleado',
    areaIds: [],
  };
}

function buildKeyDoc(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT_ID,
    userId: new Types.ObjectId(),
    keyHash: 'hash',
    prefix: 'tk_mcp_abcde',
    name: 'Mi WhatsApp',
    lastUsedAt: null as Date | null,
    revokedAt: null as Date | null,
    createdAt: new Date('2026-05-25T10:00:00.000Z'),
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

interface HarnessOpts {
  activeCount?: number;
  existingDoc?: ReturnType<typeof buildKeyDoc> | null;
  maxActive?: number;
}

function buildHarness(opts: HarnessOpts = {}) {
  const created: Array<Record<string, unknown>> = [];
  const keyModel = {
    countDocuments: vi.fn().mockResolvedValue(opts.activeCount ?? 0),
    create: vi.fn().mockImplementation(async (data: Record<string, unknown>) => {
      const doc = buildKeyDoc({ ...data, _id: new Types.ObjectId(), createdAt: new Date() });
      created.push(data);
      return doc;
    }),
    find: vi.fn(() => ({
      sort: vi.fn(() => ({
        lean: vi.fn().mockResolvedValue(opts.existingDoc ? [{ ...opts.existingDoc }] : []),
      })),
    })),
    findOne: vi.fn().mockResolvedValue(opts.existingDoc ?? null),
  };

  const config = {
    get: vi.fn((key: string) => {
      if (key === 'BCRYPT_SALT_ROUNDS') return 4; // bajo para tests rápidos
      if (key === 'MCP_MAX_ACTIVE_KEYS_PER_USER') return opts.maxActive ?? 5;
      return undefined;
    }),
  } as unknown as ConfigService;

  const service = new McpKeyService(keyModel as never, config);
  return { service, keyModel, created };
}

describe('McpKeyService.generate', () => {
  it('genera secreto bien formado y persiste hash + prefix', async () => {
    const { service, created } = buildHarness();
    const result = await service.generate(asEmpleado(), { name: 'Mi WhatsApp' });

    expect(result.secret).toHaveLength(MCP_KEY_TOTAL_LENGTH);
    expect(result.secret.startsWith(MCP_KEY_PREFIX)).toBe(true);
    expect(result.key.prefix).toHaveLength(MCP_KEY_VISIBLE_PREFIX_LENGTH);
    expect(result.key.prefix).toBe(result.secret.slice(0, MCP_KEY_VISIBLE_PREFIX_LENGTH));
    expect(result.key.name).toBe('Mi WhatsApp');
    expect(result.key.lastUsedAt).toBeNull();

    const persisted = created[0];
    expect(persisted).toBeDefined();
    expect(persisted?.keyHash).not.toBe(result.secret);
    expect(typeof persisted?.keyHash).toBe('string');
  });

  it('rechaza con 409 cuando el usuario alcanzó el límite', async () => {
    const { service } = buildHarness({ activeCount: 5, maxActive: 5 });
    await expect(service.generate(asEmpleado(), { name: 'extra' })).rejects.toMatchObject({
      constructor: ApiException,
      response: expect.objectContaining({ code: 'MCP_KEY_LIMIT_REACHED', statusCode: 409 }),
    });
  });

  it('cada invocación produce secretos distintos', async () => {
    const { service } = buildHarness();
    const a = await service.generate(asEmpleado(), { name: 'a' });
    const b = await service.generate(asEmpleado(), { name: 'b' });
    expect(a.secret).not.toBe(b.secret);
    expect(a.key.prefix).not.toBe(b.key.prefix);
  });
});

describe('McpKeyService.revoke', () => {
  it('marca revokedAt cuando la key existe y pertenece al usuario', async () => {
    const doc = buildKeyDoc();
    const { service } = buildHarness({ existingDoc: doc });
    const caller = asEmpleado();
    await service.revoke(caller, doc._id.toString());
    expect(doc.revokedAt).toBeInstanceOf(Date);
    expect(doc.save).toHaveBeenCalled();
  });

  it('responde 404 cuando el id no es un ObjectId', async () => {
    const { service } = buildHarness();
    await expect(service.revoke(asEmpleado(), 'no-es-objectid')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MCP_KEY_NOT_FOUND', statusCode: 404 }),
    });
  });

  it('responde 404 cuando la key no existe', async () => {
    const { service } = buildHarness({ existingDoc: null });
    await expect(
      service.revoke(asEmpleado(), new Types.ObjectId().toString()),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MCP_KEY_NOT_FOUND', statusCode: 404 }),
    });
  });

  it('responde 409 si la key ya estaba revocada', async () => {
    const doc = buildKeyDoc({ revokedAt: new Date('2026-05-20') });
    const { service } = buildHarness({ existingDoc: doc });
    await expect(service.revoke(asEmpleado(), doc._id.toString())).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'MCP_KEY_ALREADY_REVOKED', statusCode: 409 }),
    });
  });
});
