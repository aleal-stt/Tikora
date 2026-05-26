# Tikora — Inventario de API REST

> Contrato único de la API HTTP de Tikora. Todo endpoint que existe en el backend, su método, path, autenticación, roles, request, response y códigos de error. Es la **fuente de verdad** que consultan tanto backend como frontend (vía `@tikora/core` para los schemas).

---

## 1. Convenciones generales

- **Prefijo global:** `/api/v1`.
- **Auth por defecto:** todo endpoint requiere `Authorization: Bearer {accessToken}` salvo los marcados como `Public` o autenticados por **cookie** (refresh).
- **Tenant:** se resuelve siempre desde el JWT. Nunca se acepta `tenantId` en path/body/query.
- **IDs:** cadenas (string). El backend serializa `_id` de Mongo a `id` antes de responder.
- **Fechas:** ISO-8601 en UTC (`2026-05-06T14:23:11.000Z`).
- **Idioma:** mensajes de error visibles en español; identificadores y `code` en SCREAMING_SNAKE_CASE.
- **Content-Type:** `application/json` salvo en endpoints de adjuntos (`multipart/form-data`) y en el stream SSE (`text/event-stream`).
- **Códigos HTTP:**
  - `200` lectura/actualización exitosa.
  - `201` creación exitosa.
  - `204` éxito sin body.
  - `400` validación fallida (Zod).
  - `401` no autenticado.
  - `403` autenticado sin permisos.
  - `404` no encontrado.
  - `409` conflicto (transición inválida, duplicado, contención).
  - `422` archivo no aceptado (tipo/tamaño).
  - `429` rate limit superado.
  - `500` error interno.
- **Formato de error:**
  ```json
  {
    "statusCode": 409,
    "code": "TICKET_TRANSITION_INVALID",
    "message": "No se puede tomar un ticket cancelado.",
    "details": []
  }
  ```
- **Paginación:** cursor-based en listados. Query: `?cursor=<opaque>&limit=<n>` (limit por defecto 50, máx 100). Response:
  ```json
  { "items": [...], "nextCursor": "..." | null }
  ```
- **Filtros:** se pasan por querystring; arrays con repetición (`?estado=escalado&estado=en_progreso`).
- **Versionado:** breaking changes pasan a `/api/v2`.

---

## 2. Roles

| Sigla | Rol                                                                                       |
| ----- | ----------------------------------------------------------------------------------------- |
| `EMP` | Empleado solicitante                                                                      |
| `AGE` | Agente                                                                                    |
| `LID` | Líder de área                                                                             |
| `ADM` | Administrador                                                                             |
| `OWN` | Dueño del recurso (creador del ticket, dueño del perfil, etc.) — se evalúa además del rol |
| `*`   | Cualquier autenticado                                                                     |

**Convención:** la columna "Roles" lista quién puede llamar al endpoint. La columna "Alcance" precisa qué subconjunto de datos ve cada rol.

---

## 3. Auth (`/auth`)

| Método | Path               | Auth   | Roles | Descripción                                              |
| ------ | ------------------ | ------ | ----- | -------------------------------------------------------- |
| POST   | `/auth/login`      | Public | —     | Autentica con email + password. Setea cookie de refresh. |
| POST   | `/auth/refresh`    | Cookie | —     | Renueva access token. Rota la cookie.                    |
| POST   | `/auth/logout`     | Cookie | —     | Invalida refresh + limpia cookie.                        |
| POST   | `/auth/sse-ticket` | Bearer | `*`   | Emite ticket corto (60–120 s) para abrir el stream SSE.  |

### 3.1 `POST /auth/login`

**Request:**

```json
{ "email": "agente@empresa.com", "password": "..." }
```

**Response 200:**

```json
{
  "accessToken": "eyJhbGc...",
  "user": {
    "id": "u_123",
    "email": "agente@empresa.com",
    "fullName": "Juan Pérez",
    "role": "agente",
    "areaIds": ["a_1", "a_2"]
  }
}
```

- `Set-Cookie: tikora.refresh=...; HttpOnly; SameSite=Lax; Path=/api/v1/auth`.

**Errores:**

- `401 AUTH_INVALID_CREDENTIALS` — credenciales inválidas (mensaje genérico).
- `403 AUTH_USER_INACTIVE` — usuario desactivado.
- `429 RATE_LIMITED` — demasiados intentos.

### 3.2 `POST /auth/refresh`

**Request:** sin body. Lee cookie `tikora.refresh`.

**Response 200:**

```json
{ "accessToken": "eyJhbGc..." }
```

- `Set-Cookie` con refresh rotado.

**Errores:**

- `401 AUTH_REFRESH_INVALID` — cookie ausente, expirada o ya consumida.
- `401 AUTH_REFRESH_REUSED` — el refresh fue reutilizado (toda la cadena del usuario se invalida).

### 3.3 `POST /auth/logout`

**Response 204** + `Set-Cookie` que limpia la cookie.

### 3.4 `POST /auth/sse-ticket`

**Response 200:**

```json
{ "ticket": "eyJhbGc...", "expiresAt": "2026-05-06T14:25:11.000Z" }
```

