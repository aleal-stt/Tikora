import { areaMetricsQuerySchema, areaMetricsResponseSchema } from './metrics';

describe('metrics contracts', () => {
  describe('areaMetricsQuerySchema', () => {
    it('acepta query vacía', () => {
      expect(areaMetricsQuerySchema.safeParse({}).success).toBe(true);
    });

    it('acepta from/to válidos', () => {
      const result = areaMetricsQuerySchema.safeParse({
        from: '2026-04-01T00:00:00.000Z',
        to: '2026-05-01T00:00:00.000Z',
      });
      expect(result.success).toBe(true);
    });

    it('rechaza fechas inválidas', () => {
      const result = areaMetricsQuerySchema.safeParse({ from: 'no-fecha' });
      expect(result.success).toBe(false);
    });

    it('rechaza from posterior a to', () => {
      const result = areaMetricsQuerySchema.safeParse({
        from: '2026-05-01T00:00:00.000Z',
        to: '2026-04-01T00:00:00.000Z',
      });
      expect(result.success).toBe(false);
    });
  });

  describe('areaMetricsResponseSchema', () => {
    it('valida un response válido con ai en null', () => {
      const result = areaMetricsResponseSchema.safeParse({
        areaId: 'a_1',
        rangeFrom: '2026-04-01T00:00:00.000Z',
        rangeTo: '2026-05-01T00:00:00.000Z',
        tickets: {
          total: 245,
          byEstado: {
            recibido: 3,
            clasificado: 0,
            requiere_revision_clasificacion: 0,
            escalado: 12,
            en_progreso: 18,
            cerrado: 210,
            reabierto: 0,
            cancelado: 2,
          },
          byPrioridad: { alta: 30, media: 110, baja: 105 },
        },
        sla: { complianceRate: 0.91, breachedTotal: 22 },
        ai: { classificationAccuracy: null, autoResponseApprovalRate: null },
        avgResolutionHours: 6.3,
      });
      expect(result.success).toBe(true);
    });

    it('rechaza complianceRate fuera de [0,1]', () => {
      const result = areaMetricsResponseSchema.safeParse({
        areaId: 'a_1',
        rangeFrom: '2026-04-01T00:00:00.000Z',
        rangeTo: '2026-05-01T00:00:00.000Z',
        tickets: {
          total: 0,
          byEstado: {
            recibido: 0,
            clasificado: 0,
            requiere_revision_clasificacion: 0,
            escalado: 0,
            en_progreso: 0,
            cerrado: 0,
            reabierto: 0,
            cancelado: 0,
          },
          byPrioridad: { alta: 0, media: 0, baja: 0 },
        },
        sla: { complianceRate: 1.5, breachedTotal: 0 },
        ai: { classificationAccuracy: null, autoResponseApprovalRate: null },
        avgResolutionHours: null,
      });
      expect(result.success).toBe(false);
    });
  });
});
