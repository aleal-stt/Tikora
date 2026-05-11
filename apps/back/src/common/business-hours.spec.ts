import { describe, expect, it } from 'vitest';
import {
  addBusinessDays,
  addBusinessHours,
  businessHoursBetween,
  parseTimeOfDay,
  type BusinessHoursOpts,
} from './business-hours';

// Buenos Aires está en UTC-3 todo el año (sin DST). Usamos fechas como
// strings con offset explícito para que los tests sean reproducibles
// independientemente de la TZ del runner.
const BA_OPTS: BusinessHoursOpts = {
  timezone: 'America/Argentina/Buenos_Aires',
  dayStart: { hour: 7, minute: 0 },
  dayEnd: { hour: 18, minute: 0 },
};

/** Construye un Date a partir de hora local en BA (UTC-3). */
function ba(iso: string): Date {
  return new Date(`${iso}-03:00`);
}

describe('parseTimeOfDay', () => {
  it('parsea HH:mm', () => {
    expect(parseTimeOfDay('07:00')).toEqual({ hour: 7, minute: 0 });
    expect(parseTimeOfDay('18:30')).toEqual({ hour: 18, minute: 30 });
    expect(parseTimeOfDay('0:00')).toEqual({ hour: 0, minute: 0 });
  });

  it('rechaza formatos inválidos', () => {
    expect(() => parseTimeOfDay('7am')).toThrow();
    expect(() => parseTimeOfDay('25:00')).toThrow();
    expect(() => parseTimeOfDay('12:99')).toThrow();
  });
});

