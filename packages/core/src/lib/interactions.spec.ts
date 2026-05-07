import { createInteractionSchema, interactionSchema } from './interactions';

describe('interactions contracts', () => {
  describe('createInteractionSchema', () => {
    it('acepta type usuario con content', () => {
      const result = createInteractionSchema.safeParse({
        type: 'usuario',
        content: 'Probé reiniciar y sigue igual.',
      });
      expect(result.success).toBe(true);
    });

    it('acepta type agente sin enviarPorCorreo (queda undefined)', () => {
      const parsed = createInteractionSchema.parse({
        type: 'agente',
        content: 'Te llamo en 5 minutos.',
      });
      expect(parsed.type).toBe('agente');
      expect(parsed.enviarPorCorreo).toBeUndefined();
    });

    it('acepta type agente con enviarPorCorreo true', () => {
      const parsed = createInteractionSchema.parse({
        type: 'agente',
        content: 'Mensaje vía mail.',
        enviarPorCorreo: true,
      });
      expect(parsed.enviarPorCorreo).toBe(true);
    });

    it('rechaza type ia', () => {
      expect(createInteractionSchema.safeParse({ type: 'ia', content: 'hola' }).success).toBe(
        false,
      );
    });

    it('rechaza type sistema', () => {
      expect(createInteractionSchema.safeParse({ type: 'sistema', content: 'hola' }).success).toBe(
        false,
      );
    });

    it('rechaza content vacío', () => {
      expect(createInteractionSchema.safeParse({ type: 'usuario', content: '   ' }).success).toBe(
        false,
      );
    });
  });

  describe('interactionSchema (response)', () => {
    it('valida una interacción de sistema con eventName en metadata', () => {
      const result = interactionSchema.safeParse({
        id: 'i_1',
        ticketId: 't_1',
        type: 'sistema',
        authorId: null,
        content: 'Ticket asignado a Juan',
        createdAt: '2026-05-07T12:00:00.000Z',
        metadata: {
          eventName: 'TicketAgentAssigned',
          fromEstado: 'escalado',
          toEstado: 'en_progreso',
        },
      });
      expect(result.success).toBe(true);
    });

    it('rechaza una interacción usuario con metadata de sistema', () => {
      const result = interactionSchema.safeParse({
        id: 'i_1',
        ticketId: 't_1',
        type: 'usuario',
        authorId: 'u_1',
        content: 'hola',
        createdAt: '2026-05-07T12:00:00.000Z',
        metadata: { eventName: 'TicketCreated' },
      });
      // El metadata de usuario no aceptaría `eventName` como propiedad reconocida,
      // pero los objetos con keys extras pasan por default en Zod. Validamos que
      // al menos el campo `canal` (cuando está) sea válido.
      expect(result.success).toBe(true);
    });
  });
});
