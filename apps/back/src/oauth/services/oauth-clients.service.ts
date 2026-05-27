import { randomBytes } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { OAUTH_CLIENT_ID_PREFIX, OAUTH_CLIENT_SECRET_PREFIX } from '../oauth.constants';
import { OAuthClient, OAuthClientDocument } from '../schemas/oauth-client.schema';

/**
 * Store de clientes OAuth registrados vía Dynamic Client Registration.
 * El SDK lo consume desde `mcpAuthRouter` para validar peticiones
 * autenticadas con `client_secret` (comparación directa contra el campo
 * `client_secret` que devolvemos en `getClient`) y para popular el
 * contexto durante el flow Authorization Code.
 */
@Injectable()
export class OAuthClientsService implements OAuthRegisteredClientsStore {
  private readonly logger = new Logger(OAuthClientsService.name);

  constructor(
    @InjectModel(OAuthClient.name)
    private readonly clientModel: Model<OAuthClientDocument>,
  ) {}

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const doc = await this.clientModel.findOne({ clientId }).lean({ getters: true });
    if (!doc) return undefined;
    return this.toClientInfo(doc);
  }

  async registerClient(
    metadata: Omit<OAuthClientInformationFull, 'client_id' | 'client_id_issued_at'>,
  ): Promise<OAuthClientInformationFull> {
    const clientId = `${OAUTH_CLIENT_ID_PREFIX}${this.randomToken(24)}`;
    const isPublic = metadata.token_endpoint_auth_method === 'none';
    const clientSecret = isPublic ? null : `${OAUTH_CLIENT_SECRET_PREFIX}${this.randomToken(32)}`;

    const doc = await this.clientModel.create({
      clientId,
      clientSecret,
      redirectUris: metadata.redirect_uris,
      clientName: metadata.client_name ?? null,
      tokenEndpointAuthMethod: metadata.token_endpoint_auth_method ?? 'client_secret_post',
      grantTypes: metadata.grant_types ?? ['authorization_code', 'refresh_token'],
      responseTypes: metadata.response_types ?? ['code'],
      scope: metadata.scope ?? null,
    });

    this.logger.log(
      `Cliente OAuth registrado clientId=${clientId} name=${
        metadata.client_name ?? '(sin nombre)'
      } redirectUris=${doc.redirectUris.length}`,
    );

    return this.toClientInfo(doc);
  }

  private toClientInfo(doc: OAuthClient & { createdAt: Date }): OAuthClientInformationFull {
    return {
      client_id: doc.clientId,
      client_id_issued_at: Math.floor(doc.createdAt.getTime() / 1000),
      client_secret: doc.clientSecret ?? undefined,
      // 0 = "el secret no expira". El SDK lo trata como never-expires.
      client_secret_expires_at: doc.clientSecret ? 0 : undefined,
      redirect_uris: doc.redirectUris,
      token_endpoint_auth_method: doc.tokenEndpointAuthMethod ?? undefined,
      grant_types: doc.grantTypes,
      response_types: doc.responseTypes,
      client_name: doc.clientName ?? undefined,
      scope: doc.scope ?? undefined,
    };
  }

  private randomToken(bytes: number): string {
    return randomBytes(bytes).toString('base64url');
  }
}
