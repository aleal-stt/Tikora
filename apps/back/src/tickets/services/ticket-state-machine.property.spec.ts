import { HttpStatus } from '@nestjs/common';
import type { EstadoTicket } from '@tikora/core';
import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import { TicketStateMachineService } from './ticket-state-machine.service';

// Contrato esperado del ciclo de vida (duplicado intencional de la
// tabla del service). Actúa como spec ejecutable: cambios al service
// que rompan estas transiciones deben tocar también esta tabla, lo que
// fuerza una revisión deliberada del contrato.
const EXPECTED_TRANSITIONS: Record<EstadoTicket, readonly EstadoTicket[]> = {
  recibido: ['clasificado', 'requiere_revision_clasificacion', 'cancelado'],
  clasificado: ['escalado', 'cerrado', 'cancelado'],
  requiere_revision_clasificacion: ['clasificado', 'escalado', 'cancelado'],
  escalado: ['en_progreso', 'cancelado'],
  en_progreso: ['escalado', 'cerrado'],
  cerrado: ['reabierto'],
  reabierto: ['escalado', 'en_progreso'],
  cancelado: [],
};

const ALL_ESTADOS: readonly EstadoTicket[] = Object.keys(EXPECTED_TRANSITIONS) as EstadoTicket[];

const estadoArb: fc.Arbitrary<EstadoTicket> = fc.constantFrom(...ALL_ESTADOS);

describe('TicketStateMachineService — property tests', () => {
  const service = new TicketStateMachineService();

  it('`isTransitionAllowed` coincide con la tabla del contrato para todo (from, to)', () => {
    fc.assert(
      fc.property(estadoArb, estadoArb, (from, to) => {
        const expected = EXPECTED_TRANSITIONS[from].includes(to);
        return service.isTransitionAllowed(from, to) === expected;
      }),
    );
  });

  it('`assertTransition` lanza `TICKET_TRANSITION_INVALID` para transiciones no permitidas', () => {
    fc.assert(
      fc.property(estadoArb, estadoArb, (from, to) => {
        if (EXPECTED_TRANSITIONS[from].includes(to)) {
          // Caso válido: no debe tirar.
          expect(() => service.assertTransition(from, to)).not.toThrow();
          return;
        }
        // Caso inválido: tira ApiException con código y status correctos.
        try {
          service.assertTransition(from, to);
          throw new Error(`debería haber tirado para ${from} → ${to}`);
        } catch (err) {
          expect(err).toBeInstanceOf(ApiException);
          const api = err as ApiException;
          expect(api.getStatus()).toBe(HttpStatus.CONFLICT);
          expect(api.getResponse()).toMatchObject({ code: 'TICKET_TRANSITION_INVALID' });
        }
      }),
    );
  });

  it('`cancelado` es terminal: ningún `to` es válido', () => {
    fc.assert(
      fc.property(estadoArb, (to) => {
        return service.isTransitionAllowed('cancelado', to) === false;
      }),
    );
  });
});
