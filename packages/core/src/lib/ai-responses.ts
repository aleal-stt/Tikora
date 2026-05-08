import { z } from 'zod';

/**
 * Schemas compartidos del módulo de auto-respuesta. Cubren tanto:
 *
 * 1. La salida estructurada que devuelve el modelo de generación
 *    (`autoResponseOutputSchema`) — se valida apenas se recibe la
 *    respuesta del LLM, antes de persistir nada.
 * 2. La entidad `AiResponse` expuesta al cliente (`aiResponseSchema`).
 * 3. Los bodies de las acciones del agente (`approveWithChangesSchema`,
 *    `discardAiResponseSchema`).
 *
 * Match con `tikora-data-model.md` §3.12, `tikora-core-schemas.md` §3.9 y
 * `tikora-ia.md` §7.
 */

/**
 * Estados posibles del ciclo de vida de una respuesta IA.
 * - `sugerida`: la IA generó una propuesta y espera revisión humana (Fase 2).
 * - `aprobada`: el agente aprobó tal cual; pendiente de envío de correo.
 * - `editada`: el agente modificó el texto antes de aprobar.
 * - `enviada`: el correo salió y el ticket se cerró con `resolutionType:'auto'`.
 * - `descartada`: el agente la rechazó; el ticket vuelve a `escalado`.
 *
 * En Fase 3 una respuesta puede saltar de `sugerida` a `enviada` directamente
 * cuando supera `UMBRAL_AUTO_AUTONOMA` y no cae en el sampleo de QA.
 */
export const aiResponseEstadoSchema = z.enum([
  'sugerida',
  'aprobada',
  'editada',
  'enviada',
  'descartada',
]);
export type AiResponseEstado = z.infer<typeof aiResponseEstadoSchema>;

/**
 * Source que devuelve el modelo dentro de su JSON. `chunkIndex` es 1-based
 * y referencia el orden en el que le pasamos los fragmentos de KB en el
 * user message — el backend lo resuelve a `chunkId` real para persistir.
 *
 * `.strict()` defensivo: si el modelo agrega campos inventados, queremos
 * fallar la validación y reintentar con prompt correctivo en vez de
 * silenciar la divergencia.
 */
const autoResponseOutputSourceSchema = z
  .object({
    chunkIndex: z.number().int().min(1),
    usedFor: z.string().min(1).max(200),
  })
  .strict();

/**
 * Salida estructurada del LLM. Discriminated union por `respondable`:
 *
 * - `respondable: true` ⇒ tenemos respuesta lista; `sources` debe traer al
 *   menos una referencia (citarse a sí mismo es obligatorio para que la
 *   trazabilidad no quede vacía).
 * - `respondable: false` ⇒ el modelo determinó que la KB no alcanza para
 *   responder con confianza; persistimos el motivo y escalamos.
 *
 * Validar la unión completa antes de persistir es lo que nos protege de
 * "alucinar respondiendo sin fuentes": el modelo no puede mandar
 * `respondable: true` sin sources porque Zod lo rechaza.
 */
export const autoResponseOutputSchema = z.discriminatedUnion('respondable', [
  z
    .object({
      respondable: z.literal(true),
      respuesta: z.string().min(1),
      confianza: z.number().min(0).max(1),
      sources: z.array(autoResponseOutputSourceSchema).min(1),
    })
    .strict(),
  z
    .object({
      respondable: z.literal(false),
      motivo: z.string().min(1).max(500),
      confianza: z.number().min(0).max(1),
    })
    .strict(),
]);
export type AutoResponseOutput = z.infer<typeof autoResponseOutputSchema>;

/**
 * Source enriquecido tal como queda persistido y lo ve el cliente.
 * El backend lo arma juntando lo que devolvió el modelo (`usedFor`) con la
 * metadata real del chunk (`chunkId`, `documentTitle`, `contentSnippet`).
 *
 * `contentSnippet` es un recorte (≤280 chars) del chunk para mostrar el
 * preview en el panel de "Sugerencia IA" sin tener que pegar el chunk
 * completo en el payload del listado.
 */
export const aiResponseSourceSchema = z.object({
  chunkId: z.string(),
  documentId: z.string(),
  parentDocumentId: z.string(),
  position: z.number().int().min(0),
  score: z.number(),
  usedFor: z.string(),
  documentTitle: z.string(),
  contentSnippet: z.string(),
});
export type AiResponseSource = z.infer<typeof aiResponseSourceSchema>;

/**
 * Entidad pública. `tenantId` se omite (se infiere del JWT) por consistencia
 * con el resto de schemas del repo.
 *
 * Nota sobre `content`/`originalAiContent`:
 * - `originalAiContent` es lo que la IA propuso. Nunca se sobreescribe.
 * - `content` es el texto final enviado (puede coincidir con `originalAiContent`
 *   si se aprobó sin cambios, o ser distinto si se editó).
 * - Ambos `null` mientras `respondable === false` o antes de aprobar.
 */
export const aiResponseSchema = z.object({
  id: z.string(),
  ticketId: z.string(),
  estado: aiResponseEstadoSchema,
  respondable: z.boolean(),
  motivoNoRespondable: z.string().nullable(),
  originalAiContent: z.string().nullable(),
  content: z.string().nullable(),
  confianza: z.number(),
  sources: z.array(aiResponseSourceSchema),
  approvedBy: z.string().nullable(),
  approvedAt: z.string().nullable(),
  editedBy: z.string().nullable(),
  editedAt: z.string().nullable(),
  discardedBy: z.string().nullable(),
  discardedAt: z.string().nullable(),
  discardReason: z.string().nullable(),
  sentAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AiResponse = z.infer<typeof aiResponseSchema>;

/**
 * Body de `PATCH /ai-responses/:id/approve-with-changes`. El backend
 * persiste tanto `originalAiContent` como `content` y calcula el
 * `diffSummary` para el ciclo de mejora continua (`tikora-ia.md` §14).
 *
 * 10 000 chars cubre con holgura un correo largo bien formateado.
 */
export const approveWithChangesSchema = z.object({
  respuestaFinal: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(1, 'La respuesta final no puede estar vacía')
        .max(10_000, 'La respuesta final no puede superar los 10 000 caracteres'),
    ),
});
export type ApproveWithChanges = z.infer<typeof approveWithChangesSchema>;

/**
 * Body de `PATCH /ai-responses/:id/discard`. El motivo es obligatorio
 * porque alimenta el feedback humano del módulo de mejora continua —
 * un descarte sin motivo no nos sirve para refinar prompts ni KB.
 */
export const discardAiResponseSchema = z.object({
  motivo: z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(1, 'El motivo del descarte es obligatorio')
        .max(1000, 'El motivo no puede superar los 1000 caracteres'),
    ),
});
export type DiscardAiResponse = z.infer<typeof discardAiResponseSchema>;

/**
 * Catálogo local de eventos de dominio del módulo. Ver `tikora-events.md`
 * §3.4. Los eventos que disparan notificación al usuario (`Suggested`,
 * `Approved`, `Sent`, `Discarded`, `Failed`) deben además agregarse al
 * `notificationEventTypeSchema` en su sprint correspondiente — acá los
 * dejamos solo en el catálogo del módulo para no acoplar este sprint
 * con cambios en `notifications`.
 */
export const aiResponseEventTypeSchema = z.enum([
  'AiResponseGenerationRequested',
  'AiResponseSuggested',
  'AiResponseApproved',
  'AiResponseSent',
  'AiResponseDiscarded',
  'AiResponseFailed',
]);
export type AiResponseEventType = z.infer<typeof aiResponseEventTypeSchema>;
