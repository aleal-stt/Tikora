# Checklist de muestreo a jefes

Guion ordenado para presentar Tikora end-to-end. Cada bloque indica qué se muestra en pantalla, qué tecnología trabaja por detrás y cómo encaja la pieza en el todo, para responder cualquier pregunta técnica sin abrir el código.

## 0. Pre-flight (antes de que entren los jefes)

| Check                          | Cómo verificarlo                                                        |
| ------------------------------ | ----------------------------------------------------------------------- |
| Backend up                     | `curl http://localhost:3002/api/v1/health` devuelve `{ status: "ok" }`. |
| Frontend up                    | http://localhost:4300/ carga la pantalla de login.                      |
| Mongo Atlas accesible          | El health endpoint reporta `mongo: "ok"`.                               |
| LLM responde                   | Crear un ticket de prueba y ver `Auto-respuesta sugerida` en logs.      |
| Inbox del empleado demo limpio | Para que los correos que mandemos hoy sean fácil de ubicar.             |
| KB con docs activos            | `GET /api/v1/kb-documents` ≥ 1 doc `active: true` por área a demostrar. |
| Tab del navegador en incógnito | Sesiones limpias por rol (login fresco).                                |

Stack a tener visible en una segunda ventana, por si alguien pide "mostrame el código":

- Editor abierto en `apps/back/src` y `apps/front/src`.
- Swagger en http://localhost:3002/api/docs como respaldo visual del contrato.
- Atlas Charts o `mongosh` opcional, si la pregunta es sobre persistencia.

## 1. Stack en una página

Resumen consultable durante la demo. Las descripciones largas viven en los docs específicos de `tikoraDocs/`.

| Capa                    | Tecnología                                                  | Rol                                                                                                              |
| ----------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Monorepo                | Nx 20 + pnpm 9                                              | Comparte código entre `apps/back`, `apps/front` y `packages/core`. Cachea build/test/lint.                       |
| Lenguaje                | TypeScript strict                                           | Mismo lenguaje en back y front. Tipado fuerte (`noUncheckedIndexedAccess`, `noImplicitReturns`).                 |
| Schemas compartidos     | Zod en `@tikora/core`                                       | Una sola definición de tipos y validaciones que back y front importan: el contrato HTTP es un schema, no un PDF. |
| Backend                 | NestJS 10 + Mongoose                                        | API REST modular con DI. Mongoose mapea a Mongo Atlas.                                                           |
| Validación back         | `nestjs-zod`                                                | Cada DTO es un `createZodDto(schema)`: validación automática 1-a-1 con el contrato.                              |
| Persistencia            | MongoDB Atlas (cluster real)                                | Documento por entidad, escala vertical y horizontal. Requerimos Atlas (no Mongo local) por Vector Search.        |
| Búsqueda semántica      | Atlas Vector Search                                         | Índice `kb_chunks_vector`, 384 dims, similitud coseno. Pivote del RAG.                                           |
| Embeddings              | `Xenova/multilingual-e5-small` (Transformers.js)            | Modelo local, 100% en proceso del back. Sin costo por llamada ni rate limit externo.                             |
| Modelo LLM              | Gemini (`gemini-2.5-flash-lite`) vía endpoint OpenAI-compat | Clasifica tickets y redacta respuestas. Configurable por env, fácil de cambiar de proveedor.                     |
| Colas asíncronas        | BullMQ + Redis                                              | Clasificación, auto-respuesta e indexación KB corren fuera del request HTTP. Reintentos con backoff.             |
| Auth                    | JWT (access en memoria) + cookie httpOnly de refresh        | Access token de vida corta; refresh en cookie que viaja solo a `/auth/refresh`. XSS no roba el access.           |
| Email transaccional     | SMTP (Gmail con app password)                               | Notificaciones al usuario final. Modo `log` para dev, `live` para SMTP real.                                     |
| Eventos en tiempo real  | Server-Sent Events (SSE)                                    | Conexión persistente del front al back. Notifica clasificación, asignación, nuevo mensaje, etc.                  |
| Frontend                | React 19 + Vite 6                                           | SPA. En este entorno se sirve el bundle de producción por `vite preview`.                                        |
| UI                      | shadcn/ui sobre Tailwind                                    | Componentes copiados al repo (no librería externa). Diseño consistente, accesible, customizable.                 |
| Estado servidor         | TanStack Query (React Query)                                | Caché, refetch, invalidación. Toda la data del back pasa por hooks `useQuery`/`useMutation`.                     |
| Estado cliente          | Zustand                                                     | Sesión (access token, user). Pequeño, sin boilerplate.                                                           |
| Formularios             | react-hook-form + Zod resolver                              | Mismas reglas Zod del contrato en el form. Validación cliente sin duplicar la del back.                          |
| Observabilidad opcional | Sentry (back y front)                                       | DSN vacío = apagado. Para piloto/prod se activa con la variable de entorno.                                      |
| Email reabrir           | JWT firmado de reapertura                                   | Tokens de un solo uso, expiración 5 días, viajan en el link del mail de resolución.                              |

