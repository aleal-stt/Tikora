import { changePasswordSchema, createUserSchema, updateMeSchema, updateUserSchema } from './users';

describe('users contracts', () => {
  describe('createUserSchema', () => {
    it('normaliza el email y deja default vacío en areaIds', () => {
      const parsed = createUserSchema.parse({
        email: '  Nuevo@Empresa.COM ',
        fullName: ' Ana ',
        role: 'agente',
        temporaryPassword: 'Inicial2026',
      });
      expect(parsed.email).toBe('nuevo@empresa.com');
      expect(parsed.fullName).toBe('Ana');
      expect(parsed.areaIds).toEqual([]);
    });

    it('rechaza una temporaryPassword sin números', () => {
      const result = createUserSchema.safeParse({
        email: 'a@b.com',
        fullName: 'Ana',
        role: 'agente',
        temporaryPassword: 'sololetras',
      });
      expect(result.success).toBe(false);
    });

    it('rechaza una temporaryPassword corta', () => {
      const result = createUserSchema.safeParse({
        email: 'a@b.com',
        fullName: 'Ana',
        role: 'agente',
        temporaryPassword: 'Cort1',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateUserSchema', () => {
    it('exige al menos un campo', () => {
      const result = updateUserSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it('acepta una sola propiedad', () => {
      const result = updateUserSchema.safeParse({ active: false });
      expect(result.success).toBe(true);
    });
  });

  describe('updateMeSchema', () => {
    it('rechaza nombre vacío', () => {
      const result = updateMeSchema.safeParse({ fullName: '   ' });
      expect(result.success).toBe(false);
    });

    it('trimea el nombre antes de validar', () => {
      const parsed = updateMeSchema.parse({ fullName: '  Juan  ' });
      expect(parsed.fullName).toBe('Juan');
    });
  });

  describe('changePasswordSchema', () => {
    it('rechaza si la nueva contraseña iguala a la actual', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'MismaPass1',
        newPassword: 'MismaPass1',
      });
      expect(result.success).toBe(false);
    });

    it('acepta si las contraseñas son distintas y la nueva cumple la política', () => {
      const result = changePasswordSchema.safeParse({
        currentPassword: 'Vieja12345',
        newPassword: 'NuevaPass99',
      });
      expect(result.success).toBe(true);
    });
  });
});