El `ticket` se usa una sola vez en `?ticket=` al abrir el `EventSource`.

---

## 4. Health (`/health`)

| Método | Path      | Auth   | Roles | Descripción         |
| ------ | --------- | ------ | ----- | ------------------- |
| GET    | `/health` | Public | —     | Liveness/readiness. |

**Response 200:**

```json
{
  "status": "ok",
  "uptime": 1234.5,
  "checks": {
    "mongo": "ok",
    "redis": "ok",
    "llm": "ok"
  }
}
```

---

## 5. Usuarios (`/users`)

| Método | Path                 | Auth   | Roles       | Alcance                                                                     |
| ------ | -------------------- | ------ | ----------- | --------------------------------------------------------------------------- |
| GET    | `/users`             | Bearer | `LID` `ADM` | LID: agentes de sus áreas. ADM: todos del tenant.                           |
| GET    | `/users/:id`         | Bearer | `LID` `ADM` | Idem.                                                                       |
| POST   | `/users`             | Bearer | `LID` `ADM` | LID solo puede crear `agente` y asignarlo a sus áreas.                      |
| PATCH  | `/users/:id`         | Bearer | `LID` `ADM` | LID limitado a usuarios de sus áreas y sin cambio de rol a `lider`/`admin`. |
| DELETE | `/users/:id`         | Bearer | `ADM`       | Soft-delete (`active: false`).                                              |
| GET    | `/users/me`          | Bearer | `*`         | Perfil propio.                                                              |
| PATCH  | `/users/me`          | Bearer | `*`         | Edita `fullName` solamente.                                                 |
| PATCH  | `/users/me/password` | Bearer | `*`         | Cambia contraseña (requiere `currentPassword`).                             |

### 5.1 `POST /users`

**Request:**

```json
{
  "email": "nuevo@empresa.com",
  "fullName": "Ana Soto",
  "role": "agente",
  "areaIds": ["a_1"],
  "temporaryPassword": "..."
}
```

El backend manda correo de bienvenida con la contraseña temporal. El usuario debe cambiarla en el primer login (flag `mustChangePassword`).

**Response 201:** `UserSchema` (sin `passwordHash`).

**Errores:**

- `409 USER_EMAIL_DUPLICATE`.
- `403 USER_ROLE_FORBIDDEN` — el caller no puede asignar ese rol.
- `403 USER_AREA_FORBIDDEN` — el caller no lidera esas áreas.

### 5.2 `PATCH /users/me/password`

**Request:**

```json
{ "currentPassword": "...", "newPassword": "..." }
```

Reglas: ver §10 política de contraseñas.

---

## 6. Áreas (`/areas`)

| Método | Path                         | Auth   | Roles       | Alcance                                                                   |
| ------ | ---------------------------- | ------ | ----------- | ------------------------------------------------------------------------- |
| GET    | `/areas`                     | Bearer | `*`         | Todos los del tenant (vista pública limitada para EMP/AGE: `id`, `name`). |
| GET    | `/areas/:id`                 | Bearer | `LID` `ADM` | Detalle completo (incluye `agentIds`, `leaderIds`, `slas`).               |
| POST   | `/areas`                     | Bearer | `ADM`       | Crear área.                                                               |
| PATCH  | `/areas/:id`                 | Bearer | `ADM`       | Editar nombre, descripción.                                               |
| DELETE | `/areas/:id`                 | Bearer | `ADM`       | Soft-delete; falla si tiene tickets activos.                              |
| POST   | `/areas/:id/agents`          | Bearer | `LID` `ADM` | Agregar agente al área. LID: solo sus áreas.                              |
| DELETE | `/areas/:id/agents/:userId`  | Bearer | `LID` `ADM` | Quitar agente.                                                            |
| POST   | `/areas/:id/leaders`         | Bearer | `ADM`       | Agregar líder.                                                            |
| DELETE | `/areas/:id/leaders/:userId` | Bearer | `ADM`       | Quitar líder.                                                             |
| GET    | `/areas/:id/agents`          | Bearer | `LID` `ADM` | Lista de agentes del área.                                                |
| PATCH  | `/areas/:id/slas`            | Bearer | `LID` `ADM` | Actualizar SLAs `{alta, media, baja}` en horas hábiles.                   |
| GET    | `/areas/:id/metrics`         | Bearer | `LID` `ADM` | Métricas del área (LID solo si la lidera).                                |

### 6.1 `POST /areas`

**Request:**

```json
{
  "name": "Soporte TI",
  "description": "Tickets de hardware, software, accesos.",
  "leaderIds": ["u_1"],
  "slas": { "alta": 4, "media": 24, "baja": 48 }
}
```

**Response 201:** `AreaSchema`.

### 6.2 `GET /areas/:id/metrics`

**Query:** `?from=2026-04-01&to=2026-05-01`.

**Response 200:**

```json
{
  "areaId": "a_1",
  "rangeFrom": "2026-04-01T00:00:00.000Z",
  "rangeTo": "2026-05-01T00:00:00.000Z",
  "tickets": {
    "total": 245,
    "byEstado": {
      "recibido": 3,
      "escalado": 12,
      "en_progreso": 18,
      "cerrado": 210,
      "cancelado": 2
    },
    "byPrioridad": { "alta": 30, "media": 110, "baja": 105 }
  },
  "sla": {
    "complianceRate": 0.91,
    "breachedTotal": 22
  },
  "ai": {
    "classificationAccuracy": 0.88,
    "autoResponseApprovalRate": null
  },
  "avgResolutionHours": 6.3
}
```

