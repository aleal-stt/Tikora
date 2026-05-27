import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Authorization code del flow OAuth 2.1. Una sola entidad cubre dos
 * fases consecutivas para simplificar:
 *
 *  1. **Pending** (apenas se inicia /authorize): se persisten los
 *     params del cliente (redirectUri, codeChallenge, state, …) sin
 *     `userId`. El `_id` del row es la "session id" que viaja como
 *     hidden field en el form de consent.
 *  2. **Authorized** (POST /oauth/consent con credenciales OK): se
 *     popula `userId` + `tenantId` + `authorizedAt`. El `code` que
 *     viaja al cliente coincide con el `code` del row.
 *
 * Cuando el cliente intercambia el code por tokens (`exchangeAuthorizationCode`),
 * se marca `exchangedAt` para invalidar reusos (OAuth 2.1 §4.1.3).
 *
 * El TTL absoluto del row es `OAUTH_PENDING_AUTH_TTL_SECONDS` (5 min)
 * para que un usuario que abandone la pantalla de consent no deje basura.
 */
@Schema({ collection: 'oauth_auth_codes', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthAuthCode {
  // `code` que se devuelve al cliente en el redirect. Empieza con
  // OAUTH_AUTH_CODE_PREFIX. Single-use.
  @Prop({ type: String, required: true, unique: true })
  code!: string;

  @Prop({ type: String, required: true, index: true })
  clientId!: string;

  @Prop({ type: String, required: true })
  redirectUri!: string;

  // PKCE challenge (RFC 7636). v1 solo soporta S256 — el SDK valida
  // el verifier contra esto en exchangeAuthorizationCode.
  @Prop({ type: String, required: true })
  codeChallenge!: string;

  @Prop({ type: String, required: true, default: 'S256' })
  codeChallengeMethod!: string;

  // `state` opaco que el cliente envió; debe re-enviarse en el redirect
  // exitoso para que el cliente verifique el flow.
  @Prop({ type: String, default: null })
  state!: string | null;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  // RFC 8707 resource indicator. Si está, el access_token solo es
  // válido contra ese resource server.
  @Prop({ type: String, default: null })
  resource!: string | null;

  // Se populan al confirmar el consent.
  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  userId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Tenant', default: null })
  tenantId!: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  authorizedAt!: Date | null;

  // Marca el code como usado tras `exchangeAuthorizationCode`. Reusarlo
  // es un error de protocolo y debe invalidar tokens emitidos previamente.
  @Prop({ type: Date, default: null })
  exchangedAt!: Date | null;

  // TTL absoluto: 5 min desde createdAt. Mongo elimina el row pasado
  // este tiempo, sin importar si fue intercambiado o no — los tokens
  // emitidos sobreviven en `oauth_access_tokens`.
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type OAuthAuthCodeDocument = HydratedDocument<OAuthAuthCode>;
export const OAuthAuthCodeSchema = SchemaFactory.createForClass(OAuthAuthCode);
