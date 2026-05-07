import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/mongoose';
import { createHash, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { Env } from '../../config/env.schema';
import { ApiException } from '../../common/exceptions/api.exception';
import { JwtRefreshPayload } from '../types/auth.types';
import { RefreshToken, RefreshTokenDocument } from '../schemas/refresh-token.schema';

interface IssueInput {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
  userAgent: string | null;
  ip: string | null;
}

export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: Types.ObjectId;
  tenantId: Types.ObjectId;
}

/**
 * Service responsable de la cadena de refresh tokens:
 * emisión, rotación con detección de reuso y revocación.
 *
 * Reglas implementadas (ver `tikora-data-model.md` §3.3):
 *   - El JWT no se persiste; se guarda solo `sha256(jwt)`.
 *   - Cada `rotate` revoca el anterior y lo enlaza con `replacedById`.
 *   - Recibir un token con `revokedAt` y `replacedById` indica reuso:
 *     toda la cadena del usuario se invalida y se fuerza login.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    @InjectModel(RefreshToken.name)
    private readonly refreshModel: Model<RefreshTokenDocument>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async issue(input: IssueInput): Promise<IssuedRefreshToken> {
    return this.signAndStore(input);
  }

  async rotate(
    refreshJwt: string,
    metadata: { userAgent: string | null; ip: string | null },
  ): Promise<RotatedRefreshToken> {
    const payload = await this.verifyRefreshJwt(refreshJwt);
    const tokenHash = this.hash(refreshJwt);
    const current = await this.refreshModel.findOne({ tokenHash }).exec();

    if (!current) {
      throw this.invalid();
    }

    if (current.revokedAt !== null) {
      // Reuso: el token ya fue rotado y alguien lo presenta de nuevo.
      // Suponer compromiso y matar todas las sesiones del usuario.
      if (current.replacedById !== null) {
        await this.revokeAllForUser(current.userId);
        this.logger.warn(
          `Refresh token reusado detectado para userId=${current.userId.toString()} — toda la cadena revocada`,
        );
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          'AUTH_REFRESH_REUSED',
          'La sesión fue invalidada por seguridad. Volvé a iniciar sesión.',
        );
      }
      throw this.invalid();
    }

    if (current.expiresAt.getTime() <= Date.now()) {
      throw this.invalid();
    }

    const userId = current.userId;
    const tenantId = current.tenantId;
    if (payload.sub !== userId.toString() || payload.tenantId !== tenantId.toString()) {
      // Inconsistencia entre firma y registro; no debería ocurrir salvo manipulación.
      throw this.invalid();
    }

    const next = await this.signAndStore({
      userId,
      tenantId,
      userAgent: metadata.userAgent,
      ip: metadata.ip,
    });

    await this.refreshModel
      .updateOne(
        { _id: current._id, revokedAt: null },
        {
          $set: {
            revokedAt: new Date(),
            replacedById: await this.findIdByHash(this.hash(next.token)),
          },
        },
      )
      .exec();

    return { ...next, userId, tenantId };
  }

  async revoke(refreshJwt: string): Promise<void> {
    const tokenHash = this.hash(refreshJwt);
    await this.refreshModel
      .updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  async revokeAllForUser(userId: Types.ObjectId): Promise<void> {
    await this.refreshModel
      .updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } })
      .exec();
  }

  private async signAndStore(input: IssueInput): Promise<IssuedRefreshToken> {
    const jti = randomUUID();
    const payload: JwtRefreshPayload = {
      sub: input.userId.toString(),
      tenantId: input.tenantId.toString(),
      jti,
    };
    const secret = this.config.get('JWT_REFRESH_SECRET', { infer: true });
    const expiresIn = this.config.get('JWT_REFRESH_EXPIRES_IN', {
      infer: true,
    }) as JwtSignOptions['expiresIn'];

    const token = await this.jwt.signAsync(payload, { secret, expiresIn });
    const expiresAt = this.extractExpiry(token);

    await this.refreshModel.create({
      tenantId: input.tenantId,
      userId: input.userId,
      tokenHash: this.hash(token),
      issuedAt: new Date(),
      expiresAt,
      revokedAt: null,
      replacedById: null,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return { token, expiresAt };
  }

  private async verifyRefreshJwt(refreshJwt: string): Promise<JwtRefreshPayload> {
    const secret = this.config.get('JWT_REFRESH_SECRET', { infer: true });
    try {
      return await this.jwt.verifyAsync<JwtRefreshPayload>(refreshJwt, { secret });
    } catch {
      throw this.invalid();
    }
  }

  private async findIdByHash(tokenHash: string): Promise<Types.ObjectId | null> {
    const doc = await this.refreshModel.findOne({ tokenHash }, { _id: 1 }).exec();
    return doc?._id ?? null;
  }

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private extractExpiry(token: string): Date {
    const decoded = this.jwt.decode(token) as { exp?: number } | null;
    if (!decoded?.exp) {
      // Caso imposible si el token se acaba de firmar con expiresIn,
      // pero el tipo de decode lo permite — fallar ruidosamente.
      throw new Error('No se pudo extraer la expiración del JWT recién firmado');
    }
    return new Date(decoded.exp * 1000);
  }

  private invalid(): ApiException {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'AUTH_REFRESH_INVALID',
      'La sesión expiró o no es válida. Volvé a iniciar sesión.',
    );
  }
}
