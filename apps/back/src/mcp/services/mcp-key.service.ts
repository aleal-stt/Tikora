import { randomBytes } from 'node:crypto';
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import * as bcrypt from 'bcryptjs';
import { Model, Types } from 'mongoose';
import { CreateMcpKey, McpKey } from '@tikora/core';
import { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Env } from '../../config/env.schema';
import {
  MCP_KEY_PREFIX,
  MCP_KEY_VISIBLE_PREFIX_LENGTH,
  MCP_SECRET_BODY_LENGTH,
} from '../mcp.constants';
import { McpApiKey, McpApiKeyDocument } from '../schemas/mcp-key.schema';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Genera un secreto `tk_mcp_<24 chars base62>` con rejection sampling
 * para eliminar el sesgo del módulo 62 sobre bytes de 256 valores.
 */
function generateSecret(): { secret: string; prefix: string } {
  let body = '';
  while (body.length < MCP_SECRET_BODY_LENGTH) {
    const bytes = randomBytes(MCP_SECRET_BODY_LENGTH * 2);
    for (let i = 0; i < bytes.length && body.length < MCP_SECRET_BODY_LENGTH; i++) {
      const value = bytes[i] ?? 0;
      // 248 = 62 * 4 — descarta los valores ≥ 248 para que cada char base62
      // sea equiprobable. Sin este check, los primeros 8 chars del alfabeto
      // saldrían un 25 % más que el resto.
      if (value < 248) {
        body += BASE62_ALPHABET[value % 62];
      }
    }
  }
  const secret = `${MCP_KEY_PREFIX}${body}`;
  return { secret, prefix: secret.slice(0, MCP_KEY_VISIBLE_PREFIX_LENGTH) };
}

@Injectable()
export class McpKeyService {
  private readonly logger = new Logger(McpKeyService.name);

  constructor(
    @InjectModel(McpApiKey.name)
    private readonly keyModel: Model<McpApiKeyDocument>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Genera una key nueva para el usuario actual. El `secret` viaja en la
   * respuesta UNA SOLA VEZ: el cliente debe guardarlo en el momento.
   */
  async generate(
    caller: AuthenticatedUser,
    input: CreateMcpKey,
  ): Promise<{ key: McpKey; secret: string }> {
    const tenantId = new Types.ObjectId(caller.tenantId);
    const userId = new Types.ObjectId(caller.userId);

    const max = this.config.get('MCP_MAX_ACTIVE_KEYS_PER_USER', { infer: true });
    const activeCount = await this.keyModel.countDocuments({
      tenantId,
      userId,
      revokedAt: null,
    });
    if (activeCount >= max) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'MCP_KEY_LIMIT_REACHED',
        `Alcanzaste el límite de ${max} keys activas. Revocá alguna antes de generar otra.`,
      );
    }

    const rounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const { secret, prefix } = generateSecret();
    const keyHash = await bcrypt.hash(secret, rounds);

    const doc = await this.keyModel.create({
      tenantId,
      userId,
      keyHash,
      prefix,
      name: input.name,
      lastUsedAt: null,
      revokedAt: null,
    });

    this.logger.log(
      `Key MCP generada keyId=${doc._id.toString()} userId=${caller.userId} prefix=${prefix}`,
    );

    return { key: this.toPublic(doc), secret };
  }

  /** Lista las keys no revocadas del usuario actual, descendente por creación. */
  async listForUser(caller: AuthenticatedUser): Promise<McpKey[]> {
    const docs = await this.keyModel
      .find({
        tenantId: new Types.ObjectId(caller.tenantId),
        userId: new Types.ObjectId(caller.userId),
        revokedAt: null,
      })
      .sort({ createdAt: -1 })
      .lean({ getters: true });

    return docs.map((d) => ({
      id: d._id.toString(),
      name: d.name,
      prefix: d.prefix,
      lastUsedAt: d.lastUsedAt ? d.lastUsedAt.toISOString() : null,
      createdAt: d.createdAt.toISOString(),
    }));
  }

  /**
   * Marca la key como revocada (soft-delete). 404 si el id no existe o no
   * pertenece al usuario; 409 si ya estaba revocada para evitar revocaciones
   * idempotentes silenciosas que pueden ocultar un problema en la UI.
   */
  async revoke(caller: AuthenticatedUser, keyId: string): Promise<void> {
    if (!Types.ObjectId.isValid(keyId)) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'MCP_KEY_NOT_FOUND', 'Key no encontrada.');
    }
    const doc = await this.keyModel.findOne({
      _id: new Types.ObjectId(keyId),
      tenantId: new Types.ObjectId(caller.tenantId),
      userId: new Types.ObjectId(caller.userId),
    });
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'MCP_KEY_NOT_FOUND', 'Key no encontrada.');
    }
    if (doc.revokedAt) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'MCP_KEY_ALREADY_REVOKED',
        'La key ya estaba revocada.',
      );
    }
    doc.revokedAt = new Date();
    await doc.save();
    this.logger.log(`Key MCP revocada keyId=${keyId} userId=${caller.userId}`);
  }

  private toPublic(doc: McpApiKeyDocument): McpKey {
    return {
      id: doc._id.toString(),
      name: doc.name,
      prefix: doc.prefix,
      lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
