import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { AuthenticatedUser } from '../../auth/types/auth.types';
import { User, UserDocument } from '../../users/schemas/user.schema';
import {
  MCP_KEY_PREFIX,
  MCP_KEY_TOTAL_LENGTH,
  MCP_KEY_VISIBLE_PREFIX_LENGTH,
} from '../mcp.constants';
import { McpApiKey, McpApiKeyDocument } from '../schemas/mcp-key.schema';

/**
 * Resuelve un secreto MCP a un `AuthenticatedUser` con la misma forma que
 * popula `JwtAccessStrategy`: las tools del MCP server consumen el contexto
 * sin saber por qué transport vino el caller.
 */
@Injectable()
export class McpAuthService {
  private readonly logger = new Logger(McpAuthService.name);

  constructor(
    @InjectModel(McpApiKey.name)
    private readonly keyModel: Model<McpApiKeyDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
  ) {}

  /**
   * Devuelve el usuario asociado a la key o `null` si la key es inválida,
   * está revocada, o el usuario detrás de ella está inactivo. Nunca lanza
   * por credencial mala — el guard decide la respuesta HTTP.
   *
   * Actualiza `lastUsedAt` async cuando hay match; el catch del then evita
   * que un fallo de write tire la request en curso.
   */
  async resolve(secret: string): Promise<AuthenticatedUser | null> {
    if (!this.isWellFormed(secret)) return null;

    const prefix = secret.slice(0, MCP_KEY_VISIBLE_PREFIX_LENGTH);
    const candidates = await this.keyModel.find({ prefix, revokedAt: null });
    if (candidates.length === 0) return null;

    for (const candidate of candidates) {
      const matches = await bcrypt.compare(secret, candidate.keyHash);
      if (!matches) continue;

      const user = await this.userModel.findOne({
        _id: candidate.userId,
        tenantId: candidate.tenantId,
        active: true,
      });
      if (!user) {
        this.logger.warn(
          `Key MCP válida pero usuario inactivo o inexistente: keyId=${candidate._id.toString()}`,
        );
        return null;
      }

      // Fire-and-forget. Logueamos error pero no propagamos.
      this.keyModel
        .updateOne({ _id: candidate._id }, { $set: { lastUsedAt: new Date() } })
        .exec()
        .catch((err: unknown) => {
          this.logger.warn(
            `No se pudo actualizar lastUsedAt keyId=${candidate._id.toString()}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });

      return {
        userId: user._id.toString(),
        tenantId: user.tenantId.toString(),
        role: user.role,
        areaIds: user.areaIds.map((id: Types.ObjectId) => id.toString()),
      };
    }

    return null;
  }

  private isWellFormed(secret: string): boolean {
    return (
      typeof secret === 'string' &&
      secret.length === MCP_KEY_TOTAL_LENGTH &&
      secret.startsWith(MCP_KEY_PREFIX)
    );
  }
}
