# Tikora — Modelo de Datos (MongoDB)

> Definición completa de las colecciones de MongoDB que componen la persistencia de Tikora: schemas Mongoose, tipos de campos, relaciones, índices y reglas de integridad. Es la **fuente de verdad** del modelo de datos. Cualquier campo que aparezca en el backend debe estar listado acá.

---

## 1. Convenciones

- **ID:** `_id: ObjectId` interno; el backend lo serializa como `id: string` en la API.
- **Tenant:** toda colección de dominio lleva `tenantId: ObjectId`. La única excepción es `tenants`. Toda query DEBE filtrar por `tenantId`.
- **Timestamps:** todas las colecciones tienen `createdAt` y `updatedAt` (Mongoose `{ timestamps: true }`).
- **Soft delete:** entidades que admiten baja lógica usan `active: boolean` o `deletedAt: Date | null`. No se hace hard delete salvo en jobs de mantenimiento (KB versiones >30 días).
- **Enums:** se definen como `string` con `enum: [...]` y se validan en el schema Zod compartido (`@tikora/core`).
- **Referencias:** siempre `ObjectId`. No se desnormalizan datos del padre salvo casos justificados (ver §3.7 ticket history).
- **Índices:** todos los listados en cada sección se crean en migraciones idempotentes al arrancar el backend.

---

## 2. Inventario de colecciones

| Colección                 | Propósito                                                 | Volumen esperado                         |
| ------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `tenants`                 | Configuración por empresa cliente.                        | 1 en MVP, decenas en SaaS.               |
| `users`                   | Empleados, agentes, líderes y administradores.            | Miles por tenant.                        |
| `refresh_tokens`          | Refresh tokens emitidos, con cadena de rotación.          | 5–10× usuarios activos.                  |
| `sse_tickets`             | Tickets de un solo uso para abrir SSE (TTL 90 s).         | Vive en Redis preferentemente; ver §3.4. |
| `areas`                   | Áreas funcionales del tenant.                             | Decenas.                                 |
| `tickets`                 | Tickets de soporte.                                       | El recurso más alto en volumen.          |
| `interactions`            | Mensajes/notas/eventos cronológicos de cada ticket.       | ~5–20× tickets.                          |
| `attachments`             | Metadata de archivos adjuntos (el binario en filesystem). | ~0–5× tickets.                           |
| `classifications`         | Resultado de cada clasificación IA.                       | 1 por ticket clasificado.                |
| `kb_documents`            | Documentos de la base de conocimiento.                    | Decenas a centenas.                      |
| `kb_chunks`               | Chunks vectorizados (Atlas Vector Search).                | ~10–100× documentos.                     |
| `ai_responses`            | Respuestas auto-generadas (Fase 2+).                      | 1 por ticket auto-respondido.            |
| `notifications`           | Notificaciones para la campanita y la página.             | Mismo orden que tickets × destinatarios. |
| `feedback_classification` | Feedback de agentes sobre clasificación IA.               | Subconjunto de tickets.                  |
| `audit_log`               | Acciones administrativas auditadas.                       | Eventos puntuales.                       |
| `ai_call_logs`            | Log estructurado de cada llamada al SDK de Anthropic.     | Idem clasificaciones + auto-respuestas.  |

---

## 3. Schemas detallados

### 3.1 `tenants`

```typescript
{
  _id: ObjectId,
  name: string,                          // "Empresa Demo"
  domainAliases: string[],               // ["empresa.com"] — futuro multi-tenant
  active: boolean,
  settings: {
    timezone: string,                    // "America/Argentina/Buenos_Aires"
    businessHoursStart: string,          // "07:00"
    businessHoursEnd: string,            // "18:00"
    slaReopenGraceDays: number,          // 5
    slaAutoCloseDays: number,            // N días hábiles tras cerrado para invalidar reapertura
    umbralConfianzaClasificacion: number,// 0.7
    umbralRelevanciaKb: number,          // 0.75
    umbralAutoAutonoma: number,          // 0.9 (Fase 3)
    autoAutonomaSampleRate: number,      // 0.1 (Fase 3)
    classificationPromptVersion: string, // "v1"
    responsePromptVersion: string,       // "v1"
    promptCacheEnabled: boolean,
    monthlyBudgetUsd: number | null
  },
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ name: 1 }` único.
- `{ "domainAliases": 1 }` para resolver tenant por email del usuario al login.

**Reglas:**

- En MVP existe un único tenant; su `_id` se inyecta vía env `DEFAULT_TENANT_ID`.
- Los campos de `settings` tienen defaults globales en código; la colección sobrescribe si está poblado.

---

### 3.2 `users`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  email: string,                         // único por tenant
  fullName: string,
  passwordHash: string,                  // bcryptjs, 10 rounds
  role: 'empleado' | 'agente' | 'lider' | 'admin',
  areaIds: ObjectId[],                   // áreas a las que pertenece (agente/líder)
  active: boolean,
  mustChangePassword: boolean,           // true tras alta o reset
  lastLoginAt: Date | null,
  failedLoginAttempts: number,
  lockedUntil: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ tenantId: 1, email: 1 }` único.
- `{ tenantId: 1, role: 1, active: 1 }` para listados.
- `{ tenantId: 1, areaIds: 1 }` para resolver agentes de un área.

**Reglas:**

- `passwordHash` nunca viaja al cliente. Se excluye explícitamente en la serialización.
- `role: 'admin'` y `role: 'lider'` son exclusivos de `ADM` para asignar.
- `areaIds` debe estar vacío si `role` es `empleado`.
- `failedLoginAttempts` se incrementa en login fallido; `lockedUntil` bloquea login hasta esa fecha tras N intentos (ver `tikora-backend.md` §10).

---

### 3.3 `refresh_tokens`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  userId: ObjectId,
  tokenHash: string,                     // sha256 del JWT (no se guarda el JWT)
  issuedAt: Date,
  expiresAt: Date,
  revokedAt: Date | null,
  replacedById: ObjectId | null,         // apunta al refresh nuevo tras rotación
  userAgent: string | null,
  ip: string | null
}
```

**Índices:**

- `{ tokenHash: 1 }` único.
- `{ userId: 1, revokedAt: 1 }` para invalidar la cadena.
- `{ expiresAt: 1 }` con TTL de Mongo (se eliminan automáticamente al expirar + 7 días para auditar).

**Reglas:**

- Cada `POST /auth/refresh` exitoso:
  1. Marca el actual como `revokedAt: now`, `replacedById: <nuevo>`.
  2. Crea uno nuevo.
- Si llega un refresh con `revokedAt !== null` y `replacedById !== null`: se interpreta como **reuso** (token comprometido). Se invalida toda la cadena del usuario (`revokedAt: now` para todos sus refresh activos) y se fuerza login.

---

### 3.4 `sse_tickets`

**Recomendación: usar Redis** con clave `sse-ticket:<ticketId>` y TTL 90 s. El payload almacena `{ userId, tenantId, used: false }`.

Si se usa Mongo (alternativa):

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  userId: ObjectId,
  ticketHash: string,
  expiresAt: Date,                       // TTL index
  usedAt: Date | null
}
```

**Índices:**

- `{ ticketHash: 1 }` único.
- `{ expiresAt: 1 }` con `expireAfterSeconds: 0` (Mongo elimina automáticamente).

**Decisión preferida:** Redis. Bajo volumen, alta rotación, TTL nativo.

---

### 3.5 `areas`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  name: string,
  description: string,
  agentIds: ObjectId[],
  leaderIds: ObjectId[],
  slas: {
    alta: number,                        // horas hábiles
    media: number,
    baja: number
  },
  active: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ tenantId: 1, name: 1 }` único entre activas.
- `{ tenantId: 1, leaderIds: 1 }`.

**Reglas:**

- Soft-delete vía `active: false`. No se permite borrar un área con tickets en estados no terminales.
- `agentIds` y `leaderIds` son la fuente de verdad para permisos a nivel de área. `users.areaIds` se mantiene en sincronía como índice inverso.

---

### 3.6 `tickets`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  shortCode: string,                     // "TIK-1234" por tenant, monotónico
  requesterId: ObjectId,
  asunto: string,                        // 5–120 chars
  cuerpo: string,                        // 10–5000 chars
  estado: 'recibido' | 'clasificado' | 'requiere_revision_clasificacion'
        | 'escalado' | 'en_progreso' | 'cerrado' | 'reabierto' | 'cancelado',
  prioridad: 'alta' | 'media' | 'baja' | null,  // null hasta clasificación
  areaId: ObjectId | null,               // null hasta clasificación
  classificationId: ObjectId | null,
  autoResponseId: ObjectId | null,
  assignedAgentId: ObjectId | null,
  lastAssignedAgentId: ObjectId | null,  // se preserva tras cierre para reaperturas
  attachmentIds: ObjectId[],
  tags: string[],                        // copiados de la clasificación + manuales
  slaDeadline: Date | null,
  resolutionType: 'manual' | 'auto' | null,
  resolvedBy: ObjectId | null,
  resolvedAt: Date | null,
  cancelledBy: ObjectId | null,
  cancelledAt: Date | null,
  cancelReason: string | null,
  reopenCount: number,
  closedDefinitivelyAt: Date | null,     // tras vencer slaAutoCloseDays
  classificationFeedbackId: ObjectId | null,
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ tenantId: 1, shortCode: 1 }` único.
- `{ tenantId: 1, estado: 1, slaDeadline: 1 }` para bandejas con sort por SLA.
- `{ tenantId: 1, areaId: 1, estado: 1 }` para bandeja por área.
- `{ tenantId: 1, requesterId: 1, createdAt: -1 }` para "mis tickets".
- `{ tenantId: 1, assignedAgentId: 1, estado: 1 }` para "asignados a mí".
- `{ tenantId: 1, prioridad: 1, slaDeadline: 1 }`.
- Texto: `{ asunto: 'text', cuerpo: 'text' }` para búsqueda. Idioma `spanish`.

**Reglas:**

- Cada transición de `estado` pasa por `TicketStateMachineService`. El controller nunca toca `estado` directamente.
- `slaDeadline` se calcula al pasar a `escalado` o `en_progreso` (lo que ocurra primero), en función de `prioridad` y `area.slas` y el calendario hábil del tenant.
- `shortCode` se genera atómicamente con un counter por tenant (colección `counters` o atomic `$inc` en `tenants.settings`).
- Multi-tenant isolation: ninguna query devuelve un ticket de otro `tenantId`.

---

### 3.7 `interactions`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId,
  type: 'usuario' | 'agente' | 'ia' | 'sistema',
  authorId: ObjectId | null,             // null cuando type === 'sistema' o 'ia'
  content: string,
  metadata: {                            // depende del type
    // type === 'sistema'
    eventName?: string,                  // "TicketEscalated", "TicketAssigned", ...
    fromEstado?: string,
    toEstado?: string,
    extra?: Record<string, unknown>,

    // type === 'ia'
    purpose?: 'classification' | 'auto-response',
    aiCallLogId?: ObjectId,

    // type === 'agente'
    enviadoPorCorreo?: boolean,
    correoMessageId?: string,

    // type === 'usuario'
    canal?: 'plataforma' | 'correo'
  },
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, ticketId: 1, createdAt: 1 }` para timeline.
- `{ tenantId: 1, authorId: 1, createdAt: -1 }`.

**Reglas:**

- Las interacciones son **append-only**. No se editan ni se eliminan.
- `type: 'sistema'` y `'ia'` solo las crea el backend.
- El renderizado en UI viene de `tikora-frontend.md` §6.2.

---

### 3.8 `attachments`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId,
  uploaderId: ObjectId,
  originalName: string,
  storedName: string,                    // nombre interno (uuid + ext)
  mimeType: string,
  sizeBytes: number,
  storagePath: string,                   // "uploads/<tenantId>/<ticketId>/<storedName>"
  storageProvider: 'local',              // espacio para "s3" en el futuro
  checksum: string,                      // sha256 del archivo
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, ticketId: 1 }`.
- `{ checksum: 1 }` para detectar duplicados eventuales.

**Reglas:**

- Tipos permitidos: PDF, PNG, JPG, JPEG, GIF, WEBP, TXT, CSV, XLSX, DOCX.
- Tamaño máx: 10 MB por archivo. Cantidad máx: 5 por ticket.
- Validación en backend (multer/pipe Zod) y en frontend antes de subir.
- Eliminar adjunto borra el binario del filesystem y la metadata.

---

### 3.9 `classifications`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId,
  area: string,                          // ID del área devuelto por la IA
  prioridad: 'alta' | 'media' | 'baja',
  confianza: number,                     // 0–1
  resumen: string,                       // ≤200 chars
  tags: string[],                        // ≤5 elementos
  modelo: string,                        // "claude-haiku-4-5-20251001"
  promptVersion: string,                 // "v1"
  temperature: number,
  tokensInput: number,
  tokensInputCached: number,
  tokensOutput: number,
  latencyMs: number,
  retries: number,
  outcome: 'ok' | 'low_confidence' | 'invalid_area' | 'validation_failure'
         | 'api_error' | 'content_insufficient',
  outcomeDetail: string | null,
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, ticketId: 1, createdAt: -1 }`.
- `{ tenantId: 1, outcome: 1, createdAt: -1 }`.
- `{ tenantId: 1, modelo: 1, promptVersion: 1 }` para A/B de prompts.

**Reglas:**

- Inmutable. Si el humano corrige la clasificación, se persiste en `feedback_classification`, no se reescribe acá.
- Cada `Classification` referencia opcionalmente al `ai_call_logs` original (FK soft).

---

### 3.10 `kb_documents`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  title: string,                         // 3–200 chars
  content: string,                       // markdown o texto plano, ≤200 KB
  scope: 'global' | 'area',
  areaIds: ObjectId[],                   // requerido si scope === 'area'
  version: number,                       // entero, comienza en 1
  active: boolean,                       // solo una versión activa por documento
  uploadedBy: ObjectId,
  parentDocumentId: ObjectId | null,     // misma "lógica" pero versiones distintas comparten parentId
  deletedAt: Date | null,
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ tenantId: 1, parentDocumentId: 1, version: -1 }`.
- `{ tenantId: 1, scope: 1, areaIds: 1, active: 1 }`.

**Reglas:**

- "Documento" es el conjunto de versiones que comparten `parentDocumentId`. La versión `1` tiene `parentDocumentId = _id`.
- Editar crea una versión nueva: `parentDocumentId` se preserva, `version + 1`, anterior pasa a `active: false`.
- Activar manualmente una versión vieja (rollback admin) marca esa como `active: true` y todas las demás del mismo `parentDocumentId` como `active: false`.

---

### 3.11 `kb_chunks`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  documentId: ObjectId,                  // referencia a la versión específica
  parentDocumentId: ObjectId,            // facilita queries por "documento" lógico
  documentVersion: number,
  position: number,                      // 0-based
  content: string,
  embedding: number[],                   // 384 floats (multilingual-e5-small)
  scope: 'global' | 'area',              // copiado del doc padre
  areaIds: ObjectId[],                   // copiados
  active: boolean,                       // espejo de kb_documents.active
  createdAt: Date
}
```

**Índices Mongo regulares:**

- `{ tenantId: 1, documentId: 1, position: 1 }` único.
- `{ tenantId: 1, parentDocumentId: 1, active: 1 }`.

**Índice Atlas Vector Search** (`kb_chunks_vector`):

```json
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 384, "similarity": "cosine" },
    { "type": "filter", "path": "tenantId" },
    { "type": "filter", "path": "active" },
    { "type": "filter", "path": "scope" },
    { "type": "filter", "path": "areaIds" }
  ]
}
```

**Reglas:**

- Embeddings se generan con prefijo `passage:` al indexar (ver `tikora-embeddings.md` §3).
- `active` se actualiza en bulk junto con la transición de versión activa del documento padre.

---

### 3.12 `ai_responses`