---

## 7. Tickets (`/tickets`)

| Método | Path                              | Auth               | Roles                         | Alcance                                                                                                       |
| ------ | --------------------------------- | ------------------ | ----------------------------- | ------------------------------------------------------------------------------------------------------------- |
| POST   | `/tickets`                        | Bearer (multipart) | `*`                           | Crea ticket propio.                                                                                           |
| GET    | `/tickets`                        | Bearer             | `AGE` `LID` `ADM`             | AGE: tickets de sus áreas. LID: idem. ADM: todos.                                                             |
| GET    | `/tickets/me`                     | Bearer             | `*`                           | Tickets creados por el caller.                                                                                |
| GET    | `/tickets/:id`                    | Bearer             | `OWN` `AGE` `LID` `ADM`       | OWN siempre. AGE/LID solo si pertenece al área.                                                               |
| PATCH  | `/tickets/:id/take`               | Bearer             | `AGE` `LID` `ADM`             | Toma el ticket. Requiere estado `escalado`.                                                                   |
| PATCH  | `/tickets/:id/resolve`            | Bearer             | `AGE` `LID` `ADM`             | Resuelve con nota; cierra el ticket.                                                                          |
| PATCH  | `/tickets/:id/cancel`             | Bearer             | `OWN`                         | Solo si el ticket aún no fue tomado.                                                                          |
| PATCH  | `/tickets/:id/reopen`             | Bearer             | `OWN`                         | Dentro de la ventana de gracia (5 días hábiles).                                                              |
| POST   | `/tickets/:id/reopen-from-email`  | Token JWT en body  | `Public`                      | Botón "Esto no resolvió mi problema" del correo de auto-respuesta. Body `{ token }`. Ver `tikora-ia.md` §7.7. |
| PATCH  | `/tickets/:id/assign-agent`       | Bearer             | `AGE` `LID` `ADM`             | Reasignar dentro del área. AGE: solo a otro agente del mismo área.                                            |
| PATCH  | `/tickets/:id/assign-area`        | Bearer             | `LID` `ADM`                   | Reasignar a otra área.                                                                                        |
| PATCH  | `/tickets/:id/classification`     | Bearer             | `LID` `ADM`                   | Corrige manualmente la clasificación cuando el ticket está en `requiere_revision_clasificacion`.              |
| POST   | `/tickets/:id/interactions`       | Bearer             | `OWN` `AGE` `LID` `ADM`       | Agrega nota/mensaje.                                                                                          |
| GET    | `/tickets/:id/interactions`       | Bearer             | `OWN` `AGE` `LID` `ADM`       | Listado cronológico.                                                                                          |
| POST   | `/tickets/:id/attachments`        | Bearer (multipart) | `OWN` `AGE` `LID` `ADM`       | Sube adjunto adicional.                                                                                       |
| DELETE | `/tickets/:id/attachments/:attId` | Bearer             | `OWN` (antes de tomado) `ADM` | Elimina adjunto.                                                                                              |
| GET    | `/tickets/:id/attachments/:attId` | Bearer             | `OWN` `AGE` `LID` `ADM`       | Descarga el archivo (stream binario).                                                                         |

### 7.1 `POST /tickets`

**Request (`multipart/form-data`):**

| Campo         | Tipo   | Notas                     |
| ------------- | ------ | ------------------------- |
| `asunto`      | string | 5–120 chars.              |
| `cuerpo`      | string | 10–5000 chars.            |
| `attachments` | file[] | 0–5 archivos, ≤10 MB c/u. |

**Response 201:** `TicketSchema` con `estado: "recibido"`. La clasificación llega después por SSE.

**Errores:**

- `400 TICKET_VALIDATION` — asunto/cuerpo fuera de rango.
- `422 ATTACHMENT_TYPE_FORBIDDEN`, `422 ATTACHMENT_TOO_LARGE`, `422 ATTACHMENT_LIMIT_EXCEEDED`.

### 7.2 `GET /tickets`

**Query (todas opcionales):**

- `estado`: array (`recibido`, `clasificado`, `requiere_revision_clasificacion`, `escalado`, `en_progreso`, `cerrado`, `reabierto`, `cancelado`).
- `prioridad`: array (`alta`, `media`, `baja`).
- `areaId`: array. LID/ADM permiten filtrar por área; AGE se ignora (siempre filtrado por sus áreas).
- `tags`: array.
- `assignedToMe`: bool.
- `requesterId`: string (solo ADM/LID).
- `createdFrom`, `createdTo`: ISO date.
- `q`: búsqueda libre en asunto + cuerpo.
- `sort`: `slaAsc` (default) | `slaDesc` | `createdAtDesc` | `priorityDesc`.
- `cursor`, `limit`.

**Response 200:** `{ items: TicketListItem[], nextCursor }`.

### 7.3 `PATCH /tickets/:id/take`

