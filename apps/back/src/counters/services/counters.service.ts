import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Counter, CounterDocument } from '../schemas/counter.schema';

@Injectable()
export class CountersService {
  constructor(@InjectModel(Counter.name) private readonly counterModel: Model<CounterDocument>) {}

  /**
   * Incrementa atómicamente el counter de shortCodes del tenant y devuelve
   * el siguiente número formateado como `TIK-N`. La operación es atómica
   * gracias a `findOneAndUpdate` con `$inc` y `upsert`.
   */
  async nextTicketShortCode(tenantId: Types.ObjectId): Promise<string> {
    const id = `ticket-shortcode:${tenantId.toString()}`;
    const updated = await this.counterModel
      .findOneAndUpdate(
        { _id: id },
        { $inc: { seq: 1 } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();
    return `TIK-${updated.seq}`;
  }
}
