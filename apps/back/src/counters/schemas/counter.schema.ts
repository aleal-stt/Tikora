import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

/**
 * Contadores monotónicos auxiliares (ver `tikora-data-model.md` §4.1).
 * `_id` viaja como string compuesto, ej: `"ticket-shortcode:<tenantId>"`.
 */
@Schema({ collection: 'counters', timestamps: false, _id: false })
export class Counter {
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: Number, required: true, default: 0 })
  seq!: number;
}

export type CounterDocument = HydratedDocument<Counter>;
export const CounterSchema = SchemaFactory.createForClass(Counter);
