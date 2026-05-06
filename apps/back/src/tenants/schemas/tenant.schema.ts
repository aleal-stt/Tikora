import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({ _id: false })
export class TenantSettings {
  @Prop({ required: true })
  timezone!: string;

  @Prop({ required: true, default: '07:00' })
  businessHoursStart!: string;

  @Prop({ required: true, default: '18:00' })
  businessHoursEnd!: string;

  @Prop({ required: true, default: 5 })
  slaReopenGraceDays!: number;

  @Prop({ required: true, default: 15 })
  slaAutoCloseDays!: number;

  @Prop({ required: true, default: 0.7 })
  umbralConfianzaClasificacion!: number;

  @Prop({ required: true, default: 0.75 })
  umbralRelevanciaKb!: number;

  @Prop({ required: true, default: 0.9 })
  umbralAutoAutonoma!: number;

  @Prop({ required: true, default: 0.1 })
  autoAutonomaSampleRate!: number;

  @Prop({ required: true, default: 'v1' })
  classificationPromptVersion!: string;

  @Prop({ required: true, default: 'v1' })
  responsePromptVersion!: string;

  @Prop({ required: true, default: true })
  promptCacheEnabled!: boolean;

  @Prop({ type: Number, required: false, default: null })
  monthlyBudgetUsd!: number | null;
}

export const TenantSettingsSchema = SchemaFactory.createForClass(TenantSettings);

@Schema({ collection: 'tenants', timestamps: true })
export class Tenant {
  @Prop({ required: true, unique: true, trim: true })
  name!: string;

  @Prop({ type: [String], default: [] })
  domainAliases!: string[];

  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ type: TenantSettingsSchema, required: true })
  settings!: TenantSettings;
}

export type TenantDocument = HydratedDocument<Tenant>;
export const TenantSchema = SchemaFactory.createForClass(Tenant);

TenantSchema.index({ domainAliases: 1 });
