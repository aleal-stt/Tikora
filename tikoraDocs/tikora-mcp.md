# Tikora — Integración MCP (WhatsApp via Claude)

> Diseño y estado actual del servidor MCP que permite operar tickets de Tikora desde Claude en WhatsApp. La v1 (Fases 1 y 2 del §5) está **implementada, smoke-tested y pusheada a `main`**. Este doc refleja lo que hay en el código, no el plan original; las decisiones se mantienen para que el reader entienda el porqué de la arquitectura.

---

## 1. Objetivo

Permitir que un empleado con cuenta en Tikora interactúe con la plataforma desde WhatsApp sin necesidad de abrir la UI web, hablando con el número oficial de Claude en WhatsApp. Casos de uso concretos:

- Crear un ticket nuevo describiéndolo en lenguaje natural ("necesito reembolso de viáticos del viaje a Córdoba").
- Listar los tickets propios y su estado actual.
- Consultar la última respuesta del agente sobre un ticket abierto.
- Agregar un comentario a un ticket existente sin abrir la UI.

Lo que **no** intenta resolver esta integración:

- Trabajo del agente desde WhatsApp (los agentes siguen operando desde la UI).
- Notificación push del agente al empleado (Claude en WhatsApp no inicia mensajes; el empleado consulta cuando quiere).
- Onboarding desde cero por WhatsApp (la cuenta del empleado se crea desde la UI por admin).

---

## 2. Decisión: modelo de integración

**Decisión:** Integración vía **MCP server propio + Claude en WhatsApp**. Tikora expone un endpoint MCP que el empleado configura como _connector_ en claude.ai con una API key personal; a partir de ahí, todas las conversaciones del empleado con Claude en WhatsApp tienen acceso a las tools de Tikora.

**Opciones evaluadas:**

| Opción                                      | Pros                                                                                             | Contras                                                                                                                                     |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP via Claude en WhatsApp                  | Cero costo por mensaje; sin Meta Business; setup bajo; reutiliza el número oficial de Claude     | Claude no inicia mensajes — el agente no puede push-ear respuestas, el empleado tiene que preguntar; requiere cuenta de Claude del empleado |
| WhatsApp Business API (Twilio / Meta Cloud) | Número propio de la empresa; push real del agente; experiencia equivalente a soporte profesional | Costo recurrente por mensaje; registración del número con Meta; verificación de marca para producción                                       |
| Librería no oficial (open-wa, Baileys)      | Gratis; número personal de WhatsApp; setup mínimo                                                | Viola los ToS de Meta; ban impredecible del número; enforcement endurecido desde 2026-01-15; no defendible para producción                  |

**Por qué se eligió MCP:** la restricción operativa actual es presupuesto cero para servicios externos. WhatsApp Business API, aun en sandbox de Twilio, tiene fricción para el empleado (`join <código>` la primera vez) y costo cuando se migre a número real. La librería no oficial queda descartada por riesgo legal y de continuidad: Meta ya está bloqueando activamente bots no oficiales y un ban del número durante el muestreo o piloto sería catastrófico.

Se acepta como limitación que **el flujo de notificación del agente al empleado sigue siendo email** (el flow actual de Tikora) más consulta on-demand del empleado a Claude. Si en el futuro se libera presupuesto, la opción Business API queda como upgrade: el MCP server se conserva como canal complementario o se sustituye, y el modelo de datos (ver §4) no requiere cambios.

---

## 3. Decisiones de producto cerradas

| #   | Decisión                            | Valor                                                                                                                                                                |
| --- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo de integración               | MCP via Claude en WhatsApp                                                                                                                                           |
| 2   | Auth contra el MCP server           | API key personal por empleado, generada en la UI de Tikora (perfil del user), pegada al configurar el connector en claude.ai                                         |
| 3   | Quién puede usar el connector       | Solo `users` pre-registrados en Tikora. El admin sigue siendo quien crea cuentas; el empleado autenticado en la UI genera su propia key                              |
| 4   | Notificación del agente al empleado | Email (flow actual) + pull on-demand desde Claude. El empleado le pregunta a Claude por novedades y la tool `get_ticket` devuelve el estado y la última respuesta    |
| 5   | Adjuntos en la v1                   | Solo texto. Si el empleado adjunta una imagen en WhatsApp, Claude la describe en texto y esa descripción entra al ticket. Soporte de adjuntos reales se difiere a v2 |
| 6   | Tools del MCP server en v1          | `create_ticket`, `list_my_tickets`, `get_ticket`, `append_message_to_ticket`                                                                                         |

