import { addDays as fnsAddDays } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Cálculos de horas y días hábiles en la zona horaria de un tenant.
 *
 * Reglas (decisión §10):
 *  - Días laborables: lunes a viernes.
 *  - Horario laboral: configurable por env (default 07:00–18:00).
 *  - Feriados: no se consideran en MVP — toda hora dentro del rango
 *    lun-vie es hábil.
 *
 * Implementación: convertimos a la TZ del tenant con date-fns-tz para
 * tomar decisiones sobre "día de la semana" y "hora del día", y al
 * final devolvemos un Date absoluto (UTC) que se persiste o compara
 * normalmente. Toda la aritmética se hace sobre tiempos locales del
 * tenant — un viernes 17:55 en `America/Argentina/Buenos_Aires` se
 * trata como tal aunque internamente sea otro instante UTC.
 */

export interface TimeOfDay {
  hour: number;
  minute: number;
}

export interface BusinessHoursOpts {
  timezone: string;
  dayStart: TimeOfDay;
  dayEnd: TimeOfDay;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/** Parsea un `HH:mm` (24h) a `{ hour, minute }`. Útil para leer envs. */
export function parseTimeOfDay(input: string): TimeOfDay {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) {
    throw new Error(`Formato de hora inválido: "${input}". Esperado "HH:mm".`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) {
    throw new Error(`Hora fuera de rango: ${hour}`);
  }
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) {
    throw new Error(`Minuto fuera de rango: ${minute}`);
  }
  return { hour, minute };
}

function isWeekend(zoned: Date): boolean {
  const day = zoned.getDay();
  return day === 0 || day === 6;
}

function minutesOfDay(t: TimeOfDay): number {
  return t.hour * 60 + t.minute;
}

function zonedMinutesOfDay(zoned: Date): number {
  return zoned.getHours() * 60 + zoned.getMinutes() + zoned.getSeconds() / 60;
}

/**
 * Devuelve el siguiente inicio de día hábil (en hora local del tenant)
 * que es ≥ al instante dado. Si `zoned` ya está dentro de la ventana
 * hábil, devuelve `zoned` sin cambios.
 */
function nextBusinessStart(zoned: Date, opts: BusinessHoursOpts): Date {
  let cursor = new Date(zoned);
  const startMin = minutesOfDay(opts.dayStart);
  const endMin = minutesOfDay(opts.dayEnd);
  // Loop seguro: máximo 7 iteraciones (peor caso, todos los días son
  // feriado/fin de semana — hoy solo aplica a fines de semana).
  for (let i = 0; i < 8; i += 1) {
    if (!isWeekend(cursor)) {
      const m = zonedMinutesOfDay(cursor);
      if (m < startMin) {
        cursor.setHours(opts.dayStart.hour, opts.dayStart.minute, 0, 0);
        return cursor;
      }
      if (m < endMin) {
        return cursor;
      }
    }
    // Pasar al inicio del siguiente día.
    cursor = fnsAddDays(cursor, 1);
    cursor.setHours(opts.dayStart.hour, opts.dayStart.minute, 0, 0);
  }
  return cursor;
}

/**
 * Suma `hours` horas hábiles a `start`. Si `hours` es 0 o negativo,
 * devuelve `start` sin cambios. Soporta valores fraccionarios
 * (`2.5` horas hábiles).
 */
