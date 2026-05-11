import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import type { Role } from '@tikora/core';
import { Env } from '../config/env.schema';
import { TenantDocument } from '../tenants/schemas/tenant.schema';
import { TenantsService } from '../tenants/services/tenants.service';
import { UsersService } from '../users/services/users.service';

interface E2eUserSpec {
  email: string;
  fullName: string;
  role: Exclude<Role, 'admin'>;
}

// Usuarios fijos para suites E2E. Emails y password son conocidos —
// solo se siembran cuando SEED_E2E_USERS=true (nunca en prod).
const E2E_USERS: readonly E2eUserSpec[] = [
  { email: 'lider@empresa.com', fullName: 'Líder E2E', role: 'lider' },
  { email: 'agente@empresa.com', fullName: 'Agente E2E', role: 'agente' },
  { email: 'empleado@empresa.com', fullName: 'Empleado E2E', role: 'empleado' },
];

@Injectable()
export class SeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
  ) {}

  async onApplicationBootstrap() {
    const tenant = await this.seedTenantAndAdmin();
    if (this.config.get('SEED_E2E_USERS', { infer: true })) {
      await this.seedE2eUsers(tenant);
    }
  }

  private async seedTenantAndAdmin(): Promise<TenantDocument> {
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
      return tenant;
    }

    const adminPassword = this.config.get('SEED_ADMIN_PASSWORD', { infer: true });
    const adminFullName = this.config.get('SEED_ADMIN_FULLNAME', { infer: true });
    const saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const passwordHash = await bcrypt.hash(adminPassword, saltRounds);

    const admin = await this.users.createRaw({
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
    return tenant;
  }

  /**
   * Siembra usuarios fijos para suites E2E. Idempotente: si un usuario ya
   * existe lo saltea. `mustChangePassword: false` para que el login E2E
   * sea directo. No se asignan áreas; las suites de admin las crean.
   */
  private async seedE2eUsers(tenant: TenantDocument): Promise<void> {
    const password = this.config.get('SEED_E2E_PASSWORD', { infer: true });
    const saltRounds = this.config.get('BCRYPT_SALT_ROUNDS', { infer: true });
    const passwordHash = await bcrypt.hash(password, saltRounds);

    for (const spec of E2E_USERS) {
      const existing = await this.users.findByEmail(tenant._id, spec.email);
      if (existing) {
        continue;
      }
      await this.users.createRaw({
        tenantId: tenant._id,
        email: spec.email,
        fullName: spec.fullName,
        passwordHash,
        role: spec.role,
        areaIds: [],
        active: true,
        mustChangePassword: false,
        lastLoginAt: null,
        failedLoginAttempts: 0,
        lockedUntil: null,
      });
      this.logger.log(`Usuario E2E creado: ${spec.email} (rol ${spec.role})`);
    }
  }
}
