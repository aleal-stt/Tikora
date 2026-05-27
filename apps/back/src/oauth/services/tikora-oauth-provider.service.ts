import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import {
  InvalidGrantError,
  InvalidRequestError,
  InvalidTokenError,
  ServerError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { Env } from '../../config/env.schema';
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_AUTH_CODE_PREFIX,
  OAUTH_AUTH_CODE_TTL_SECONDS,
  OAUTH_DEFAULT_SCOPE,
  OAUTH_PENDING_AUTH_TTL_SECONDS,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from '../oauth.constants';
import { OAuthAccessToken, OAuthAccessTokenDocument } from '../schemas/oauth-access-token.schema';
import { OAuthAuthCode, OAuthAuthCodeDocument } from '../schemas/oauth-auth-code.schema';
import {
  OAuthRefreshToken,
  OAuthRefreshTokenDocument,
} from '../schemas/oauth-refresh-token.schema';
import { OAuthClientsService } from './oauth-clients.service';

/**
 * Provider OAuth de Tikora consumido por `mcpAuthRouter` del SDK MCP.
 * Cada método implementa una fase del flow Authorization Code + PKCE:
 *
 *  - `authorize()`: persiste los params del cliente como un row
 *    `OAuthAuthCode` "pending" y redirige al usuario a la pantalla de
 *    consent. El consent controller completa el row con `userId` y
 *    redirige al cliente con `code` + `state`.
 *  - `challengeForAuthorizationCode()`: devuelve el `code_challenge`
 *    guardado para que el SDK valide PKCE contra el `code_verifier`.
 *  - `exchangeAuthorizationCode()`: emite el par access+refresh token
 *    y marca el code como usado (one-time, OAuth 2.1).
 *  - `exchangeRefreshToken()`: rota el refresh y devuelve un par nuevo;
 *    si detecta reuso revoca toda la cadena del usuario+cliente.
 *  - `verifyAccessToken()`: resuelve el access token al `AuthInfo` que
 *    el guard MCP usa para popular `request.user`.
 *  - `revokeToken()`: soft-delete sobre access o refresh.
 */
@Injectable()
export class TikoraOAuthProvider implements OAuthServerProvider {
  private readonly logger = new Logger(TikoraOAuthProvider.name);

  constructor(
    @InjectModel(OAuthAuthCode.name)
    private readonly codeModel: Model<OAuthAuthCodeDocument>,
    @InjectModel(OAuthAccessToken.name)
    private readonly accessModel: Model<OAuthAccessTokenDocument>,
    @InjectModel(OAuthRefreshToken.name)
    private readonly refreshModel: Model<OAuthRefreshTokenDocument>,
    private readonly clients: OAuthClientsService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  get clientsStore(): OAuthClientsService {
    return this.clients;
  }

  /**
   * Inicia el flow: persiste params y redirige a `/oauth/consent`. El
   * SDK ya validó que `params.redirectUri` está en `client.redirect_uris`
   * y que `codeChallenge` es no vacío.
   */
  // El tipo de `res` se deriva del propio `OAuthServerProvider['authorize']`
  // del SDK MCP para evitar el clash entre @types/express@4 (que arrastra
  // NestJS por @nestjs/platform-express) y @types/express@5 (que usa el SDK).
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Parameters<OAuthServerProvider['authorize']>[2],
  ): Promise<void> {
    const code = `${OAUTH_AUTH_CODE_PREFIX}${this.randomToken(24)}`;
    const expiresAt = new Date(Date.now() + OAUTH_PENDING_AUTH_TTL_SECONDS * 1000);

    await this.codeModel.create({
      code,
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: 'S256',
      state: params.state ?? null,
      scopes: params.scopes ?? [OAUTH_DEFAULT_SCOPE],
      resource: params.resource ? params.resource.toString() : null,
      expiresAt,
    });

    this.logger.log(
      `Authorize iniciado clientId=${client.client_id} code=${code.slice(0, 20)}… redirectUri=${
        params.redirectUri
      }`,
    );

    res.redirect(302, `/oauth/consent?session=${encodeURIComponent(code)}`);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const doc = await this.codeModel.findOne({
      code: authorizationCode,
      clientId: client.client_id,
    });
    if (!doc) {
      throw new InvalidGrantError('Authorization code inválido o expirado.');
    }
    if (!doc.authorizedAt || !doc.userId) {
      throw new InvalidGrantError('Authorization code aún no fue autorizado por el usuario.');
    }
    if (doc.exchangedAt) {
      throw new InvalidGrantError('Authorization code ya fue intercambiado.');
    }
    return doc.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    // Atómico: marcar `exchangedAt` solo si el code está autorizado, no
    // intercambiado, no expirado y (si se pasó) con redirectUri coincidente.
    // Si dos requests concurrentes con el mismo code llegan, solo una gana
    // el update y la otra recibe `null` → cae al path de reuso abajo.
    const now = new Date();
    const filter: Record<string, unknown> = {
      code: authorizationCode,
      clientId: client.client_id,
      exchangedAt: null,
      authorizedAt: { $ne: null },
      userId: { $ne: null },
      tenantId: { $ne: null },
      expiresAt: { $gt: now },
    };
    if (redirectUri) {
      filter['redirectUri'] = redirectUri;
    }
    const doc = await this.codeModel.findOneAndUpdate(
      filter,
      { $set: { exchangedAt: now } },
      { new: true },
    );

    if (!doc) {
      // Falló el update: distinguir entre "no existe / no autorizado / expirado"
      // y "reuso de un code ya intercambiado" (que dispara revocación).
      const existing = await this.codeModel.findOne({
        code: authorizationCode,
        clientId: client.client_id,
      });
      if (existing?.exchangedAt && existing.userId) {
        await this.revokeAllForUser(client.client_id, existing.userId);
        throw new InvalidGrantError('Authorization code ya fue intercambiado.');
      }
      if (existing && redirectUri && existing.redirectUri !== redirectUri) {
        throw new InvalidGrantError('redirect_uri no coincide con el de la autorización.');
      }
      if (existing && Date.now() > existing.expiresAt.getTime()) {
        throw new InvalidGrantError('Authorization code expirado.');
      }
      throw new InvalidGrantError('Authorization code inválido.');
    }
    if (!doc.userId || !doc.tenantId) {
      throw new InvalidGrantError('Authorization code inválido.');
    }
    if (resource && doc.resource && doc.resource !== resource.toString()) {
      throw new InvalidRequestError('El parámetro resource no coincide con la autorización.');
    }

    const accessTtl = this.config.get('OAUTH_ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    const refreshTtl = this.config.get('OAUTH_REFRESH_TOKEN_TTL_SECONDS', { infer: true });

    const { plain: accessToken, expiresAtMs: accessExp } = await this.issueAccessToken({
      clientId: client.client_id,
      userId: doc.userId,
      tenantId: doc.tenantId,
      scopes: doc.scopes,
      resource: doc.resource,
      ttlSeconds: accessTtl,
    });

    const { plain: refreshToken } = await this.issueRefreshToken({
      clientId: client.client_id,
      userId: doc.userId,
      tenantId: doc.tenantId,
      scopes: doc.scopes,
      resource: doc.resource,
      ttlSeconds: refreshTtl,
    });

    this.logger.log(
      `Tokens emitidos clientId=${
        client.client_id
      } userId=${doc.userId.toString()} accessExp=${new Date(accessExp).toISOString()}`,
    );

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessTtl,
      refresh_token: refreshToken,
      scope: doc.scopes.join(' ') || undefined,
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshTokenValue: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const candidates = await this.refreshModel.find({
      clientId: client.client_id,
      prefix: refreshTokenValue.slice(0, 16),
      revokedAt: null,
    });
    if (candidates.length === 0) {
      throw new InvalidGrantError('Refresh token inválido o revocado.');
    }
    let matched: OAuthRefreshTokenDocument | null = null;
    for (const candidate of candidates) {
      if (await bcrypt.compare(refreshTokenValue, candidate.tokenHash)) {
        matched = candidate;
        break;
      }
    }
    if (!matched) {
      throw new InvalidGrantError('Refresh token inválido o revocado.');
    }
    if (scopes && scopes.some((s) => !matched!.scopes.includes(s))) {
      throw new InvalidRequestError(
        'Los scopes solicitados exceden los autorizados originalmente.',
      );
    }
    if (resource && matched.resource && matched.resource !== resource.toString()) {
      throw new InvalidRequestError('El parámetro resource no coincide con el grant original.');
    }

    // Atómico: marcar `usedAt` solo si todavía estaba en null y el token
    // no expiró. Dos requests concurrentes con el mismo refresh: solo
    // una gana el update; la otra recibe `null` y lo trata como reuso.
    const now = new Date();
    const rotated = await this.refreshModel.findOneAndUpdate(
      {
        _id: matched._id,
        usedAt: null,
        revokedAt: null,
        expiresAt: { $gt: now },
      },
      { $set: { usedAt: now } },
      { new: true },
    );

    if (!rotated) {
      // Re-leer el doc para distinguir reuso (usedAt != null en BD) de
      // expirado/revocado. El reuso dispara revocación de la cadena.
      const recheck = await this.refreshModel.findById(matched._id);
      if (recheck?.usedAt) {
        await this.revokeAllForUser(client.client_id, recheck.userId);
        throw new InvalidGrantError(
          'Refresh token reutilizado — todos los tokens de este cliente fueron revocados.',
        );
      }
      if (recheck?.revokedAt) {
        throw new InvalidGrantError('Refresh token revocado.');
      }
      throw new InvalidGrantError('Refresh token expirado.');
    }

    const accessTtl = this.config.get('OAUTH_ACCESS_TOKEN_TTL_SECONDS', { infer: true });
    const refreshTtl = this.config.get('OAUTH_REFRESH_TOKEN_TTL_SECONDS', { infer: true });
    const grantedScopes = scopes ?? matched.scopes;

    const { plain: accessToken } = await this.issueAccessToken({
      clientId: client.client_id,
      userId: matched.userId,
      tenantId: matched.tenantId,
      scopes: grantedScopes,
      resource: matched.resource,
      ttlSeconds: accessTtl,
    });
    const { plain: newRefresh } = await this.issueRefreshToken({
      clientId: client.client_id,
      userId: matched.userId,
      tenantId: matched.tenantId,
      scopes: grantedScopes,
      resource: matched.resource,
      ttlSeconds: refreshTtl,
    });

    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: accessTtl,
      refresh_token: newRefresh,
      scope: grantedScopes.join(' ') || undefined,
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    if (!token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
      throw new InvalidTokenError('Access token inválido.');
    }
    const candidates = await this.accessModel.find({
      prefix: token.slice(0, 16),
      revokedAt: null,
    });
    for (const candidate of candidates) {
      if (await bcrypt.compare(token, candidate.tokenHash)) {
        if (Date.now() > candidate.expiresAt.getTime()) {
          throw new InvalidTokenError('Access token expirado.');
        }
        return {
          token,
          clientId: candidate.clientId,
          scopes: candidate.scopes,
          expiresAt: Math.floor(candidate.expiresAt.getTime() / 1000),
          resource: candidate.resource ? new URL(candidate.resource) : undefined,
          extra: {
            userId: candidate.userId.toString(),
            tenantId: candidate.tenantId.toString(),
          },
        };
      }
    }
    throw new InvalidTokenError('Access token inválido.');
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    const hint = request.token_type_hint;
    const prefix = request.token.slice(0, 16);

    if (hint !== 'refresh_token') {
      const candidates = await this.accessModel.find({
        clientId: client.client_id,
        prefix,
        revokedAt: null,
      });
      for (const candidate of candidates) {
        if (await bcrypt.compare(request.token, candidate.tokenHash)) {
          candidate.revokedAt = new Date();
          await candidate.save();
          return;
        }
      }
    }

    if (hint !== 'access_token') {
      const candidates = await this.refreshModel.find({
        clientId: client.client_id,
        prefix,
        revokedAt: null,
      });
      for (const candidate of candidates) {
        if (await bcrypt.compare(request.token, candidate.tokenHash)) {
          candidate.revokedAt = new Date();
          await candidate.save();
          return;
        }
      }
    }
  }

  // ---------- helpers internos ----------

  /**
   * Confirma un row pending → authorized. Lo llama el consent controller
   * tras validar credenciales del usuario. Devuelve el `code` que el
   * controller debe pasar al redirect final.
   */
  async authorizePending(
    code: string,
    user: { userId: Types.ObjectId; tenantId: Types.ObjectId },
  ): Promise<{ redirectUri: string; state: string | null }> {
    const doc = await this.codeModel.findOne({ code });
    if (!doc) {
      throw new InvalidGrantError('Sesión de autorización inválida o expirada.');
    }
    if (doc.authorizedAt) {
      throw new InvalidGrantError('Esta sesión de autorización ya fue confirmada.');
    }
    if (Date.now() > doc.expiresAt.getTime()) {
      throw new InvalidGrantError('Sesión de autorización expirada — volvé a iniciar el flow.');
    }

    doc.userId = user.userId;
    doc.tenantId = user.tenantId;
    doc.authorizedAt = new Date();
    // Acortar TTL del code a OAUTH_AUTH_CODE_TTL_SECONDS post-autorización
    // para forzar al cliente a intercambiarlo rápido (OAuth 2.1 §4.1.3).
    doc.expiresAt = new Date(Date.now() + OAUTH_AUTH_CODE_TTL_SECONDS * 1000);
    await doc.save();

    return { redirectUri: doc.redirectUri, state: doc.state };
  }

  /** Lee el row pending para mostrar el nombre del cliente en consent. */
  async getPending(code: string): Promise<OAuthAuthCodeDocument | null> {
    const doc = await this.codeModel.findOne({ code });
    if (!doc) return null;
    if (doc.authorizedAt) return null;
    if (Date.now() > doc.expiresAt.getTime()) return null;
    return doc;
  }

  private async issueAccessToken(input: {
    clientId: string;
    userId: Types.ObjectId;
    tenantId: Types.ObjectId;
    scopes: string[];
    resource: string | null;
    ttlSeconds: number;
  }): Promise<{ plain: string; expiresAtMs: number }> {
    const plain = `${OAUTH_ACCESS_TOKEN_PREFIX}${this.randomToken(32)}`;
    const rounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const tokenHash = await bcrypt.hash(plain, rounds);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    await this.accessModel.create({
      tokenHash,
      prefix: plain.slice(0, 16),
      clientId: input.clientId,
      userId: input.userId,
      tenantId: input.tenantId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt,
    });
    return { plain, expiresAtMs: expiresAt.getTime() };
  }

  private async issueRefreshToken(input: {
    clientId: string;
    userId: Types.ObjectId;
    tenantId: Types.ObjectId;
    scopes: string[];
    resource: string | null;
    ttlSeconds: number;
  }): Promise<{ plain: string; expiresAtMs: number }> {
    const plain = `${OAUTH_REFRESH_TOKEN_PREFIX}${this.randomToken(32)}`;
    const rounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const tokenHash = await bcrypt.hash(plain, rounds);
    const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);
    await this.refreshModel.create({
      tokenHash,
      prefix: plain.slice(0, 16),
      clientId: input.clientId,
      userId: input.userId,
      tenantId: input.tenantId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt,
    });
    return { plain, expiresAtMs: expiresAt.getTime() };
  }

  private async revokeAllForUser(clientId: string, userId: Types.ObjectId): Promise<void> {
    const now = new Date();
    await Promise.all([
      this.accessModel.updateMany(
        { clientId, userId, revokedAt: null },
        { $set: { revokedAt: now } },
      ),
      this.refreshModel.updateMany(
        { clientId, userId, revokedAt: null },
        { $set: { revokedAt: now } },
      ),
    ]);
    this.logger.warn(`Tokens revocados por reuso clientId=${clientId} userId=${userId.toString()}`);
  }

  private randomToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
  }
}

// Re-export ServerError para consumo desde el provider sin importar
// directamente del SDK en otros módulos.
export { ServerError };
