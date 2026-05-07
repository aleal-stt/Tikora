import { HttpStatus, Injectable } from '@nestjs/common';
import type { EstadoTicket } from '@tikora/core';
import { ApiException } from '../../common/exceptions/api.exception';

/**
 * Matriz de transiciones legales del ciclo de vida del ticket
 * (ver `tikora-backend.md` §3.5). Cualquier transición ausente acá
 * se considera inválida y debe rechazarse con `TICKET_TRANSITION_INVALID`.
 */
const TRANSITIONS: Record<EstadoTicket, EstadoTicket[]> = {
  recibido: ['clasificado', 'requiere_revision_clasificacion', 'cancelado'],
  clasificado: ['escalado', 'cerrado', 'cancelado'],
  requiere_revision_clasificacion: ['clasificado', 'escalado', 'cancelado'],
  escalado: ['en_progreso', 'cancelado'],
  en_progreso: ['escalado', 'cerrado'],
  cerrado: ['reabierto'],
  reabierto: ['escalado', 'en_progreso'],
  cancelado: [],
};

@Injectable()
export class TicketStateMachineService {
  /**
   * Lanza `TICKET_TRANSITION_INVALID` si la transición no está permitida.
   * Toda mutación de estado del ticket debe pasar por acá; los services
   * de ticket no deben tocar el campo `estado` directamente sin esta
   * validación.
   */
  assertTransition(from: EstadoTicket, to: EstadoTicket): void {
    const allowed = TRANSITIONS[from] ?? [];
    if (!allowed.includes(to)) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'TICKET_TRANSITION_INVALID',
        `Transición inválida: ${from} → ${to}.`,
      );
    }
  }

  isTransitionAllowed(from: EstadoTicket, to: EstadoTicket): boolean {
    return (TRANSITIONS[from] ?? []).includes(to);
  }
}
