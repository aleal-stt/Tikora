import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  Area as AreaResponse,
  AreaListResponseFull,
  AreaListResponsePublic,
  AreaPublic,
  CreateArea,
  Slas,
  UpdateArea,
  User as UserResponse,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { toUserResponse } from '../../users/users.mapper';
import {
  detachUserFromAllAreas as detachUserFn,
  ensureAreasExistAndActive as ensureFn,
  syncUserMembership as syncFn,
} from '../areas.sync';
import { Area, AreaDocument } from '../schemas/area.schema';

interface ListParams {
  cursor?: string;
  limit: number;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class AreasService {
  constructor(
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  // -------- helpers internos compartidos con UsersService --------

  // -------- helpers internos compartidos (delegan a `areas.sync`) --------

  ensureExistAndActive(tenantId: Types.ObjectId, areaIds: string[]) {
    return ensureFn(this.areaModel, tenantId, areaIds);
  }

  syncUserMembership(
    tenantId: Types.ObjectId,
    userId: Types.ObjectId,
    oldRole: string,
    oldAreaIds: string[],
    newRole: string,
    newAreaIds: string[],
  ) {
    return syncFn(this.areaModel, tenantId, userId, oldRole, oldAreaIds, newRole, newAreaIds);
  }

  detachUserFromAllAreas(tenantId: Types.ObjectId, userId: Types.ObjectId) {
    return detachUserFn(this.areaModel, tenantId, userId);
  }

  // -------- API pública (con permisos) --------

  async listForCaller(
    caller: AuthenticatedUser,
    params: ListParams,
  ): Promise<AreaListResponseFull | AreaListResponsePublic> {
    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const tenantId = new Types.ObjectId(caller.tenantId);
    const filter: Record<string, unknown> = { tenantId, active: true };
    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }

    const docs = await this.areaModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? this.encodeCursor(last._id) : null;

    if (caller.role === 'admin' || caller.role === 'lider') {
      return {
        items: page.map((d) => this.toAreaResponse(d)),
        nextCursor,
      };
    }
    return {
      items: page.map((d) => this.toAreaPublic(d)),
      nextCursor,
    };
  }

  async getByIdForCaller(caller: AuthenticatedUser, id: string): Promise<AreaResponse> {
    const doc = await this.findOrFail(caller.tenantId, id);
    return this.toAreaResponse(doc);
  }

  async create(caller: AuthenticatedUser, input: CreateArea): Promise<AreaResponse> {
    const tenantId = new Types.ObjectId(caller.tenantId);
    const dup = await this.areaModel.findOne({ tenantId, name: input.name, active: true }).exec();
    if (dup) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'AREA_NAME_DUPLICATE',
        'Ya existe un área activa con ese nombre.',
      );
    }

