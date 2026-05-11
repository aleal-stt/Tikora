import type { Prioridad } from '@tikora/core';
import { addBusinessHours, type BusinessHoursOpts } from '../common/business-hours';

/**
 * Calcula el deadline SLA aplicando **horas hábiles** del tenant
 * (decisión §10): lun-vie en la ventana horaria configurada
 * (`SLA_BUSINESS_HOURS_START`/`_END`), sin feriados en MVP.
 *
 * Antes era wallclock; ahora un ticket creado viernes 17:55 con SLA
 * de 4 h habiles vence el lunes a las 10:55, no el sábado a la 1 AM.
 *
 * Función pura para reuso entre `TicketsService` (transiciones manuales)
 * y `ClassificationService` (clasificación IA). Las opts las construye
 * `BusinessHoursService.getOptsForTenant(tenantId)`.
 */
export function calculateSlaDeadline(
  prioridad: Prioridad,
  slas: { alta: number; media: number; baja: number },
  opts: BusinessHoursOpts,
  fromDate: Date = new Date(),
): Date {
  const hours = slas[prioridad];
  return addBusinessHours(fromDate, hours, opts);
}
