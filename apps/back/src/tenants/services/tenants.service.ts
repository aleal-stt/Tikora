import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument } from '../schemas/tenant.schema';
import { ApiException } from '../../common/exceptions/api.exception';
import { HttpStatus } from '@nestjs/common';

@Injectable()
export class TenantsService {
  // Cache en memoria del tenant del MVP. Se resuelve la primera vez
  // y se mantiene hasta el reinicio del proceso. Cuando lleguemos a
  // multi-tenant, este path se reemplaza por una resolución basada
  // en dominio del request y este cache desaparece.
  private defaultTenantIdCache: Types.ObjectId | null = null;

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

  async getDefaultTenantId(): Promise<Types.ObjectId> {
    if (this.defaultTenantIdCache !== null) {
      return this.defaultTenantIdCache;
    }
    const tenant = await this.tenantModel
      .findOne({ active: true }, { _id: 1 })
      .sort({ createdAt: 1 })
      .exec();
    if (!tenant) {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'TENANT_NOT_INITIALIZED',
        'No hay un tenant activo configurado.',
      );
    }
    this.defaultTenantIdCache = tenant._id;
    return tenant._id;
  }
}
