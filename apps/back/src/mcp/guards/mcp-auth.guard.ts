import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { McpAuthService } from '../services/mcp-auth.service';

/**
 * Guard del transport MCP. Valida `Authorization: Bearer <secret>` y popula
 * `request.user` con la misma forma que `JwtAuthGuard` para que el resto del
 * pipeline (tools que delegan a services) no distinga el origen del caller.
 */
@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(private readonly mcpAuth: McpAuthService) {}

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

  private extractBearer(header: string | string[] | undefined): string | null {
    if (!header) return null;
    const value = Array.isArray(header) ? header[0] : header;
    if (!value) return null;
    const match = /^Bearer\s+(.+)$/i.exec(value.trim());
    return match?.[1] ?? null;
  }
}
