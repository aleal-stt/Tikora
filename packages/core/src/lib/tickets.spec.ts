import {
  cancelTicketSchema,
  classifyTicketSchema,
  createTicketSchema,
  estadoTicketSchema,
  prioridadSchema,
  resolveTicketSchema,
} from './tickets';

describe('tickets contracts', () => {
  describe('createTicketSchema', () => {
    it('rechaza asunto corto', () => {
      const result = createTicketSchema.safeParse({ asunto: 'hola', cuerpo: 'Cuerpo válido aquí' });
      expect(result.success).toBe(false);
    });

    it('rechaza cuerpo muy largo', () => {
      const result = createTicketSchema.safeParse({
        asunto: 'Asunto válido',
        cuerpo: 'a'.repeat(5001),
      });
      expect(result.success).toBe(false);
    });

    it('trimea asunto y cuerpo', () => {
      const parsed = createTicketSchema.parse({
        asunto: '  Asunto válido aquí  ',
        cuerpo: '  Cuerpo válido con contenido  ',
      });
      expect(parsed.asunto).toBe('Asunto válido aquí');
      expect(parsed.cuerpo).toBe('Cuerpo válido con contenido');
    });
  });

  describe('classifyTicketSchema', () => {
    it('exige areaId y prioridad', () => {
      expect(classifyTicketSchema.safeParse({ areaId: 'a1' }).success).toBe(false);
    });

    it('acepta motivo opcional', () => {
      const parsed = classifyTicketSchema.parse({ areaId: 'a1', prioridad: 'alta' });
      expect(parsed.motivo).toBeUndefined();
    });
  });

  describe('cancelTicketSchema / resolveTicketSchema', () => {
    it('cancel exige motivo no vacío', () => {
      expect(cancelTicketSchema.safeParse({ motivo: '   ' }).success).toBe(false);
    });

    it('resolve por defecto no envía correo', () => {
      const parsed = resolveTicketSchema.parse({ nota: 'OK' });
      expect(parsed.enviarPorCorreo).toBe(false);
    });
  });

  describe('estadoTicketSchema / prioridadSchema', () => {
    it('valida los 8 estados', () => {
      [
        'recibido',
        'clasificado',
        'requiere_revision_clasificacion',
        'escalado',
        'en_progreso',
        'cerrado',
        'reabierto',
        'cancelado',
      ].forEach((e) => {
        expect(estadoTicketSchema.safeParse(e).success).toBe(true);
      });
    });

    it('rechaza prioridad inválida', () => {
      expect(prioridadSchema.safeParse('urgente').success).toBe(false);
    });
  });
});