**Request:** `{}` (sin body).

**Response 200:** `TicketSchema` actualizado (`estado: "en_progreso"`, `assignedAgentId: <caller>`).

**Errores:**

- `409 TICKET_TRANSITION_INVALID` — el ticket no está en `escalado`.
- `409 TICKET_ALREADY_TAKEN` — otro agente lo tomó (race condition; se devuelve quién lo tomó).

### 7.4 `PATCH /tickets/:id/resolve`

**Request:**

```json
{
  "nota": "Se reseteó la VPN del usuario. Confirmé acceso.",
  "enviarPorCorreo": true
}
```

**Response 200:** `TicketSchema` con `estado: "cerrado"`, `resolutionType: "manual"`, `resolvedBy`, `resolvedAt`.

### 7.5 `PATCH /tickets/:id/cancel`

**Request:**

```json
{ "motivo": "Ya lo resolví por mi cuenta." }
```

**Response 200:** ticket en `cancelado`.

**Errores:**

- `409 TICKET_NOT_CANCELABLE` — ya está en `en_progreso` o terminal.

### 7.6 `PATCH /tickets/:id/reopen`

**Request:**

```json
{ "motivo": "El problema volvió a aparecer." }
```

**Response 200:** ticket en `reabierto` (transitorio) → `en_progreso` (con `lastAssignedAgentId`) o `escalado` (si el cierre fue auto-respuesta).

**Errores:**

- `409 TICKET_REOPEN_GRACE_EXPIRED`.

### 7.7 `PATCH /tickets/:id/assign-agent`

**Request:** `{ "agentId": "u_5" }`.

### 7.8 `PATCH /tickets/:id/assign-area`

**Request:** `{ "areaId": "a_3", "motivo": "Pertenece a RRHH, no a TI." }`.

### 7.9 `PATCH /tickets/:id/classification`

Sirve para que un humano corrija la IA cuando el ticket cae en `requiere_revision_clasificacion` o la clasificación es manifiestamente errada.

**Request:**

```json
{
  "areaId": "a_2",
  "prioridad": "media",
  "motivo": "La IA sugirió TI pero es de RRHH."
}
```

**Response 200:** ticket transiciona a `escalado`.

### 7.10 `POST /tickets/:id/interactions`

**Request:**

```json
{
  "type": "agente",
  "content": "Llamé al usuario, sin respuesta. Le envío correo."
}
```

`type` permitido al caller:

- `OWN` (solicitante) → `usuario`.
- `AGE`/`LID`/`ADM` → `agente`.
- Solo el sistema crea `sistema` e `ia` internamente.

**Response 201:** `InteractionSchema`.

---

## 8. Adjuntos

Los adjuntos viven dentro del recurso ticket; los endpoints están listados arriba (§7). Detalles de transporte y almacenamiento en `tikora-frontend.md` §6.7 y `decisiones-tecnicas.md` §14.

### 8.1 `GET /tickets/:id/attachments/:attId`

Devuelve el archivo binario con headers:

```
Content-Type: <mime>
Content-Disposition: inline; filename="<original>"
Content-Length: <bytes>
```

El backend valida que el caller tenga acceso al ticket. No hay URLs públicas firmadas en MVP.

---

## 9. Base de Conocimiento (`/kb-documents`)

| Método | Path                                     | Auth   | Roles       | Alcance                                                          |
| ------ | ---------------------------------------- | ------ | ----------- | ---------------------------------------------------------------- |
| GET    | `/kb-documents`                          | Bearer | `LID` `ADM` | LID: documentos de sus áreas + globales. ADM: todos.             |
| GET    | `/kb-documents/:id`                      | Bearer | `LID` `ADM` | Idem.                                                            |
| POST   | `/kb-documents`                          | Bearer | `LID` `ADM` | LID: solo `scope: 'area'` con áreas que lidera. ADM: cualquiera. |
| PUT    | `/kb-documents/:id`                      | Bearer | `LID` `ADM` | Crea **versión nueva**. La versión anterior queda inactiva.      |
| DELETE | `/kb-documents/:id`                      | Bearer | `LID` `ADM` | Soft-delete (todas las versiones quedan inactivas).              |
| GET    | `/kb-documents/:id/versions`             | Bearer | `LID` `ADM` | Historial.                                                       |
| POST   | `/kb-documents/:id/versions/:n/activate` | Bearer | `ADM`       | Reactivar una versión anterior (rollback).                       |

### 9.1 `POST /kb-documents`

**Request:**

```json
{
  "title": "Cómo solicitar acceso VPN",
  "content": "# Pasos\n\n1. Ingresar al portal...",
  "scope": "area",
  "areaIds": ["a_1"]
}
```

**Validación:**

- `title`: 3–200 chars.
- `content`: ≤200 KB y solo texto plano o Markdown.
- `scope === 'area'` requiere `areaIds.length ≥ 1`.
- `scope === 'global'` requiere rol `ADM`.

**Response 201:** `KbDocumentSchema` (`version: 1`, `active: true`). El backend encola job de chunking + embedding.

### 9.2 `PUT /kb-documents/:id`

