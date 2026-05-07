import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { LoginResponse, UserPublic } from '@tikora/core';
import { Env } from '../../config/env.schema';
import { ApiException } from '../../common/exceptions/api.exception';
import { TenantsService } from '../../tenants/services/tenants.service';
import { UserDocument } from '../../users/schemas/user.schema';
import { UsersService } from '../../users/services/users.service';
import { JwtAccessPayload } from '../types/auth.types';
import { PasswordService } from './password.service';
import { IssuedRefreshToken, RefreshTokenService } from './refresh-token.service';

interface LoginInput {
  email: string;
  password: string;
  userAgent: string | null;
  ip: string | null;
}

export interface LoginResult {
  response: LoginResponse;
  refresh: IssuedRefreshToken;
}

export interface RefreshResult {
  accessToken: string;
  refresh: IssuedRefreshToken;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tenants: TenantsService,
    private readonly passwords: PasswordService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async login(input: LoginInput): Promise<LoginResult> {
    const tenantId = await this.tenants.getDefaultTenantId();
    const user = await this.users.findByEmail(tenantId, input.email);

    // No revelamos si el email existe o no: misma respuesta para
    // "usuario no encontrado" y "password mal".
    if (!user) {
      throw this.invalidCredentials();
    }

    if (!user.active) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'AUTH_USER_INACTIVE',
        'La cuenta está desactivada. Contactá al administrador.',
      );
    }

    if (this.isLocked(user)) {
      // Tampoco distinguimos lockout: mismo error genérico al cliente.
      // Loggeamos para que oncall pueda diagnosticar al usuario legítimo.
      this.logger.warn(
        `Intento de login con cuenta bloqueada userId=${user._id.toString()} hasta ${user.lockedUntil?.toISOString()}`,
      );
      throw this.invalidCredentials();
    }

    const passwordOk = await this.passwords.compare(input.password, user.passwordHash);
    if (!passwordOk) {
      await this.handleFailedAttempt(user._id);
      throw this.invalidCredentials();
    }

    await this.users.recordSuccessfulLogin(user._id);

    const accessToken = await this.signAccessToken(user);
    const refresh = await this.refreshTokens.issue({
      userId: user._id,
      tenantId: user.tenantId,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    return {
      response: {
        accessToken,
        user: this.toPublicUser(user),
      },
      refresh,
    };
  }

  async refresh(
    refreshJwt: string,
    metadata: { userAgent: string | null; ip: string | null },
  ): Promise<RefreshResult> {
    const rotated = await this.refreshTokens.rotate(refreshJwt, metadata);
    const user = await this.users.findById(rotated.tenantId, rotated.userId);

    // Si el usuario fue desactivado o eliminado mientras tenía sesión activa,
    // matamos la cadena y forzamos login. La cookie nueva ya emitida queda
    // huérfana — al próximo refresh fallará por revocación.
    if (!user || !user.active) {
      await this.refreshTokens.revokeAllForUser(rotated.userId);
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'AUTH_REFRESH_INVALID',
        'La sesión expiró o no es válida. Volvé a iniciar sesión.',
      );
    }

    const accessToken = await this.signAccessToken(user);
    return { accessToken, refresh: rotated };
  }

  async logout(refreshJwt: string | undefined): Promise<void> {
    if (!refreshJwt) return;
    await this.refreshTokens.revoke(refreshJwt);
  }

  private async handleFailedAttempt(userId: Types.ObjectId): Promise<void> {
    const max = this.config.get('LOGIN_MAX_FAILED_ATTEMPTS', { infer: true });
    const attempts = await this.users.incrementFailedLogin(userId);
    if (attempts >= max) {
      const minutes = this.config.get('LOGIN_LOCKOUT_MINUTES', { infer: true });
      const until = new Date(Date.now() + minutes * 60 * 1000);
      await this.users.lockUntil(userId, until);
      this.logger.warn(
        `Cuenta bloqueada por intentos fallidos userId=${userId.toString()} hasta=${until.toISOString()}`,
      );
    }
  }

  private isLocked(user: UserDocument): boolean {
    return user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now();
  }

  private async signAccessToken(user: UserDocument): Promise<string> {
    const payload: JwtAccessPayload = {
      sub: user._id.toString(),
      tenantId: user.tenantId.toString(),
      role: user.role,
      areaIds: user.areaIds.map((a) => a.toString()),
    };
    // El env valida que sea string no vacío; el cast evita arrastrar el
    // tipo `StringValue` de la lib `ms` por toda la base de código.
    const expiresIn = this.config.get('JWT_ACCESS_EXPIRES_IN', {
      infer: true,
    }) as JwtSignOptions['expiresIn'];
    return this.jwt.signAsync(payload, { expiresIn });
  }

  private toPublicUser(user: UserDocument): UserPublic {
    return {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      areaIds: user.areaIds.map((a) => a.toString()),
    };
  }

  private invalidCredentials(): ApiException {
    return new ApiException(
      HttpStatus.UNAUTHORIZED,
      'AUTH_INVALID_CREDENTIALS',
      'Credenciales inválidas.',
    );
  }
}
