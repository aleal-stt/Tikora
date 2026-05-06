import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { UsersModule } from '../users/users.module';
import { SeedService } from './seed.service';

@Module({
  imports: [TenantsModule, UsersModule],
  providers: [SeedService],
})
export class SeedModule {}
