# Tikora Backend

## 1. Descripción General

Backend de **Tikora**, plataforma interna de gestión de tickets potenciada por IA. Construido con **NestJS** sobre un monorepo **Nx** con **pnpm**. Base de datos **MongoDB** vía Mongoose. Validación con **Zod** a través de `nestjs-zod`. Autenticación con **JWT** (access + refresh) y hashing con **bcryptjs**. Procesamiento asíncrono con **BullMQ + Redis**. IA generativa vía SDK oficial de **Anthropic**. Búsqueda semántica con **Transformers.js** (embeddings locales) y **MongoDB Atlas Vector Search**. Notificaciones en tiempo real con **SSE** y correos transaccionales con **Resend**.

El backend es mono-tenant en MVP pero está preparado para SaaS multi-empresa: toda entidad lleva `tenantId` desde el día uno y todas las queries lo aplican como filtro transversal.

---

## 2. Stack Tecnológico

- **Runtime:** Node.js
- **Framework:** NestJS
- **Monorepo:** Nx
- **Package manager:** pnpm
- **Lenguaje:** TypeScript
- **Base de datos:** MongoDB (Mongoose)
- **Validación:** Zod + nestjs-zod (schemas compartidos desde `@tikora/core`)
- **Autenticación:** JWT (`@nestjs/jwt`) + bcryptjs
- **Cola de jobs:** BullMQ + Redis
- **IA generativa:** SDK oficial de Anthropic (`@anthropic-ai/sdk`)
- **Embeddings:** Transformers.js (`@xenova/transformers`) — modelo `Xenova/multilingual-e5-small`
- **Búsqueda vectorial:** MongoDB Atlas Vector Search
- **Notificaciones realtime:** Server-Sent Events (SSE)
- **Email transaccional:** Resend
- **Testing:** Vitest + fast-check (property-based testing)
- **Bundler:** Webpack (vía `@nx/webpack`)
- **Documentación API:** Swagger (`@nestjs/swagger`)

---

## 3. Arquitectura y Patrones de Diseño

### 3.1 Modular Monolith (Feature-Based)

El backend sigue una arquitectura de **monolito modular** donde cada dominio de negocio es un módulo NestJS autocontenido. Los módulos se comunican entre sí mediante exports/imports de NestJS, nunca con llamadas HTTP internas.

Cada módulo encapsula su propia lógica: controllers, services, schemas, DTOs, eventos y tests. El `AppModule` raíz solo importa y registra los módulos de dominio. No hay lógica de negocio en `AppModule`.

**Módulos del MVP:**

| Módulo           | Responsabilidad                                                                                            |
| ---------------- | ---------------------------------------------------------------------------------------------------------- |
| `auth`           | Registro, login, refresh tokens, guard global JWT, decorador `@Public`.                                    |
| `users`          | CRUD de usuarios, perfil, asignación a una o varias áreas.                                                 |
| `tenants`        | Modelo y resolución del tenant. En MVP existe uno solo, pero el módulo está listo para crecer.             |
| `areas`          | CRUD de áreas, listado de agentes asignados, configuración de SLAs por área.                               |
| `tickets`        | Modelo central, CRUD, estados, asignación, historial de interacciones.                                     |
| `classification` | Orquestador del pipeline de clasificación por IA. Encola job, persiste resultado y dispara siguiente paso. |
| `ai-client`      | Cliente reutilizable del SDK de Anthropic. Encapsula prompt caching, retries, salida estructurada.         |
| `kb`             | Documentos de la base de conocimiento, generación de embeddings, búsqueda vectorial.                       |
| `auto-response`  | Generación de respuesta automática vía RAG. Activación efectiva en Fase 2.                                 |
| `notifications`  | Hub central de notificaciones. Recibe eventos de dominio y decide qué mandar y por dónde.                  |
| `email`          | Cliente del proveedor transaccional de correo.                                                             |
| `realtime`       | Gateway SSE para notificaciones en vivo del agente.                                                        |
| `sla`            | Cron de chequeo periódico, alertas previas y vencimientos.                                                 |
| `feedback`       | Feedback estructurado del agente sobre clasificación y respuestas IA.                                      |
| `health`         | Health check para readiness/liveness probes.                                                               |

**Mapa de dependencias entre módulos:**

```
AppModule
├── AuthModule ← UsersModule, TenantsModule
├── UsersModule ← TenantsModule, AreasModule
├── TenantsModule
├── AreasModule ← TenantsModule
├── TicketsModule ← UsersModule, AreasModule, NotificationsModule
├── ClassificationModule ← TicketsModule, AiClientModule
├── AiClientModule (standalone, reutilizable)
├── KbModule ← AiClientModule
├── AutoResponseModule ← TicketsModule, KbModule, AiClientModule, NotificationsModule
├── NotificationsModule ← EmailModule, RealtimeModule
├── EmailModule (standalone)
├── RealtimeModule (standalone)
├── SlaModule ← TicketsModule, NotificationsModule
├── FeedbackModule ← TicketsModule
└── HealthModule (standalone)
```

**Reglas:**

- Cada dominio vive en su propio módulo.
- Nunca crear lógica de negocio en `AppModule`.
- Toda la lógica de negocio vive en services, nunca en controllers.
- La comunicación entre módulos es por inyección de dependencias, nunca por llamadas HTTP locales.

---

