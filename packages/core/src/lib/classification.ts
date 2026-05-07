import { z } from 'zod';
import { prioridadSchema } from './tickets';

/**
 * Salida estructurada esperada del modelo de clasificación.
 * Match con `tikora-ia.md` §5.3. Validamos esto sobre el JSON que devuelve
 * la IA antes de transicionar el ticket; si falla, el job reintenta con
 * un prompt correctivo y luego cae al fallback humano.
 */
export const classificationOutputSchema = z.object({
  area: z.string().min(1, 'El area es obligatoria'),
  prioridad: prioridadSchema,
  confianza: z.number().min(0).max(1),
  resumen: z.string().min(1).max(200),
  tags: z.array(z.string().min(1)).max(5),
});
export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

/** Outcome de cada intento de clasificación, según `tikora-data-model.md` §3.9. */
export const classificationOutcomeSchema = z.enum([
  'ok',
  'low_confidence',
  'invalid_area',
  'validation_failure',
  'api_error',
  'content_insufficient',
]);
export type ClassificationOutcome = z.infer<typeof classificationOutcomeSchema>;