---

## 4. Arquitectura

### 4.1 Ubicación del MCP server

**Decisión:** el MCP server vive **dentro del back de NestJS** como módulo nuevo `apps/back/src/mcp/`, expuesto en un endpoint HTTP del mismo proceso con el `StreamableHTTPServerTransport` del SDK MCP. La URL real es `POST /api/v1/mcp` — el `setGlobalPrefix('api/v1')` del back aplica también al controller MCP, así que el usuario configura esa URL completa como connector en claude.ai. No se crea una app aparte en `apps/`.

**Modo stateless.** El transport se instancia con `sessionIdGenerator: undefined` y cada request HTTP crea su propio par `McpServer` + `transport`. Las tools se registran en closure sobre el `AuthenticatedUser` que el `McpAuthGuard` resolvió desde la API key del header. Sin sesión persistente: no hay estado compartido entre requests ni entre usuarios.

**Por qué:** todo el dominio que el MCP necesita (users, tickets, classification queue, tenants) ya vive en el back. Levantar otra app Nx implicaría duplicar bootstrap, conexiones a Mongo y Redis, o exponer un cliente HTTP interno — overhead sin retorno para v1. Cuando crezca a punto de necesitar escalado independiente o procesos separados, se extrae con la misma interfaz pública.

### 4.2 Estructura del módulo

```
apps/back/src/mcp/
├── mcp.module.ts                       # NestModule, importa Tickets/Interactions/Users
├── mcp.constants.ts                    # MCP_KEY_PREFIX, longitudes, etc.
├── controllers/
│   ├── mcp.controller.ts               # POST /api/v1/mcp — transport HTTP del SDK
│   └── me-mcp-keys.controller.ts       # REST de gestión de keys (ver §4.6)
├── services/
│   ├── mcp-server.service.ts           # Fábrica de McpServer + registro de tools
│   ├── mcp-key.service.ts              # Genera, hashea, valida, revoca, regenera
│   └── mcp-auth.service.ts             # Resuelve key → AuthenticatedUser
├── tools/
│   ├── crear-ticket.tool.ts            # Una tool por archivo, nombres en español
│   ├── listar-mis-tickets.tool.ts
│   ├── obtener-ticket.tool.ts
│   ├── agregar-mensaje-a-ticket.tool.ts
│   └── tool-helpers.ts                 # toolError() para mapear ApiException a CallToolResult
├── schemas/
│   └── mcp-key.schema.ts               # Mongoose schema de McpApiKey
├── dto/
│   └── create-mcp-key.dto.ts           # createZodDto(createMcpKeySchema) para nestjs-zod
└── guards/
    └── mcp-auth.guard.ts               # Guard que valida la API key en el header MCP
```

**Schemas Zod en `@tikora/core`** viven flat en `packages/core/src/lib/`, no en una subcarpeta `mcp/` — coherente con la convención existente del paquete (`tickets.ts`, `auth.ts`, etc.). Los archivos son `mcp-keys.ts` (REST de gestión) y `mcp-tools.ts` (I/O de las 4 tools).

### 4.3 Modelo de datos

**Nueva colección `mcp_api_keys`** (no se extiende `users` con un campo embebido para soportar múltiples keys por user en el futuro y para revocaciones limpias):

```ts
// packages/core/src/mcp/mcp-key.schema.ts
export const McpApiKeySchema = z.object({
  _id: ObjectIdSchema,
  tenantId: ObjectIdSchema,
  userId: ObjectIdSchema,
  keyHash: z.string(), // bcrypt hash del secreto completo
  prefix: z.string().length(12), // primeros 12 chars del secreto, en claro, para identificar la key en logs/UI
  name: z.string().min(1).max(80), // descripción que pone el user, ej "Mi WhatsApp personal"
  lastUsedAt: z.date().nullable(),
  revokedAt: z.date().nullable(),
  createdAt: z.date(),
});
```

