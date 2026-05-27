import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Access token OAuth opaco (no JWT — guardar solo el hash en la BD).
 * Su forma en claro es `tk_oauth_at_<random>` y solo viaja en la
 * respuesta de /token; queda en manos del cliente hasta `expiresAt`.
 *
 * El `userId` + `tenantId` se inyectan en `request.user` por el guard
 * cuando una request MCP llega con este token; las tools downstream no
 * distinguen el origen del caller.
 */
@Schema({ collection: 'oauth_access_tokens', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthAccessToken {
  // Hash bcrypt del token completo. La búsqueda usa el `prefix` para
  // acotar candidatos y después compara con bcrypt.
  @Prop({ type: String, required: true })
  tokenHash!: string;

  // Primeros 16 chars del token en claro (`tk_oauth_at_xxx`). Sirve
  // para acotar la búsqueda de candidatos durante la validación.
  @Prop({ type: String, required: true, minlength: 16, maxlength: 16, index: true })
  prefix!: string;

  @Prop({ type: String, required: true, index: true })
  clientId!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  scopes!: string[];

  @Prop({ type: String, default: null })
  resource!: string | null;

  // TTL del token. Mongo elimina el row pasado este tiempo; el guard
  // ya rechazaba antes con expiresAt < now, pero el cleanup automático
  // mantiene la colección acotada.
  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;

  // Soft-delete por revocación explícita o por reuso de un code.
  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type OAuthAccessTokenDocument = HydratedDocument<OAuthAccessToken>;
export const OAuthAccessTokenSchema = SchemaFactory.createForClass(OAuthAccessToken);
