import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Tenant, TenantDocument, TenantSettings } from '../tenants/schemas/tenant.schema';
import { parseTimeOfDay, type BusinessHoursOpts } from './business-hours';

/**
 * Construye `BusinessHoursOpts` (timezone + ventana hábil) para un
 * tenant a partir de `tenant.settings`. Decisión §10: el horario hábil
 * es configurable **por tenant** (no global), porque distintas
 * empresas pueden tener horarios distintos.
 *
 * Punto único para que los services que calculan SLA no dupliquen la
 * carga del tenant ni el parseo de los campos `businessHoursStart`/
 * `businessHoursEnd`. El sla-checker carga todos los tenants al
 * inicio del tick y reusa estas opts en sus 3 barridos.
 */
@Injectable()
export class BusinessHoursService {
  constructor(@InjectModel(Tenant.name) private readonly tenantModel: Model<TenantDocument>) {}

  /** Devuelve las opts hábiles para el tenant indicado. */
  async getOptsForTenant(tenantId: string | Types.ObjectId): Promise<BusinessHoursOpts> {
    const _id = typeof tenantId === 'string' ? new Types.ObjectId(tenantId) : tenantId;
    const tenant = await this.tenantModel.findOne({ _id }).select({ settings: 1 }).lean().exec();
    if (!tenant) {
      throw new NotFoundException(`Tenant no encontrado: ${tenantId.toString()}`);
    }
    return this.optsFromSettings(tenant.settings);
  }

  /**
   * Variante síncrona cuando ya tenés los settings cargados (típico en
   * loops del cron de SLA donde cargás todos los tenants al inicio).
   */
  optsFromSettings(settings: TenantSettings): BusinessHoursOpts {
    return {
      timezone: settings.timezone,
      dayStart: parseTimeOfDay(settings.businessHoursStart),
      dayEnd: parseTimeOfDay(settings.businessHoursEnd),
    };
  }
}
