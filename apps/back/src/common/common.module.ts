import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { BusinessHoursService } from './business-hours.service';

/**
 * Módulo de utilidades cross-feature: services que sirven a varios
 * módulos de dominio sin pertenecer a ninguno en particular. Hoy
 * expone `BusinessHoursService` (cálculo de horas/días hábiles para
 * SLA según decisión §10).
 */
@Module({
  imports: [TenantsModule],
  providers: [BusinessHoursService],
  exports: [BusinessHoursService],
})
export class CommonModule {}
