import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { OAUTH_ACCESS_TOKEN_PREFIX } from '../../oauth/oauth.constants';
import { TikoraOAuthProvider } from '../../oauth/services/tikora-oauth-provider.service';
import { User, UserDocument } from '../../users/schemas/user.schema';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MCP_KEY_PREFIX } from '../mcp.constants';
import { McpAuthService } from '../services/mcp-auth.service';

/**
 * Guard del transport MCP. Acepta dos tipos de credenciales:
 *
 *  - **API key MCP directa** (`tk_mcp_…`): generada en `/perfil/mcp-keys`
 *    y pegada en clientes que aceptan Bearer plano (curl, MCP Inspector).
 *  - **Access token OAuth** (`tk_oauth_at_…`): emitido por `/token` tras
 *    el flow Authorization Code + PKCE. Es el que usa claude.ai cuando
 *    se configura un connector custom.
 *
 * En ambos casos popula `request.user` con la misma forma `AuthenticatedUser`
 * para que las tools downstream no distingan el origen del caller.
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(
    private readonly mcpAuth: McpAuthService,
    private readonly oauth: TikoraOAuthProvider,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();

    const secret = this.extractBearer(req.headers['authorization']);
    if (!secret) {
      throw new ApiException(
        HttpStatus.UNAUTHORIZED,
        'MCP_KEY_MISSING',
        'Falta la API key MCP en el header Authorization.',
      );
    }

    if (secret.startsWith(MCP_KEY_PREFIX)) {
      const user = await this.mcpAuth.resolve(secret);
      if (!user) {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          'MCP_KEY_INVALID',
          'API key MCP inválida o revocada.',
        );
      }
      req.user = user;
      return true;
    }

    if (secret.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)) {
      const user = await this.resolveOauthToken(secret);
      if (!user) {
        throw new ApiException(
          HttpStatus.UNAUTHORIZED,
          'MCP_KEY_INVALID',
          'Access token OAuth inválido, expirado o revocado.',
        );
      }
      req.user = user;
      return true;
    }

    throw new ApiException(
      HttpStatus.UNAUTHORIZED,
      'MCP_KEY_INVALID',
      'El formato del token no es reconocido.',
    );
  }

  private async resolveOauthToken(token: string): Promise<AuthenticatedUser | null> {
    try {
      const info = await this.oauth.verifyAccessToken(token);
      const userId = info.extra?.['userId'];
      const tenantId = info.extra?.['tenantId'];
      if (typeof userId !== 'string' || typeof tenantId !== 'string') return null;

      const userDoc = await this.userModel.findOne({
        _id: new Types.ObjectId(userId),
        tenantId: new Types.ObjectId(tenantId),
        active: true,
      });
      if (!userDoc) return null;

      return {
        userId: userDoc._id.toString(),
        tenantId: userDoc.tenantId.toString(),
        role: userDoc.role,
        areaIds: userDoc.areaIds.map((id) => id.toString()),
      };
    } catch (err) {
      if (err instanceof InvalidTokenError) return null;
      throw err;
    }
  }

  private extractBearer(header: string | string[] | undefined): string | null {
    if (!header) return null;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match?.[1] ?? null;
  }
}
