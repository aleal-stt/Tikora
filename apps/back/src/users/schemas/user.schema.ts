import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserRole = 'empleado' | 'agente' | 'lider' | 'admin';

@Schema({ collection: 'users', timestamps: true })
export class User {
  @Prop({ type: Types.ObjectId, ref: 'Tenant', required: true, index: true })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, trim: true })
  fullName!: string;

  @Prop({ required: true })
  passwordHash!: string;

  @Prop({
    required: true,
    enum: ['empleado', 'agente', 'lider', 'admin'],
    type: String,
  })
  role!: UserRole;

  @Prop({ type: [{ type: Types.ObjectId, ref: 'Area' }], default: [] })
  areaIds!: Types.ObjectId[];

  @Prop({ required: true, default: true })
  active!: boolean;

  @Prop({ required: true, default: true })
  mustChangePassword!: boolean;

  @Prop({ type: Date, default: null })
  lastLoginAt!: Date | null;

  @Prop({ required: true, default: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil!: Date | null;

  // Mongoose maneja estas dos automáticamente vía `timestamps: true`,
  // pero declaramos los tipos para que el mapper de respuesta los lea
  // sin hacer casts.
  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);

UserSchema.index({ tenantId: 1, email: 1 }, { unique: true });
UserSchema.index({ tenantId: 1, role: 1, active: 1 });
UserSchema.index({ tenantId: 1, areaIds: 1 });