export function addBusinessHours(start: Date, hours: number, opts: BusinessHoursOpts): Date {
  if (hours <= 0) return new Date(start);

  let zoned = toZonedTime(start, opts.timezone);
  zoned = nextBusinessStart(zoned, opts);

  let remainingMs = hours * MS_PER_HOUR;
  const startMin = minutesOfDay(opts.dayStart);
  const endMin = minutesOfDay(opts.dayEnd);
  const dayLengthMs = (endMin - startMin) * 60 * 1000;

  while (remainingMs > 0) {
    const fromMin = zonedMinutesOfDay(zoned);
    const remainingInDayMs = Math.max(0, (endMin - fromMin) * 60 * 1000);
    if (remainingMs <= remainingInDayMs) {
      zoned = new Date(zoned.getTime() + remainingMs);
      remainingMs = 0;
      break;
    }
    remainingMs -= remainingInDayMs;
    // Saltar al inicio del próximo día hábil.
    zoned = fnsAddDays(zoned, 1);
    zoned.setHours(opts.dayStart.hour, opts.dayStart.minute, 0, 0);
    zoned = nextBusinessStart(zoned, opts);
    // Si el día entero alcanza, evita un loop extra.
    if (remainingMs <= dayLengthMs) {
      zoned = new Date(zoned.getTime() + remainingMs);
      remainingMs = 0;
    } else {
      remainingMs -= dayLengthMs;
      zoned = fnsAddDays(zoned, 1);
      zoned.setHours(opts.dayStart.hour, opts.dayStart.minute, 0, 0);
      zoned = nextBusinessStart(zoned, opts);
    }
  }

  return fromZonedTime(zoned, opts.timezone);
}

/**
 * Cuenta horas hábiles entre dos instantes (positivo si `end > start`,
 * 0 si son iguales o `end < start`). Aritmética puramente en TZ local.
 *
 * Algoritmo: itera por día, cuenta minutos hábiles dentro de cada día
 * y los suma. Acepta rangos arbitrariamente largos (cota razonable).
 */
export function businessHoursBetween(start: Date, end: Date, opts: BusinessHoursOpts): number {
  if (end <= start) return 0;

  const zonedStart = toZonedTime(start, opts.timezone);
  const zonedEnd = toZonedTime(end, opts.timezone);
  const startMin = minutesOfDay(opts.dayStart);
  const endMin = minutesOfDay(opts.dayEnd);

  let totalMinutes = 0;
  let cursor = new Date(zonedStart);
  cursor.setSeconds(0, 0);
  // Tope de seguridad: 366 días * 5 = 1830 iteraciones máximo razonables.
  const HARD_LIMIT = 2000;

  for (let i = 0; i < HARD_LIMIT; i += 1) {
    // Si avanzamos más allá de zonedEnd, terminar.
    if (cursor >= zonedEnd) break;

    if (!isWeekend(cursor)) {
      // Determinar inicio y fin efectivos del tramo dentro del día.
      const dayStart = new Date(cursor);
      dayStart.setHours(opts.dayStart.hour, opts.dayStart.minute, 0, 0);
      const dayEnd = new Date(cursor);
      dayEnd.setHours(opts.dayEnd.hour, opts.dayEnd.minute, 0, 0);

      const segmentStart = cursor < dayStart ? dayStart : cursor;
      const segmentEnd = zonedEnd < dayEnd ? zonedEnd : dayEnd;

      if (segmentEnd > segmentStart) {
        // Acotar al rango hábil del día.
        const fromMin = Math.max(zonedMinutesOfDay(segmentStart), startMin);
        const toMin = Math.min(zonedMinutesOfDay(segmentEnd), endMin);
        if (toMin > fromMin) {
          totalMinutes += toMin - fromMin;
        }
      }
    }

    // Avanzar al inicio del próximo día.
    cursor = fnsAddDays(cursor, 1);
    cursor.setHours(0, 0, 0, 0);
  }

  return totalMinutes / 60;
}

/**
 * Suma `days` días hábiles a `start`. Soporta negativos para retroceder
 * (usado en cutoff de auto-cierre: `addBusinessDays(now, -15, opts)`
 * devuelve "hace 15 días hábiles").
 *
 * El resultado conserva la hora local del start (no la mueve a
 * `dayStart` ni a `dayEnd`).
 */
export function addBusinessDays(start: Date, days: number, opts: BusinessHoursOpts): Date {
  if (days === 0) return new Date(start);

  let zoned = toZonedTime(start, opts.timezone);
  const step = days > 0 ? 1 : -1;
  let remaining = Math.abs(days);

  while (remaining > 0) {
    zoned = fnsAddDays(zoned, step);
    if (!isWeekend(zoned)) {
      remaining -= 1;
    }
  }

  return fromZonedTime(zoned, opts.timezone);
}