### 3.2 DTO Pattern con Validación Compartida (Zod + nestjs-zod)

Los schemas de validación se definen una sola vez en `packages/core` usando **Zod** y se comparten entre frontend y backend. En NestJS, cada schema se envuelve con `createZodDto()` de `nestjs-zod` para generar el DTO. El pipe global `ZodValidationPipe` valida automáticamente todos los DTOs en todos los endpoints.

```
packages/core (Zod schema) → Frontend (zodResolver) + Backend (createZodDto)
```

**Reglas:**

- Todo schema de validación se define en `packages/core`, jamás en el backend directamente.
- Todo DTO de NestJS usa `createZodDto(Schema)`. No se usa `class-validator`.
- El pipe `ZodValidationPipe` está aplicado globalmente en `main.ts`.
- Los controllers nunca validan manualmente; la validación es responsabilidad del pipe.
- Cuando un endpoint requiere transformaciones específicas del backend (ej. `email.toLowerCase()`), se hace en el service tras la validación, no en el schema.

---

### 3.3 Multi-Tenant con `tenantId` en JWT

Toda entidad del dominio lleva un campo `tenantId` desde el día uno. Al hacer login, el backend resuelve el tenant del usuario y lo embebe como claim del JWT. Un guard global lee el JWT, extrae el `tenantId` y lo inyecta en el `request` para que los services lo usen como filtro automático en todas las queries.

**Componentes clave:**

- `JwtAuthGuard` valida el token y popula `request.user = { userId, tenantId, role, areaIds }`.
- `TenantContextService` expone el `tenantId` actual a cualquier service vía inyección.
- Todos los repositorios extienden de un `TenantAwareRepository` base que aplica `{ tenantId }` automáticamente en cada query.
- Los Mongoose schemas tienen un índice compuesto `(tenantId, ...otros)` en todas las consultas frecuentes.

**Reglas:**

- Ninguna query de Mongoose se ejecuta sin filtro de `tenantId`. Si un endpoint legítimamente cruza tenants (operación de plataforma), debe declararse explícitamente y registrarse en logs.
- El `tenantId` viaja siempre desde el JWT, nunca desde un body o query parameter del cliente.
- En MVP existe un único tenant configurado vía variable de entorno `DEFAULT_TENANT_ID`. El sistema sigue resolviéndolo del JWT, simplemente todos los usuarios pertenecen al mismo tenant.

---

### 3.4 Guard Pattern (JWT + `@Public`)

La autenticación se implementa con un **guard global** de NestJS que intercepta todas las peticiones y valida el JWT del header `Authorization: Bearer {token}`.

Los endpoints que no requieren autenticación se marcan con un decorador custom `@Public()` que los excluye del guard.

**Endpoints públicos del MVP** (excluidos del `JwtAuthGuard` global):

- `POST /api/v1/auth/login`
- `POST /api/v1/auth/refresh` _(autenticado por la cookie httpOnly de refresh, no por bearer)_
- `POST /api/v1/auth/logout` _(autenticado por la cookie httpOnly de refresh)_
- `GET /api/v1/health`

**Endpoints autenticados especiales:**

- `POST /api/v1/auth/sse-ticket` — emite un **ticket corto** (60–120 s, single-use, firmado, vinculado a `userId` y `tenantId`) que el cliente usa para autenticar la apertura del stream SSE. Este endpoint sí requiere `Authorization: Bearer {accessToken}`.

**Reglas:**

- Todo endpoint nuevo es **protegido por defecto**. Solo se marca `@Public()` cuando es estrictamente necesario.
- En MVP no hay registro abierto: los usuarios los crea el administrador desde el panel. No existe `POST /auth/register` público.
- Los mensajes de error de autenticación son genéricos (ej. "credenciales inválidas", nunca "el email no existe" o "la contraseña es incorrecta").
- El **access token** expira en **15 minutos** y viaja en `Authorization: Bearer {token}`.
- El **refresh token** expira en **7 días**, **rota en cada uso** y viaja exclusivamente en una cookie `HttpOnly`, `SameSite=Lax`, `Path=/api/v1/auth`. JavaScript no la lee; el browser la maneja.
- El flag `Secure` de la cookie se aplica solo cuando se sirve por HTTPS (controlado por env `COOKIE_SECURE`). En dev local sobre HTTP queda desactivado.
- Bcrypt usa **10 salt rounds**.

**Respuesta de `POST /auth/login`:**

```json
{ "accessToken": "...", "user": { "id": "...", "email": "...", "fullName": "...", "role": "...", "areaIds": [...] } }
```

Junto con un header `Set-Cookie` con el refresh token. **El refresh token nunca aparece en el body del response.**

**Respuesta de `POST /auth/refresh`:**

```json
{ "accessToken": "..." }
```

Junto con un `Set-Cookie` que **rota** el refresh token (la cookie anterior queda inválida en backend).

**`POST /auth/logout`:** invalida el refresh token en backend y devuelve un `Set-Cookie` que limpia la cookie del cliente. Responde `204`.

---

### 3.5 State Machine Pattern (Ciclo de Vida del Ticket)

El ticket sigue una máquina de estados explícita. **Toda transición pasa por un service que la valida** antes de persistir; los controllers no modifican el campo `estado` directamente en la base.

**Estados:**

| Estado                            | Significado                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `recibido`                        | Recién creado, aún no clasificado.                                                       |
| `clasificado`                     | La IA emitió clasificación. Estado transitorio que decide siguiente paso.                |
| `requiere_revision_clasificacion` | Confianza por debajo del umbral. Un humano debe asignar el área.                         |
| `escalado`                        | Asignado a un área, esperando que un agente lo tome.                                     |
| `en_progreso`                     | Un agente lo tomó explícitamente con la acción "Tomar ticket".                           |
| `cerrado`                         | Estado terminal de resolución (manual o auto). Reabrible dentro de la ventana de gracia. |
| `reabierto`                       | Estado transitorio al volver del cierre. Pasa rápidamente a `en_progreso`.               |
| `cancelado`                       | Estado terminal. Cancelado por el solicitante antes de ser tomado. No reabrible.         |

**Diagrama del flujo:**

```
        ┌──────────┐
        │ recibido │
        └────┬─────┘
             │ clasificación IA
       ┌─────┴─────────────┐
       ▼                   ▼
┌─────────────┐  ┌─────────────────────────────┐
│ clasificado │  │ requiere_revision_clasif.   │
└──┬───┬──────┘  └────────┬──────┬─────────────┘
   │   │ auto IA          │      │
   │   ▼                  ▼      │
   │  ┌─────────┐  ┌────────────┐│
   │  │ cerrado │◄─│ clasificado││
   │  └────┬────┘  └────────────┘│
   │ esca  │ reab.               │
   ▼ lar   ▼                     ▼
┌──────────┐ ┌──────────┐
│ escalado │ │ reabierto│
└────┬─────┘ └────┬─────┘
     │ tomar     │ con último agente
     ▼            ▼
┌──────────────┐
│ en_progreso  │──── resolver ───► cerrado
└──────────────┘

(cancelar: recibido | clasificado | requiere_rev | escalado → cancelado)
```

**Matriz de transiciones válidas:**

| Desde ↓ → Hacia                   | clasificado | requiere_rev |    escalado    |      en_progreso       |    cerrado    | reabierto | cancelado |
| --------------------------------- | :---------: | :----------: | :------------: | :--------------------: | :-----------: | :-------: | :-------: |
| `recibido`                        |     ✅      |      ✅      |       —        |           —            |       —       |     —     |    ✅     |
| `clasificado`                     |      —      |      —       |       ✅       |           —            | ✅ (auto-IA)  |     —     |    ✅     |
| `requiere_revision_clasificacion` |     ✅      |      —       |       ✅       |           —            |       —       |     —     |    ✅     |
| `escalado`                        |      —      |      —       |       —        |           ✅           |       —       |     —     |    ✅     |
| `en_progreso`                     |      —      |      —       | ✅ (reasignar) |           —            | ✅ (resolver) |     —     |     —     |
| `cerrado`                         |      —      |      —       |       —        |           —            |       —       |    ✅     |     —     |
| `reabierto`                       |      —      |      —       | ✅ (era auto)  | ✅ (con último agente) |       —       |     —     |     —     |
| `cancelado`                       |      —      |      —       |       —        |           —            |       —       |     —     |     —     |

**Reglas:**

- Toda transición pasa por `TicketStateMachineService.transition(ticketId, targetState, context)`. El service valida que la transición sea legal, persiste el cambio, registra una entrada en el historial e dispara el evento de dominio correspondiente.
- El estado `cerrado` admite reapertura solo durante **5 días hábiles**. Pasado ese plazo el cron de SLA marca el ticket como cierre definitivo.
- La metadata de cierre incluye `resolutionType: 'manual' | 'auto'`, `resolvedBy` (agente o `'ia'`) y `resolvedAt`.
- La acción "Tomar ticket" del agente es **explícita**: leer o abrir un ticket no lo transiciona a `en_progreso`.

---

### 3.6 Modelo de Permisos por Matriz (RBAC)

Cuatro roles fijos: **empleado**, **agente**, **líder**, **admin**. Los permisos se definen por matriz y se evalúan en guards y services. No se usa una librería externa de RBAC; los chequeos en cada endpoint son suficientes para el alcance actual.

**Roles:**

- **Empleado solicitante** — usuario autenticado del tenant que crea tickets.
- **Agente** — pertenece a una o más áreas (`areaIds: ObjectId[]`). Trabaja tickets de sus áreas.
- **Líder de área** — supervisa una o más áreas. Visibilidad y métricas de su área. Puede gestionar agentes y KB del área.
- **Administrador** — control total del tenant.

**Matriz de permisos:**

| Acción                                       | Empleado | Agente | Líder | Admin |
| -------------------------------------------- | :------: | :----: | :---: | :---: |
| Crear ticket                                 |    ✅    |   ✅   |  ✅   |  ✅   |
| Ver sus propios tickets                      |    ✅    |   ✅   |  ✅   |  ✅   |
| Cancelar ticket propio (antes de ser tomado) |    ✅    |   ✅   |  ✅   |  ✅   |
| Ver tickets del área                         |    —     |   ✅   |  ✅   |  ✅   |
| Ver tickets de todas las áreas               |    —     |   —    |   —   |  ✅   |
| Tomar / asignarse ticket                     |    —     |   ✅   |  ✅   |  ✅   |
| Reasignar dentro del área                    |    —     |   ✅   |  ✅   |  ✅   |
| Reasignar a otra área                        |    —     |   —    |  ✅   |  ✅   |
| Resolver / cerrar ticket                     |    —     |   ✅   |  ✅   |  ✅   |
| Aprobar/editar respuesta sugerida por IA     |    —     |   ✅   |  ✅   |  ✅   |
| Ver métricas del área                        |    —     |   —    |  ✅   |  ✅   |
| Ver métricas globales del tenant             |    —     |   —    |   —   |  ✅   |
| Configurar áreas, SLAs, umbrales de IA       |    —     |   —    |   —   |  ✅   |
| Cargar/editar KB del área                    |    —     |   —    |  ✅   |  ✅   |
| Cargar/editar KB global                      |    —     |   —    |   —   |  ✅   |
| Gestionar usuarios del área                  |    —     |   —    |  ✅   |  ✅   |
| Gestionar todos los usuarios                 |    —     |   —    |   —   |  ✅   |

**Reglas:**

- Decoradores `@Roles(...roles)` y `@RequiresArea()` aplicados en controllers.
- Los services validan permisos finos (ej. "este agente pertenece al área del ticket") cuando el rol solo no alcanza.
- Un usuario con `areaIds = []` siendo agente es inválido y debe rechazarse en validación.

---

### 3.7 Pipeline de IA con BullMQ + SDK Anthropic

La clasificación de tickets, generación de auto-respuesta, generación de embeddings y envío de correos corren como **jobs en background** en BullMQ + Redis. El POST de creación de ticket responde inmediatamente con el ticket en estado `recibido` y la clasificación llega vía notificación cuando el job termina.

**Colas principales:**

| Cola             | Job                                         | Trigger                                                                          |
| ---------------- | ------------------------------------------- | -------------------------------------------------------------------------------- |
| `classification` | Clasificar ticket con Claude Haiku          | Al crear ticket                                                                  |
| `auto-response`  | Generar respuesta vía RAG con Claude Sonnet | Cuando un ticket clasificado cumple las 3 condiciones de auto-respuesta          |
| `embeddings`     | Generar embeddings de chunks de KB          | Al cargar/editar documento de KB                                                 |
| `email`          | Enviar correo transaccional                 | Eventos de notificación                                                          |
| `sla-check`      | Cron periódico de chequeo de SLAs           | Cada `SLA_CRON_INTERVAL_MS` (default 5 min, módulo `sla` con `@nestjs/schedule`) |

**Cliente Anthropic (`AiClientService`):**

- Centraliza llamadas al SDK oficial.
- Configurable por modelo vía variable de entorno (`ANTHROPIC_MODEL_CLASSIFICATION`, `ANTHROPIC_MODEL_RESPONSE`).
- Aprovecha **prompt caching** de Anthropic para amortizar el costo del system prompt + KB en RAG.
- Estrategia de retries con backoff exponencial (3 intentos por defecto, configurable).
- Salida estructurada con JSON schema cuando el contexto lo requiere (clasificación).

**Clasificación:**

- Entrada: `asunto + cuerpo + áreas disponibles + taxonomía del tenant`.
- Salida JSON: `{ area, prioridad, confianza, resumen, tags[] }`.
- System prompt versionado en `apps/back/src/classification/templates/classification-prompt.md`.
- La versión del prompt se persiste en cada `Clasificación` para evaluación A/B y comparación histórica.
- Si `confianza < UMBRAL_CONFIANZA_CLASIFICACION` (default `0.7`, configurable por tenant), el ticket pasa a `requiere_revision_clasificacion`.

**Auto-respuesta (Fase 2+):**

Solo se intenta auto-responder si se cumplen **las tres condiciones**:

1. Prioridad clasificada como **baja**.
2. Confianza de clasificación por encima del umbral configurado.
3. La búsqueda en la KB devuelve fragmentos con relevancia suficiente (`UMBRAL_RELEVANCIA_KB`).

Si alguna condición falla, el ticket se escala normalmente.

Cada respuesta de IA registra: prompt usado, respuesta generada, fuentes de la KB consultadas, confianza, modelo y versión.

**Reglas:**

- Los system prompts viven como archivos `.md` en `templates/` de cada módulo. Nunca inline en el código.
- La API key (`ANTHROPIC_API_KEY`) y los modelos se configuran exclusivamente por variable de entorno.
- Toda salida de la IA pasa por validación Zod antes de persistirse: si el JSON no cumple el schema, el job falla y se reintenta.
- Los reintentos por fallo de la API de Claude son automáticos. Tras agotarse, el ticket se marca como `requiere_revision_clasificacion` y se notifica al líder del área (cuando el área es resoluble) o al admin.

---

### 3.8 RAG con Transformers.js + Atlas Vector Search

La base de conocimiento usa embeddings generados localmente con **Transformers.js** y búsqueda vectorial nativa de **MongoDB Atlas Vector Search**.

**Flujo de indexación (al cargar/editar un documento):**

1. El admin o líder sube un archivo `.md` o `.txt` (≤ 200 KB).
2. Se valida formato y tamaño en el endpoint.
3. Se encola un job en `embeddings` con el contenido del documento.
4. El worker chunkea el texto en fragmentos de 500-800 tokens con overlap de 100.
5. Cada chunk se transforma a vector con el modelo `Xenova/multilingual-e5-small` (384 dimensiones).
6. Los chunks + embeddings se guardan en la colección `kb_chunks` con `{ tenantId, documentId, version, areaIds, content, embedding, position }`.
7. La versión anterior queda archivada (no se borra) y la nueva pasa a ser la activa.

