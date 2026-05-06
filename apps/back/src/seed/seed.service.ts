import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import { Env } from '../config/env.schema';
import { TenantsService } from '../tenants/services/tenants.service';
import { UsersService } from '../users/services/users.service';

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
  ) {}

  async onApplicationBootstrap() {
    await this.seedTenantAndAdmin();
  }

  private async seedTenantAndAdmin() {
    const tenantName = this.config.get('DEFAULT_TENANT_NAME', { infer: true });
    const tenantTimezone = this.config.get('DEFAULT_TENANT_TIMEZONE', { infer: true });

    let tenant = await this.tenants.findByName(tenantName);
    if (!tenant) {
      tenant = await this.tenants.create({
        name: tenantName,
        domainAliases: [],
        active: true,
        settings: {
          timezone: tenantTimezone,
          businessHoursStart: '07:00',
          businessHoursEnd: '18:00',
          slaReopenGraceDays: 5,
          slaAutoCloseDays: 15,
          umbralConfianzaClasificacion: 0.7,
          umbralRelevanciaKb: 0.75,
          umbralAutoAutonoma: 0.9,
          autoAutonomaSampleRate: 0.1,
          classificationPromptVersion: 'v1',
          responsePromptVersion: 'v1',
          promptCacheEnabled: true,
          monthlyBudgetUsd: null,
        },
      });
      this.logger.log(`Tenant default creado: ${tenant.name} (${tenant._id})`);
    }

    const adminEmail = this.config.get('SEED_ADMIN_EMAIL', { infer: true });
    const existing = await this.users.findByEmail(tenant._id, adminEmail);
    if (existing) {
      return;
    }

    const adminPassword = this.config.get('SEED_ADMIN_PASSWORD', { infer: true });
    const adminFullName = this.config.get('SEED_ADMIN_FULLNAME', { infer: true });
    const saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    const admin = await this.users.create({
      tenantId: tenant._id,
      email: adminEmail,
      fullName: adminFullName,
      passwordHash,
      role: 'admin',
      areaIds: [],
      active: true,
      mustChangePassword: true,
      lastLoginAt: null,
      failedLoginAttempts: 0,
      lockedUntil: null,
    });

    this.logger.log(`Admin inicial creado: ${admin.email} (debe cambiar contraseña al ingresar)`);
  }
}