## 2. Roles del sistema

| Rol        | Qué puede hacer (resumen)                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------- |
| `empleado` | Crea tickets, los ve, los cancela. Recibe respuestas por email y en la app.                                           |
| `agente`   | Atiende tickets de las áreas a las que pertenece. Toma, reasigna dentro del área, agrega notas, resuelve.             |
| `lider`    | Lo que hace el agente, más: edita SLAs de sus áreas, gestiona agentes del área, reasigna a otras áreas, escala.       |
| `admin`    | Todo lo anterior + crear áreas, crear usuarios de cualquier rol, gestionar KB, ver métricas globales, ajustes tenant. |

Usuarios demo precargados en el tenant:

- `admin@empresa.com` / `ChangeMe123!`
- `lider.cont@empresa.com`, `lider.rrhh@empresa.com`, `lider.ti@empresa.com` (líderes por área)
- `agente.cont@empresa.com`, `agente.rrhh@empresa.com`, `agente.ti@empresa.com` (agentes por área)
- `empleado.demo@empresa.com` (empleado)

Las pass de los demo no-admin se setean al seed; preguntar a quien manejó el `.env`.

## 3. Demo recomendada (orden y duración aproximada)

Total estimado: 25-30 minutos. Cada bloque indica el **qué se ve** y el **cómo funciona por dentro**.

### Bloque 1 — Login y modelo de roles (3 min)

**Qué se muestra**

1. Login con `admin@empresa.com`.
2. Navegación por el sidebar muestra opciones de admin (Métricas, Usuarios, Áreas, KB, SLAs).
3. Logout y login como `empleado.demo@empresa.com`: el sidebar cambia a "Mis tickets".
4. Logout y login como `agente.ti@empresa.com`: aparece "Bandeja".

**Qué hay por detrás**

- **Auth (JWT + cookie httpOnly)**: el login devuelve un access token que se guarda en Zustand (memoria del browser, no en localStorage), y setea una cookie de refresh `HttpOnly; SameSite=Lax` que solo viaja a `/auth/refresh`. Cuando el access expira (15 min), `apiFetch` recibe un 401, llama `/auth/refresh` con la cookie y reintenta la request.
- **Por qué este split**: el access en memoria evita que un XSS robe la sesión (no está en disco); la cookie httpOnly tampoco es accesible desde JS. Es el patrón estándar para SPAs.
- **Guards por rol en el router** (`apps/front/src/routes/router.tsx`): `RoleGuard` envuelve rutas; si el rol del user no está en la lista permitida, redirige.
- **Permisos en el back**: cada endpoint declara los roles permitidos con `@Roles('admin', 'lider')`. El guard valida contra el JWT decodificado.

### Bloque 2 — Un empleado crea un ticket (3 min)

**Qué se muestra**