describe('addBusinessHours', () => {
  it('viernes 17:55 + 4h → lunes 10:55 (consume 5 min vie + 3h55 lun)', () => {
    // Viernes 2026-05-08 17:55 BA + 4 h hábiles
    // = 5 min hasta vie 18:00 + 3h 55min del lunes desde 07:00
    // = lunes 10:55 BA
    const result = addBusinessHours(ba('2026-05-08T17:55:00'), 4, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T10:55:00').toISOString());
  });

  it('viernes 10:00 + 4h → viernes 14:00 (mismo día hábil)', () => {
    const result = addBusinessHours(ba('2026-05-08T10:00:00'), 4, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-08T14:00:00').toISOString());
  });

  it('sábado 10:00 + 4h → lunes 11:00 (corre al inicio del lunes)', () => {
    const result = addBusinessHours(ba('2026-05-09T10:00:00'), 4, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T11:00:00').toISOString());
  });

  it('domingo 23:00 + 1h → lunes 08:00', () => {
    const result = addBusinessHours(ba('2026-05-10T23:00:00'), 1, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T08:00:00').toISOString());
  });

  it('lunes 06:00 (pre-hábil) + 2h → lunes 09:00', () => {
    const result = addBusinessHours(ba('2026-05-11T06:00:00'), 2, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T09:00:00').toISOString());
  });

  it('lunes 19:00 (post-hábil) + 2h → martes 09:00', () => {
    const result = addBusinessHours(ba('2026-05-11T19:00:00'), 2, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-12T09:00:00').toISOString());
  });

  it('lunes 07:00 + 11h (jornada completa) → lunes 18:00', () => {
    const result = addBusinessHours(ba('2026-05-11T07:00:00'), 11, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T18:00:00').toISOString());
  });

  it('lunes 07:00 + 22h (2 jornadas completas) → martes 18:00', () => {
    const result = addBusinessHours(ba('2026-05-11T07:00:00'), 22, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-12T18:00:00').toISOString());
  });

  it('0 horas devuelve la misma fecha (idempotencia)', () => {
    const start = ba('2026-05-11T10:00:00');
    expect(addBusinessHours(start, 0, BA_OPTS).getTime()).toBe(start.getTime());
  });

  it('valores fraccionarios (0.5h)', () => {
    const result = addBusinessHours(ba('2026-05-11T10:00:00'), 0.5, BA_OPTS);
    expect(result.toISOString()).toBe(ba('2026-05-11T10:30:00').toISOString());
  });
});

describe('businessHoursBetween', () => {
  it('mismo día, dentro de horario', () => {
    expect(
      businessHoursBetween(ba('2026-05-11T09:00:00'), ba('2026-05-11T12:00:00'), BA_OPTS),
    ).toBe(3);
  });

  it('viernes 17:55 → lunes 10:55 = 4h', () => {
    // Inverso del primer test de addBusinessHours.
    expect(
      businessHoursBetween(ba('2026-05-08T17:55:00'), ba('2026-05-11T10:55:00'), BA_OPTS),
    ).toBeCloseTo(4, 5);
  });

  it('sábado a domingo = 0', () => {
    expect(
      businessHoursBetween(ba('2026-05-09T10:00:00'), ba('2026-05-10T15:00:00'), BA_OPTS),
    ).toBe(0);
  });

  it('end ≤ start devuelve 0', () => {
    expect(
      businessHoursBetween(ba('2026-05-11T15:00:00'), ba('2026-05-11T10:00:00'), BA_OPTS),
    ).toBe(0);
    expect(
      businessHoursBetween(ba('2026-05-11T10:00:00'), ba('2026-05-11T10:00:00'), BA_OPTS),
    ).toBe(0);
  });

  it('semana completa (lun 07:00 a vie 18:00) = 55h', () => {
    expect(
      businessHoursBetween(ba('2026-05-11T07:00:00'), ba('2026-05-15T18:00:00'), BA_OPTS),
    ).toBe(55);
  });

  it('rango fuera de hábil completamente (sábado entero) = 0', () => {
    expect(
      businessHoursBetween(ba('2026-05-09T00:00:00'), ba('2026-05-09T23:59:59'), BA_OPTS),
    ).toBe(0);
  });

  it('inversa de addBusinessHours: A + h → B implica between(A, B) = h', () => {
    const cases: Array<[string, number]> = [
      ['2026-05-04T08:00:00', 5],
      ['2026-05-08T16:30:00', 3.5],
      ['2026-05-11T10:00:00', 22],
    ];
    for (const [startIso, hours] of cases) {
      const start = ba(startIso);
      const end = addBusinessHours(start, hours, BA_OPTS);
      expect(businessHoursBetween(start, end, BA_OPTS)).toBeCloseTo(hours, 5);
    }
  });
});

describe('addBusinessDays', () => {
  it('lunes + 1 día hábil = martes', () => {
    expect(addBusinessDays(ba('2026-05-11T10:00:00'), 1, BA_OPTS).toISOString()).toBe(
      ba('2026-05-12T10:00:00').toISOString(),
    );
  });

  it('viernes + 1 día hábil = lunes (salta fin de semana)', () => {
    expect(addBusinessDays(ba('2026-05-08T10:00:00'), 1, BA_OPTS).toISOString()).toBe(
      ba('2026-05-11T10:00:00').toISOString(),
    );
  });

  it('lunes + 5 días hábiles = lunes siguiente', () => {
    expect(addBusinessDays(ba('2026-05-11T10:00:00'), 5, BA_OPTS).toISOString()).toBe(
      ba('2026-05-18T10:00:00').toISOString(),
    );
  });

  it('lunes - 1 día hábil = viernes anterior', () => {
    expect(addBusinessDays(ba('2026-05-11T10:00:00'), -1, BA_OPTS).toISOString()).toBe(
      ba('2026-05-08T10:00:00').toISOString(),
    );
  });

  it('lunes - 15 días hábiles = 3 semanas calendario antes', () => {
    // 2026-05-11 lunes; 15 días hábiles antes = lunes 2026-04-20
    expect(addBusinessDays(ba('2026-05-11T10:00:00'), -15, BA_OPTS).toISOString()).toBe(
      ba('2026-04-20T10:00:00').toISOString(),
    );
  });

  it('0 días devuelve la misma fecha', () => {
    const start = ba('2026-05-11T10:00:00');
    expect(addBusinessDays(start, 0, BA_OPTS).getTime()).toBe(start.getTime());
  });
});
