import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'mcp_api_keys', timestamps: { createdAt: true, updatedAt: false } })
export class McpApiKey {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  // Hash bcrypt del secreto completo. Nunca se devuelve al cliente.
  @Prop({ type: String, required: true })
  keyHash!: string;

  // Primeros 12 chars del secreto en claro (`tk_mcp_xxxxx`). Sirve para
  // identificar la key en logs/UI sin exponer el resto. Acota la búsqueda
  // del hash en validación (ver McpAuthService).
  @Prop({ type: String, required: true, minlength: 12, maxlength: 12 })
  prefix!: string;

  // Etiqueta que el usuario le pone a la key ("Mi WhatsApp personal").
  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: Date, default: null })
  lastUsedAt!: Date | null;

  // Soft-delete: las keys revocadas se conservan para auditoría.
  @Prop({ type: Date, default: null })
  revokedAt!: Date | null;

  @Prop({ type: Date })
  createdAt!: Date;
}

export type McpApiKeyDocument = HydratedDocument<McpApiKey>;
export const McpApiKeySchema = SchemaFactory.createForClass(McpApiKey);

// Cuenta de keys activas por usuario (cap en MCP_MAX_ACTIVE_KEYS_PER_USER).
McpApiKeySchema.index({ tenantId: 1, userId: 1, revokedAt: 1 });
// Acota candidatas a comparar con bcrypt durante la validación de la key.
McpApiKeySchema.index({ prefix: 1 });
