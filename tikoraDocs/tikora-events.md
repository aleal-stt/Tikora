# Tikora — Eventos de Dominio

> Catálogo de eventos de dominio que emite el backend, sus payloads, productores y consumidores. Es la fuente de verdad para:
>
> - Listeners internos (notificaciones, SLA, auto-respuesta, audit).
> - Eventos que viajan por SSE al frontend.
> - Persistencia en `interactions` cuando aplica.

---

## 1. Modelo

Tikora usa un **event bus interno** del backend (basado en `@nestjs/event-emitter` o un wrapper propio). Cuando un service termina una operación de dominio significativa emite un evento con un payload tipado. Listeners reaccionan de manera asíncrona.

### 1.1 Propiedades comunes

Todo evento incluye estas propiedades base, además de su payload específico:

```typescript
interface BaseDomainEvent<T extends string, P> {
  name: T; // identificador del evento, en PascalCase
  eventId: string; // uuid, único
  occurredAt: string; // ISO-8601
  tenantId: string;
  actorId: string | null; // null cuando lo emite el sistema
  payload: P;
}
```

Los listeners reciben el evento completo; el SSE serializa solo `name`, `occurredAt`, `payload` (más `id` como `Last-Event-ID`).

### 1.2 Naming

- `PascalCase`, en pasado: `TicketCreated`, no `CreateTicket`.
- Sin prefijo de namespace (el bus es plano dentro del tenant).
- Eventos que cambian estado del ticket usan el verbo asociado a la transición: `TicketEscalated`, `TicketTaken`, `TicketResolved`, etc.

### 1.3 Garantías

- **At-least-once** dentro de un proceso (los listeners pueden ejecutarse más de una vez ante reintentos). Los handlers deben ser idempotentes.
- **Orden parcial:** dentro de un mismo `ticketId`, los eventos se procesan en orden de emisión. Entre tickets distintos, no hay garantía de orden.
- **Persistencia:** los eventos no se persisten en una colección general (no es event sourcing). Lo que se persiste es el efecto: nueva interaction, notification, audit_log, etc.

---

## 2. Catálogo de eventos

| Nombre                               | Productor        | Persistencia                            | Va por SSE                                     |
| ------------------------------------ | ---------------- | --------------------------------------- | ---------------------------------------------- |
| `TicketCreated`                      | `tickets`        | `interactions` (sistema)                | ✅ al solicitante (auto-suscrito)              |
| `TicketClassificationRequested`      | `tickets`        | —                                       | —                                              |
| `TicketClassified`                   | `classification` | `interactions` (ia) + `classifications` | ✅ al solicitante y agentes del área           |
| `TicketClassificationFailed`         | `classification` | `interactions` (sistema)                | ✅ al admin (canal admin)                      |
| `TicketEscalated`                    | `tickets`        | `interactions` (sistema)                | ✅ a los agentes del área                      |
| `TicketRequiresClassificationReview` | `classification` | `interactions` (sistema)                | ✅ a líderes del área (o admin si no hay área) |
| `TicketClassificationOverridden`     | `tickets`        | `interactions` (sistema)                | ✅ a agentes del área nueva                    |
| `TicketTaken`                        | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `TicketAssigned`                     | `tickets`        | `interactions` (sistema)                | ✅ al agente nuevo                             |
| `TicketAreaReassigned`               | `tickets`        | `interactions` (sistema)                | ✅ a agentes del área nueva                    |
| `TicketUpdated`                      | `tickets`        | `interactions` (sistema) cuando aplica  | ✅ a participantes del ticket                  |
| `TicketResolved`                     | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `TicketCancelled`                    | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `TicketReopened`                     | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `TicketClosedDefinitively`           | `sla`            | `interactions` (sistema)                | —                                              |
| `InteractionAdded`                   | `tickets`        | — (la interaction ya está)              | ✅ a participantes                             |
| `AttachmentAdded`                    | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `AttachmentDeleted`                  | `tickets`        | `interactions` (sistema)                | ✅                                             |
| `SlaApproaching`                     | `sla`            | `notifications`                         | ✅ al agente asignado                          |
| `SlaBreach`                          | `sla`            | `notifications`                         | ✅ al líder del área                           |
| `AiResponseGenerationRequested`      | `auto-response`  | —                                       | —                                              |
| `AiResponseSuggested`                | `auto-response`  | `ai_responses`                          | ✅ a agentes del área (Fase 2)                 |
| `AiResponseApproved`                 | `auto-response`  | `interactions` (agente)                 | ✅                                             |
| `AiResponseSent`                     | `auto-response`  | `interactions` (sistema)                | ✅ al solicitante                              |
| `AiResponseDiscarded`                | `auto-response`  | `interactions` (agente)                 | ✅                                             |
| `AiResponseFailed`                   | `auto-response`  | `interactions` (sistema)                | ✅ al admin                                    |
| `KbDocumentCreated`                  | `kb`             | —                                       | —                                              |
| `KbDocumentUpdated`                  | `kb`             | —                                       | —                                              |
| `KbDocumentDeleted`                  | `kb`             | —                                       | —                                              |
| `KbDocumentReindexed`                | `kb`             | —                                       | —                                              |
| `UserCreated`                        | `users`          | `audit_log`                             | —                                              |
| `UserUpdated`                        | `users`          | `audit_log`                             | —                                              |
| `UserDeactivated`                    | `users`          | `audit_log`                             | —                                              |
| `AreaCreated`                        | `areas`          | `audit_log`                             | —                                              |
| `AreaUpdated`                        | `areas`          | `audit_log`                             | —                                              |
| `AreaDeleted`                        | `areas`          | `audit_log`                             | —                                              |
| `ThresholdsUpdated`                  | `tenants`        | `audit_log`                             | —                                              |
| `NotificationCreated`                | `notifications`  | `notifications`                         | ✅                                             |
| `LoginSucceeded`                     | `auth`           | —                                       | —                                              |
| `LoginFailed`                        | `auth`           | —                                       | —                                              |
| `RefreshTokenReused`                 | `auth`           | `audit_log`                             | —                                              |