Disponible desde Fase 2.

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId,
  estado: 'sugerida' | 'aprobada' | 'editada' | 'enviada' | 'descartada' | 'fallida',
  respondable: boolean,
  motivoNoRespondable: string | null,
  originalAiContent: string | null,
  content: string | null,                // texto final enviado o editado
  confianza: number,
  sourceChunks: Array<{
    chunkId: ObjectId,
    documentId: ObjectId,
    parentDocumentId: ObjectId,
    position: number,
    score: number,
    usedFor: string                      // descripción que dio la IA
  }>,
  modelo: string,
  promptVersion: string,
  temperature: number,
  tokensInput: number,
  tokensInputCached: number,
  tokensOutput: number,
  latencyMs: number,
  approvedBy: ObjectId | null,
  approvedAt: Date | null,
  editedBy: ObjectId | null,
  editedAt: Date | null,
  diffSummary: string | null,            // resumen del diff entre original y editado
  discardedBy: ObjectId | null,
  discardedAt: Date | null,
  discardReason: string | null,
  sentAt: Date | null,
  emailMessageId: string | null,
  failureReason: 'api_error' | 'validation_error' | null,
  failureDetail: string | null,
  reopenedAfterAutoResponse: boolean,
  createdAt: Date,
  updatedAt: Date
}
```

**Índices:**

- `{ tenantId: 1, ticketId: 1, createdAt: -1 }`.
- `{ tenantId: 1, estado: 1, createdAt: -1 }`.
- `{ tenantId: 1, modelo: 1, promptVersion: 1 }`.

**Reglas:**

- Al máximo una `ai_responses` activa por ticket. Si se descarta, se puede regenerar.
- `respondable: false` deja `content = null` y bloquea aprobación.
- `estado: 'fallida'` marca un intento de generación que agotó los retries del LLM
  (transitorios) o no respetó el schema esperado tras los reintentos correctivos.
  Es **audit-only**: deja `respondable: false`, `originalAiContent: null`, copia los
  `sourceChunks` recuperados de la KB y persiste `failureReason` + `failureDetail`
  para diagnóstico. No es accionable desde el panel del ticket
  (`GET /tickets/:id/ai-response` la ignora) y un admin queda notificado vía
  `AiResponseFailed`.

---

### 3.13 `notifications`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  recipientId: ObjectId,
  type: string,                          // EventName de tikora-events.md
  ticketId: ObjectId | null,
  payload: Record<string, unknown>,      // datos del evento (snapshot mínimo)
  read: boolean,
  readAt: Date | null,
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, recipientId: 1, read: 1, createdAt: -1 }`.
- `{ tenantId: 1, recipientId: 1, type: 1, createdAt: -1 }`.

**Reglas:**

- Se crea en sincronía con la emisión del evento de dominio.
- El payload guarda lo mínimo para renderizar la notificación sin tocar otras colecciones (snapshot).

---

### 3.14 `feedback_classification`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId,
  classificationId: ObjectId,
  authorId: ObjectId,
  veredicto: 'correcta' | 'area_incorrecta' | 'prioridad_incorrecta' | 'ambas_incorrectas',
  areaCorrectaId: ObjectId | null,
  prioridadCorrecta: 'alta' | 'media' | 'baja' | null,
  comentario: string | null,
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, ticketId: 1 }` único (un feedback por ticket; se sobrescribe).
- `{ tenantId: 1, classificationId: 1 }`.
- `{ tenantId: 1, veredicto: 1, createdAt: -1 }`.

---

### 3.15 `audit_log`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  actorId: ObjectId,
  action: string,                        // "USER_CREATED", "AREA_DELETED", "THRESHOLDS_UPDATED", etc.
  resourceType: string,                  // "user" | "area" | "ticket" | "kb-document" | ...
  resourceId: ObjectId | null,
  diff: Record<string, { from: unknown, to: unknown }> | null,
  ip: string | null,
  userAgent: string | null,
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, createdAt: -1 }`.
- `{ tenantId: 1, actorId: 1, createdAt: -1 }`.
- `{ tenantId: 1, resourceType: 1, resourceId: 1, createdAt: -1 }`.

**Reglas:**