**Flujo de búsqueda (al evaluar auto-respuesta):**

1. Se genera el embedding de `asunto + cuerpo` del ticket con el mismo modelo.
2. Se hace `$vectorSearch` en Atlas filtrando por `tenantId`, `versión activa` y `áreas relevantes`.
3. Se traen los `top-k` chunks (k = 5 por defecto).
4. Si el score máximo es menor que `UMBRAL_RELEVANCIA_KB` (default `0.75`), no se intenta auto-responder.
5. Los chunks recuperados se inyectan en el prompt de generación junto con la pregunta del usuario.
6. La respuesta de Claude se devuelve junto con las referencias a los chunks utilizados.

**Reglas:**

- El modelo de embeddings vive como singleton dentro del worker de BullMQ. Se carga una sola vez al arranque del worker.
- Las búsquedas siempre filtran por `tenantId`. Sin excepción.
- Los embeddings se regeneran solo cuando cambia el contenido del documento, no en cada arranque.
- La interfaz `EmbeddingProvider` permite cambiar de motor sin tocar el resto del módulo.

---

### 3.9 Notificaciones (SSE + Email)

El módulo `notifications` es el hub central que recibe eventos de dominio (`TicketEscalated`, `TicketAssigned`, `SlaApproaching`, etc.) y decide qué canales activar.

**Canales:**

- **Email** (módulo `email`): correos transaccionales vía Resend. Templates en español.
- **Realtime** (módulo `realtime`): SSE. Cada cliente conectado tiene un stream `/api/v1/notifications/stream` autenticado por **ticket corto**. Como `EventSource` no permite enviar headers, el cliente primero llama `POST /api/v1/auth/sse-ticket` (autenticado con bearer normal) y obtiene un ticket de vida corta firmado. Luego abre el stream con `?ticket={ticket}`. El backend valida el ticket en el handshake (firma, expiración, single-use), lo marca como consumido y mantiene el stream abierto. Tras desconexión, el cliente debe pedir un ticket nuevo antes de reabrir.

**Eventos y canales asociados:**

| Evento                                        |         Email         |   Realtime   |
| --------------------------------------------- | :-------------------: | :----------: |
| Ticket creado                                 |   ✅ al solicitante   |      —       |
| Ticket escalado a área                        | ✅ a agentes del área |      ✅      |
| Ticket asignado a agente                      |     ✅ al agente      |      ✅      |
| Ticket actualizado                            |   ✅ al solicitante   | ✅ al agente |
| SLA próximo a vencer                          |     ✅ al agente      |      ✅      |
| SLA vencido                                   |      ✅ al líder      |      ✅      |
| Respuesta IA pendiente de aprobación (Fase 2) |           —           | ✅ al agente |
| Auto-respuesta enviada                        |   ✅ al solicitante   |      —       |

**Reglas:**

- El módulo `notifications` no envía correos ni eventos directamente: delega a `email` y `realtime`.
- Cada usuario tiene preferencias (a futuro): qué eventos recibe por correo y cuáles solo en realtime.
- Los correos al usuario solicitante incluyen el contenido completo del ticket o respuesta. En MVP la respuesta del agente sigue saliendo por correo, no desde la plataforma.
- El cliente SSE reconecta automáticamente; el server soporta reanudación de stream con `Last-Event-ID`.

---

### 3.10 Convenciones de API REST

**Prefijo global:** `/api/v1` (versionado desde el inicio).

**Documentación:** Swagger en `/api/docs`.

**Nomenclatura de rutas:**

- Sustantivos en plural para recursos: `/tickets`, `/users`, `/areas`.
- Kebab-case en rutas compuestas: `/auth/login`, `/auth/refresh`, `/kb-documents`.
- IDs como parámetros de ruta: `/tickets/:id`, `/areas/:id/agents`.
- Rutas anidadas para sub-recursos: `/tickets/:id/interactions`, `/tickets/:id/feedback`.

**Verbos HTTP:**

| Verbo    | Uso                                      | Ejemplo                                                 |
| -------- | ---------------------------------------- | ------------------------------------------------------- |
| `GET`    | Leer recurso(s)                          | `GET /tickets`, `GET /tickets/:id`                      |
| `POST`   | Crear recurso o disparar acción          | `POST /tickets`, `POST /auth/login`                     |
| `PUT`    | Reemplazar recurso completo              | `PUT /users/:id`                                        |
| `PATCH`  | Actualizar parcialmente o cambiar estado | `PATCH /tickets/:id/take`, `PATCH /tickets/:id/resolve` |
| `DELETE` | Eliminar recurso                         | `DELETE /kb-documents/:id`                              |

**Códigos de respuesta:**

| Código | Uso                                                            |
| ------ | -------------------------------------------------------------- |
| `200`  | Operación exitosa (GET, PATCH, PUT)                            |
| `201`  | Recurso creado (POST)                                          |
| `204`  | Operación exitosa sin body (DELETE)                            |
| `400`  | Validación fallida (`ZodValidationPipe`)                       |
| `401`  | No autenticado (JWT inválido o ausente)                        |
| `403`  | Autenticado pero sin permisos                                  |
| `404`  | Recurso no encontrado                                          |
| `409`  | Conflicto (ej. transición de estado inválida, email duplicado) |
| `500`  | Error interno del servidor                                     |