---

## 3. Detalle de payloads

### 3.1 Ciclo de vida del ticket

#### `TicketCreated`

```typescript
{
  ticketId: string,
  shortCode: string,
  requesterId: string,
  asunto: string,
  cuerpoSnippet: string,                 // primeros 280 chars del cuerpo
  attachmentCount: number
}
```

#### `TicketClassificationRequested`

Interno; encola job. Sin payload visible al cliente.

```typescript
{
  ticketId: string;
}
```

#### `TicketClassified`

```typescript
{
  ticketId: string,
  classificationId: string,
  areaId: string,
  prioridad: 'alta' | 'media' | 'baja',
  confianza: number,
  resumen: string,
  tags: string[],
  modelo: string,
  promptVersion: string
}
```

#### `TicketClassificationFailed`

```typescript
{
  ticketId: string,
  motivo: 'api_error' | 'validation_failure' | 'content_insufficient' | 'invalid_area',
  detalle: string,
  retries: number
}
```

#### `TicketRequiresClassificationReview`

```typescript
{
  ticketId: string,
  motivo: 'low_confidence' | 'invalid_area' | 'classification_failed',
  sugeridoAreaId: string | null,
  confianza: number | null
}
```

#### `TicketClassificationOverridden`

Cuando un humano corrige la clasificación de un ticket en `requiere_revision_clasificacion`.

```typescript
{
  ticketId: string,
  fromAreaId: string | null,
  toAreaId: string,
  fromPrioridad: string | null,
  toPrioridad: 'alta' | 'media' | 'baja',
  motivo: string | null
}
```

#### `TicketEscalated`

```typescript
{
  ticketId: string,
  areaId: string,
  prioridad: 'alta' | 'media' | 'baja',
  slaDeadline: string                    // ISO
}
```

#### `TicketTaken`

```typescript
{
  ticketId: string,
  agentId: string,
  areaId: string
}
```

#### `TicketAssigned`

Reasignación entre agentes del mismo área.

```typescript
{
  ticketId: string,
  fromAgentId: string | null,
  toAgentId: string,
  areaId: string
}
```

#### `TicketAreaReassigned`

```typescript
{
  ticketId: string,
  fromAreaId: string,
  toAreaId: string,
  motivo: string
}
```

#### `TicketUpdated`

Evento "paraguas" para cambios menores que no merecen un evento propio (edición de tags por agente, etc.).

```typescript
{
  ticketId: string,
  changes: Array<{ field: string, from: unknown, to: unknown }>
}
```

#### `TicketResolved`

```typescript
{
  ticketId: string,
  resolutionType: 'manual' | 'auto',
  resolvedBy: string | null,             // null si auto-respuesta autónoma
  notaSnippet: string | null
}
```

