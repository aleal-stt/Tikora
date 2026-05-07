import type { User as UserResponse } from '@tikora/core';
import type { UserDocument } from './schemas/user.schema';

/**
 * Mapea un `UserDocument` a la forma pública del contrato.
 * Excluye `passwordHash` y los contadores de lockout. Vive como función
 * pura (sin DI) para que cualquier módulo lo reutilice sin sumar dependencia.
 */
export function toUserResponse(doc: UserDocument): UserResponse {
  return {
    id: doc._id.toString(),
    email: doc.email,
    fullName: doc.fullName,
    role: doc.role,
    areaIds: doc.areaIds.map((a) => a.toString()),
    active: doc.active,
    mustChangePassword: doc.mustChangePassword,
    lastLoginAt: doc.lastLoginAt ? doc.lastLoginAt.toISOString() : null,
    createdAt: doc.createdAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}
