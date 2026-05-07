import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ _id: false })
export class AreaSlas {
  @Prop({ type: Number, required: true })
  alta!: number;

  @Prop({ type: Number, required: true })
  media!: number;

  @Prop({ type: Number, required: true })
  baja!: number;
}

export const AreaSlasSchema = SchemaFactory.createForClass(AreaSlas);

@Schema({ collection: 'areas', timestamps: true })
export class Area {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  agentIds!: Types.ObjectId[];

  @Prop({ type: [{ type: Types.ObjectId, ref: 'User' }], default: [] })
  leaderIds!: Types.ObjectId[];

  @Prop({ type: AreaSlasSchema, required: true })
  slas!: AreaSlas;

  @Prop({ type: Boolean, required: true, default: true })
  active!: boolean;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type AreaDocument = HydratedDocument<Area>;
export const AreaSchema = SchemaFactory.createForClass(Area);

// Único entre áreas activas: dos áreas inactivas pueden compartir nombre,
// pero no debería haber dos activas con el mismo nombre dentro del tenant.
AreaSchema.index(
  { tenantId: 1, name: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);
AreaSchema.index({ tenantId: 1, leaderIds: 1 });
AreaSchema.index({ tenantId: 1, agentIds: 1 });
