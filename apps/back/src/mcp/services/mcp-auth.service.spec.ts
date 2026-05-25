import { Types } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { describe, expect, it, vi } from 'vitest';
import { McpAuthService } from './mcp-auth.service';
import { MCP_KEY_PREFIX, MCP_SECRET_BODY_LENGTH } from '../mcp.constants';

function buildSecret(suffix = '0123456789abcdefghijklmn'): string {
  // Aseguramos que el cuerpo tenga exactamente la longitud esperada.
  const body = suffix.padEnd(MCP_SECRET_BODY_LENGTH, 'x').slice(0, MCP_SECRET_BODY_LENGTH);
  return `${MCP_KEY_PREFIX}${body}`;
}

async function buildKeyDoc(secret: string, overrides: Partial<Record<string, unknown>> = {}) {
  const keyHash = await bcrypt.hash(secret, 4);
  return {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    userId: new Types.ObjectId(),
    keyHash,
    prefix: secret.slice(0, 12),
    name: 'k',
    lastUsedAt: null,
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

function buildUserDoc(
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    _id: userId,
    tenantId,
    email: 'empleado@empresa.com',
    fullName: 'Empleado',
    role: 'empleado',
    areaIds: [new Types.ObjectId()],
    active: true,
    ...overrides,
  };
}

function buildHarness(opts: {
  candidates?: Array<Awaited<ReturnType<typeof buildKeyDoc>>>;
  user?: ReturnType<typeof buildUserDoc> | null;
}) {
  const keyModel = {
    find: vi.fn().mockResolvedValue(opts.candidates ?? []),
    updateOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue({}) })),
  };
  const userModel = {
    findOne: vi.fn().mockResolvedValue(opts.user ?? null),
  };
  const service = new McpAuthService(keyModel as never, userModel as never);
  return { service, keyModel, userModel };
}

describe('McpAuthService.resolve', () => {
  it('devuelve null sin tocar DB cuando el secret no está bien formado', async () => {
    const { service, keyModel } = buildHarness({});
    expect(await service.resolve('')).toBeNull();
    expect(await service.resolve('plain-token-sin-prefijo')).toBeNull();
    expect(await service.resolve(`${MCP_KEY_PREFIX}corto`)).toBeNull();
    expect(keyModel.find).not.toHaveBeenCalled();
  });

  it('devuelve null cuando ninguna key con ese prefix existe', async () => {
    const { service } = buildHarness({ candidates: [] });
    expect(await service.resolve(buildSecret())).toBeNull();
  });

  it('devuelve null cuando el hash no matchea ninguna candidata', async () => {
    const otherSecret = buildSecret('aaaaaaaaaaaaaaaaaaaaaaaa');
    const candidate = await buildKeyDoc(otherSecret);
    const { service } = buildHarness({ candidates: [candidate] });
    expect(await service.resolve(buildSecret('bbbbbbbbbbbbbbbbbbbbbbbb'))).toBeNull();
  });

  it('devuelve AuthenticatedUser con el shape esperado cuando matchea', async () => {
    const secret = buildSecret();
    const candidate = await buildKeyDoc(secret);
    const user = buildUserDoc(candidate.tenantId, candidate.userId);
    const { service, keyModel } = buildHarness({ candidates: [candidate], user });

    const result = await service.resolve(secret);
    expect(result).not.toBeNull();
    expect(result?.userId).toBe(user._id.toString());
    expect(result?.tenantId).toBe(user.tenantId.toString());
    expect(result?.role).toBe('empleado');
    expect(result?.areaIds).toHaveLength(1);
    expect(keyModel.updateOne).toHaveBeenCalled();
  });

  it('devuelve null cuando el usuario está inactivo', async () => {
    const secret = buildSecret();
    const candidate = await buildKeyDoc(secret);
    // El query agrega `active: true`, simulamos el filtro devolviendo null.
    const { service } = buildHarness({ candidates: [candidate], user: null });
    expect(await service.resolve(secret)).toBeNull();
  });
});