Índices: `{tenantId:1, userId:1, revokedAt:1}`, `{prefix:1}` (no único — el prefix se usa para acotar la búsqueda del hash, ver §4.4).

**No se agrega `phoneE164` al user.** El connector identifica al user por la key, no por número.

### 4.4 Auth MCP

Formato de la API key: `tk_mcp_<24 chars base62>` (total 31 chars). El cuerpo aleatorio se genera con `crypto.randomBytes` + rejection sampling sobre los 62 chars del alfabeto base62 (descarta bytes ≥ 248 para que cada char sea equiprobable). El secreto completo se muestra **una sola vez** al generarla; después solo queda el prefix visible (`tk_mcp_xxxxx`, 12 chars = prefijo fijo + 5 chars random) y el hash bcrypt.

Flujo de validación en cada request MCP:

1. El connector manda la key en el header `Authorization: Bearer tk_mcp_xxx...`.
2. `McpAuthGuard` extrae el header.
3. `McpAuthService` toma los primeros 12 chars (`tk_mcp_xxxxx`), busca todas las keys con ese prefix no revocadas (esperable: 1, máximo poquísimas por colisión de prefix).
4. Por cada candidata corre `bcrypt.compare` contra el secreto completo. Si matchea, resuelve `tenantId+userId` y los inyecta en el contexto MCP equivalente al `AuthenticatedUser` que el guard JWT usa para HTTP.
5. Actualiza `lastUsedAt` async (sin bloquear la response).

El hashing se hace con `bcryptjs`, la misma librería que ya usa el back para passwords.

### 4.5 Tools v1 — especificación

Las tools usan **nombres y campos en español**, coherente con el resto del dominio Tikora (`asunto`, `cuerpo`, `estado`, `prioridad`). Claude infiere bien tanto en inglés como en español, y mantener una sola convención evita mapeos entre la capa MCP y los services del back. Cada tool recibe el contexto resuelto del auth (`tenantId`, `userId`, `role`) por closure y delega a services existentes — no hace queries directas a Mongo.

Schemas de I/O viven en `@tikora/core/src/lib/mcp-tools.ts` con Zod, y el SDK MCP los expone como JSON Schema a Claude usando `.shape` del schema.

**`crear_ticket`**

```yaml
input:
  asunto: string (5..120, trim)
  cuerpo: string (10..5000, trim)
output:
  ticketId: string
  shortCode: string
  estado: EstadoTicket
  mensaje: string # confirmación humana
behavior:
  - Llama a TicketsService.create(caller, { asunto, cuerpo })
  - El ticket entra al pipeline de clasificación IA (idéntico a creación desde UI)
  - No espera al pipeline; devuelve apenas el ticket queda persistido
nota:
  - No acepta `areaId`. TicketsService.create no lo permite — el área la
    asigna el ClassificationProcessor a partir del cuerpo. Si se quiere
    permitir override desde Claude, hay que extender create primero.
```

**`listar_mis_tickets`**

```yaml
input:
  estado: optional EstadoTicket # recibido|clasificado|requiere_revision_clasificacion|escalado|en_progreso|cerrado|reabierto|cancelado
  limite: optional int (1..20, default 10)
output:
  tickets: array of { ticketId, shortCode, asunto, estado, prioridad, createdAt }
behavior:
  - Llama a TicketsService.listMine(caller, { limit: 100 }) — el cap del back es MAX_PAGE_SIZE=100.
  - Filtra por `estado` en memoria sobre esos 100 resultados, después corta a `limite`.
  - Orden descendente por _id (que sigue createdAt).
nota:
  - El filtro `estado` no es server-side (TicketsService.listMine no lo soporta).
    Si el usuario tiene >100 tickets de un estado, los más viejos no aparecerán.
    Para usuarios con backlog grande hay que extender listMine con filtro server-side.
```

**`obtener_ticket`**

```yaml
input:
  ticketId: string (ObjectId, regex /^[0-9a-fA-F]{24}$/)
output:
  ticket: { ticketId, shortCode, asunto, cuerpo, estado, prioridad, areaId, createdAt }
  ultimaRespuestaAgente: nullable { contenido, agenteNombre, enviadaEn }
  historial: array of { tipo: 'mensaje'|'cambio_estado', contenido, fecha }  # últimos 10 eventos
behavior:
  - Llama a TicketsService.getByIdForCaller (que ya valida ownership y tira 404
    si el ticket no es del caller o no es del tenant).
  - Llama a InteractionsService.listForTicket para construir historial y detectar
    la última interaction de tipo `agente`.
nota:
  - `agenteNombre` es siempre el string genérico "Agente" en v1. Para resolver
    el nombre real hay que inyectar UsersService.findById en el closure de la
    tool — se difiere a v2 para no acoplar el módulo MCP con UsersService.
```

**`agregar_mensaje_a_ticket`**

```yaml
input:
  ticketId: string (ObjectId)
  texto: string (1..2000, trim)
output:
  ok: true (literal)
  mensaje: string
behavior:
  - Llama a TicketsService.getByIdForCaller para validar ownership + estado actual.
  - Si estado ∈ {cerrado, cancelado}, devuelve isError con mensaje específico
    (sin hacer el append).
  - Llama a InteractionsService.createForCaller(caller, ticketId, { type: 'usuario', content: texto }).
  - No re-clasifica; si se necesita escalamiento, queda para el agente desde la UI.
```

Errores de los services (ApiException del back) se mapean a `CallToolResult { isError: true, content: [...] }` por `tool-helpers.ts:toolError()`, que extrae el `message` en español y lo pone en el content de texto que Claude le muestra al usuario.

### 4.6 UI de gestión de keys

Pantalla en `apps/front/src/features/mcp-keys/`, ruta privada **`/perfil/mcp-keys`** accesible por cualquier rol logueado (item "Claves MCP" en el sidebar del `AppShell`, ícono llave). `/perfil` redirige a `/perfil/mcp-keys` porque hoy es la única sub-página de perfil.

Componentes:

- `McpKeysPage` — listado de keys activas con nombre, prefix, `lastUsedAt`, fecha de creación. Por item, dos botones: **Regenerar** y **Revocar**.
- `CreateMcpKeyDialog` — input de nombre + botón "Generar". Al confirmar, el dialog cambia al panel reusable `RevealedSecretPanel` que muestra el secret **una sola vez** con copy-to-clipboard y advertencia ámbar destacada.
- `RegenerateMcpKeyDialog` — confirmación destructiva (muestra el nombre + prefijo de la key actual) → al confirmar, llama a `POST /me/mcp-keys/:id/regenerate` y muestra el nuevo secret con el mismo `RevealedSecretPanel`.
- Reusa `ConfirmDialog` (de `features/admin/components/`) para la revocación simple.

Endpoints HTTP (autenticados con JWT, no con la propia key MCP):

- `GET /api/v1/me/mcp-keys` → lista de keys activas del user actual.
- `POST /api/v1/me/mcp-keys` → genera nueva, retorna `{ key, secret }` (secret una sola vez).
- `DELETE /api/v1/me/mcp-keys/:id` → marca `revokedAt` (soft-delete; el registro queda para auditoría).
- `POST /api/v1/me/mcp-keys/:id/regenerate` → revoca la actual + crea otra con el mismo `name`, devuelve `{ key, secret }` con el shape de creación.

El endpoint `regenerate` no estaba en el plan original. Se agregó durante el smoke front porque el usuario pidió "un botón para copiar la key cuando sea necesario", y el secret no se puede recuperar (hash-only). Regenerar manteniendo el `name` preserva la identificación en la lista sin debilitar la seguridad: la key vieja queda inválida de inmediato y solo el nuevo secret viaja una vez.

Límite suave: máximo **5 keys activas por user**, configurable por env (`MCP_MAX_ACTIVE_KEYS_PER_USER=5`). El cap se chequea en `generate` (no en `regenerate` porque revoca antes de crear → no acumula).

