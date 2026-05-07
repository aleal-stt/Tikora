import { z } from 'zod';
import { estadoTicketSchema, prioridadSchema } from './tickets';

const ticketsByEstadoSchema = z.object({
  recibido: z.number().int().nonnegative(),
  clasificado: z.number().int().nonnegative(),
  requiere_revision_clasificacion: z.number().int().nonnegative(),
  escalado: z.number().int().nonnegative(),
  en_progreso: z.number().int().nonnegative(),
  cerrado: z.number().int().nonnegative(),
  reabierto: z.number().int().nonnegative(),
  cancelado: z.number().int().nonnegative(),
});

const ticketsByPrioridadSchema = z.object({
  alta: z.number().int().nonnegative(),
  media: z.number().int().nonnegative(),
  baja: z.number().int().nonnegative(),
});

/**
 * Forma del response de `GET /areas/:id/metrics` (ver `tikora-api.md` §6.2).
 * Los campos de IA quedan `null` hasta que el módulo de clasificación esté
 * disponible — el cliente debe interpretar `null` como "todavía no medible".
 */
export const areaMetricsResponseSchema = z.object({
  areaId: z.string(),
  rangeFrom: z.string(),
  rangeTo: z.string(),
  tickets: z.object({
    total: z.number().int().nonnegative(),
    byEstado: ticketsByEstadoSchema,
    byPrioridad: ticketsByPrioridadSchema,
  }),
  sla: z.object({
    complianceRate: z.number().min(0).max(1).nullable(),
    breachedTotal: z.number().int().nonnegative(),
  }),
  ai: z.object({
    classificationAccuracy: z.number().min(0).max(1).nullable(),
    autoResponseApprovalRate: z.number().min(0).max(1).nullable(),
  }),
  avgResolutionHours: z.number().nonnegative().nullable(),
});
export type AreaMetricsResponse = z.infer<typeof areaMetricsResponseSchema>;

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida — usar ISO-8601');

export const areaMetricsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: '`from` debe ser anterior o igual a `to`',
    path: ['from'],
  });
export type AreaMetricsQuery = z.infer<typeof areaMetricsQuerySchema>;

export const ESTADO_LABELS = estadoTicketSchema.options;
export const PRIORIDAD_LABELS = prioridadSchema.options;