1. Logueado como `empleado.demo@empresa.com`, ir a "Mis tickets" → "Nuevo ticket".
2. Asunto: `Gastos`. Cuerpo: `¿cuál es el plazo para rendir gastos?`.
3. Crear → redirige al detalle del ticket. Aparece sin área asignada y con un indicador de "clasificando…".
4. En 5-10 segundos, el ticket muestra el área (Contabilidad), la prioridad (baja) y unos tags. El estado pasa por "clasificado" y, si hay match en KB, queda como "cerrado" con una respuesta automática (ver Bloque 4).

**Qué hay por detrás**

- **Frontend**: el form usa `react-hook-form` con resolver Zod que viene de `@tikora/core` (`createTicketSchema`). El submit dispara una mutación de React Query que pega a `POST /api/v1/tickets`.
- **Backend** (`TicketsService.create`): valida el DTO contra el schema Zod (`nestjs-zod`), genera un `shortCode` atómico con un counter en Mongo (`TIK-N`), inserta el ticket en estado inicial y **emite un evento** `TicketCreated`.
- **Cola de clasificación** (BullMQ): un listener encola un job de clasificación. El response HTTP ya volvió al usuario; el resto es asíncrono.
- **Estado del ticket**: la transición es una máquina de estados explícita (`TicketStateMachineService`) con tabla de transiciones permitidas. Por eso el front muestra "clasificando…" sin caches stale: el SSE empuja cada cambio.
- **SSE para realtime**: el detalle del ticket abre una conexión persistente a `/api/v1/notifications/stream`. Cuando el back emite `TicketClassified`, el cliente recibe el evento y React Query invalida la query del ticket, refrescando sin polling.

### Bloque 3 — Clasificación automática con IA (3 min)

**Qué se muestra**

- Volver al detalle del ticket recién creado. Señalar el área asignada (Contabilidad), la prioridad, los tags.
- Abrir el panel "Detalles de IA" (si está disponible) o desde la vista admin del ticket: mostrar `confianza` y `resumen`.

**Qué hay por detrás**

- **Worker BullMQ** (`ClassificationProcessor`) toma el job y llama a `ClassificationService.classify`.
- **Prompt** (`apps/back/src/classification/prompts/`): system prompt con criterios de prioridad y la lista de áreas del tenant (`{ id, name, descripcion }`). User prompt: asunto + cuerpo + adjuntos resumidos.
- **LLM call**: `AiClientService` postea al endpoint OpenAI-compat de Gemini (`/v1beta/openai/chat/completions`). Modelo: `gemini-2.5-flash-lite` (configurable en `.env`).
- **Output validado por Zod**: el modelo devuelve JSON con `area`, `prioridad`, `confianza`, `resumen`, `tags`. Si no cumple el schema, el cliente reintenta una vez con feedback correctivo; si tampoco, encola un fallback al área de default.
- **Por qué Gemini Flash y no GPT-4 o Sonnet**: para clasificación, latencia y costo importan más que sutileza. Flash-lite responde en ~1 segundo y es ~10x más barato que un modelo grande. La calidad es suficiente en un set acotado de áreas.
- **Confianza < umbral (0.7 por default)**: el ticket pasa a `requiere_revision_clasificacion` y queda visible para un líder/admin que lo asigne a mano. Sin IA mágica que se equivoca silenciosamente.

### Bloque 4 — RAG y auto-respuesta (5 min, núcleo de la demo)

**Qué se muestra**

- Mismo ticket que en bloque 2 (debería ya estar resuelto o con sugerencia, según `AI_PHASE`).
- Mostrar la respuesta generada citando el documento "Rendición de gastos" de la KB.
- Mostrar el panel de fuentes: chunk(s) usados, score de similitud, link al documento original en `/admin/kb`.

**Qué hay por detrás**

Diagrama mental: `ticket → embedQuery → Vector Search en kb_chunks → chunks relevantes → LLM con prompt + chunks → respuesta + citas → email + cierre`.

1. **Pre-condiciones** (`AutoResponseEvaluatorListener`):

   - `AI_PHASE >= 2` (en el ambiente actual está en 3, envío autónomo).
   - `prioridad === 'baja'` (alta o media siempre escalan a humano).
   - `confianza ≥ UMBRAL_CONFIANZA_CLASIFICACION` (0.7).
   - Si falla cualquiera: no se intenta, escala normal.

