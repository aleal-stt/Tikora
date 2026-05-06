import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';

@Injectable()
export class TenantsService {
  constructor(@InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>) {}

  findByName(name: string) {
    return this.tenantModel.findOne({ name }).exec();
  }

  count() {
    return this.tenantModel.estimatedDocumentCount().exec();
  }

  create(data: Tenant) {
    return this.tenantModel.create(data);
  }
}