**Formato de respuesta exitosa:**

```json
// Recurso individual
{ "id": "...", "asunto": "...", "estado": "recibido" }

// Lista
[{ "id": "...", "asunto": "..." }, ...]

// Acción (login)
{ "accessToken": "...", "user": { ... } }
// + Set-Cookie con el refresh token (httpOnly). El refresh nunca viaja en el body.
```

**Formato de error:**

```json
{
  "statusCode": 400,
  "code": "TICKET_TRANSITION_INVALID",
  "message": "Descripción del error en español",
  "details": [...]
}
```

- `code` es un identificador estable, en SCREAMING_SNAKE_CASE, para que el cliente pueda mapearlo a comportamientos específicos sin parsear el `message`.
- `message` está siempre en español y es seguro mostrar al usuario.
- `details` es opcional. Para errores de validación Zod (`400`) contiene el array de issues con `path` y `message`.

**Reglas:**

- Mensajes de error visibles al usuario en **español**.
- Mensajes de auth genéricos (no revelar si el email existe).
- Nunca exponer `_id` de Mongo en rutas públicas o tokens; usar `id` como string.
- Todos los endpoints documentados con decoradores Swagger (`@ApiTags`, `@ApiOperation`, `@ApiResponse`).
- Usar `@HttpCode()` cuando el código por defecto no aplique.

---

## 4. Estructura del Proyecto

```
apps/back/
├── src/
│   ├── main.ts                          # Bootstrap NestJS
│   ├── app/
│   │   ├── app.module.ts                # Módulo raíz (registra todos los dominios)
│   │   └── app.controller.ts            # (vacío en MVP)
│   ├── auth/
│   │   ├── auth.module.ts
│   │   ├── controllers/
│   │   │   └── auth.controller.ts
│   │   ├── services/
│   │   │   └── auth.service.ts
│   │   ├── guards/
│   │   │   ├── jwt-auth.guard.ts
│   │   │   └── roles.guard.ts
│   │   ├── decorators/
│   │   │   ├── public.decorator.ts
│   │   │   └── roles.decorator.ts
│   │   ├── dto/
│   │   └── __tests__/
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── schemas/
│   │   │   └── user.schema.ts
│   │   ├── dto/
│   │   └── __tests__/
│   ├── tenants/
│   ├── areas/
│   ├── tickets/
│   │   ├── tickets.module.ts
│   │   ├── controllers/
│   │   ├── services/
│   │   │   ├── tickets.service.ts
│   │   │   └── ticket-state-machine.service.ts
│   │   ├── schemas/
│   │   ├── dto/
│   │   ├── events/
│   │   │   ├── ticket-created.event.ts
│   │   │   ├── ticket-classified.event.ts
│   │   │   └── ...
│   │   └── __tests__/
│   ├── classification/
│   │   ├── classification.module.ts
│   │   ├── services/
│   │   ├── processors/                  # Workers BullMQ
│   │   ├── templates/
│   │   │   └── classification-prompt.md
│   │   └── __tests__/
│   ├── ai-client/
│   │   ├── ai-client.module.ts
│   │   ├── services/
│   │   │   └── ai-client.service.ts
│   │   └── __tests__/
│   ├── kb/
│   │   ├── kb.module.ts
│   │   ├── controllers/
│   │   ├── services/
│   │   ├── processors/
│   │   ├── schemas/
│   │   └── __tests__/
│   ├── auto-response/
│   │   ├── auto-response.module.ts
│   │   ├── services/
│   │   ├── processors/
│   │   ├── templates/
│   │   │   └── response-prompt.md
│   │   └── __tests__/
│   ├── notifications/
│   │   ├── notifications.module.ts
│   │   ├── services/
│   │   ├── events/                      # Listeners de eventos de dominio
│   │   └── __tests__/
│   ├── email/
│   │   ├── email.module.ts
│   │   ├── services/
│   │   ├── templates/                   # Templates HTML/MJML
│   │   └── __tests__/
│   ├── realtime/
│   │   ├── realtime.module.ts
│   │   ├── controllers/
│   │   │   └── sse.controller.ts
│   │   └── __tests__/
│   ├── sla/
│   │   ├── sla.module.ts
│   │   ├── services/
│   │   ├── crons/
│   │   └── __tests__/
│   ├── feedback/
│   └── health/
├── .env / .env.example
├── Dockerfile
├── project.json
├── tsconfig.json / tsconfig.app.json
└── webpack.config.js
```

### Convenciones de estructura por feature

```
src/{feature}/
├── {feature}.module.ts      # Módulo NestJS en la raíz del feature
├── controllers/             # Controllers HTTP
├── services/                # Lógica de negocio
├── processors/              # Workers BullMQ (cuando aplica)
├── schemas/                 # Schemas Mongoose (cuando aplica)
├── dto/                     # createZodDto envolviendo schemas de @tikora/core
├── events/                  # Eventos de dominio que emite o consume el módulo
├── templates/               # System prompts IA / templates de email (cuando aplica)
├── guards/ | decorators/    # Solo en módulos que los exporten (auth)
├── crons/                   # Tareas programadas (cuando aplica)
└── __tests__/               # Tests unitarios e integración
```

**Reglas al crear un nuevo feature:**

