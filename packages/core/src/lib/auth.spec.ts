import { loginRequestSchema, roleSchema, userPublicSchema } from './auth';

describe('auth contracts', () => {
  describe('loginRequestSchema', () => {
    it('normaliza el email a lowercase y trim', () => {
      const parsed = loginRequestSchema.parse({
        email: '  Agente@Empresa.COM ',
        password: 'secret',
      });
      expect(parsed.email).toBe('agente@empresa.com');
    });

    it('rechaza emails inválidos', () => {
      const result = loginRequestSchema.safeParse({
        email: 'no-es-email',
        password: 'secret',
      });
      expect(result.success).toBe(false);
    });

    it('rechaza password vacío', () => {
      const result = loginRequestSchema.safeParse({
        email: 'a@b.com',
        password: '',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('roleSchema', () => {
    it('acepta solo los cuatro roles válidos', () => {
      expect(roleSchema.parse('empleado')).toBe('empleado');
      expect(roleSchema.parse('agente')).toBe('agente');
      expect(roleSchema.parse('lider')).toBe('lider');
      expect(roleSchema.parse('admin')).toBe('admin');
      expect(roleSchema.safeParse('superuser').success).toBe(false);
    });
  });

  describe('userPublicSchema', () => {
    it('valida la forma del usuario expuesto al cliente', () => {
      const parsed = userPublicSchema.parse({
        id: 'u_1',
        email: 'a@b.com',
        fullName: 'Juan',
        role: 'agente',
        areaIds: ['a_1', 'a_2'],
      });
      expect(parsed.areaIds).toEqual(['a_1', 'a_2']);
    });
  });
});
