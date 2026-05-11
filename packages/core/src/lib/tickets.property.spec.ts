import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classifyTicketSchema, createTicketSchema, prioridadSchema } from './tickets';

// Genera strings que después del trim queden en un rango exacto de
// longitud — agrega padding random de espacios alrededor del contenido.
function makePaddedString(content: string, padding = 3): fc.Arbitrary<string> {
  return fc
    .tuple(
      fc.string({ minLength: 0, maxLength: padding }).map((s) => s.replace(/\S/g, ' ')),
      fc.string({ minLength: 0, maxLength: padding }).map((s) => s.replace(/\S/g, ' ')),
    )
    .map(([pre, post]) => `${pre}${content}${post}`);
}

// Strings de longitud exacta (post trim) hechos con caracteres no-blancos.
function exactNonBlankString(length: number): fc.Arbitrary<string> {
  return fc
    .stringMatching(/^[a-zA-Z0-9]{1,1}$/)
    .map((c) => (c.length === 1 ? c : 'a'))
    .chain((c) => fc.constant(c.repeat(length)));
}

describe('createTicketSchema — property tests', () => {
  it('acepta asunto y cuerpo dentro de los rangos válidos (incluso con whitespace alrededor)', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 5, max: 120 })
          .chain((n) => exactNonBlankString(n))
          .chain(makePaddedString),
        fc
          .integer({ min: 10, max: 5000 })
          .chain((n) => exactNonBlankString(n))
          .chain(makePaddedString),
        (asunto, cuerpo) => {
          const result = createTicketSchema.safeParse({ asunto, cuerpo });
          return result.success;
        },
      ),
    );
  });

  it('rechaza asunto con longitud (post-trim) < 5', () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 0, max: 4 })
          .chain((n) => exactNonBlankString(n))
          .chain(makePaddedString),
        fc.integer({ min: 10, max: 200 }).chain((n) => exactNonBlankString(n)),
        (asunto, cuerpo) => {
          const result = createTicketSchema.safeParse({ asunto, cuerpo });
          return result.success === false;
        },
      ),
    );
  });

  it('rechaza asunto con longitud (post-trim) > 120', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 121, max: 500 }).chain((n) => exactNonBlankString(n)),
        fc.integer({ min: 10, max: 200 }).chain((n) => exactNonBlankString(n)),
        (asunto, cuerpo) => {
          const result = createTicketSchema.safeParse({ asunto, cuerpo });
          return result.success === false;
        },
      ),
    );
  });

  it('rechaza cuerpo con longitud (post-trim) < 10', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 120 }).chain((n) => exactNonBlankString(n)),
        fc
          .integer({ min: 0, max: 9 })
          .chain((n) => exactNonBlankString(n))
          .chain(makePaddedString),
        (asunto, cuerpo) => {
          const result = createTicketSchema.safeParse({ asunto, cuerpo });
          return result.success === false;
        },
      ),
    );
  });

  it('rechaza cuerpo con longitud (post-trim) > 5000', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 120 }).chain((n) => exactNonBlankString(n)),
        fc.integer({ min: 5001, max: 8000 }).chain((n) => exactNonBlankString(n)),
        (asunto, cuerpo) => {
          const result = createTicketSchema.safeParse({ asunto, cuerpo });
          return result.success === false;
        },
      ),
      // Estos strings son grandes — limito runs para mantener el spec rápido.
      { numRuns: 30 },
    );
  });
});

describe('classifyTicketSchema — property tests', () => {
  const validPrioridad: fc.Arbitrary<'alta' | 'media' | 'baja'> = fc.constantFrom(
    'alta',
    'media',
    'baja',
  );

  it('acepta cualquier prioridad válida y areaId no vacío', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        validPrioridad,
        fc.option(fc.string({ minLength: 0, maxLength: 100 }), { nil: undefined }),
        (areaId, prioridad, motivo) => {
          const result = classifyTicketSchema.safeParse({
            areaId,
            prioridad,
            ...(motivo !== undefined ? { motivo } : {}),
          });
          return result.success;
        },
      ),
    );
  });

  it('rechaza areaId vacío', () => {
    fc.assert(
      fc.property(validPrioridad, (prioridad) => {
        const result = classifyTicketSchema.safeParse({ areaId: '', prioridad });
        return result.success === false;
      }),
    );
  });

  it('rechaza prioridad fuera del enum', () => {
    const invalidPrioridad = fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s) => !['alta', 'media', 'baja'].includes(s));
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 50 }),
        invalidPrioridad,
        (areaId, prioridad) => {
          const result = classifyTicketSchema.safeParse({ areaId, prioridad });
          return result.success === false;
        },
      ),
    );
  });

  it('`prioridadSchema` acepta solo los 3 valores válidos', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 30 }), (s) => {
        const expected = ['alta', 'media', 'baja'].includes(s);
        return prioridadSchema.safeParse(s).success === expected;
      }),
    );
  });
});
