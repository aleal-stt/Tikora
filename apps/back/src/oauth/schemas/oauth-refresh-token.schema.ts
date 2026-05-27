import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Refresh token OAuth. Mismo patrón que el access token (opaco,
 * hasheado en BD), pero TTL más largo y permite emitir nuevos access
 * tokens sin volver a pasar por `/authorize`.
 *
 * v1 rota el refresh en cada uso (OAuth 2.1 §6.1): cada llamada a
 * /token con grant_type=refresh_token devuelve un par nuevo y revoca
 * el anterior. Si un atacante usa un refresh ya rotado, se revoca
 * toda la cadena del usuario.
 */
@Schema({ collection: 'oauth_refresh_tokens', timestamps: { createdAt: true, updatedAt: false } })
export class OAuthRefreshToken {
  @Prop({ type: String, required: true })
  tokenHash!: string;

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

  @Prop({ type: Date, required: true, expires: 0 })
  expiresAt!: Date;

  // Marca el refresh como ya utilizado en una rotación. Una request
  // que llegue con un refresh `usedAt != null` indica reuso → todos
  // los tokens del par se revocan.
  @Prop({ type: Date, default: null })
  usedAt!: Date | null;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type OAuthRefreshTokenDocument = HydratedDocument<OAuthRefreshToken>;
export const OAuthRefreshTokenSchema = SchemaFactory.createForClass(OAuthRefreshToken);