2. **Búsqueda en KB** (`KbSearchService`):

   - Embebe `asunto + cuerpo` con prefijo `query:` que requiere el modelo E5.
   - Ejecuta `$vectorSearch` en Atlas filtrando por `tenantId`, `active: true`, y scope (chunks `global` o del área del ticket).
   - Filtra hits por `UMBRAL_RELEVANCIA_KB` (0.75). Si nadie supera, escala normal.

3. **Por qué `multilingual-e5-small` y por qué local**:

   - Multilingüe con buen español. Soporte de Transformers.js → corre 100% en Node, sin llamada externa.
   - 384 dimensiones: barato de almacenar e indexar. ~120 MB en disco.
   - Sin costo por consulta, sin rate limit, sin dependencia externa para retrieval.
   - El modelo requiere prefijos (`passage:` para indexar, `query:` para buscar). Los aplica el provider, no el caller.

4. **Generación de respuesta** (`AutoResponseGeneratorService`):

   - System prompt con tono y restricciones.
   - User message con el ticket + chunks recuperados numerados.
   - `AiClient.generateStructured(autoResponseOutputSchema)`: el LLM devuelve `{ respondable, respuesta, confianza, sources: [{ chunkIndex, usedFor }], motivo? }`.
   - Si `respondable: false` (la KB no alcanza), se persiste como `descartada` para auditoría y se escala.

5. **Fase 2 vs Fase 3**:

   - **Fase 2**: la respuesta queda en estado `sugerida`. Un agente la ve en el panel de IA del ticket y puede aprobar, editar o descartar.
   - **Fase 3** (la actual): si `confianza ≥ UMBRAL_AUTO_AUTONOMA` (0.9) y no cae en el sampling de QA (10% siguen pasando por humano), se aprueba automáticamente, se manda el email al requester y el ticket se cierra. El `approvedBy` queda como `'system'` para distinguirlo.

6. **Auditoría**: cada `AiResponse` guarda modelo usado, tokens consumidos, latencia, score de cada chunk citado y el `usedFor` que el modelo asoció a cada uno. Permite analizar calidad por modelo, tenant, área, etc.

### Bloque 5 — Si no se contesta sola: agente toma el ticket (3 min)

**Qué se muestra**

1. Crear un ticket que no tenga match en KB (ej. "Quiero pedirme dos semanas seguidas de vacaciones en agosto"): probablemente quede `escalado` o como sugerencia.
2. Logueado como agente del área correspondiente, ir a "Bandeja".
3. Filtrar por "Sin asignar" y abrir el ticket.
4. Botón "Tomar ticket" → el ticket pasa a `en_progreso` y queda asignado al agente.
5. Agregar una nota interactiva con `@interno` (no visible al empleado) o sin tag (visible).
6. "Resolver" → tipo de resolución, mensaje al usuario, enviar.

**Qué hay por detrás**

- **Máquina de estados**: las transiciones permitidas están en `TicketStateMachineService` y se validan en el back. El front consulta `can.takeTicket(ticket)` y muestra/oculta botones según el estado y rol.
- **SSE notifica al empleado** en tiempo real cuando hay una nota nueva o un cambio de estado.
- **Email**: al resolver, el back manda un mail al requester con la respuesta y un link de reapertura.

### Bloque 6 — Reapertura desde email (2 min)

**Qué se muestra**

1. Mostrar el email que llegó al empleado tras resolver.
2. Click en el link "No se resolvió, quiero reabrir" → abre el front en `/reopen-confirm?token=...`.
3. El empleado confirma y opcionalmente agrega contexto.
4. El ticket vuelve a `en_progreso`, el agente recibe notificación SSE.

**Qué hay por detrás**

- **Token JWT firmado** específico para reapertura (`JWT_REOPEN_SECRET`), TTL configurable (5 días por default).
- **Un solo uso**: el back marca el token como consumido tras la reapertura. Si el link se forwardea o reenvía, no se puede usar dos veces.
- **No requiere login**: el token autentica la acción. Es por diseño, para reducir fricción del usuario final.
- **Límite de reaperturas**: `reopenCount` en el ticket. Si supera el cap, el ticket queda definitivamente cerrado.

