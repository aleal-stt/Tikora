import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'refresh_tokens', timestamps: false })
export class RefreshToken {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  // sha256(refreshJwt). Nunca se guarda el JWT en claro: ante un dump
  // de la colección, los tokens activos no sirven para hacerse pasar.
  @Prop({ required: true })
  tokenHash!: string;

  @Prop({ required: true, type: Date })
  issuedAt!: Date;

  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'RefreshToken', default: null })
  replacedById!: Types.ObjectId | null;

  @Prop({ type: String, default: null })
  userAgent!: string | null;

  @Prop({ type: String, default: null })
  ip!: string | null;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;
export const RefreshTokenSchema = SchemaFactory.createForClass(RefreshToken);

RefreshTokenSchema.index({ tokenHash: 1 }, { unique: true });
RefreshTokenSchema.index({ userId: 1, revokedAt: 1 });
// Mongo borra el documento 7 días después de su expiración. Esa ventana se
// usa para auditar reuso de tokens revocados antes de perder el rastro.
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });
