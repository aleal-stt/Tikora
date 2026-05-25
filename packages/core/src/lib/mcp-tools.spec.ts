import { describe, expect, it } from 'vitest';
import {
  agregarMensajeATicketInputSchema,
  crearTicketInputSchema,
  listarMisTicketsInputSchema,
  obtenerTicketInputSchema,
} from './mcp-tools';

describe('crearTicketInputSchema', () => {
  it('acepta asunto y cuerpo válidos y los trimea', () => {
    const result = crearTicketInputSchema.parse({
      asunto: '  Necesito reembolso de viáticos  ',
      cuerpo: '  Viaje a Córdoba del 12 al 14 de mayo, factura adjunta en correo.  ',
    });
    expect(result.asunto.startsWith(' ')).toBe(false);
    expect(result.cuerpo.endsWith(' ')).toBe(false);
  });

  it('rechaza asunto corto', () => {
    expect(() =>
      crearTicketInputSchema.parse({ asunto: 'hola', cuerpo: 'cuerpo válido largo' }),
    ).toThrow();
  });

  it('rechaza cuerpo demasiado largo', () => {
    expect(() =>
      crearTicketInputSchema.parse({ asunto: 'asunto ok', cuerpo: 'x'.repeat(5001) }),
    ).toThrow();
  });
});

describe('listarMisTicketsInputSchema', () => {
  it('aplica límite por default de 10', () => {
    const result = listarMisTicketsInputSchema.parse({});
    expect(result.limite).toBe(10);
  });

  it('rechaza límite fuera de rango', () => {
    expect(() => listarMisTicketsInputSchema.parse({ limite: 0 })).toThrow();
    expect(() => listarMisTicketsInputSchema.parse({ limite: 21 })).toThrow();
  });

  it('acepta estado válido del dominio', () => {
    const result = listarMisTicketsInputSchema.parse({ estado: 'en_progreso' });
    expect(result.estado).toBe('en_progreso');
  });

  it('rechaza estado inexistente', () => {
    expect(() => listarMisTicketsInputSchema.parse({ estado: 'pendiente' })).toThrow();
  });
});

describe('obtenerTicketInputSchema', () => {
  it('acepta ObjectId válido', () => {
    const result = obtenerTicketInputSchema.parse({ ticketId: '69fdef7eb24d4156c5998df8' });
    expect(result.ticketId).toBe('69fdef7eb24d4156c5998df8');
  });

  it('rechaza string que no es ObjectId', () => {
    expect(() => obtenerTicketInputSchema.parse({ ticketId: 'no-es-objectid' })).toThrow();
    expect(() => obtenerTicketInputSchema.parse({ ticketId: '123' })).toThrow();
  });
});

describe('agregarMensajeATicketInputSchema', () => {
  it('acepta texto válido', () => {
    const result = agregarMensajeATicketInputSchema.parse({
      ticketId: '69fdef7eb24d4156c5998df8',
      texto: 'Agrego que la factura está adjunta',
    });
    expect(result.texto).toBe('Agrego que la factura está adjunta');
  });

  it('rechaza texto vacío y texto excedido', () => {
    expect(() =>
      agregarMensajeATicketInputSchema.parse({
        ticketId: '69fdef7eb24d4156c5998df8',
        texto: '',
      }),
    ).toThrow();
    expect(() =>
      agregarMensajeATicketInputSchema.parse({
        ticketId: '69fdef7eb24d4156c5998df8',
        texto: 'x'.repeat(2001),
      }),
    ).toThrow();
  });
});