- Append-only. Se escribe desde un interceptor o decorator `@Audit(...)` aplicado a controllers admin.
- Acciones a auditar como mínimo: alta/baja/edición de usuarios, áreas, KB; cambio de umbrales y SLAs; activación de versión KB; cancelación admin de tickets de otros.

---

### 3.16 `ai_call_logs`

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  ticketId: ObjectId | null,
  purpose: 'classification' | 'auto-response' | 'review',
  modelo: string,
  promptVersion: string,
  temperature: number,
  maxTokens: number,
  tokensInput: number,
  tokensInputCached: number,
  tokensOutput: number,
  latencyMs: number,
  retries: number,
  outcome: 'ok' | 'validation_failure' | 'api_error' | 'refusal' | 'jailbreak_detected',
  errorCode: string | null,
  errorMessage: string | null,
  promptHash: string,                    // sha256 del prompt completo, para correlacionar
  responseHash: string,                  // idem de la respuesta
  costUsdEstimated: number,
  createdAt: Date
}
```

**Índices:**

- `{ tenantId: 1, createdAt: -1 }`.
- `{ tenantId: 1, purpose: 1, outcome: 1, createdAt: -1 }`.
- `{ tenantId: 1, ticketId: 1 }`.

**Reglas:**

- A nivel `info` se guarda lo de arriba. El **prompt y la respuesta completos** se loguean a nivel `debug` en archivo, nunca en Mongo (volumen).
- `costUsdEstimated` se calcula al cierre de la llamada con la tabla de pricing del modelo (configurable).

---

## 4. Counters auxiliares

### 4.1 `counters`

```typescript
{
  _id: string,                           // ej: "ticket-shortcode:<tenantId>"
  seq: number
}
```

Operación atómica:

```typescript
db.counters.findOneAndUpdate(
  { _id: `ticket-shortcode:${tenantId}` },
  { $inc: { seq: 1 } },
  { upsert: true, returnDocument: 'after' },
);
```

Resultado se formatea como `TIK-${seq}`.

---

## 5. Reglas globales de integridad

1. **Multi-tenant strict isolation.** Toda query de cualquier service va por `TenantAwareRepository` que inyecta `{ tenantId }` automáticamente. Tests de fast-check generan IDs cruzados y verifican que jamás se devuelven datos de otro tenant.
2. **Append-only para historiales.** `interactions`, `audit_log`, `ai_call_logs`, `classifications`, `ai_responses` (campos de decisión humana son los únicos updateables).
3. **Soft delete por defecto.** `users`, `areas`, `kb_documents` usan `active`/`deletedAt`. Hard delete solo en jobs de mantenimiento programados.
4. **Estados de ticket.** `tickets.estado` solo cambia vía `TicketStateMachineService`. Cualquier write directo en repositorios debe pasar por el service correspondiente.
5. **Referencias cruzadas.** No se borra nada que tenga referencias activas (ej. área con tickets en `escalado`/`en_progreso`).
6. **Encoding.** Strings se almacenan en UTF-8. `email` se normaliza a minúsculas antes de persistir.

---

## 6. Migraciones e inicialización

- Migraciones en `apps/back/src/migrations/<nnnn>-<descripcion>.ts`.
- Cada migración es **idempotente**: chequea estado y aplica solo si falta.
- Al arrancar el backend (no en cada request), se ejecutan migraciones pendientes.
- Migraciones cubren:
  - Creación de índices (incluye los Atlas Vector Search vía API si está disponible, o pre-requisito manual con doc en `tikora-setup.md`).
  - Seeds: `Tenant` por defecto, `User` admin inicial (configurable por env), 0 áreas (las crea el admin).
  - Migración de datos cuando un campo cambia de shape.

---

## 7. Reglas para implementadores

- Cada colección nueva se documenta primero acá, luego se crea el schema Mongoose.
- Cada índice nuevo se agrega como migración. **No** se confía en `autoIndex` de Mongoose en producción.
- Los tipos TypeScript del lado del backend se derivan del schema Zod de `@tikora/core` cuando aplican (entidades visibles en API), o se declaran como interface si son internos (counters, ai_call_logs).
- Cualquier renombre de campo se hace con migración + tests, nunca solo en código.