### 4.7 Logging y observabilidad

- Cada invocación de tool deja un log con `userId`, `tenantId`, `toolName`, `durationMs`, `success`.
- `keyId` (no el secreto) se incluye para correlación.
- Si la integración con Sentry está activa, los errores de tools se reportan con tag `source=mcp`.
- No loguear el secreto completo ni en error paths.

---

## 5. Plan de implementación en fases

### Fase 1 — Backend mínimo viable ✅ COMPLETADA (2026-05-25)

Commits en `main`: `b1e935c`, `8843348`, `98ef648`, `76def6b`, `b588954`.

1. ✅ Instalar `@modelcontextprotocol/sdk@1.29.0` (pin exacto).
2. ✅ Schemas Zod en `@tikora/core/src/lib/mcp-keys.ts` + `mcp-tools.ts` (flat, no subcarpeta).
3. ✅ Mongoose schema `McpApiKey` con índices `(tenantId, userId, revokedAt)` y `prefix`.
4. ✅ `McpKeyService` (generar/hashear/listar/revocar, + `regenerate` agregado después — ver §4.6).
5. ✅ `McpAuthService` + `McpAuthGuard`.
6. ✅ `McpServerService` con las 4 tools registradas en español, delegando a services existentes.
7. ✅ `McpController` con endpoint `POST /api/v1/mcp` y `StreamableHTTPServerTransport` stateless.
8. ✅ Endpoints REST `/api/v1/me/mcp-keys` (GET/POST/DELETE/regenerate).
9. ✅ Variables de entorno: `MCP_ENABLED`, `MCP_MAX_ACTIVE_KEYS_PER_USER`. `MCP_KEY_PREFIX` no se hizo configurable; vive en `mcp.constants.ts`.

Smoke curl validado: `initialize`, `tools/list` (las 4 tools con JSON Schema correcto), `tools/call listar_mis_tickets`, auth ok / inválida / revocada → todos los caminos OK.

### Fase 2 — Frontend ✅ COMPLETADA (2026-05-25)

Commits en `main`: `d13101c` (api + hooks), `15b4d8f` (página + dialogs + sidebar), más `e01f1e5` (back regenerate) y `0336cf7` (front regenerate).

1. ✅ Ruta `/perfil/mcp-keys` bajo `RequireAuth` (cualquier rol).
2. ✅ Hooks `useMcpKeys`, `useCreateMcpKey`, `useRevokeMcpKey`, `useRegenerateMcpKey`.
3. ✅ Componentes `McpKeysPage`, `CreateMcpKeyDialog`, `RegenerateMcpKeyDialog`, `RevealedSecretPanel`. Reusa `ConfirmDialog` para revoke.
4. ✅ Item "Claves MCP" agregado al sidebar del `AppShell` (no dropdown — el front no tiene avatar dropdown).

Smoke front en browser validado por el usuario: crear/copy/revocar/regenerar funcionan visualmente.

### Fase 3 — Tests y validación ⏳ PARCIAL

1. ✅ Unit tests del `McpKeyService` (generación, hashing, prefix length, cap, 404/409 de revoke y regenerate).
2. ✅ Unit tests de los handlers de cada tool con services mockeados (`tools.spec.ts`): delegación, filtro estado in-memory, mapeo de historial, bloqueo de tickets cerrados, mapeo de `ApiException` a `isError`.
3. ❌ Integration test del flow completo (crear key → request MCP real → tool ejecuta contra Mongo). Pendiente.
4. ❌ Property test del input de `crear_ticket` con `fast-check`. Pendiente (los tests actuales son ejemplos puntuales).
5. ❌ Smoke con el connector real en claude.ai → WhatsApp. Pendiente — bloquea cierre de v1 desde la perspectiva del usuario final.

### Fase 4 — Docs y release ⏳ EN CURSO

