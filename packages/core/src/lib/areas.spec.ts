import { createAreaSchema, slasSchema, updateAreaSchema, updateSlasSchema } from './areas';

describe('areas contracts', () => {
  describe('slasSchema', () => {
    it('rechaza horas no enteras', () => {
      const result = slasSchema.safeParse({ alta: 4.5, media: 24, baja: 48 });
      expect(result.success).toBe(false);
    });

    it('rechaza horas <= 0', () => {
      const result = slasSchema.safeParse({ alta: 0, media: 24, baja: 48 });
      expect(result.success).toBe(false);
    });

    it('acepta valores válidos', () => {
      const result = slasSchema.safeParse({ alta: 4, media: 24, baja: 48 });
      expect(result.success).toBe(true);
    });
  });

  describe('createAreaSchema', () => {
    it('trimea name y default description y leaderIds', () => {
      const parsed = createAreaSchema.parse({
        name: '  Soporte TI  ',
        slas: { alta: 4, media: 24, baja: 48 },
      });
      expect(parsed.name).toBe('Soporte TI');
      expect(parsed.description).toBe('');
      expect(parsed.leaderIds).toEqual([]);
    });

    it('rechaza nombre vacío', () => {
      const result = createAreaSchema.safeParse({
        name: '   ',
        slas: { alta: 4, media: 24, baja: 48 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('updateAreaSchema', () => {
    it('exige al menos un campo', () => {
      expect(updateAreaSchema.safeParse({}).success).toBe(false);
    });

    it('acepta solo description', () => {
      expect(updateAreaSchema.safeParse({ description: 'nueva' }).success).toBe(true);
    });
  });

  describe('updateSlasSchema', () => {
    it('exige las tres prioridades', () => {
      expect(updateSlasSchema.safeParse({ slas: { alta: 4, media: 24 } }).success).toBe(false);
    });
  });
});
