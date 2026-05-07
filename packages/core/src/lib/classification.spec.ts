import { classificationOutputSchema } from './classification';

describe('classification contracts', () => {
  it('valida un output IA bien formado', () => {
    const result = classificationOutputSchema.safeParse({
      area: 'a_1',
      prioridad: 'media',
      confianza: 0.85,
      resumen: 'No puede acceder a la VPN.',
      tags: ['vpn', 'red'],
    });
    expect(result.success).toBe(true);
  });

  it('rechaza confianza fuera de rango', () => {
    const result = classificationOutputSchema.safeParse({
      area: 'a_1',
      prioridad: 'alta',
      confianza: 1.2,
      resumen: 'algo',
      tags: [],
    });
    expect(result.success).toBe(false);
  });

  it('rechaza más de 5 tags', () => {
    const result = classificationOutputSchema.safeParse({
      area: 'a_1',
      prioridad: 'baja',
      confianza: 0.5,
      resumen: 'algo',
      tags: ['a', 'b', 'c', 'd', 'e', 'f'],
    });
    expect(result.success).toBe(false);
  });

  it('rechaza resumen mayor a 200 chars', () => {
    const result = classificationOutputSchema.safeParse({
      area: 'a_1',
      prioridad: 'baja',
      confianza: 0.5,
      resumen: 'a'.repeat(201),
      tags: [],
    });
    expect(result.success).toBe(false);
  });
});
