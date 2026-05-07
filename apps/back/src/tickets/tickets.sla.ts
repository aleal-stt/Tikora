import type { Prioridad } from '@tikora/core';

/**
 * Calcula el deadline SLA en ms wallclock desde el momento de cálculo.
 * TODO: pasar a horas hábiles del tenant cuando exista el calendario
 * laboral con feriados. Función pura para reuso entre TicketsService
 * (transiciones manuales) y ClassificationService (clasificación IA).
 */
export function calculateSlaDeadline(
  prioridad: Prioridad,
  slas: { alta: number; media: number; baja: number },
  fromDate: Date = new Date(),
): Date {
  const hours = slas[prioridad];
  return new Date(fromDate.getTime() + hours * 60 * 60 * 1000);
}