1. Crear la carpeta en `src/{nombre-feature}/`.
2. El `{feature}.module.ts` va en la raíz del feature.
3. Separar archivos en subcarpetas por tipo (controllers, services, etc.).
4. Registrar el módulo en `app.module.ts`.
5. DTOs con `createZodDto()` y schemas tomados de `@tikora/core`.
6. Tests en `__tests__/` con nomenclatura `{archivo}.spec.ts`.
7. System prompts y templates de email en `templates/` como archivos.

---

## 5. Paquete Compartido: `@tikora/core`

Ubicado en `packages/core/`. Exporta schemas Zod, tipos derivados y utilidades compartidas entre frontend y backend.

**Contenido principal:**

- Schemas de validación de cada entidad (`UserSchema`, `TicketSchema`, `AreaSchema`, `KbDocumentSchema`).
- Schemas de payloads (`CreateTicketSchema`, `LoginSchema`, `ClassificationOutputSchema`).
- Enums compartidos (`TicketState`, `Priority`, `Role`).
- Tipos inferidos (`type Ticket = z.infer<typeof TicketSchema>`).
- Constantes (`APP_NAME`, `DEFAULT_PAGE_SIZE`, `MAX_ATTACHMENT_SIZE_MB`).

**Reglas:**

- Los schemas se definen una sola vez y se consumen desde ambos lados.
- El backend extiende cada schema con `createZodDto()` cuando lo necesita como DTO.
- El frontend lo consume con `zodResolver` para formularios.
- Cambios al paquete son cambios cross-stack: hay que verificar que ambos lados compilen.

---

## 6. Modelo de Datos

Todas las entidades llevan `tenantId`, `createdAt`, `updatedAt`. Las queries siempre filtran por `tenantId`.

**Entidades principales:**

- **User** — `{ id, tenantId, email, fullName, passwordHash, role, areaIds[], active, createdAt, updatedAt }`.
- **Tenant** — `{ id, name, domainAliases[], settings (umbrales IA, calendario, etc.), createdAt }`.
- **Area** — `{ id, tenantId, name, description, agentIds[], leaderIds[], slas: { alta, media, baja }, createdAt }`.
- **Ticket** — `{ id, tenantId, requesterId, asunto, cuerpo, attachments[], estado, prioridad, areaId, classificationId, autoResponseId, slaDeadline, lastAssignedAgentId, resolutionType, resolvedBy, resolvedAt, history[], createdAt, updatedAt }`.
- **Interaction** — `{ id, ticketId, authorId, type ('usuario' | 'agente' | 'ia' | 'sistema'), content, createdAt }`.
- **Classification** — `{ id, ticketId, area, prioridad, confianza, resumen, tags[], modelo, promptVersion, createdAt }`.
- **AiResponse** — `{ id, ticketId, content, sourceChunkIds[], confianza, estado ('sugerida' | 'aprobada' | 'editada' | 'enviada' | 'descartada'), approvedBy, modelo, promptVersion, createdAt }`.
- **KbDocument** — `{ id, tenantId, title, content, areaIds[], scope ('global' | 'area'), version, active, uploadedBy, createdAt, updatedAt }`.
- **KbChunk** — `{ id, tenantId, documentId, documentVersion, position, content, embedding[384], createdAt }`.
- **Notification** — `{ id, tenantId, recipientId, type, ticketId, read, createdAt }`.

---

## 7. Configuración Clave

**Variables de entorno** (archivo `.env.example` versionado, `.env` en `.gitignore`):

| Variable                         | Descripción                                       | Ejemplo                        |
| -------------------------------- | ------------------------------------------------- | ------------------------------ |
| `PORT`                           | Puerto HTTP del backend                           | `3001`                         |
| `MONGODB_URI`                    | Cadena de conexión a Mongo Atlas                  | `mongodb+srv://...`            |
| `REDIS_URL`                      | Conexión a Redis para BullMQ                      | `redis://localhost:6379`       |
| `JWT_SECRET`                     | Secreto del access token                          | (random 64 chars)              |
| `JWT_REFRESH_SECRET`             | Secreto del refresh token                         | (random 64 chars)              |
| `JWT_ACCESS_EXPIRES_IN`          | Vencimiento access token                          | `15m`                          |
| `JWT_REFRESH_EXPIRES_IN`         | Vencimiento refresh token                         | `7d`                           |
| `SSE_TICKET_EXPIRES_IN`          | Vencimiento del ticket de apertura SSE            | `90s`                          |
| `COOKIE_SECURE`                  | Activa flag `Secure` en cookies (solo HTTPS).     | `false` (dev) / `true` (prod)  |
| `COOKIE_SAMESITE`                | Política `SameSite` de cookies.                   | `lax`                          |
| `BCRYPT_SALT_ROUNDS`             | Salt rounds para bcryptjs                         | `10`                           |
| `DEFAULT_TENANT_ID`              | Tenant del MVP mono-empresa                       | `tenant-default`               |
| `ANTHROPIC_API_KEY`              | API key de Anthropic                              | `sk-ant-...`                   |
| `ANTHROPIC_MODEL_CLASSIFICATION` | Modelo para clasificación                         | `claude-haiku-4-5-20251001`    |
| `ANTHROPIC_MODEL_RESPONSE`       | Modelo para generación de respuestas              | `claude-sonnet-4-6`            |
| `UMBRAL_CONFIANZA_CLASIFICACION` | Confianza mínima para no requerir revisión humana | `0.7`                          |
| `UMBRAL_RELEVANCIA_KB`           | Score mínimo de chunk de KB para auto-respuesta   | `0.75`                         |
| `EMBEDDING_MODEL_NAME`           | Modelo de Transformers.js                         | `Xenova/multilingual-e5-small` |
| `RESEND_API_KEY`                 | API key de Resend                                 | `re_...`                       |
| `EMAIL_FROM`                     | Remitente de los correos                          | `Tikora <noreply@tikora.app>`  |
| `UPLOADS_DIR`                    | Directorio local de adjuntos                      | `./uploads`                    |
| `MAX_ATTACHMENT_SIZE_MB`         | Tamaño máximo por adjunto                         | `10`                           |
| `MAX_ATTACHMENTS_PER_TICKET`     | Cantidad máxima por ticket                        | `5`                            |
| `SLA_BUSINESS_HOURS_START`       | Inicio de jornada hábil                           | `07:00`                        |
| `SLA_BUSINESS_HOURS_END`         | Fin de jornada hábil                              | `18:00`                        |
| `SLA_REOPEN_GRACE_DAYS`          | Días hábiles para admitir reapertura              | `5`                            |
| `LOG_LEVEL`                      | Nivel de logs                                     | `info`                         |

