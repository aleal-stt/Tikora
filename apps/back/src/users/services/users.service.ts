import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  findByEmail(tenantId: Types.ObjectId, email: string) {
    return this.userModel.findOne({ tenantId, email: email.toLowerCase() }).exec();
  }

  countByTenant(tenantId: Types.ObjectId) {
    return this.userModel.countDocuments({ tenantId }).exec();
  }

  create(data: Omit<User, never>) {
    return this.userModel.create(data);
  }
}