#### `TicketCancelled`

```typescript
{
  ticketId: string,
  cancelledBy: string,
  motivo: string
}
```

#### `TicketReopened`

```typescript
{
  ticketId: string,
  reopenedBy: string,
  motivo: string,
  toEstado: 'en_progreso' | 'escalado',
  toAgentId: string | null
}
```

#### `TicketClosedDefinitively`

Tras `slaAutoCloseDays` sin actividad.

```typescript
{
  ticketId: string,
  cerradoOriginalmenteAt: string         // ISO
}
```

---

### 3.2 Interacciones y adjuntos

#### `InteractionAdded`

```typescript
{
  ticketId: string,
  interactionId: string,
  type: 'usuario' | 'agente' | 'ia' | 'sistema',
  authorId: string | null,
  contentSnippet: string                 // primeros 280 chars
}
```

#### `AttachmentAdded`

```typescript
{
  ticketId: string,
  attachmentId: string,
  uploaderId: string,
  originalName: string,
  sizeBytes: number,
  mimeType: string
}
```

#### `AttachmentDeleted`

```typescript
{
  ticketId: string,
  attachmentId: string,
  deletedBy: string,
  originalName: string
}
```

---

### 3.3 SLA

#### `SlaApproaching`

Emitido cuando queda ≤25 % del SLA y aún no se notificó.

```typescript
{
  ticketId: string,
  agentId: string | null,
  areaId: string,
  prioridad: 'alta' | 'media' | 'baja',
  slaDeadline: string,
  remainingMinutes: number
}
```

#### `SlaBreach`

```typescript
{
  ticketId: string,
  areaId: string,
  agentId: string | null,
  leaderIds: string[],
  prioridad: 'alta' | 'media' | 'baja',
  slaDeadline: string,
  overdueMinutes: number
}
```

---

### 3.4 IA — auto-respuesta (Fase 2+)

#### `AiResponseGenerationRequested`

```typescript
{ ticketId: string, classificationId: string }
```

#### `AiResponseSuggested`

```typescript
{
  ticketId: string,
  aiResponseId: string,
  confianza: number,
  sourcesCount: number,
  modelo: string,
  promptVersion: string
}
```

#### `AiResponseApproved`

```typescript
{
  ticketId: string,
  aiResponseId: string,
  approvedBy: string,
  edited: boolean
}
```

#### `AiResponseSent`

```typescript
{
  ticketId: string,
  aiResponseId: string,
  sentTo: string,                        // email del solicitante
  emailMessageId: string,
  autonomous: boolean                    // true en Fase 3 sin paso humano
}
```

#### `AiResponseDiscarded`

```typescript
{
  ticketId: string,
  aiResponseId: string,
  discardedBy: string,
  motivo: string
}
```

#### `AiResponseFailed`

```typescript
{
  ticketId: string,
  motivo: 'kb_no_match' | 'api_error' | 'validation_failure' | 'refusal',
  detalle: string
}
```

---

### 3.5 KB

#### `KbDocumentCreated`

```typescript
{
  documentId: string,
  parentDocumentId: string,
  scope: 'global' | 'area',
  areaIds: string[]
}
```

#### `KbDocumentUpdated`

```typescript
{
  documentId: string,                    // versión nueva
  parentDocumentId: string,
  previousVersion: number,
  newVersion: number
}
```

#### `KbDocumentDeleted`

```typescript
{
  parentDocumentId: string,
  scope: 'global' | 'area',
  areaIds: string[]
}
```

#### `KbDocumentReindexed`

```typescript
{
  documentId: string,
  parentDocumentId: string,
  chunksGenerated: number,
  durationMs: number
}
```

---

### 3.6 Administración

#### `UserCreated` / `UserUpdated` / `UserDeactivated`

```typescript
// UserCreated
{ userId: string, email: string, role: string, areaIds: string[] }

// UserUpdated
{ userId: string, changes: Array<{ field: string, from: unknown, to: unknown }> }

// UserDeactivated
{ userId: string }
```

#### `AreaCreated` / `AreaUpdated` / `AreaDeleted`

```typescript
// AreaCreated
{ areaId: string, name: string, leaderIds: string[] }

// AreaUpdated
{ areaId: string, changes: Array<{ field: string, from: unknown, to: unknown }> }

// AreaDeleted
{ areaId: string }
```