**Configuración runtime:**

- Prefijo global: `/api/v1`.
- **CORS:** habilitado para los orígenes definidos en `CORS_ORIGINS` (lista separada por coma) con `credentials: true` para que la cookie de refresh viaje. En dev y prod el deployment esperado es **same-origin** detrás de un reverse proxy (proxy de Vite en dev, nginx/caddy en prod), por lo que CORS cross-origin es solo un fallback.
- Validación global con `ZodValidationPipe`.
- Swagger en `/api/docs`.

---

## 8. Testing

**Framework:** Vitest.

**Metodología:**

- **Unit tests** para services, validadores, máquinas de estado y funciones puras.
- **Property-based tests** con `fast-check` para invariantes críticas (transiciones de estado, generación de SLAs, validación de schemas Zod, multi-tenant isolation).
- **Integration tests** para controllers usando `Test.createTestingModule()` con Mongo en memoria.

**Ubicación:** `src/{feature}/__tests__/`.

**Mocks:** decoradores y dependencias de NestJS (`@Injectable`, `@InjectModel`, `BullMQ`) se mockean con `vi.mock()`.

**Comandos:**

```bash
npx vitest run                          # Todos los tests
npx vitest run apps/back/src/auth   # Tests de un módulo
npx vitest watch                        # Modo watch durante desarrollo
```

**Invariantes obligatorias a cubrir con PBT:**

- Ninguna transición inválida del ticket es aceptada por la máquina de estados.
- Ninguna query devuelve documentos de un `tenantId` distinto al del usuario.
- Ningún DTO inválido pasa la validación del pipe.
- El cálculo de SLA en horas hábiles respeta el calendario (lun-vie 7-18) en cualquier instante de inicio.
- La máquina de permisos rechaza siempre las acciones no permitidas para un rol.

---

## 9. Reglas para IA

Cuando una IA (incluyendo asistentes de codificación) implementa o modifica este backend, debe respetar:

- **Arquitectura modular**: cada dominio en su propio módulo NestJS.
- **Sin lógica en controllers**: toda la lógica vive en services.
- **DTOs con `createZodDto()`**: nunca `class-validator`.
- **Schemas en `@tikora/core`**: jamás definir schemas Zod directamente en el backend.
- **Tenant siempre filtrado**: ninguna query ejecutada sin `{ tenantId }`. Si una operación cruza tenants, debe ser explícita y registrada.
- **Endpoints protegidos por defecto**: usar `@Public()` solo cuando sea estrictamente necesario.
- **Transiciones de estado vía service**: nunca modificar el campo `estado` directamente desde un controller o repositorio.
- **System prompts en archivos**: nunca inline en el código. Versionados y referenciados en cada uso.
- **Configuración por env**: API keys, modelos, umbrales, secretos. Nada hardcodeado.
- **Estructura por feature**: respetar `controllers/`, `services/`, `dto/`, `schemas/`, `events/`, `templates/`, `__tests__/`.
- **Tests obligatorios**: todo service nuevo viene con tests; toda invariante crítica con PBT.
- **Registrar el módulo nuevo en `app.module.ts`**.
- **Idioma de errores**: en español para errores de usuario; en inglés para errores internos/técnicos en logs.
- **No introducir librerías sin justificación**: el stack está definido. Cualquier dependencia nueva requiere decisión explícita en `decisiones-tecnicas.md`.

---

## 10. Comandos Útiles

```bash
# Desarrollo
pnpm install                              # Instalar dependencias
npx nx serve back                  # Dev server con hot reload
npx nx build back                  # Build de producción
npx nx run back:lint               # Lint del backend

# Testing
npx vitest run                            # Todos los tests
npx vitest run apps/back/src/auth  # Tests de un módulo
npx vitest watch                          # Watch mode
npx vitest run --coverage                 # Con cobertura

# Workers BullMQ (procesos separados)
npx nx serve back-worker           # Worker de jobs (a definir)

# Generación de embeddings de KB ya cargada (mantenimiento)
npx nx run back:reindex-kb         # Custom target a definir

# Base de datos (mantenimiento manual)
mongosh "$MONGODB_URI"                    # CLI de Mongo
```
