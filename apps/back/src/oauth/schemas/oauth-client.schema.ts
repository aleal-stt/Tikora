import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Cliente OAuth registrado vía Dynamic Client Registration (RFC 7591).
 * Cada cliente representa una "app" que pidió integrarse con Tikora —
 * en la práctica, una instancia del connector custom de claude.ai por
 * cada usuario que lo configura.
 *
 * **Sobre el almacenamiento del `client_secret` en claro:** el SDK MCP
 * de Anthropic (`authenticateClient` middleware) compara el secreto
 * recibido contra `client.client_secret` con `!==` directo, sin pasar
 * por una función de verificación que pudiéramos overridear con bcrypt.
 * Para no reimplementar el handler de /token desde cero se aceptó este
 * trade-off: el secret es 32 bytes random base64url (~256 bits de
 * entropía, no es un password humano de baja entropía), Atlas tiene
 * encryption at rest y los secrets son revocables (basta con DELETE
 * sobre el row). Si en el futuro se requiere defensa en profundidad,
 * la migración natural es agregar AES-256 simétrica con clave en env.
 */
@Schema({ collection: 'oauth_clients', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthClient {
  // `client_id` emitido. Empieza con OAUTH_CLIENT_ID_PREFIX.
  @Prop({ type: String, required: true, unique: true })
  clientId!: string;

  // `client_secret` en claro. Null si el cliente es público (`token_endpoint_auth_method=none`).
  @Prop({ type: String, default: null })
  clientSecret!: string | null;

  // Lista de redirect_uris registrados (RFC 7591 §2). Solo se acepta
  // redirect a alguna de estas durante el flow.
  @Prop({ type: [String], required: true, validate: (v: unknown[]) => v.length > 0 })
  redirectUris!: string[];

  // Nombre descriptivo que el cliente declaró en el registro. Se muestra
  // al usuario en la pantalla de consent ("X quiere conectarse a tu cuenta").
  @Prop({ type: String, default: null })
  clientName!: string | null;

  // Métodos token_endpoint_auth_method aceptados para este cliente.
  // Por defecto 'client_secret_post'; null si es cliente público.
  @Prop({ type: String, default: 'client_secret_post' })
  tokenEndpointAuthMethod!: string | null;

  // Grant types declarados por el cliente. v1 soporta authorization_code
  // y refresh_token; otros se rechazan.
  @Prop({ type: [String], default: ['authorization_code', 'refresh_token'] })
  grantTypes!: string[];

  // Response types declarados.
  @Prop({ type: [String], default: ['code'] })
  responseTypes!: string[];

  // Scope opcional declarado en el registro. Si está, el cliente solo
  // puede pedir tokens dentro de ese subset.
  @Prop({ type: String, default: null })
  scope!: string | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type OAuthClientDocument = HydratedDocument<OAuthClient>;
export const OAuthClientSchema = SchemaFactory.createForClass(OAuthClient);