    // Validar que los líderes propuestos sean usuarios líderes activos del tenant.
    const leaderObjectIds = input.leaderIds.map((id) => this.toObjectId(id, 'AREA_LEADER_INVALID'));
    if (leaderObjectIds.length > 0) {
      const leaders = await this.userModel
        .find({ tenantId, _id: { $in: leaderObjectIds }, role: 'lider', active: true })
        .exec();
      if (leaders.length !== leaderObjectIds.length) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'AREA_LEADER_INVALID',
          'Uno o más líderes no existen o no tienen rol líder.',
        );
      }
    }

    const area = await this.areaModel.create({
      tenantId,
      name: input.name,
      description: input.description,
      agentIds: [],
      leaderIds: leaderObjectIds,
      slas: input.slas,
      active: true,
    });

    // Espejar en `users.areaIds` de cada líder asignado.
    if (leaderObjectIds.length > 0) {
      await this.userModel
        .updateMany(
          { tenantId, _id: { $in: leaderObjectIds } },
          { $addToSet: { areaIds: area._id } },
        )
        .exec();
    }

    return this.toAreaResponse(area);
  }

  async update(caller: AuthenticatedUser, id: string, input: UpdateArea): Promise<AreaResponse> {
    const area = await this.findOrFail(caller.tenantId, id);

    if (input.name !== undefined && input.name !== area.name) {
      const dup = await this.areaModel
        .findOne({
          tenantId: area.tenantId,
          name: input.name,
          active: true,
          _id: { $ne: area._id },
        })
        .exec();
      if (dup) {
        throw new ApiException(
          HttpStatus.CONFLICT,
          'AREA_NAME_DUPLICATE',
          'Ya existe un área activa con ese nombre.',
        );
      }
      area.name = input.name;
    }
    if (input.description !== undefined) {
      area.description = input.description;
    }

    await area.save();
    return this.toAreaResponse(area);
  }

  async softDelete(caller: AuthenticatedUser, id: string): Promise<void> {
    const area = await this.findOrFail(caller.tenantId, id);

    // El doc dice "no se permite borrar un área con tickets en estados no
    // terminales". Como tickets aún no existe, lo evitamos por ahora si el
    // área tiene miembros — al menos previene perder referencias.
    if (area.agentIds.length > 0 || area.leaderIds.length > 0) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'AREA_HAS_MEMBERS',
        'Quitá agentes y líderes antes de desactivar el área.',
      );
    }

    area.active = false;
    await area.save();
  }

  async addAgent(caller: AuthenticatedUser, areaId: string, userId: string): Promise<AreaResponse> {
    const area = await this.findOrFail(caller.tenantId, areaId);
    this.assertLeaderManagesArea(caller, area);

    const user = await this.fetchActiveUser(area.tenantId, userId);
    if (user.role !== 'agente') {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'USER_ROLE_MISMATCH',
        'El usuario debe tener rol agente.',
      );
    }

    await this.areaModel.updateOne({ _id: area._id }, { $addToSet: { agentIds: user._id } }).exec();
    await this.userModel.updateOne({ _id: user._id }, { $addToSet: { areaIds: area._id } }).exec();

    return this.toAreaResponse(await this.findOrFail(caller.tenantId, areaId));
  }

  async removeAgent(caller: AuthenticatedUser, areaId: string, userId: string): Promise<void> {
    const area = await this.findOrFail(caller.tenantId, areaId);
    this.assertLeaderManagesArea(caller, area);
    const userObjectId = this.toObjectId(userId, 'USER_NOT_FOUND');

    await this.areaModel.updateOne({ _id: area._id }, { $pull: { agentIds: userObjectId } }).exec();
    await this.userModel.updateOne({ _id: userObjectId }, { $pull: { areaIds: area._id } }).exec();
  }

  async addLeader(
    caller: AuthenticatedUser,
    areaId: string,
    userId: string,
  ): Promise<AreaResponse> {
    const area = await this.findOrFail(caller.tenantId, areaId);
    const user = await this.fetchActiveUser(area.tenantId, userId);
    if (user.role !== 'lider') {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'USER_ROLE_MISMATCH',
        'El usuario debe tener rol líder.',
      );
    }

    await this.areaModel
      .updateOne({ _id: area._id }, { $addToSet: { leaderIds: user._id } })
      .exec();
    await this.userModel.updateOne({ _id: user._id }, { $addToSet: { areaIds: area._id } }).exec();

    return this.toAreaResponse(await this.findOrFail(caller.tenantId, areaId));
  }

  async removeLeader(caller: AuthenticatedUser, areaId: string, userId: string): Promise<void> {
    const area = await this.findOrFail(caller.tenantId, areaId);
    const userObjectId = this.toObjectId(userId, 'USER_NOT_FOUND');

    await this.areaModel
      .updateOne({ _id: area._id }, { $pull: { leaderIds: userObjectId } })
      .exec();
    await this.userModel.updateOne({ _id: userObjectId }, { $pull: { areaIds: area._id } }).exec();
  }

  async listAgents(caller: AuthenticatedUser, areaId: string): Promise<UserResponse[]> {
    const area = await this.findOrFail(caller.tenantId, areaId);
    const docs = await this.userModel
      .find({
        tenantId: area.tenantId,
        _id: { $in: area.agentIds },
        active: true,
      })
      .exec();
    return docs.map((d) => toUserResponse(d));
  }

  async updateSlas(caller: AuthenticatedUser, areaId: string, slas: Slas): Promise<AreaResponse> {
    // Defensa en profundidad: el controller ya restringe a admin, pero
    // si un día se cambia el `@Roles` el service sigue rechazando.
    if (caller.role !== 'admin') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'SLAS_ADMIN_ONLY',
        'Solo un administrador puede modificar los SLAs.',
      );
    }
    const area = await this.findOrFail(caller.tenantId, areaId);
    area.slas = slas;
    await area.save();
    return this.toAreaResponse(area);
  }

  // -------- helpers privados --------

  private async findOrFail(tenantId: string, id: string): Promise<AreaDocument> {
    const objectId = this.toObjectId(id, 'AREA_NOT_FOUND');
    const doc = await this.areaModel
      .findOne({ _id: objectId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'AREA_NOT_FOUND', 'No se encontró el área.');
    }
    return doc;
  }

  private async fetchActiveUser(tenantId: Types.ObjectId, userId: string): Promise<UserDocument> {
    const userObjectId = this.toObjectId(userId, 'USER_NOT_FOUND');
    const user = await this.userModel.findOne({ _id: userObjectId, tenantId, active: true }).exec();
    if (!user) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No se encontró el usuario.');
    }
    return user;
  }

  private assertLeaderManagesArea(caller: AuthenticatedUser, area: AreaDocument): void {
    if (caller.role !== 'lider') return;
    const leadsThis = area.leaderIds.some((id) => id.toString() === caller.userId);
    if (!leadsThis) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'AREA_NOT_MANAGED_BY_LEADER',
        'Solo podés modificar áreas que liderás.',
      );
    }
  }

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
    }
  }

  private encodeCursor(id: Types.ObjectId): string {
    return Buffer.from(id.toHexString()).toString('base64url');
  }

  private decodeCursor(cursor: string): Types.ObjectId {
    try {
      const hex = Buffer.from(cursor, 'base64url').toString('utf8');
      return new Types.ObjectId(hex);
    } catch {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'CURSOR_INVALID',
        'El cursor de paginación no es válido.',
      );
    }
  }

  private toAreaResponse(doc: AreaDocument): AreaResponse {
    return {
      id: doc._id.toString(),
      name: doc.name,
      description: doc.description,
      agentIds: doc.agentIds.map((a) => a.toString()),
      leaderIds: doc.leaderIds.map((a) => a.toString()),
      slas: { alta: doc.slas.alta, media: doc.slas.media, baja: doc.slas.baja },
      active: doc.active,
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private toAreaPublic(doc: AreaDocument): AreaPublic {
    return {
      id: doc._id.toString(),
      name: doc.name,
      active: doc.active,
    };
  }
}
