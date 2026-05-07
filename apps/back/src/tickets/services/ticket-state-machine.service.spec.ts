import type { EstadoTicket } from '@tikora/core';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../common/exceptions/api.exception';
import { TicketStateMachineService } from './ticket-state-machine.service';

describe('TicketStateMachineService', () => {
  const sm = new TicketStateMachineService();

  const valid: Array<[EstadoTicket, EstadoTicket]> = [
    ['recibido', 'clasificado'],
    ['recibido', 'requiere_revision_clasificacion'],
    ['recibido', 'cancelado'],
    ['clasificado', 'escalado'],
    ['clasificado', 'cerrado'],
    ['requiere_revision_clasificacion', 'escalado'],
    ['requiere_revision_clasificacion', 'cancelado'],
    ['escalado', 'en_progreso'],
    ['escalado', 'cancelado'],
    ['en_progreso', 'cerrado'],
    ['en_progreso', 'escalado'],
    ['cerrado', 'reabierto'],
    ['reabierto', 'en_progreso'],
    ['reabierto', 'escalado'],
  ];

  const invalid: Array<[EstadoTicket, EstadoTicket]> = [
    ['recibido', 'en_progreso'],
    ['escalado', 'cerrado'],
    ['cerrado', 'en_progreso'],
    ['cancelado', 'en_progreso'],
    ['cancelado', 'cerrado'],
    ['en_progreso', 'cancelado'],
  ];

  it.each(valid)('permite la transición %s → %s', (from, to) => {
    expect(() => sm.assertTransition(from, to)).not.toThrow();
    expect(sm.isTransitionAllowed(from, to)).toBe(true);
  });

  it.each(invalid)('rechaza la transición %s → %s', (from, to) => {
    expect(() => sm.assertTransition(from, to)).toThrow(ApiException);
    expect(sm.isTransitionAllowed(from, to)).toBe(false);
  });
});