### Bloque 7 — Panel del admin: gestión (4 min)

**Qué se muestra**

Como admin, recorrer:

1. **`/admin/areas`**: lista de áreas. Crear una nueva (ej. "Legales"). Entrar al detalle: SLAs por prioridad (alta/media/baja en horas hábiles), miembros (agentes y líderes).
2. **`/admin/usuarios`**: lista paginada. Crear un usuario `agente` y asignarlo al área "Legales". Mostrar que el rol `empleado` deshabilita el selector de áreas (fix de hoy).
3. **`/admin/kb`**: documentos cargados. Subir un doc nuevo, ver que aparece como `active: false` mientras se indexa, refrescar y aparece `active: true`. Mostrar versionado: editar un doc → nueva versión `v2`.
4. **`/admin/slas`**: SLAs globales por área. Editar las horas de un nivel.

**Qué hay por detrás**

- **SLAs en horas hábiles** (`BusinessHoursService`): los SLAs no son "24h" calendario sino "8h hábiles" según el horario del tenant (`businessHoursStart/End` en `tenant.settings`). Un ticket creado un viernes a las 17h con SLA de 4h vence el lunes a las 12h, no el viernes a las 21h.
- **Cron de SLA** (`SlaCheckerService`): corre cada 5 min, detecta tickets `approaching` (cerca del vencimiento) y `breach` (vencidos). Notifica a los responsables vía SSE + email.
- **Numeración de tickets**: counter atómico por tenant (`ticket-shortcode:<tenantId>`). Los shortcodes nunca se repiten ni saltan números, incluso bajo concurrencia.
- **Áreas y miembros bidireccional**: `Area.agentIds` y `User.areaIds` se mantienen en espejo. Agregar un agente al área actualiza ambos en la misma operación.
- **KB versionado**: editar un doc crea un nuevo registro con `version: N+1` y `active: false`. El indexador embebe los chunks; al terminar, swap atómico: activa la nueva versión y desactiva la anterior. La cadena de versiones se ve en `GET /kb-documents/:id/versions`.
- **Chunking + embeddings al indexar**: cuando se sube/edita un doc, un job de BullMQ (`KbIndexingProcessor`) parte el contenido en chunks de tamaño acotado, los embebe con `passage:` y los inserta en `kb_chunks`. El doc queda `active` cuando todos sus chunks están indexados.

### Bloque 8 — Métricas y feedback (3 min)

**Qué se muestra**

1. **`/admin/metricas`**: dashboard con métricas por área (tickets abiertos, resueltos, breach de SLA, tiempo de resolución promedio).
2. Mostrar un ticket clasificado por IA y el botón de **feedback de clasificación** (agente puede marcar la clasificación como correcta o corregirla).
3. Discutir el potencial: feedback acumulado puede entrenar prompts mejorados o detectar drift del modelo.

**Qué hay por detrás**

- **Métricas en Mongo**: el back agrega sobre `tickets` con `$group` por área y rango temporal. Sin warehouse separado en MVP; si el volumen crece, se mueve a una vista materializada o a un job nocturno.
- **Feedback** (`feedback_classification`): se guarda como evento inmutable con el área original, la corregida y el agente que la corrigió. No modifica el ticket; es una traza paralela.

### Bloque 9 — Detrás de escena (2-3 min, técnica)

Si la audiencia es técnica, mostrar 5-10 minutos del repo:

1. **`@tikora/core`**: una sola fuente de schemas Zod compartidos. Cambiar el contrato es cambiar este paquete; back y front rompen typecheck si no se ajustan.
2. **Swagger** en `http://localhost:3002/api/docs`: contrato vivo, navegable, ejecutable.
3. **Tests**: `pnpm test` corre ~370 unit/integration tests; `pnpm exec nx run front-e2e:e2e` corre 27 specs Playwright en ~2 minutos. Mencionar property tests con fast-check sobre la state machine.
4. **CI/CD** (si está): describir si los commits a `main` corren tests automáticamente.

