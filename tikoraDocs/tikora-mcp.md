# Tikora — Integración MCP (WhatsApp via Claude)

> Plan de implementación de un servidor MCP para que los empleados puedan crear y consultar tickets de Tikora a través de Claude en WhatsApp. Documento de diseño previo a codear; cuando la implementación arranque, se actualiza con realidad del código y se agregan referencias a archivos concretos.

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

**Decisión:** el MCP server vive **dentro del back de NestJS** como módulo nuevo `apps/back/src/mcp/`, expuesto en un endpoint HTTP del mismo proceso (`POST /mcp` con transport HTTP streaming del SDK MCP). No se crea una app aparte en `apps/`.

**Por qué:** todo el dominio que el MCP necesita (users, tickets, classification queue, tenants) ya vive en el back. Levantar otra app Nx implicaría duplicar bootstrap, conexiones a Mongo y Redis, o exponer un cliente HTTP interno — overhead sin retorno para v1. Cuando crezca a punto de necesitar escalado independiente o procesos separados, se extrae con la misma interfaz pública.

### 4.2 Estructura del módulo

```
apps/back/src/mcp/
├── mcp.module.ts                # NestModule, importa UsersModule, TicketsModule, etc.
├── mcp.controller.ts            # POST /mcp — transport HTTP del SDK
├── services/
│   ├── mcp-server.service.ts    # Construye el McpServer y registra las tools
│   ├── mcp-key.service.ts       # Genera, hashea, valida y revoca API keys
│   └── mcp-auth.service.ts      # Resuelve key → AuthenticatedUser
├── tools/
│   ├── create-ticket.tool.ts    # Una tool por archivo
│   ├── list-my-tickets.tool.ts
│   ├── get-ticket.tool.ts
│   └── append-message.tool.ts
├── schemas/
│   └── mcp-key.schema.ts        # Mongoose schema de McpApiKey
└── guards/
    └── mcp-auth.guard.ts        # Guard que valida la API key en el header MCP
```

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

Formato de la API key: `tk_mcp_<24 chars base62>` (total 31 chars). El secreto completo se muestra **una sola vez** al generarla; después solo queda el prefix visible y el hash bcrypt.

Flujo de validación en cada request MCP:

1. El connector manda la key en el header `Authorization: Bearer tk_mcp_xxx...`.
2. `McpAuthGuard` extrae el header.
3. `McpAuthService` toma los primeros 12 chars (`tk_mcp_xxxxx`), busca todas las keys con ese prefix no revocadas (esperable: 1, máximo poquísimas por colisión de prefix).
4. Por cada candidata corre `bcrypt.compare` contra el secreto completo. Si matchea, resuelve `tenantId+userId` y los inyecta en el contexto MCP equivalente al `AuthenticatedUser` que el guard JWT usa para HTTP.
5. Actualiza `lastUsedAt` async (sin bloquear la response).

El hashing se hace con `bcryptjs`, la misma librería que ya usa el back para passwords.

### 4.5 Tools v1 — especificación

Cada tool recibe el contexto resuelto del auth (`tenantId`, `userId`, `role`) y delega a services existentes. No hace queries directas a Mongo.

**`create_ticket`**

```yaml
input:
  title: string (5..120)
  description: string (10..5000)
  areaId: optional string (ObjectId) # si Claude lo infiere; si no, queda al pipeline de clasificación
output:
  ticketId: string
  status: 'recibido'
  message: string # confirmación humana para Claude
behavior:
  - Llama a TicketsService.create({ tenantId, requesterId: userId, title, description, areaId? })
  - Eso encola job en ClassificationQueueService (flow idéntico a tickets desde UI)
  - No espera al pipeline IA; devuelve apenas el ticket queda persistido
```

**`list_my_tickets`**

```yaml
input:
  status: optional enum (recibido|escalado|en_progreso|sugerida|cerrado|requiere_revision_clasificacion)
  limit: optional int (1..20, default 10)
output:
  tickets: array of { ticketId, title, status, createdAt, lastAgentReplyAt? }
behavior:
  - Filtro fijo por tenantId + requesterId = userId
  - Orden descendente por createdAt
  - Cap duro en 20 para evitar respuestas larguísimas en Claude
```

**`get_ticket`**

```yaml
input:
  ticketId: string (ObjectId)
output:
  ticket: { ticketId, title, description, status, areaId, createdAt }
  lastAgentResponse: optional { content, agentName, sentAt }
  history: array of { kind: 'message'|'status_change', content, at }  # últimos 10 eventos
behavior:
  - Verifica que ticket.tenantId === auth.tenantId Y ticket.requesterId === auth.userId
  - Si no, devuelve error específico "ticket no encontrado o sin acceso"
  - Carga interactions del ticket (modulo interactions existente)
```

**`append_message_to_ticket`**

```yaml
input:
  ticketId: string (ObjectId)
  text: string (1..2000)
output:
  ok: boolean
  message: string
behavior:
  - Misma verificación de ownership que get_ticket
  - Solo permite append si ticket.status !== 'cerrado'
  - Crea una Interaction de tipo 'requester_message'
  - No re-clasifica (la clasificación inicial ya pasó); si se necesita escalamiento, queda para el agente
```

Schemas de input/output de cada tool van en `@tikora/core/src/mcp/` con Zod, y el SDK MCP los expone como JSON Schema a Claude.

### 4.6 UI de gestión de keys

Pantalla nueva en el front: **`/profile/mcp-keys`** (ruta privada, accesible por cualquier rol logueado).

Componentes:

- `McpKeysPage` — listado de keys del user (nombre, prefix, `lastUsedAt`, fecha de creación, botón "revocar").
- `CreateMcpKeyDialog` — input de nombre, botón "Generar", al confirmar muestra el secreto completo **una sola vez** con botón "copiar" y advertencia "guardalo ahora, no se vuelve a mostrar".
- `RevokeMcpKeyDialog` — confirmación destructiva.

Endpoints HTTP nuevos (autenticados con JWT, no con la propia key MCP):

- `GET /api/v1/me/mcp-keys` → lista del user actual
- `POST /api/v1/me/mcp-keys` → genera nueva, retorna el secreto completo en esta única respuesta
- `DELETE /api/v1/me/mcp-keys/:id` → marca `revokedAt` (no borra el registro, para auditoría)

Límite suave: máximo **5 keys activas por user**, configurable por env (`MCP_MAX_ACTIVE_KEYS_PER_USER=5`).

### 4.7 Logging y observabilidad

- Cada invocación de tool deja un log con `userId`, `tenantId`, `toolName`, `durationMs`, `success`.
- `keyId` (no el secreto) se incluye para correlación.
- Si la integración con Sentry está activa, los errores de tools se reportan con tag `source=mcp`.
- No loguear el secreto completo ni en error paths.

---

## 5. Plan de implementación en fases

### Fase 1 — Backend mínimo viable (~2 días de trabajo)

1. Instalar `@modelcontextprotocol/sdk` en el back.
2. Crear schemas Zod en `@tikora/core/src/mcp/` (key + cada tool I/O).
3. Mongoose schema `McpApiKey` + repository.
4. `McpKeyService` (generar, hashear, validar, listar, revocar).
5. `McpAuthService` + `McpAuthGuard`.
6. `McpServerService` con las 4 tools registradas, delegando a services existentes.
7. `McpController` con endpoint `POST /mcp` y transport HTTP del SDK.
8. Endpoints REST `/api/v1/me/mcp-keys` (GET/POST/DELETE).
9. Variables de entorno: `MCP_ENABLED`, `MCP_MAX_ACTIVE_KEYS_PER_USER`, `MCP_KEY_PREFIX` (default `tk_mcp_`).

### Fase 2 — Frontend (~1 día)

1. Ruta `/profile/mcp-keys` con guard de login.
2. Hooks `useMcpKeys`, `useCreateMcpKey`, `useRevokeMcpKey` (React Query).
3. Componentes `McpKeysPage`, `CreateMcpKeyDialog` (con flow del secreto de un solo uso), `RevokeMcpKeyDialog`.
4. Link a la página desde el menú del user (avatar dropdown).

### Fase 3 — Tests y validación (~1 día)

1. Unit tests del `McpKeyService` (generación, hashing, prefix collision).
2. Unit tests de cada tool (con services mockeados): casos felices, ownership cross-tenant, ticket no propio.
3. Integration test del flow completo: crear key → request MCP simulado → tool ejecuta → ticket persistido.
4. Property test del input de `create_ticket` (longitudes, caracteres, áreas inválidas) con `fast-check`.
5. Smoke manual: conectar el connector real en claude.ai, hacer las 4 operaciones desde WhatsApp.

### Fase 4 — Docs y release (~0.5 días)

1. Actualizar este documento con paths y comportamientos reales.
2. Bloque en `tikora-api.md` para los nuevos endpoints REST.
3. Sección "MCP" en `tikora-setup.md` con instrucciones para configurar el connector en claude.ai.
4. Entrada nueva en `decisiones-tecnicas.md` resumiendo §2 de este doc.

**Estimación total:** ~4.5 días de trabajo concentrado. No entra en el muestreo del 2026-06-01; arranca después.

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

| Riesgo / pregunta abierta                                                               | Mitigación / próxima acción                                                                                                        |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Que el contrato MCP de Anthropic cambie antes de release                                | Pinear versión del SDK en `package.json`; cuando arranquemos, validar release notes del SDK                                        |
| Que el connector MCP exija un IdP OAuth y no permita API key plain                      | Verificar en docs de Anthropic en el momento de codear; si es así, escalar fase 1 con un mini-IdP                                  |
| Que Claude no invoque las tools de forma consistente (decida no llamar `create_ticket`) | Iterar el `description` de cada tool; las descripciones bien escritas son lo que hace que Claude las elija                         |
| Adopción real: que los empleados no quieran usar Claude para crear tickets              | Muestrear con 2-3 empleados después del piloto interno; si la adopción es baja, no escalar y volver a evaluar Business API         |
| Posibilidad futura de querer push real del agente                                       | Migrar a opción Business API (Twilio o Meta Cloud) cuando haya presupuesto. El MCP server queda como canal alternativo o se retira |

---

## 8. Definición de "done" para la v1

- [ ] Un empleado puede entrar a `/profile/mcp-keys` en la UI, generar una key, copiar el secreto, configurar el connector en claude.ai y crear un ticket por WhatsApp.
- [ ] El ticket creado por MCP es indistinguible (en Mongo, en la UI del agente, en el pipeline IA) de un ticket creado por la UI.
- [ ] El empleado puede listar sus tickets, ver detalle y agregar comentarios desde Claude.
- [ ] La key se puede revocar y queda inválida inmediatamente.
- [ ] Un empleado no puede acceder a tickets de otro empleado, ni a tickets de otro tenant, aunque conozca el `ticketId`.
- [ ] Tests pasan en CI; no hay errores de tipos.
- [ ] Documento actualizado con paths y comandos reales.