**Request:** mismo shape que `POST` salvo `scope` (no se cambia tras creación). Crea `version + 1` y dispara reindexación.

---

## 10. Respuestas IA (`/ai-responses`)

Disponible desde Fase 2.

| Método | Path                                     | Auth   | Roles             | Descripción                                                        |
| ------ | ---------------------------------------- | ------ | ----------------- | ------------------------------------------------------------------ |
| GET    | `/tickets/:id/ai-response`               | Bearer | `AGE` `LID` `ADM` | Devuelve la respuesta sugerida vigente del ticket (404 si no hay). |
| PATCH  | `/ai-responses/:id/approve`              | Bearer | `AGE` `LID` `ADM` | Aprueba sin cambios → encola envío por correo.                     |
| PATCH  | `/ai-responses/:id/approve-with-changes` | Bearer | `AGE` `LID` `ADM` | Aprueba con texto editado.                                         |
| PATCH  | `/ai-responses/:id/discard`              | Bearer | `AGE` `LID` `ADM` | Descartar con motivo. Vuelve al ticket a `escalado`.               |

### 10.1 `PATCH /ai-responses/:id/approve-with-changes`

**Request:**

```json
{ "respuestaFinal": "Hola Juan, ..." }
```

El backend persiste `originalAiContent` y `content` (final), calcula el diff y registra `editedBy`/`editedAt`.

### 10.2 `PATCH /ai-responses/:id/discard`

**Request:**

```json
{ "motivo": "La respuesta no contempla el caso de cuentas suspendidas." }
```

---

## 11. Notificaciones (`/notifications`)

| Método | Path                          | Auth       | Roles | Descripción                                                |
| ------ | ----------------------------- | ---------- | ----- | ---------------------------------------------------------- |
| GET    | `/notifications`              | Bearer     | `*`   | Listado del caller, paginado, filtrable por `read`/`type`. |
| GET    | `/notifications/unread-count` | Bearer     | `*`   | Contador para la campanita.                                |
| PATCH  | `/notifications/:id/read`     | Bearer     | `*`   | Marcar una.                                                |
| PATCH  | `/notifications/read-all`     | Bearer     | `*`   | Marcar todas.                                              |
| GET    | `/notifications/stream`       | Ticket SSE | `*`   | Stream `text/event-stream` con eventos en tiempo real.     |

### 11.1 `GET /notifications`

**Query:** `?read=false&type=TicketAssigned&cursor=...&limit=...`.

**Response 200:** `{ items: NotificationSchema[], nextCursor }`.

### 11.2 `GET /notifications/stream`

**Query:** `?ticket=<sse-ticket>`.

**Response:** `Content-Type: text/event-stream`. Cada evento sigue:

```
id: <eventId>
event: <EventType>
data: <JSON payload>

```

Catálogo de eventos en `tikora-events.md`.

**Headers especiales:**

- `Last-Event-ID` (de cliente al reconectar) → backend reanuda desde ese punto si lo tiene en buffer.

---

## 12. Búsqueda global (`/search`)

| Método | Path      | Auth   | Roles | Descripción      |
| ------ | --------- | ------ | ----- | ---------------- |
| GET    | `/search` | Bearer | `*`   | Búsqueda global. |

### 12.1 `GET /search`

**Query:** `?q=<texto>&types=tickets,kb,users&limit=10`.

`types` por defecto depende del rol:

- `EMP`: `tickets` (solo los propios) + `kb` (globales).
- `AGE`/`LID`: `tickets` (de sus áreas) + `kb` (globales + áreas).
- `ADM`: todos los tipos, incluyendo `users`.

**Response 200:**

```json
{
  "tickets": [{ "id": "...", "asunto": "...", "snippet": "...", "estado": "..." }],
  "kb": [{ "id": "...", "title": "...", "snippet": "..." }],
  "users": [{ "id": "...", "fullName": "...", "email": "..." }]
}
```

---

## 13. Administración (`/admin`)

Todos los endpoints bajo `/admin` requieren rol `ADM`.