## 4. Plan B (contingencias durante la demo)

| Problema en vivo                               | Mitigación                                                                                                            |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| LLM devuelve 429 (cuota agotada)               | Cambiar `LLM_MODEL_*` a otro modelo disponible en `.env` y reiniciar el back. Tener la API key alternativa a mano.    |
| Atlas Vector Search no devuelve hits           | Posible eventual consistency tras indexar. Tener un ticket prearmado cuyos chunks ya estén indexados desde hace rato. |
| SSE no conecta (proxy, CORS)                   | Refrescar el panel manualmente; los datos siguen llegando vía polling de React Query con `refetchOnWindowFocus`.      |
| Email no llega                                 | Cambiar `EMAIL_DELIVERY_MODE=log` y mostrar el contenido en los logs del back, justificando que es para esta demo.    |
| El front no carga (ENOSPC inotify)             | Es un detalle del ambiente de desarrollo. Mostrar que el bundle de producción ya está construido (`dist/apps/front`). |
| Ticket queda `requiere_revision_clasificacion` | Como admin: asignarle el área a mano desde el detalle. Útil también para mostrar el flujo manual.                     |

## 5. Lo que NO mostrar (todavía)

- **Multi-tenant en producción**: el código está preparado (todos los queries filtran por `tenantId`), pero el deploy actual tiene un solo tenant. No abrir la conversación a multi-tenancy hasta que el piloto valide el flujo.
- **Costo unitario por respuesta IA**: tenemos `tokens_input/output` por llamada, pero el cálculo de USD/respuesta depende del modelo y aún no está expuesto. Dejar para Camino C.
- **Migración de modelo**: el código abstrae el cliente LLM por env, pero validar otro proveedor (Anthropic, OpenAI) en serio requiere un sprint. Si preguntan, mencionar que es "swap de variable de entorno + validación".

## 6. Glosario rápido (si lo piden)

- **RAG (Retrieval-Augmented Generation)**: patrón donde el LLM no inventa la respuesta, sino que recupera fragmentos de una base de conocimiento ("retrieval") y los usa como contexto al generar ("generation"). Permite respuestas factuales sobre datos propios sin reentrenar el modelo.
- **Embedding**: vector numérico (acá 384 números) que representa el "significado" de un texto. Textos similares tienen vectores cercanos. Habilita búsqueda semántica ("plazo para rendir gastos" matchea "30 días posteriores a la fecha del comprobante" sin compartir palabras).
- **Vector Search**: índice especializado en buscar el vecino más cercano de un vector en un espacio multidimensional. Atlas implementa este índice como parte del servicio.
- **Chunk**: fragmento de un documento de KB. Los docs se cortan en pedazos antes de embeber para que cada vector represente una idea acotada y las búsquedas sean más precisas.
- **SSE (Server-Sent Events)**: protocolo HTTP donde el servidor empuja eventos al cliente por una conexión persistente. Más simple que WebSockets cuando la comunicación es one-way (servidor → cliente).
- **BullMQ**: librería de colas sobre Redis. Permite ejecutar trabajos asíncronos con reintentos, backoff y observabilidad (cola actual, jobs fallidos, etc.).
- **Atlas Vector Search**: índice de búsqueda vectorial dentro del cluster Atlas. Hace `$vectorSearch` como una etapa del aggregation pipeline; no requiere base separada.

## 7. Después de la demo

Apuntes a tomar durante el muestreo:

- Qué partes generaron preguntas largas (señal de interés o de confusión).
- Qué pedidos de feature aparecen ("¿y si...").
- Qué tipo de tickets quieren probar.
- Qué métricas faltan en `/admin/metricas` desde su punto de vista.
- Si surge "esto debería conectarse con X sistema": qué sistema, qué dato, qué dirección.

Estas notas alimentan el siguiente plan (Camino C: ajustes post-muestreo) o destraban el piloto.
