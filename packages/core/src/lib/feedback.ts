import { z } from 'zod';
import { prioridadSchema } from './tickets';

/**
 * Schemas del módulo `feedback` — feedback estructurado del agente sobre
 * la clasificación de la IA. Match con `tikora-data-model.md` §3.14 y
 * `tikora-api.md` §14.
 *
 * El feedback alimenta el ciclo de mejora continua: dataset para ajustar
 * prompts y umbrales, y métricas de precisión que `MetricsService` usa
 * para reportar `classificationAccuracy`.
 */

export const feedbackVeredictoSchema = z.enum([
  'correcta',
  'area_incorrecta',
  'prioridad_incorrecta',
  'ambas_incorrectas',
]);
export type FeedbackVeredicto = z.infer<typeof feedbackVeredictoSchema>;

const baseFeedback = z.object({
  veredicto: feedbackVeredictoSchema,
  areaCorrectaId: z.string().min(1).nullable().optional(),
  prioridadCorrecta: prioridadSchema.nullable().optional(),
  comentario: z.string().trim().max(1000).nullable().optional(),
});

/**
 * Body de `POST /tickets/:id/classification-feedback`. Cuando el veredicto
 * no es `correcta`, los campos correspondientes pasan a ser obligatorios:
 *
 * - `area_incorrecta` → `areaCorrectaId` requerido.
 * - `prioridad_incorrecta` → `prioridadCorrecta` requerido.
 * - `ambas_incorrectas` → ambos requeridos.
 *
 * Si veredicto es `correcta`, los campos quedan ignorados (el back puede
 * normalizarlos a null).
 */
export const createClassificationFeedbackSchema = baseFeedback.superRefine((data, ctx) => {
  const requiresArea =
    data.veredicto === 'area_incorrecta' || data.veredicto === 'ambas_incorrectas';
  const requiresPrioridad =
    data.veredicto === 'prioridad_incorrecta' || data.veredicto === 'ambas_incorrectas';

  if (requiresArea && !data.areaCorrectaId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['areaCorrectaId'],
      message: 'Indicá el área correcta cuando el veredicto marca el área como incorrecta.',
    });
  }
  if (requiresPrioridad && !data.prioridadCorrecta) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['prioridadCorrecta'],
      message:
        'Indicá la prioridad correcta cuando el veredicto marca la prioridad como incorrecta.',
    });
  }
});
export type CreateClassificationFeedback = z.infer<typeof createClassificationFeedbackSchema>;

/**
 * Entidad pública. Sirve tanto al `POST` como al `GET`. `tenantId` no se
 * expone (igual que en el resto de schemas — se infiere del JWT).
 */
export const classificationFeedbackSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  classificationId: z.string(),
  authorId: z.string(),
  veredicto: feedbackVeredictoSchema,
  areaCorrectaId: z.string().nullable(),
  prioridadCorrecta: prioridadSchema.nullable(),
  comentario: z.string().nullable(),
  createdAt: z.string(),
});
export type ClassificationFeedback = z.infer<typeof classificationFeedbackSchema>;
