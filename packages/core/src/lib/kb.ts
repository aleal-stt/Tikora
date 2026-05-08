import { z } from 'zod';

/**
 * Schemas compartidos del módulo de Base de Conocimiento.
 * Match con `tikora-data-model.md` §3.10 (`kb_documents`) y
 * `tikora-core-schemas.md` §3.8. El backend valida los bodies con
 * `nestjs-zod` y el front los reusa en formularios con `zodResolver`.
 *
 * Convenciones del repo: camelCase para schemas, IDs como `z.string()`,
 * fechas como ISO-8601 en `z.string()` (sin `.datetime()` para no
 * romper inputs ya almacenados sin tz explícita).
 */

/**
 * Alcance del documento. `global` aplica a tickets de cualquier área del
 * tenant; `area` se restringe a las áreas listadas en `areaIds`.
 */
export const kbScopeSchema = z.enum(['global', 'area']);
export type KbScope = z.infer<typeof kbScopeSchema>;

/**
 * Límite duro de tamaño del cuerpo del documento. Se mide en bytes UTF-8
 * (no en chars) porque eso es lo que efectivamente persiste y serializa
 * Mongo. 200 KB cubre con margen los manuales reales sin entrar en territorio
 * que rompa el chunking ni el budget de embeddings (un doc de 200 KB son
 * ~50 chunks de 800 tokens — manejable).
 */
export const KB_MAX_BYTES = 200 * 1024;

/**
 * Validación reusable del cuerpo. Se exporta para que el backend pueda
 * derivar variantes (por ejemplo, una versión más laxa para reindex
 * forzado desde script).
 */
export const kbContentSchema = z
  .string()
  .min(1, 'El contenido no puede estar vacío')
  .refine(
    (s) => new TextEncoder().encode(s).byteLength <= KB_MAX_BYTES,
    `El documento excede el tamaño máximo de ${KB_MAX_BYTES / 1024} KB`,
  );

const kbTitleSchema = z
  .string()
  .transform((v) => v.trim())
  .pipe(
    z
      .string()
      .min(3, 'El título debe tener al menos 3 caracteres')
      .max(200, 'El título no puede superar los 200 caracteres'),
  );

/**
 * Forma completa del documento expuesta al cliente. `tenantId` se infiere
 * del contexto (JWT) y nunca viaja al cliente, igual que en el resto de
 * entidades del repo.
 */
export const kbDocumentSchema = z.object({
  id: z.string(),
  parentDocumentId: z.string(),
  title: z.string(),
  content: z.string(),
  scope: kbScopeSchema,
  areaIds: z.array(z.string()),
  version: z.number().int().min(1),
  active: z.boolean(),
  uploadedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type KbDocument = z.infer<typeof kbDocumentSchema>;

/**
 * Vista reducida para listados. Omite `content` para no inflar respuestas
 * (un listado de KB con 50 docs y 200 KB cada uno serían 10 MB de payload).
 */
export const kbDocumentListItemSchema = kbDocumentSchema.omit({ content: true });
export type KbDocumentListItem = z.infer<typeof kbDocumentListItemSchema>;

export const kbDocumentListResponseSchema = z.object({
  items: z.array(kbDocumentListItemSchema),
  nextCursor: z.string().nullable(),
});
export type KbDocumentListResponse = z.infer<typeof kbDocumentListResponseSchema>;

/**
 * Body de creación. La validación cruzada `scope === 'area' ⇒ areaIds.length ≥ 1`
 * vive acá (no en el backend) para que el front pueda mostrar el error de
 * formulario sin round-trip y porque es una invariante del contrato, no
 * de la persistencia.
 */
export const createKbDocumentSchema = z
  .object({
    title: kbTitleSchema,
    content: kbContentSchema,
    scope: kbScopeSchema,
    areaIds: z.array(z.string()).default([]),
  })
  .superRefine((data, ctx) => {
    if (data.scope === 'area' && data.areaIds.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaIds'],
        message: 'Documentos con scope área requieren al menos un área',
      });
    }
    if (data.scope === 'global' && data.areaIds.length > 0) {
      // Coherencia: si es global, areaIds debe estar vacío para no
      // confundir al lector del documento (¿se aplica a todos o solo a
      // los listados?). Forzamos vacío y el front lo refleja en el toggle.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaIds'],
        message: 'Documentos globales no pueden tener áreas asignadas',
      });
    }
  });
export type CreateKbDocument = z.infer<typeof createKbDocumentSchema>;

/**
 * Body de edición. **No permite cambiar `scope`** (decisión documentada en
 * `tikora-api.md` §9.2): cambiar scope implicaría reindexar con criterios
 * de visibilidad distintos y romper la trazabilidad de versiones del
 * mismo documento lógico. Si se necesita cambiar scope, hay que crear un
 * documento nuevo y archivar el viejo.
 */
export const updateKbDocumentSchema = z.object({
  title: kbTitleSchema,
  content: kbContentSchema,
  areaIds: z.array(z.string()).optional(),
});
export type UpdateKbDocument = z.infer<typeof updateKbDocumentSchema>;

/**
 * Item de historial de versiones. Más liviano que el documento completo —
 * para el listado en el drawer de "Versiones" no necesitamos el `content`.
 */
export const kbDocumentVersionItemSchema = kbDocumentSchema.omit({ content: true });
export type KbDocumentVersionItem = z.infer<typeof kbDocumentVersionItemSchema>;

export const kbDocumentVersionsResponseSchema = z.object({
  items: z.array(kbDocumentVersionItemSchema),
});
export type KbDocumentVersionsResponse = z.infer<typeof kbDocumentVersionsResponseSchema>;

/**
 * Catálogo local de eventos de dominio del módulo. Se mantiene separado
 * del `notificationEventTypeSchema` porque ninguno de estos eventos
 * dispara notificación al usuario (`tikora-events.md` §2). Sirven para
 * SSE técnico (refresh de UI mientras el job de indexación corre) y
 * auditoría.
 */
export const kbDocumentEventTypeSchema = z.enum([
  'KbDocumentCreated',
  'KbDocumentUpdated',
  'KbDocumentDeleted',
  'KbDocumentReindexed',
]);
export type KbDocumentEventType = z.infer<typeof kbDocumentEventTypeSchema>;
