import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  findByEmail(tenantId: Types.ObjectId, email: string) {
    return this.userModel.findOne({ tenantId, email: email.toLowerCase() }).exec();
  }

  findById(tenantId: Types.ObjectId, userId: Types.ObjectId) {
    return this.userModel.findOne({ _id: userId, tenantId }).exec();
  }

  countByTenant(tenantId: Types.ObjectId) {
    return this.userModel.countDocuments({ tenantId }).exec();
  }

  create(data: Omit<User, never>) {
    return this.userModel.create(data);
  }

  /** Resetea contadores de bloqueo y registra el login exitoso. */
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

  /**
   * Incrementa el contador de intentos fallidos y, si alcanza el umbral,
   * bloquea la cuenta hasta `lockUntil`. Retorna el nuevo conteo para que
   * el caller decida si bloquear (operación de dos pasos para mantener la
   * decisión del umbral en un solo lugar — el AuthService).
   */
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

  /** Aplica un lockout y resetea el contador a 0 (se recontaron tras desbloqueo). */
  lockUntil(userId: Types.ObjectId, until: Date) {
    return this.userModel
      .updateOne({ _id: userId }, { $set: { lockedUntil: until, failedLoginAttempts: 0 } })
      .exec();
  }
}
