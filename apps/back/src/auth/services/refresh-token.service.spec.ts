import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RefreshTokenService } from './refresh-token.service';
import { ApiException } from '../../common/exceptions/api.exception';

const SECRETS = {
  JWT_REFRESH_SECRET: 'a'.repeat(64),
  JWT_REFRESH_EXPIRES_IN: '7d',
};

function fakeConfig() {
  return { get: (key: keyof typeof SECRETS) => SECRETS[key] } as never;
}

interface StoredDoc {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  tokenHash: string;
  issuedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  replacedById: Types.ObjectId | null;
  userAgent: string | null;
  ip: string | null;
}

/**
 * Fake del modelo Mongoose: implementa solo la superficie que usa
 * RefreshTokenService (create, findOne, updateOne, updateMany).
 * Mantiene los docs en memoria para validar transiciones de estado
 * (rotación, revocación, detección de reuso).
 */
function createFakeRefreshModel() {
  const docs: StoredDoc[] = [];

  const findById = (_id: Types.ObjectId) => docs.find((d) => d._id.equals(_id));

  return {
    docs,
    create: vi.fn(async (data: Omit<StoredDoc, '_id'>) => {
      const doc: StoredDoc = { ...data, _id: new Types.ObjectId() };
      docs.push(doc);
      return doc;
    }),
    findOne: vi.fn((filter: Partial<StoredDoc>) => ({
      exec: async () => {
        if ('tokenHash' in filter && filter.tokenHash) {
          return docs.find((d) => d.tokenHash === filter.tokenHash) ?? null;
        }
        return null;
      },
    })),
    updateOne: vi.fn(
      (
        filter: { _id?: Types.ObjectId; tokenHash?: string; revokedAt?: null },
        update: { $set: Partial<StoredDoc> },
      ) => ({
        exec: async () => {
          const target = filter._id
            ? findById(filter._id)
            : docs.find(
                (d) =>
                  (filter.tokenHash === undefined || d.tokenHash === filter.tokenHash) &&
                  (filter.revokedAt !== null || d.revokedAt === null),
              );
          if (target) Object.assign(target, update.$set);
          return { matchedCount: target ? 1 : 0 };
        },
      }),
    ),
    updateMany: vi.fn(
      (
        filter: { userId: Types.ObjectId; revokedAt: null },
        update: { $set: Partial<StoredDoc> },
      ) => ({
        exec: async () => {
          for (const d of docs) {
            if (d.userId.equals(filter.userId) && d.revokedAt === null) {
              Object.assign(d, update.$set);
            }
          }
          return {};
        },
      }),
    ),
  };
}

describe('RefreshTokenService', () => {
  const jwt = new JwtService({});
  const userId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  let model: ReturnType<typeof createFakeRefreshModel>;
  let service: RefreshTokenService;

  beforeEach(() => {
    model = createFakeRefreshModel();
    service = new RefreshTokenService(model as never, jwt, fakeConfig());
  });

  it('emite un refresh token y persiste un documento con el hash', async () => {
    const issued = await service.issue({ userId, tenantId, userAgent: null, ip: null });

    expect(typeof issued.token).toBe('string');
    expect(issued.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(model.docs).toHaveLength(1);
    expect(model.docs[0]?.tokenHash).not.toBe(issued.token);
    expect(model.docs[0]?.revokedAt).toBeNull();
  });

  it('al rotar, marca el viejo como revocado y crea uno nuevo enlazado', async () => {
    const initial = await service.issue({ userId, tenantId, userAgent: null, ip: null });

    const rotated = await service.rotate(initial.token, { userAgent: null, ip: null });

    expect(rotated.token).not.toBe(initial.token);
    expect(model.docs).toHaveLength(2);
    const [oldDoc, newDoc] = model.docs;
    expect(oldDoc?.revokedAt).toBeInstanceOf(Date);
    expect(newDoc).toBeDefined();
    expect(oldDoc?.replacedById?.equals(newDoc?._id ?? new Types.ObjectId())).toBe(true);
    expect(newDoc?.revokedAt).toBeNull();
  });

  it('detecta reuso: rotar dos veces el mismo token revoca toda la cadena', async () => {
    const initial = await service.issue({ userId, tenantId, userAgent: null, ip: null });
    await service.rotate(initial.token, { userAgent: null, ip: null });

    await expect(
      service.rotate(initial.token, { userAgent: null, ip: null }),
    ).rejects.toMatchObject({
      getResponse: expect.any(Function),
    });

    // Confirmar que TODOS los tokens del usuario quedaron revocados.
    expect(model.docs.every((d) => d.revokedAt !== null)).toBe(true);
  });

  it('lanza AUTH_REFRESH_INVALID con un token con firma inválida', async () => {
    await expect(service.rotate('not-a-jwt', { userAgent: null, ip: null })).rejects.toBeInstanceOf(
      ApiException,
    );
  });

  it('lanza AUTH_REFRESH_INVALID si el token no existe en la colección', async () => {
    const orphan = await jwt.signAsync(
      { sub: userId.toString(), tenantId: tenantId.toString(), jti: 'x' },
      { secret: SECRETS.JWT_REFRESH_SECRET, expiresIn: '7d' },
    );

    await expect(service.rotate(orphan, { userAgent: null, ip: null })).rejects.toBeInstanceOf(
      ApiException,
    );
  });

  it('revoke marca el documento como revocado', async () => {
    const issued = await service.issue({ userId, tenantId, userAgent: null, ip: null });

    await service.revoke(issued.token);

    expect(model.docs[0]?.revokedAt).toBeInstanceOf(Date);
  });

  it('revokeAllForUser revoca todos los tokens activos del usuario', async () => {
    await service.issue({ userId, tenantId, userAgent: null, ip: null });
    await service.issue({ userId, tenantId, userAgent: null, ip: null });

    await service.revokeAllForUser(userId);

    expect(model.docs.every((d) => d.revokedAt !== null)).toBe(true);
  });
});