#### `ThresholdsUpdated`

```typescript
{
  changes: Array<{
    key:
      | 'umbralConfianzaClasificacion'
      | 'umbralRelevanciaKb'
      | 'umbralAutoAutonoma'
      | 'autoAutonomaSampleRate';
    from: number;
    to: number;
  }>;
}
```

---

### 3.7 Notificaciones y auth

#### `NotificationCreated`

```typescript
{
  notificationId: string,
  recipientId: string,
  type: string,                          // EventName que la generó
  ticketId: string | null,
  payload: Record<string, unknown>
}
```

#### `LoginSucceeded`

```typescript
{ userId: string, ip: string | null, userAgent: string | null }
```

#### `LoginFailed`

```typescript
{
  emailIntento: string,
  motivo: 'invalid_credentials' | 'user_inactive' | 'locked',
  ip: string | null
}
```

#### `RefreshTokenReused`

```typescript
{ userId: string, tokenId: string, ip: string | null }
```

---

## 4. Mapeo evento → SSE

El frontend escucha estos eventos por el stream global. La tabla siguiente mapea cada evento que va por SSE a la reacción esperada en cliente. Coincide con `tikora-frontend.md` §4.7.

| Evento                                      | Acción en frontend                                                                                          |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `TicketCreated`                             | `invalidate(['tickets'])` + `invalidate(['tickets', 'me'])` (si el caller es el solicitante).               |
| `TicketClassified`                          | `invalidate(['ticket', id])` + `invalidate(['tickets'])`. Toast solo si el ticket está abierto en pantalla. |
| `TicketRequiresClassificationReview`        | Toast a líderes del área + invalidar bandeja de revisión.                                                   |
| `TicketEscalated`                           | Badge en bandeja del área.                                                                                  |
| `TicketTaken`                               | `invalidate(['ticket', id])`, `invalidate(['tickets'])`.                                                    |
| `TicketAssigned`                            | Toast al agente nuevo + `invalidate(['tickets'])`.                                                          |
| `TicketAreaReassigned`                      | `invalidate(['tickets'])` + toast a agentes del área nueva.                                                 |
| `TicketUpdated`                             | `invalidate(['ticket', id])`.                                                                               |
| `TicketResolved`                            | `invalidate(['ticket', id])` + `invalidate(['tickets'])` + toast al solicitante.                            |
| `TicketReopened`                            | Toast + `invalidate(['ticket', id])`.                                                                       |
| `InteractionAdded`                          | `invalidate(['ticket', id, 'interactions'])`.                                                               |
| `AttachmentAdded` / `AttachmentDeleted`     | `invalidate(['ticket', id])`.                                                                               |
| `SlaApproaching`                            | Toast amarillo + `invalidate` para refrescar el semáforo.                                                   |
| `SlaBreach`                                 | Toast rojo + `invalidate`.                                                                                  |
| `AiResponseSuggested`                       | Toast + badge en ticket + `invalidate(['ticket', id, 'ai-response'])`.                                      |
| `AiResponseApproved` / `Sent` / `Discarded` | `invalidate(['ticket', id])`.                                                                               |
| `NotificationCreated`                       | `useNotificationsStore.add(...)` + incrementa contador.                                                     |

**Filtro de visibilidad por usuario.** El backend decide a quién enviar cada evento según rol y áreas. El cliente recibe solo los eventos que le corresponden (no filtra al final).

---

## 5. Reglas para implementadores

- **Un solo emisor por evento.** Cada evento tiene un único productor (módulo). Otros módulos no lo emiten directamente.
- **Listeners idempotentes.** Mismo evento puede llegar dos veces; el handler debe tolerarlo (chequear estado antes de aplicar).
- **No llamar a otros módulos directamente desde un service.** Si un módulo tiene que reaccionar a un cambio, lo hace vía evento. Excepto inyección de servicios "horizontal" (`AiClientService`, `EmailService`).
- **Versión del payload:** si un payload necesita cambiar de shape, se agrega un evento nuevo (`TicketResolvedV2`), nunca se rompe el existente.
- **El SSE serializa solo lo que está documentado acá.** Nunca filtrar campos nuevos al cliente sin agregarlos al doc.
- **Notification spam:** un mismo evento dispara máximo una `notification` por destinatario. Deduplicar por `(recipientId, type, ticketId, día)` cuando aplique.
