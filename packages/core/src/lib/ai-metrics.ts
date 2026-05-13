import { z } from 'zod';

/**
 * Métricas de uso de IA a nivel tenant. Sólo accesible para rol `admin`.
 * Fuente: colección `ai_call_logs` (append-only). Ver `tikora-ia.md` §12.2.
 *
 * El costo USD viene calculado por el back con tabla de pricing por modelo
 * (`apps/back/src/metrics/ai-pricing.ts`); el front recibe el número final
 * marcado como **estimado** porque depende del provider y free-tiers.
 */

const isoDate = z
  .string()
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Fecha inválida — usar ISO-8601');

export const aiMetricsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine((q) => !q.from || !q.to || Date.parse(q.from) <= Date.parse(q.to), {
    message: '`from` debe ser anterior o igual a `to`',
    path: ['from'],
  });
export type AiMetricsQuery = z.infer<typeof aiMetricsQuerySchema>;

export const aiCallPurposeSchema = z.enum(['classification', 'auto-response', 'review']);
export type AiCallPurpose = z.infer<typeof aiCallPurposeSchema>;

export const aiCallOutcomeSchema = z.enum(['ok', 'validation_failure', 'api_error']);
export type AiCallOutcome = z.infer<typeof aiCallOutcomeSchema>;

const tokensBucketSchema = z.object({
  input: z.number().int().nonnegative(),
  inputCached: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
});

const latencySchema = z.object({
  avgMs: z.number().nonnegative().nullable(),
  p95Ms: z.number().nonnegative().nullable(),
});

const totalsSchema = z.object({
  calls: z.number().int().nonnegative(),
  tokens: tokensBucketSchema,
  costUsd: z.number().nonnegative(),
  latency: latencySchema,
  retries: z.number().int().nonnegative(),
});

const byPurposeRowSchema = z.object({
  purpose: aiCallPurposeSchema,
  calls: z.number().int().nonnegative(),
  tokens: tokensBucketSchema,
  costUsd: z.number().nonnegative(),
  latencyAvgMs: z.number().nonnegative().nullable(),
});

const byModelRowSchema = z.object({
  modelo: z.string(),
  calls: z.number().int().nonnegative(),
  tokens: tokensBucketSchema,
  costUsd: z.number().nonnegative(),
  // `pricingKnown=false` significa que no había tabla de precios para ese
  // modelo y el costo se contó como 0 — útil para que el front muestre un
  // tag "sin pricing".
  pricingKnown: z.boolean(),
});

const byOutcomeSchema = z.object({
  ok: z.number().int().nonnegative(),
  validation_failure: z.number().int().nonnegative(),
  api_error: z.number().int().nonnegative(),
});

const timelinePointSchema = z.object({
  // Día en formato YYYY-MM-DD (UTC) — coincide con $dateTrunc del aggregate.
  date: z.string(),
  calls: z.number().int().nonnegative(),
  tokens: tokensBucketSchema,
  costUsd: z.number().nonnegative(),
});

export const aiMetricsResponseSchema = z.object({
  rangeFrom: z.string(),
  rangeTo: z.string(),
  totals: totalsSchema,
  byPurpose: z.array(byPurposeRowSchema),
  byModel: z.array(byModelRowSchema),
  byOutcome: byOutcomeSchema,
  timeline: z.array(timelinePointSchema),
});
export type AiMetricsResponse = z.infer<typeof aiMetricsResponseSchema>;
export type AiMetricsByPurposeRow = z.infer<typeof byPurposeRowSchema>;
export type AiMetricsByModelRow = z.infer<typeof byModelRowSchema>;
export type AiMetricsTimelinePoint = z.infer<typeof timelinePointSchema>;
