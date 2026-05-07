import { HttpStatus } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { ApiException } from '../common/exceptions/api.exception';
import type { AreaDocument } from './schemas/area.schema';

export type AreaModel = Model<AreaDocument>;

/**
 * Funciones puras de sincronización areas↔users que comparten
 * `AreasService` y `UsersService`. Se extraen acá para que ambos
 * módulos las usen sin inyectar el service del otro y caer en ciclos.
 */

function fieldForRole(role: string): 'agentIds' | 'leaderIds' | null {
  if (role === 'agente') return 'agentIds';
  if (role === 'lider') return 'leaderIds';
  return null;
}

function mapIds(ids: string[]): Types.ObjectId[] {
  return ids.map((id) => new Types.ObjectId(id));
}

/**
 * Aplica el diff entre `(oldRole, oldAreaIds)` y `(newRole, newAreaIds)`
 * sobre la colección `areas`. Idempotente; el caller debe haber persistido
 * ya el cambio en el `User` antes de llamar (los efectos no son atómicos
 * — riesgo aceptable mientras no haya transacciones disponibles).
 */
export async function syncUserMembership(
  areaModel: AreaModel,
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
  oldRole: string,
  oldAreaIds: string[],
  newRole: string,
  newAreaIds: string[],
): Promise<void> {
  const oldField = fieldForRole(oldRole);
  const newField = fieldForRole(newRole);

  if (oldRole !== newRole) {
    if (oldField && oldAreaIds.length > 0) {
      await areaModel
        .updateMany(
          { tenantId, _id: { $in: mapIds(oldAreaIds) } },
          { $pull: { [oldField]: userId } },
        )
        .exec();
    }
    if (newField && newAreaIds.length > 0) {
      await areaModel
        .updateMany(
          { tenantId, _id: { $in: mapIds(newAreaIds) } },
          { $addToSet: { [newField]: userId } },
        )
        .exec();
    }
    return;
  }

  if (!newField) return;

  const removed = oldAreaIds.filter((a) => !newAreaIds.includes(a));
  const added = newAreaIds.filter((a) => !oldAreaIds.includes(a));

  if (removed.length > 0) {
    await areaModel
      .updateMany({ tenantId, _id: { $in: mapIds(removed) } }, { $pull: { [newField]: userId } })
      .exec();
  }
  if (added.length > 0) {
    await areaModel
      .updateMany({ tenantId, _id: { $in: mapIds(added) } }, { $addToSet: { [newField]: userId } })
      .exec();
  }
}

/**
 * Quita al usuario de `agentIds`/`leaderIds` en todas las áreas donde
 * apareciera. Se usa al desactivar un usuario.
 */
export async function detachUserFromAllAreas(
  areaModel: AreaModel,
  tenantId: Types.ObjectId,
  userId: Types.ObjectId,
): Promise<void> {
  await areaModel
    .updateMany(
      { tenantId, $or: [{ agentIds: userId }, { leaderIds: userId }] },
      { $pull: { agentIds: userId, leaderIds: userId } },
    )
    .exec();
}

/**
 * Verifica que todas las `areaIds` existan, sean del tenant y estén activas.
 * Lanza `AREA_REFERENCE_INVALID` si falta alguna.
 */
export async function ensureAreasExistAndActive(
  areaModel: AreaModel,
  tenantId: Types.ObjectId,
  areaIds: string[],
): Promise<void> {
  if (areaIds.length === 0) return;
  let objectIds: Types.ObjectId[];
  try {
    objectIds = mapIds(areaIds);
  } catch {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'AREA_REFERENCE_INVALID',
      'Una o más áreas no son válidas.',
    );
  }
  const count = await areaModel
    .countDocuments({ tenantId, _id: { $in: objectIds }, active: true })
    .exec();
  if (count !== areaIds.length) {
    throw new ApiException(
      HttpStatus.BAD_REQUEST,
      'AREA_REFERENCE_INVALID',
      'Una o más áreas no existen o están inactivas.',
    );
  }
}