| Método | Path                     | Descripción                                                                                                                          |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/admin/metrics`         | Métricas globales del tenant.                                                                                                        |
| GET    | `/admin/ai-metrics`      | Métricas de uso de IA del tenant: tokens, costo USD estimado, latencia, desglose por propósito/modelo/outcome y serie temporal.      |
| GET    | `/admin/thresholds`      | Umbrales de IA configurados.                                                                                                         |
| PATCH  | `/admin/thresholds`      | Actualizar umbrales (`UMBRAL_CONFIANZA_CLASIFICACION`, `UMBRAL_RELEVANCIA_KB`, `UMBRAL_AUTO_AUTONOMA`, `AUTO_AUTONOMA_SAMPLE_RATE`). |
| GET    | `/admin/ai-logs`         | Logs de llamadas IA, paginado. Filtros por `purpose`, `outcome`, `model`, fecha.                                                     |
| GET    | `/admin/ai-logs/:callId` | Detalle de una llamada (incluye prompt y response, redactado de PII si aplica).                                                      |
| GET    | `/admin/audit-log`       | Acciones administrativas auditadas.                                                                                                  |
| GET    | `/admin/sla-config`      | Calendario hábil del tenant.                                                                                                         |
| PATCH  | `/admin/sla-config`      | Editar inicio/fin de jornada y zona horaria.                                                                                         |

### 13.1 `PATCH /admin/thresholds`

**Request (todos opcionales):**

```json
{
  "umbralConfianzaClasificacion": 0.7,
  "umbralRelevanciaKb": 0.75,
  "umbralAutoAutonoma": 0.9,
  "autoAutonomaSampleRate": 0.1
}
```

**Validación:** todos en `[0, 1]`. `umbralAutoAutonoma ≥ umbralConfianzaClasificacion`.

### 13.2 `GET /admin/metrics`

**Query:** `?from=...&to=...`.

**Response 200:**

```json
{
  "tickets": { "total": 1234, "byEstado": { ... }, "byArea": { ... }, "byPrioridad": { ... } },
  "sla": { "complianceRate": 0.92, "breachedTotal": 96 },
  "ai": {
    "classificationAccuracy": 0.89,
    "classificationCallsTotal": 1234,
    "classificationCostUsd": 1.23,
    "autoResponseApprovalRate": 0.81,
    "autoResponseCallsTotal": 540,
    "autoResponseCostUsd": 12.50
  },
  "users": { "active": 87, "byRole": { "agente": 30, "lider": 5, "admin": 2, "empleado": 50 } }
}
```

### 13.3 `GET /admin/ai-metrics`

Agrega `ai_call_logs` por tenant en un rango de fechas y devuelve totales,
desgloses por propósito/modelo/outcome y serie temporal por día. El costo en
USD se calcula con la tabla de pricing del back (`apps/back/src/metrics/ai-pricing.ts`)
y es **estimado** — no refleja descuentos por free-tier ni créditos
negociados con el proveedor. Si un modelo no está en la tabla, `pricingKnown`
viene en `false` y su costo se cuenta como 0.

**Query:** `?from=...&to=...` (opcionales; default últimos 30 días).

**Response 200:**

```json
{
  "rangeFrom": "2026-04-13T00:00:00.000Z",
  "rangeTo": "2026-05-13T00:00:00.000Z",
  "totals": {
    "calls": 28,
    "tokens": { "input": 34233, "inputCached": 9088, "output": 3395 },
    "costUsd": 0.0167,
    "latency": { "avgMs": 8479.4, "p95Ms": 21625 },
    "retries": 18
  },
  "byPurpose": [
    { "purpose": "classification", "calls": 10, "tokens": { ... }, "costUsd": 0.0031, "latencyAvgMs": 7080.4 },
    { "purpose": "auto-response", "calls": 18, "tokens": { ... }, "costUsd": 0.0136, "latencyAvgMs": 9256.6 },
    { "purpose": "review", "calls": 0, "tokens": { ... }, "costUsd": 0, "latencyAvgMs": null }
  ],
  "byModel": [
    { "modelo": "gemini-2.5-flash", "calls": 21, "tokens": { ... }, "costUsd": 0.0158, "pricingKnown": true },
    { "modelo": "gemini-1.5-flash", "calls": 1,  "tokens": { ... }, "costUsd": 0,      "pricingKnown": false }
  ],
  "byOutcome": { "ok": 24, "validation_failure": 0, "api_error": 4 },
  "timeline": [
    { "date": "2026-05-12", "calls": 28, "tokens": { ... }, "costUsd": 0.0167 }
  ]
}
```

**Notas:**

- `latency.p95Ms` se calcula en memoria sobre todas las latencias del rango
  (método nearest-rank). Si el volumen del tenant crece mucho, migrar a
  `$percentile` de Mongo 7+.
- `timeline` no rellena días vacíos: si un día no tuvo llamadas, no aparece
  en el array.
- Schema Zod compartido en `@tikora/core` → `aiMetricsResponseSchema`.

---

## 14. Feedback (`/feedback`)

| Método | Path                                   | Auth   | Roles             | Descripción                                        |
| ------ | -------------------------------------- | ------ | ----------------- | -------------------------------------------------- |
| POST   | `/tickets/:id/classification-feedback` | Bearer | `AGE` `LID` `ADM` | Marca la clasificación como correcta o incorrecta. |
| GET    | `/tickets/:id/classification-feedback` | Bearer | `AGE` `LID` `ADM` | Lee el feedback registrado.                        |

### 14.1 `POST /tickets/:id/classification-feedback`

**Request:**

```json
{
  "veredicto": "correcta" | "area_incorrecta" | "prioridad_incorrecta" | "ambas_incorrectas",
  "areaCorrectaId": "a_3",
  "prioridadCorrecta": "alta",
  "comentario": "..."
}
```

`areaCorrectaId` y `prioridadCorrecta` son obligatorios cuando `veredicto !== 'correcta'`.

El feedback de respuestas IA (Fase 2) se infiere implícitamente de las acciones aprobar/aprobar-con-cambios/descartar de §10.

---

## 15. MCP (`/me/mcp-keys`, `/mcp`)

Servidor MCP que expone tools de Tikora a Claude (típicamente desde el connector configurado en claude.ai → Claude en WhatsApp). Diseño y motivación en `tikora-mcp.md`.

Dos superficies HTTP distintas:

- **`/me/mcp-keys`** — gestión de API keys MCP del usuario autenticado, **autenticado por JWT** (las keys nuevas no pueden autenticar su propia creación: sería bootstrap circular).
- **`/mcp`** — transport JSON-RPC del SDK MCP (`StreamableHTTPServerTransport`, stateless), **autenticado por API key MCP** en `Authorization: Bearer tk_mcp_…`. **No** acepta JWT.

Ambas superficies se deshabilitan en bloque vía `MCP_ENABLED=false` (en ese caso `/mcp` responde `503 MCP_DISABLED`).

| Método | Path                          | Auth       | Roles | Descripción                                                                           |
| ------ | ----------------------------- | ---------- | ----- | ------------------------------------------------------------------------------------- |
| GET    | `/me/mcp-keys`                | Bearer JWT | `*`   | Lista las keys activas (no revocadas) del caller.                                     |
| POST   | `/me/mcp-keys`                | Bearer JWT | `*`   | Genera una key nueva. El `secret` se devuelve **una sola vez**.                       |
| DELETE | `/me/mcp-keys/:id`            | Bearer JWT | `*`   | Revoca una key (soft-delete, idempotencia bloqueada con `409`).                       |
| POST   | `/me/mcp-keys/:id/regenerate` | Bearer JWT | `*`   | Revoca la key indicada y crea una nueva con el mismo `name`. Para "perdí el secreto". |
| ALL    | `/mcp`                        | Bearer MCP | `*`   | Transport JSON-RPC del SDK MCP (`initialize`, `tools/list`, `tools/call`).            |

### 15.1 `GET /me/mcp-keys`

**Response 200:**

```json
{
  "items": [
    {
      "id": "...",
      "name": "Claude en WhatsApp",
      "prefix": "tk_mcp_xxxxx",
      "lastUsedAt": "2026-05-26T12:34:56.000Z",
      "createdAt": "2026-05-25T22:10:11.000Z"
    }
  ]
}
```

`prefix` son los primeros 12 caracteres del secreto (`tk_mcp_` + 5 chars). Sirve para identificar la key en la lista sin exponer el hash. El secreto completo NO se devuelve nunca después del POST original.

### 15.2 `POST /me/mcp-keys`

**Request:** `{ "name": "Claude en WhatsApp" }` (1..80 chars, `trim`).

**Response 201:**

```json
{
  "key": {
    "id": "...",
    "name": "...",
    "prefix": "tk_mcp_xxxxx",
    "lastUsedAt": null,
    "createdAt": "..."
  },
  "secret": "tk_mcp_xxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

`secret` es el valor literal que el usuario pega en el connector de claude.ai. **Solo viaja en esta respuesta** — el back guarda únicamente el hash bcrypt y el `prefix`. Si se pierde, hay que `regenerate` o crear una nueva.

**Errores:**

- `409 MCP_KEY_LIMIT_REACHED` cuando el usuario ya tiene `MCP_MAX_ACTIVE_KEYS_PER_USER` (default 5) keys activas. Revocar alguna antes de generar otra.

### 15.3 `DELETE /me/mcp-keys/:id`

**Response 204** sin body. Soft-delete: marca `revokedAt` y la key queda inválida en la próxima request a `/mcp`.

**Errores:**

- `404 MCP_KEY_NOT_FOUND` si el id no existe, no es ObjectId válido, o pertenece a otro usuario.
- `409 MCP_KEY_ALREADY_REVOKED` si ya estaba revocada. No es idempotente para que la UI pueda detectar el caso.

### 15.4 `POST /me/mcp-keys/:id/regenerate`

Revoca la key indicada y genera una reemplazante con el mismo `name`. Pensado para el caso "perdí el secreto": conserva la etiqueta para que el usuario reconozca la entrada en la lista.

**Response 201:** mismo shape que `POST /me/mcp-keys` (`{ key, secret }`). El `secret` nuevo solo viaja en esta respuesta.

**Errores:** mismos códigos que `DELETE` (`404 MCP_KEY_NOT_FOUND`, `409 MCP_KEY_ALREADY_REVOKED`).

### 15.5 `ALL /mcp`

Endpoint del transport MCP. **No** es REST: el body es JSON-RPC 2.0 del SDK `@modelcontextprotocol/sdk`. En Tikora se usa stateless — un par `transport` + `server` se crea, atiende la request y se cierra al terminar la respuesta (no hay sesión persistente entre llamadas).

**Auth:** `Authorization: Bearer tk_mcp_<24 chars base62>`. El guard `McpAuthGuard` resuelve `tenantId`+`userId` desde el hash de la key y popula `request.user` con la misma forma que `JwtAuthGuard`, de modo que las tools delegan a los services existentes sin distinguir el origen del caller.

**Errores de auth:**

- `401 MCP_KEY_MISSING` cuando falta el header `Authorization`.
- `401 MCP_KEY_INVALID` cuando la key no matchea ninguna activa (no existe, fue revocada, o fue truncada).
- `503 MCP_DISABLED` cuando `MCP_ENABLED=false`.
- `500 MCP_INTERNAL_ERROR` cuando el handler MCP falla antes de enviar la respuesta JSON-RPC.

**Tools v1** (registradas con nombres en español; los schemas viven en `@tikora/core/src/lib/mcp-tools.ts`):

| Tool                       | Input                                    | Output                                                                         | Delega a                                                                 |
| -------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `crear_ticket`             | `asunto` (5..120), `cuerpo` (10..5000)   | `{ ticketId, shortCode, estado, mensaje }`                                     | `TicketsService.create` → entra al pipeline de clasificación IA.         |
| `listar_mis_tickets`       | `estado?`, `limite?` (1..20, default 10) | `{ tickets: [{ ticketId, shortCode, asunto, estado, prioridad, createdAt }] }` | `TicketsService.listMine` (cap 100, filtro `estado` en memoria).         |
| `obtener_ticket`           | `ticketId` (ObjectId)                    | `{ ticket, ultimaRespuestaAgente, historial[10] }`                             | `TicketsService.getByIdForCaller` + `InteractionsService.listForTicket`. |
| `agregar_mensaje_a_ticket` | `ticketId` (ObjectId), `texto` (1..2000) | `{ ok: true, mensaje }`                                                        | `InteractionsService.createForCaller` (tipo `usuario`).                  |

Las `ApiException` que tiren los services se mapean a `CallToolResult { isError: true, content: [...] }` por `tool-helpers.ts:toolError()`, que extrae el `message` en español y lo entrega a Claude como contenido de texto.

Schemas Zod compartidos en `@tikora/core` → `mcpKeySchema`, `createMcpKeySchema`, `createMcpKeyResponseSchema`, `crearTicketInputSchema`, `listarMisTicketsInputSchema`, `obtenerTicketInputSchema`, `agregarMensajeATicketInputSchema` (y sus `*OutputSchema`).

Detalle de comportamiento, motivos de cada elección (incluyendo por qué no hay `areaId` en `crear_ticket` y por qué el filtro de `estado` es in-memory) en `tikora-mcp.md` §4.5.

---

## 16. Resumen — endpoints por módulo

| Módulo          | Endpoints                                                                                                                                                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `auth`          | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/sse-ticket`                                                                                                                                                           |
| `health`        | `GET /health`                                                                                                                                                                                                                                    |
| `users`         | `GET/POST /users`, `GET/PATCH/DELETE /users/:id`, `GET/PATCH /users/me`, `PATCH /users/me/password`                                                                                                                                              |
| `areas`         | `GET/POST /areas`, `GET/PATCH/DELETE /areas/:id`, `POST/DELETE /areas/:id/agents[/:userId]`, `POST/DELETE /areas/:id/leaders[/:userId]`, `GET /areas/:id/agents`, `PATCH /areas/:id/slas`, `GET /areas/:id/metrics`                              |
| `tickets`       | `POST/GET /tickets`, `GET /tickets/me`, `GET /tickets/:id`, `PATCH /tickets/:id/{take,resolve,cancel,reopen,assign-agent,assign-area,classification}`, `POST/GET /tickets/:id/interactions`, `POST/DELETE/GET /tickets/:id/attachments[/:attId]` |
| `kb`            | `GET/POST /kb-documents`, `GET/PUT/DELETE /kb-documents/:id`, `GET /kb-documents/:id/versions`, `POST /kb-documents/:id/versions/:n/activate`                                                                                                    |
| `ai-response`   | `GET /tickets/:id/ai-response`, `PATCH /ai-responses/:id/{approve,approve-with-changes,discard}`                                                                                                                                                 |
| `notifications` | `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, `GET /notifications/stream`                                                                                           |
| `search`        | `GET /search`                                                                                                                                                                                                                                    |
| `admin`         | `GET /admin/metrics`, `GET /admin/ai-metrics`, `GET/PATCH /admin/thresholds`, `GET /admin/ai-logs[/:callId]`, `GET /admin/audit-log`, `GET/PATCH /admin/sla-config`                                                                              |
| `feedback`      | `POST/GET /tickets/:id/classification-feedback`                                                                                                                                                                                                  |
| `mcp`           | `GET/POST /me/mcp-keys`, `DELETE /me/mcp-keys/:id`, `POST /me/mcp-keys/:id/regenerate`, `ALL /mcp` (JSON-RPC, auth por API key MCP)                                                                                                              |

**Total Fase 1:** ~45 endpoints. Fase 2 agrega los 4 de `ai-response`. Fase MCP agrega 4 REST + el transport `/mcp`.

---

## 17. Reglas para implementadores

- Cada endpoint nuevo se registra primero en este documento, luego se implementa.
- El request y response schema **vive en `@tikora/core`** y se referencia por nombre (`CreateTicketSchema`, etc.).
- Cada endpoint tiene tests de:
  - Validación de input (al menos un caso `200` y uno `400` por campo crítico).
  - Permisos (al menos un caso `403` por rol que no debería tener acceso).
  - Multi-tenant isolation (no devolver datos de otro tenant).
- Los códigos `code` de error son **estables**: una vez publicados, no se renombran. Si un comportamiento cambia, se agrega un código nuevo.
- Cualquier endpoint que rompa compatibilidad pasa a `/api/v2`.