1. ✅ Este documento actualizado con paths, decisiones y comportamientos reales (estás leyendo el resultado).
2. ❌ Bloque en `tikora-api.md` para los nuevos endpoints REST `/me/mcp-keys` + `POST /mcp`. Pendiente.
3. ❌ Sección "MCP" en `tikora-setup.md` con pasos para configurar el connector en claude.ai. Pendiente.
4. ❌ Entrada nueva en `decisiones-tecnicas.md` resumiendo §2 de este doc. Pendiente.

---

## 6. Fuera de alcance v1

Se enumeran para que el siguiente plan los recoja, no para implementarlos ahora:

- **Adjuntos** (imágenes, PDFs). Requiere validar si el transporte MCP propaga blobs del cliente WhatsApp y, en su caso, integrarlos con el módulo `attachments` existente.
- **Notificaciones proactivas a Claude.** Si Claude permite tools tipo `pendingUpdates` que invoca al inicio de cada sesión, se podría agregar `get_my_pending_updates` para que avise el empleado de nuevas respuestas sin que pregunte.
- **OAuth flow para el connector.** Mejor UX que la API key (no hay que copiar/pegar el secreto), pero requiere implementar un IdP MCP completo. Para v1 la API key alcanza.
- **Reclasificación o reapertura desde la tool.** Si el ticket está cerrado, el empleado tiene que abrir uno nuevo o pedirle al agente que lo reabra desde la UI.
- **Multi-tenant connector único.** Cada empleado configura su propia key. No hay un connector "Tikora" compartido por toda la empresa.
- **Rate limiting por key.** No se implementa en v1; el cap natural lo da Claude (que llama tools secuencialmente) y los timeouts del back.

---

## 7. Riesgos y decisiones diferidas

| Riesgo / pregunta abierta                                                              | Estado / mitigación                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Que el contrato MCP de Anthropic cambie y rompa el server                              | SDK pineado en `1.29.0` (exact). Cuando se quiera actualizar, revisar release notes y volver a correr smoke curl + claude.ai.                                                                        |
| Que el connector de claude.ai exija un IdP OAuth y rechace API key plain               | Smoke curl contra el endpoint demostró que el Bearer token funciona end-to-end con el SDK. **Falta validar contra claude.ai real**: si lo rechaza, hay que envolver el endpoint con un mini-IdP MCP. |
| Que Claude no invoque las tools de forma consistente (decida no llamar `crear_ticket`) | Las `description` están escritas en español apuntando a casos concretos. Solo se valida con el smoke real desde WhatsApp; si hay problemas iterar las descriptions.                                  |
| Adopción real: que los empleados no quieran usar Claude para crear tickets             | Muestrear con 2-3 empleados después del piloto interno; si la adopción es baja, no escalar y volver a evaluar Business API.                                                                          |
| Posibilidad futura de querer push real del agente                                      | Migrar a opción Business API (Twilio o Meta Cloud) cuando haya presupuesto. El MCP server queda como canal alternativo o se retira.                                                                  |

---

## 8. Definición de "done" para la v1

- [x] Un empleado puede entrar a `/perfil/mcp-keys` en la UI, generar una key y copiar el secreto. **Configurar el connector en claude.ai y crear un ticket por WhatsApp queda pendiente de smoke real con el servicio externo.**
- [x] Un ticket creado vía MCP entra al mismo pipeline IA y queda indistinguible en Mongo de uno creado por la UI (validado por construcción: la tool `crear_ticket` delega a `TicketsService.create`).
- [x] El empleado puede listar sus tickets, ver detalle y agregar comentarios desde la tool (validado por unit tests; smoke real desde Claude pendiente).
- [x] La key se puede revocar y queda inválida inmediatamente (validado por smoke curl).
- [x] Un empleado no puede acceder a tickets de otro empleado ni de otro tenant — `TicketsService.getByIdForCaller` aplica los mismos filtros que la UI.
- [x] Tests pasan localmente; no hay errores de tipos (`pnpm exec nx test back` + `nx build back` + `nx build front` verdes).
- [x] Este documento actualizado con paths y comportamientos reales.
- [ ] **Smoke real claude.ai + WhatsApp** — único pendiente bloqueante para declarar v1 cerrada de cara al usuario final.
