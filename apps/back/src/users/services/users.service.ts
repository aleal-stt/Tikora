import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { CreateUser, UpdateUser, User as UserResponse, UserListResponse } from '@tikora/core';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { EmailService } from '../../email/services/email.service';
import { User, UserDocument } from '../schemas/user.schema';
import { PasswordService } from './password.service';

interface ListParams {
  cursor?: string;
  limit: number;
}

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    private readonly passwords: PasswordService,
    private readonly emails: EmailService,
  ) {}

  // -------- consultas internas (sin permisos) — usadas por auth/seed --------

  findByEmail(tenantId: Types.ObjectId, email: string) {
    return this.userModel.findOne({ tenantId, email: email.toLowerCase() }).exec();
  }

  findById(tenantId: Types.ObjectId, userId: Types.ObjectId) {
    return this.userModel.findOne({ _id: userId, tenantId }).exec();
  }

  countByTenant(tenantId: Types.ObjectId) {
    return this.userModel.countDocuments({ tenantId }).exec();
  }

  /**
   * Inserta un usuario sin validaciones de permisos. Reservado para el
   * seed inicial — la API pública usa `createForCaller`.
   */
  createRaw(data: Omit<User, 'createdAt' | 'updatedAt'>) {
    return this.userModel.create(data);
  }

  recordSuccessfulLogin(userId: Types.ObjectId) {
    return this.userModel
      .updateOne(
        { _id: userId },
        {
          $set: {
            lastLoginAt: new Date(),
            failedLoginAttempts: 0,
            lockedUntil: null,
          },
        },
      )
      .exec();
  }

  async incrementFailedLogin(userId: Types.ObjectId): Promise<number> {
    const updated = await this.userModel
      .findOneAndUpdate(
        { _id: userId },
        { $inc: { failedLoginAttempts: 1 } },
        { new: true, projection: { failedLoginAttempts: 1 } },
      )
      .exec();
    return updated?.failedLoginAttempts ?? 0;
  }

  lockUntil(userId: Types.ObjectId, until: Date) {
    return this.userModel
      .updateOne({ _id: userId }, { $set: { lockedUntil: until, failedLoginAttempts: 0 } })
      .exec();
  }

  // -------- API pública (con validaciones de permisos) --------

  async listForCaller(caller: AuthenticatedUser, params: ListParams): Promise<UserListResponse> {
    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const tenantId = new Types.ObjectId(caller.tenantId);
    const filter: QueryFilter<UserDocument> = { tenantId };

    if (caller.role === 'lider') {
      if (caller.areaIds.length === 0) {
        // Líder sin áreas no ve a nadie (caso defensivo; el alta lo evita).
        return { items: [], nextCursor: null };
      }
      filter.areaIds = { $in: caller.areaIds.map((id) => new Types.ObjectId(id)) };
    }

    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }

    const docs = await this.userModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((d) => this.toUserResponse(d)),
      nextCursor: hasMore && last ? this.encodeCursor(last._id) : null,
    };
  }

  async getByIdForCaller(caller: AuthenticatedUser, id: string): Promise<UserResponse> {
    const target = await this.findOrFail(caller.tenantId, id);
    this.assertCanReadAsLeader(caller, target);
    return this.toUserResponse(target);
  }

  async createForCaller(caller: AuthenticatedUser, input: CreateUser): Promise<UserResponse> {
    this.assertLeaderCanAssign(caller, input.role, input.areaIds);
    this.assertRoleAreasConsistent(input.role, input.areaIds);

    const tenantId = new Types.ObjectId(caller.tenantId);
    const duplicate = await this.userModel.findOne({ tenantId, email: input.email }).exec();
    if (duplicate) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'USER_EMAIL_DUPLICATE',
        'Ya existe un usuario con ese email.',
      );
    }

    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    const created = await this.userModel.create({
      tenantId,
      email: input.email,
      fullName: input.fullName,
      passwordHash,
      role: input.role,
      areaIds: input.areaIds.map((a) => new Types.ObjectId(a)),
      active: true,
      mustChangePassword: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    // El correo es best-effort: si el adapter falla no perdemos el alta.
    // En modo `log` esto siempre pasa; en modo `live` un fallo de Resend
    // queda solo como warning para que oncall lo vea.
    try {
      await this.emails.sendWelcomeEmail(
        { email: created.email, fullName: created.fullName },
        input.temporaryPassword,
      );
    } catch {
      // El logger del deliverer ya capturó el detalle; acá solo evitamos romper.
    }

    return this.toUserResponse(created);
  }

  async updateForCaller(
    caller: AuthenticatedUser,
    id: string,
    input: UpdateUser,
  ): Promise<UserResponse> {
    const target = await this.findOrFail(caller.tenantId, id);
    this.assertCanReadAsLeader(caller, target);

    const nextRole = input.role ?? target.role;
    const nextAreaIds = input.areaIds ?? target.areaIds.map((a) => a.toString());
    this.assertLeaderCanAssign(caller, nextRole, nextAreaIds, target);
    this.assertRoleAreasConsistent(nextRole, nextAreaIds);

    const update: Partial<User> = {};
    if (input.fullName !== undefined) update.fullName = input.fullName;
    if (input.role !== undefined) update.role = input.role;
    if (input.areaIds !== undefined) {
      update.areaIds = input.areaIds.map((a) => new Types.ObjectId(a));
    }
    if (input.active !== undefined) update.active = input.active;

    Object.assign(target, update);
    await target.save();
    return this.toUserResponse(target);
  }

  async softDeleteForCaller(caller: AuthenticatedUser, id: string): Promise<void> {
    if (caller.userId === id) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'USER_SELF_DELETE_FORBIDDEN',
        'No podés desactivar tu propia cuenta.',
      );
    }
    const target = await this.findOrFail(caller.tenantId, id);
    target.active = false;
    await target.save();
  }

  async updateProfile(caller: AuthenticatedUser, fullName: string): Promise<UserResponse> {
    const target = await this.findOrFail(caller.tenantId, caller.userId);
    target.fullName = fullName;
    await target.save();
    return this.toUserResponse(target);
  }

  async updatePassword(
    caller: AuthenticatedUser,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const target = await this.findOrFail(caller.tenantId, caller.userId);
    const ok = await this.passwords.compare(currentPassword, target.passwordHash);
    if (!ok) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'USER_PASSWORD_MISMATCH',
        'La contraseña actual no es correcta.',
      );
    }
    target.passwordHash = await this.passwords.hash(newPassword);
    target.mustChangePassword = false;
    await target.save();
  }

  // -------- helpers --------

  private async findOrFail(tenantId: string, id: string): Promise<UserDocument> {
    let objectId: Types.ObjectId;
    try {
      objectId = new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No se encontró el usuario.');
    }
    const doc = await this.userModel
      .findOne({ _id: objectId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'No se encontró el usuario.');
    }
    return doc;
  }

  private assertCanReadAsLeader(caller: AuthenticatedUser, target: UserDocument): void {
    if (caller.role !== 'lider') return;
    const targetAreas = target.areaIds.map((a) => a.toString());
    const overlap = targetAreas.some((a) => caller.areaIds.includes(a));
    if (!overlap) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'USER_AREA_FORBIDDEN',
        'No tenés permisos sobre las áreas de este usuario.',
      );
    }
  }

  /**
   * Valida que un líder solo asigne rol `agente` y solo dentro de sus áreas.
   * El admin puede cualquier cosa. El target opcional cubre el caso UPDATE
   * (un líder no debe poder mover a un usuario fuera de sus áreas).
   */
  private assertLeaderCanAssign(
    caller: AuthenticatedUser,
    role: string,
    areaIds: string[],
    target?: UserDocument,
  ): void {
    if (caller.role !== 'lider') return;

    if (role !== 'agente') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'USER_ROLE_FORBIDDEN',
        'Como líder solo podés asignar el rol agente.',
      );
    }

    const allowed = new Set(caller.areaIds);
    const outside = areaIds.find((a) => !allowed.has(a));
    if (outside !== undefined) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'USER_AREA_FORBIDDEN',
        'No podés asignar áreas que no liderás.',
      );
    }

    if (target) {
      const targetAreas = target.areaIds.map((a) => a.toString());
      const targetOutside = targetAreas.find((a) => !allowed.has(a));
      if (targetOutside !== undefined) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'USER_AREA_FORBIDDEN',
          'No podés modificar usuarios de áreas que no liderás.',
        );
      }
    }
  }

  private assertRoleAreasConsistent(role: string, areaIds: string[]): void {
    if (role === 'empleado' && areaIds.length > 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'USER_ROLE_AREAS_MISMATCH',
        'Los empleados no se asignan a áreas.',
      );
    }
    if ((role === 'agente' || role === 'lider') && areaIds.length === 0) {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'USER_ROLE_AREAS_MISMATCH',
        'Agentes y líderes deben tener al menos un área asignada.',
      );
    }
  }

  private toUserResponse(doc: UserDocument): UserResponse {
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
}

export { DEFAULT_PAGE_SIZE };
