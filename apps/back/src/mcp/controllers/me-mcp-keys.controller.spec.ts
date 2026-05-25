import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import type { McpKeyService } from '../services/mcp-key.service';
import { MeMcpKeysController } from './me-mcp-keys.controller';

function asEmpleado(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: new Types.ObjectId().toString(),
    role: 'empleado',
    areaIds: [],
  };
}

describe('MeMcpKeysController', () => {
  it('list envuelve el array del service en { items }', async () => {
    const items = [
      {
        id: 'a',
        name: 'WhatsApp',
        prefix: 'tk_mcp_abcde',
        lastUsedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
      },
    ];
    const service = { listForUser: vi.fn().mockResolvedValue(items) } as unknown as McpKeyService;
    const controller = new MeMcpKeysController(service);

    const result = await controller.list(asEmpleado());
    expect(result).toEqual({ items });
  });

  it('create devuelve secret + key del service', async () => {
    const response = {
      key: {
        id: 'a',
        name: 'Mi WhatsApp',
        prefix: 'tk_mcp_abcde',
        lastUsedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
      },
      secret: 'tk_mcp_abcde0123456789012345',
    };
    const service = { generate: vi.fn().mockResolvedValue(response) } as unknown as McpKeyService;
    const controller = new MeMcpKeysController(service);

    const result = await controller.create(asEmpleado(), { name: 'Mi WhatsApp' });
    expect(result).toBe(response);
  });

  it('revoke delega al service y no devuelve cuerpo', async () => {
    const service = { revoke: vi.fn().mockResolvedValue(undefined) } as unknown as McpKeyService;
    const controller = new MeMcpKeysController(service);

    await expect(controller.revoke(asEmpleado(), 'someId')).resolves.toBeUndefined();
    expect(service.revoke).toHaveBeenCalledWith(expect.anything(), 'someId');
  });

  it('regenerate delega al service y devuelve la respuesta', async () => {
    const response = {
      key: {
        id: 'b',
        name: 'Mi WhatsApp',
        prefix: 'tk_mcp_zzzzz',
        lastUsedAt: null,
        createdAt: '2026-05-25T00:00:00.000Z',
      },
      secret: 'tk_mcp_zzzzz0000000000000000',
    };
    const service = {
      regenerate: vi.fn().mockResolvedValue(response),
    } as unknown as McpKeyService;
    const controller = new MeMcpKeysController(service);

    const result = await controller.regenerate(asEmpleado(), 'keyId');
    expect(result).toBe(response);
    expect(service.regenerate).toHaveBeenCalledWith(expect.anything(), 'keyId');
  });
});
