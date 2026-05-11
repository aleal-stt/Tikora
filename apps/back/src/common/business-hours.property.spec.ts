import * as fc from 'fast-check';
import { toZonedTime } from 'date-fns-tz';
import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addBusinessHours,
  businessHoursBetween,
  type BusinessHoursOpts,
} from './business-hours';

const OPTS: BusinessHoursOpts = {
  timezone: 'America/Argentina/Buenos_Aires',
  dayStart: { hour: 7, minute: 0 },
  dayEnd: { hour: 18, minute: 0 },
};

// Rango razonable de fechas: 2024-2030. Evita extremos del calendario
// gregoriano que pueden activar bugs de date-fns no relacionados con
// la lógica que probamos.
const dateArb = fc.date({
  min: new Date('2024-01-01T00:00:00Z'),
  max: new Date('2030-12-31T23:59:59Z'),
  noInvalidDate: true,
});

const positiveHoursArb = fc.float({
  min: Math.fround(0.1),
  max: Math.fround(100),
  noNaN: true,
  noDefaultInfinity: true,
});

function isWeekday(date: Date, tz: string): boolean {
  const zoned = toZonedTime(date, tz);
  const day = zoned.getDay();
  return day >= 1 && day <= 5;
}

function localMinutes(date: Date, tz: string): number {
  const zoned = toZonedTime(date, tz);
  return zoned.getHours() * 60 + zoned.getMinutes() + zoned.getSeconds() / 60;
}

describe('business-hours — property tests', () => {
  it('addBusinessHours es monótonamente creciente con horas positivas', () => {
    fc.assert(
      fc.property(dateArb, positiveHoursArb, (start, hours) => {
        const result = addBusinessHours(start, hours, OPTS);
        return result.getTime() >= start.getTime();
      }),
    );
  });

  it('addBusinessHours con horas ≤ 0 devuelve `start` sin cambios', () => {
    fc.assert(
      fc.property(
        dateArb,
        fc.float({ min: Math.fround(-50), max: 0, noNaN: true }),
        (start, hours) => {
          const result = addBusinessHours(start, hours, OPTS);
          return result.getTime() === start.getTime();
        },
      ),
    );
  });

  it('addBusinessHours con horas > 0 siempre cae en día hábil y dentro del horario', () => {
    fc.assert(
      fc.property(dateArb, positiveHoursArb, (start, hours) => {
        const result = addBusinessHours(start, hours, OPTS);
        const dayOk = isWeekday(result, OPTS.timezone);
        const min = localMinutes(result, OPTS.timezone);
        // Inclusivo en ambos extremos: 07:00 y 18:00 son válidos como
        // frontera (el cómputo puede dejar el cursor en el cierre exacto
        // del día cuando las horas consumidas son múltiplo del día).
        const hourOk = min >= 7 * 60 - 1e-6 && min <= 18 * 60 + 1e-6;
        return dayOk && hourOk;
      }),
    );
  });

  it('businessHoursBetween(start, start) === 0 y end ≤ start ⇒ 0', () => {
    fc.assert(
      fc.property(dateArb, (start) => {
        return businessHoursBetween(start, start, OPTS) === 0;
      }),
    );
    fc.assert(
      fc.property(
        dateArb,
        fc.float({ min: Math.fround(0.001), max: Math.fround(48), noNaN: true }),
        (start, hoursBack) => {
          const end = new Date(start.getTime() - hoursBack * 60 * 60 * 1000);
          return businessHoursBetween(start, end, OPTS) === 0;
        },
      ),
    );
  });

  it('businessHoursBetween es no negativo', () => {
    fc.assert(
      fc.property(dateArb, dateArb, (a, b) => {
        const [start, end] = a < b ? [a, b] : [b, a];
        return businessHoursBetween(start, end, OPTS) >= 0;
      }),
    );
  });

  it('round-trip: businessHoursBetween(start, addBusinessHours(start, h)) ≈ h', () => {
    fc.assert(
      fc.property(dateArb, positiveHoursArb, (start, hours) => {
        const end = addBusinessHours(start, hours, OPTS);
        const counted = businessHoursBetween(start, end, OPTS);
        // Tolerancia: 1 minuto. La función addBusinessHours usa
        // aritmética de ms y businessHoursBetween acumula por minutos
        // enteros (Math.max + redondeo implícito al setSeconds(0,0)).
        return Math.abs(counted - hours) <= 1 / 60 + 1e-6;
      }),
    );
  });

  it('addBusinessDays con n > 0 siempre cae en día hábil', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: 1, max: 60 }), (start, days) => {
        const result = addBusinessDays(start, days, OPTS);
        return isWeekday(result, OPTS.timezone);
      }),
    );
  });
});
