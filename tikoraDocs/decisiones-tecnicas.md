# Tikora — Decisiones Técnicas

> Documento vivo. Recoge cada decisión técnica del proyecto: opciones que se evaluaron, opción elegida y la razón. Se actualiza cada vez que se cierra una decisión nueva o se revisa una existente.

---

## 1. Estructura del repositorio

**Decisión:** Monorepo con **Nx + pnpm**, con un paquete compartido `@tikora/core` para schemas Zod y utilidades cross-stack. Frontend y backend viven dentro de `apps/`.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Monorepo Nx + pnpm + paquete `core` compartido | Tipos y validaciones únicos para front y back, build/test unificados, generadores de Nx aceleran scaffolding | Curva de aprendizaje inicial de Nx, configuración un poco más densa |
| Repos separados (back y front) | Independencia total entre equipos, despliegue desacoplado | Duplicación de tipos y schemas, riesgo alto de divergencia entre contratos front/back |
| Monorepo liviano (pnpm workspaces sin Nx) | Más simple que Nx, comparte código | Sin caché de tareas, sin generadores, sin grafo de dependencias |

**Por qué se eligió:** Tikora necesita que el frontend (formulario de tickets, plataforma del agente) y el backend hablen exactamente el mismo lenguaje de datos. Compartir los schemas Zod desde un único paquete elimina la clase de bugs en que el frontend valida una cosa y el backend espera otra. Nx además da herramientas concretas (caché, grafo, generadores) que aceleran la creación de los múltiples módulos previstos en el roadmap.

---

## 2. Validación de datos

**Decisión:** **Zod** como librería de validación, integrada en NestJS mediante **`nestjs-zod`** y `createZodDto()`. Pipe global `ZodValidationPipe` aplicado a todos los endpoints.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Zod + nestjs-zod (`createZodDto`) | Schema único reutilizable en front y back, inferencia de tipos automática, integración con Swagger | Capa de adaptación adicional sobre NestJS |
| `class-validator` + `class-transformer` (default de NestJS) | Soporte nativo de NestJS, decoradores familiares | Schemas atados al backend, no reutilizables en el frontend, validaciones complejas son verbosas |

**Por qué se eligió:** La decisión va de la mano con el monorepo: si el paquete `@tikora/core` define los schemas una sola vez, ambos lados los consumen sin duplicar. Zod además tiene un sistema de tipos más expresivo y una API funcional que escala mejor a validaciones complejas (refinements, transforms, discriminated unions) que vamos a necesitar en payloads como la respuesta estructurada de la IA.

---

## 3. Cliente y proveedor de IA

**Decisión:** **SDK oficial de Anthropic** (`@anthropic-ai/sdk`). Modelos sugeridos: **Claude Haiku 4.5** para clasificación y **Claude Sonnet 4.6** para generación de respuestas. Ambos configurables por variable de entorno.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| SDK oficial de Anthropic | Acceso nativo a prompt caching, tool use, citations, structured output con JSON schema; menor latencia (un hop menos); soporte oficial | Atado al ecosistema Anthropic |
| OpenRouter | Cambiar de modelo (incluso a otro proveedor) sin tocar código; pricing comparativo | Hop intermedio agrega latencia, no expone todas las features avanzadas de Claude, dependencia de un tercero |
| Abstracción propia con ambos | Máxima flexibilidad | Sobre-ingeniería para el MVP, mantenimiento doble |

**Por qué se eligió:** El proyecto se diseñó alrededor de Claude desde la concepción. El **prompt caching de Anthropic** es decisivo para el flujo RAG: el system prompt + los fragmentos recurrentes de la KB se cachean y reducen drásticamente el costo por ticket. Cuando un día queramos cambiar de modelo, lo abstraemos detrás de un `AiClientService` y listo — pero no pagamos esa abstracción ahora.

---

## 4. Framework de testing

**Decisión:** **Vitest** como runner, con **`fast-check`** para *property-based testing* en la lógica crítica (clasificación, transiciones de estado, validaciones). Tests por feature dentro de `__tests__/`.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Vitest + fast-check | Ejecución muy rápida, ESM nativo, watch mode excelente, PBT cubre casos que los tests por ejemplo no contemplan | Menos integraciones de terceros que Jest |
| Jest (default de NestJS) | Mayor adopción, mucha documentación | Más lento, configuración pesada para ESM/TS |
| Mocha + Chai | Flexible, longeva | Requiere ensamblar más piezas, menos idiomático en proyectos NestJS modernos |

**Por qué se eligió:** Las reglas de negocio de Tikora tienen muchas invariantes que se prestan al property-based testing: ninguna transición inválida de estado debe aceptarse, ninguna clasificación debe romper el contrato JSON, ningún ticket debe quedar sin tenant. Generar miles de inputs aleatorios con `fast-check` da más confianza que un puñado de tests por ejemplo. Vitest acelera el feedback loop durante el desarrollo.

---

## 5. Identificación del tenant en cada request

**Decisión:** El `tenantId` se incluye como **claim dentro del JWT**. Al hacer login se resuelve el tenant del usuario y queda fijado en el token. Un guard global lo extrae y lo inyecta en cada request para que los services lo usen como filtro automático.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Claim en el JWT | Simple, seguro, sin estado en backend, el tenant viaja firmado y verificable | Cambio de tenant requiere reemitir token (no es problema en MVP mono-tenant) |
| Subdominio (`empresa.tikora.com`) | Visualmente claro, separa entornos por marca | Requiere DNS wildcard, certificados SSL multi-dominio, complejidad de hosting |
| Header explícito (`X-Tenant-Id`) | Flexible | Inseguro: el cliente podría falsificarlo si no se cruza con el JWT igual |
| Dominio del correo en login | Buena UX para SaaS multi-empresa | No determina el tenant en cada request, solo en login → termina necesitando otro mecanismo igual |

**Por qué se eligió:** Es la opción que cumple los objetivos del proyecto con la mínima superficie de error. El MVP es mono-tenant pero ya queremos viajar el `tenantId` en cada request para que toda la capa de queries lo use como filtro transparente. El JWT ya es la fuente de verdad de la identidad del usuario; agregarle el tenant ahí es la extensión natural. Cuando llegue el modo SaaS multi-empresa real, el dominio del correo (opción d) se usará al login para *resolver* el tenant del usuario, pero el runtime sigue leyéndolo del JWT.

---

## 6. Procesamiento de tareas asíncronas

**Decisión:** **BullMQ + Redis**. La clasificación de IA, generación de auto-respuesta, envío de correos, generación de embeddings de la KB y chequeos de SLA corren como jobs en background.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| BullMQ + Redis | Reintentos automáticos, prioridades, jobs programados, dashboard de monitoreo, throughput alto | Dependencia operacional adicional (Redis) |
| Procesamiento síncrono dentro del request | Simplicidad máxima, sin infra extra | Requests largos para el usuario (clasificar puede tardar varios segundos), sin reintentos, riesgo de timeouts |
| Cola en Mongo (cambio de stream) | Sin infra adicional | Performance peor para colas, sin features ricas de un broker |
| RabbitMQ / SQS | Más robustos en producción a gran escala | Sobre-ingeniería para el MVP |

**Por qué se eligió:** El POST de creación de ticket no puede quedar esperando 3-8 segundos a que Claude responda; el usuario ve la confirmación inmediata y la clasificación llega vía notificación cuando termina. BullMQ además da reintentos automáticos cuando la API de Claude falla transitoriamente, y permite priorizar (un ticket de alta prioridad se clasifica antes que el backlog de baja). Redis ya es una dependencia probable para sesiones/cache, así que el costo operacional incremental es bajo.

---

## 7. Módulos NestJS de Fase 1

**Decisión:** El backend se organiza como un **monolito modular**. Cada dominio de negocio es un módulo NestJS autocontenido (controllers, services, DTOs, schemas, tests). La comunicación entre módulos se hace mediante imports/exports de NestJS, nunca llamadas HTTP internas.

**Módulos definidos:**

| Módulo | Responsabilidad |
|---|---|
| `auth` | Registro, login, refresh tokens, guard global JWT, decorador `@Public`. |
| `users` | CRUD de usuarios, perfil, asignación a una o varias áreas. |
| `tenants` | Modelo y resolución del tenant. En MVP existe uno solo, pero el módulo está listo para crecer. |
| `areas` | CRUD de áreas, listado de agentes asignados, configuración de SLAs por área. |
| `tickets` | Modelo central, CRUD, estados, asignación, historial de interacciones. |
| `classification` | Orquestador del pipeline de clasificación por IA: encola job, persiste resultado, dispara siguiente paso. |
| `ai-client` | Cliente reutilizable del SDK de Anthropic. Encapsula prompt caching, retries, salida estructurada. Lo consumen `classification`, `auto-response` y `kb`. |
| `kb` | Documentos de la base de conocimiento, generación de embeddings, búsqueda vectorial. *(Modelo desde Fase 1; uso activo en Fase 2.)* |
| `auto-response` | Generación de la respuesta automática vía RAG. *(Activación en Fase 2.)* |
| `notifications` | Hub central de notificaciones. Recibe eventos de dominio y decide qué mandar y por dónde. Coordina los módulos `email` y `realtime`. |
| `email` | Cliente del proveedor transaccional de correo. |
| `realtime` | Gateway en tiempo real (Socket.io o SSE — pendiente) para la campanita de notificaciones del agente. |
| `sla` | Cron de chequeo periódico, alertas previas y vencidas. *(Cron activo en Fase 4; modelo desde el inicio.)* |
| `feedback` | Feedback estructurado del agente sobre la clasificación de la IA y sobre las respuestas auto-generadas. |
| `health` | Endpoint de health check para readiness/liveness probes. |

**Por qué se eligió este granulado:** Cada módulo encapsula un único concepto de dominio y se puede testear, modificar o eventualmente extraer sin tocar el resto. Mantenemos `email` y `realtime` separados de `notifications` porque son canales de transporte distintos (uno externo, uno interno con WebSocket); `notifications` es el módulo de coordinación que decide *qué evento se manda por dónde*. Esto permite agregar canales nuevos a futuro (Slack, Teams, push móvil) sin reescribir la lógica de cuándo notificar.

**Mapa de dependencias:**
```
AppModule
├── AuthModule ← UsersModule, TenantsModule
├── UsersModule ← TenantsModule, AreasModule
├── TenantsModule (raíz, nadie depende hacia arriba)
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

---

## 8. Ciclo de vida del ticket — estados y transiciones

**Decisión:** El ticket sigue una máquina de estados explícita. Toda transición pasa por un service que la valida antes de persistir; los controllers no modifican el campo `estado` directamente.

**Estados:**

| Estado | Significado |
|---|---|
| `recibido` | Recién creado, aún no clasificado. |
| `clasificado` | La IA emitió clasificación. Estado transitorio: el sistema decide si escalar o auto-resolver. |
| `requiere_revision_clasificacion` | La confianza de clasificación quedó por debajo del umbral. Un humano (líder o admin) debe asignar el área. |
| `escalado` | Asignado a un área, esperando que un agente lo tome. |
| `en_progreso` | Un agente lo tomó explícitamente con la acción "Tomar ticket" y está trabajando. |
| `cerrado` | Estado terminal de resolución. La metadata distingue si fue resolución manual o auto-respuesta de IA. Puede ser reabierto. |
| `reabierto` | El solicitante respondió a un ticket cerrado y vuelve al flujo. Estado transitorio: pasa rápidamente a `en_progreso`. |
| `cancelado` | Estado terminal. El solicitante canceló el ticket antes de que un agente lo tomara. No reabrible. |

**Decisiones clave que justifican esta lista:**

- **`resuelto` y `auto_resuelto` se colapsan en `cerrado`.** Tener tres estados terminales semánticamente equivalentes complica la state machine sin agregar valor: la diferencia entre "resuelto por agente" y "resuelto por IA" se preserva como metadata (`resolutionType: 'manual' | 'auto'`, `resolvedBy`, `resolvedAt`), que es suficiente para métricas y dashboards. La acción "Resolver" del agente y el envío de auto-respuesta transicionan directo a `cerrado`.
- **`en_progreso` requiere acción explícita.** El agente pulsa "Tomar ticket" para entrar a `en_progreso`. Solo abrir o leer el ticket no lo cambia: esto evita que múltiples agentes parezcan estar trabajando al mismo tiempo y deja un evento claro para el SLA.
- **`reabierto` regresa al último agente.** Cuando el solicitante responde a un ticket cerrado, el ticket vuelve a `en_progreso` con el `assignedAgentId` del cierre anterior. Si el cierre fue una auto-respuesta de la IA (no hay agente), regresa a `escalado` para que cualquier agente del área lo tome.
- **`cancelado` solo antes de `en_progreso`.** El solicitante puede cancelar mientras el ticket aún no fue tomado por un agente. Una vez en progreso, el cierre lo decide el flujo normal.

**Matriz de transiciones válidas:**

| Desde ↓ → Hacia | clasificado | requiere_rev | escalado | en_progreso | cerrado | reabierto | cancelado |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `recibido` | ✅ | ✅ | — | — | — | — | ✅ |
| `clasificado` | — | — | ✅ | — | ✅ (auto-IA) | — | ✅ |
| `requiere_revision_clasificacion` | ✅ | — | ✅ | — | — | — | ✅ |
| `escalado` | — | — | — | ✅ | — | — | ✅ |
| `en_progreso` | — | — | ✅ (reasignar) | — | ✅ (resolver) | — | — |
| `cerrado` | — | — | — | — | — | ✅ | — |
| `reabierto` | — | — | ✅ (si era auto) | ✅ (con último agente) | — | — | — |
| `cancelado` | — | — | — | — | — | — | — |

**Auto-cierre por reapertura:** si un ticket está `cerrado` por más de **N días hábiles** (valor por definir en Ronda 3) sin actividad del solicitante, se considera cierre definitivo y deja de admitir reapertura. Esto se implementa con un cron de SLA, no como un estado nuevo.

---

## 9. Roles y permisos

**Decisión:** Cuatro roles fijos en MVP. Permisos definidos por matriz, evaluados en guards/services. No se usa una librería externa de RBAC: para el alcance actual, los chequeos en cada endpoint son suficientes y mantienen el código transparente. Si la complejidad crece, se puede introducir CASL u otra herramienta sin cambiar el modelo.

**Roles:**

- **Empleado solicitante** — cualquier usuario autenticado del tenant que crea tickets.
- **Agente** — usuario asignado a **una o más áreas**. Trabaja tickets de las áreas a las que pertenece.
- **Líder de área** — supervisor de una o más áreas. Tiene visibilidad y métricas sobre su área y puede gestionar agentes y KB de su área.
- **Administrador** — control total del tenant.

**Matriz de permisos:**

| Acción | Empleado | Agente | Líder | Admin |
|---|:---:|:---:|:---:|:---:|
| Crear ticket | ✅ | ✅ | ✅ | ✅ |
| Ver sus propios tickets | ✅ | ✅ | ✅ | ✅ |
| Cancelar ticket propio (antes de ser tomado) | ✅ | ✅ | ✅ | ✅ |
| Ver tickets del área a la que pertenece | — | ✅ | ✅ | ✅ |
| Ver tickets de todas las áreas | — | — | — | ✅ |
| Tomar / asignarse ticket | — | ✅ | ✅ | ✅ |
| Reasignar dentro del área | — | ✅ | ✅ | ✅ |
| Reasignar a otra área | — | — | ✅ | ✅ |
| Resolver / cerrar ticket | — | ✅ | ✅ | ✅ |
| Aprobar/editar respuesta sugerida por IA | — | ✅ | ✅ | ✅ |
| Ver métricas de su área | — | — | ✅ | ✅ |
| Ver métricas globales del tenant | — | — | — | ✅ |
| Configurar áreas, SLAs, umbrales de IA | — | — | — | ✅ |
| Cargar/editar documentos de KB de su área | — | — | ✅ | ✅ |
| Cargar/editar documentos de KB globales | — | — | — | ✅ |
| Gestionar usuarios de su área (alta/baja agentes) | — | — | ✅ | ✅ |
| Gestionar todos los usuarios del tenant | — | — | — | ✅ |

**Decisiones clave que justifican esta matriz:**

- **Agente multi-área.** El modelo `User` lleva `areaIds: ObjectId[]` (array, no escalar). Esto refleja la realidad: en empresas pequeñas y medianas un mismo agente cubre TI y Soporte, o RRHH y Administración. Cualquier query que verifique "el agente puede ver este ticket" hace `area.id ∈ user.areaIds`.
- **Líder gestiona usuarios de su área.** El líder puede dar de alta y baja agentes en las áreas que lidera. No puede crear usuarios fuera de sus áreas ni promover a otros líderes (eso queda solo en admin). Esto descarga al admin de tareas operativas y mantiene jerarquía clara.
- **Cancelación por el solicitante.** El empleado que creó el ticket puede cancelarlo siempre que aún no haya un agente trabajando en él (estados `recibido`, `clasificado`, `requiere_revision_clasificacion`, `escalado`). Una vez en `en_progreso`, la decisión de cierre pasa por el flujo normal: si el problema dejó de ser relevante, el agente lo cierra como resuelto con la nota correspondiente.

---

## 10. SLAs y calendario hábil

**Decisión:** SLAs por defecto del ticket según prioridad, medidos en horas hábiles. Configurables por área desde el panel de administración.

| Prioridad | Tiempo objetivo |
|---|---|
| Alta | **4 horas hábiles** |
| Media | **24 horas hábiles** |
| Baja | **48 horas hábiles** |

**Calendario hábil:**

- Días laborables: **lunes a viernes**.
- Horario laboral: **07:00 a 18:00** (zona horaria del tenant).
- Feriados: **no se consideran en MVP**. Toda hora dentro del rango lun-vie 7-18 cuenta como hábil.

**Alertas previas al vencimiento:** se notifica al agente asignado cuando queda **25 % o menos del SLA**. La notificación viaja por correo y por la campanita en tiempo real.

**Vencimiento del SLA:** al pasar el plazo sin resolución, se notifica al líder del área. El ticket no cambia de estado por el vencimiento; el SLA es informativo y no bloquea el flujo.

**Días de gracia para reapertura:** un ticket en estado `cerrado` admite la transición a `reabierto` durante **5 días hábiles**. Pasado ese plazo, el ticket queda definitivamente cerrado y el solicitante debe crear uno nuevo si necesita continuar. Esta regla la aplica el cron de SLA, no genera un estado nuevo.

**Por qué se eligió:** Las horas hábiles son el lenguaje natural del soporte interno; un ticket creado a las 17:55 del viernes con SLA de 4 horas no debe vencer a la 1 AM del sábado. Empezar sin feriados mantiene la implementación simple en MVP — si una empresa lo necesita, se agrega calendario configurable después. La franja 07:00-18:00 cubre tanto el inicio temprano de áreas operativas como las jornadas extendidas.

---

## 11. Base de conocimiento — formato y embeddings

**Decisión:**

- **Formatos aceptados en MVP:** Markdown (`.md`) y texto plano (`.txt`). PDF queda fuera del alcance inicial.
- **Tamaño máximo por documento:** 200 KB.
- **Chunking:** 500-800 tokens por chunk con overlap de 100 tokens.
- **Versionado:** cada edición crea una versión nueva; los embeddings se regeneran y la búsqueda solo apunta a la versión activa.
- **Modelo de embeddings:** `Xenova/multilingual-e5-small` corrido localmente vía **Transformers.js** (`@xenova/transformers`). Modelo multilingüe (~120 MB, 384 dimensiones) con buen soporte de español.
- **Almacenamiento vectorial:** **MongoDB Atlas Vector Search** sobre el mismo cluster que la BD principal.

**Opciones evaluadas para embeddings:**

| Opción | Costo | Pros | Contras |
|---|---|---|---|
| Transformers.js local (`multilingual-e5-small`) | Gratis | Sin dependencia externa, sin rate limits, offline, datos no salen del servidor | ~200 MB de RAM extra, CPU al generar embeddings |
| Voyage AI (`voyage-3-lite` free tier) | Free tier 50M tokens/mes, luego de pago | Calidad superior, sin carga local | Dependencia de un tercero, free tier puede cambiar, datos viajan a su API |
| OpenAI (`text-embedding-3-small`) | De pago desde el primer token | Buena calidad | Costo no nulo desde el día 1 |
| Anthropic | — | — | Anthropic no ofrece API de embeddings |

**Por qué se eligió Transformers.js:** El proyecto requiere mantener costos en el plan actual de Anthropic sin incurrir en gastos adicionales por servicios de terceros. Transformers.js permite correr el modelo de embeddings dentro del mismo proceso del backend (o en un worker de BullMQ), eliminando dependencias externas y cualquier riesgo de rate limit o cambio de pricing. La generación de embeddings ocurre en background (al cargar/editar documentos de KB y al evaluar candidatos de auto-respuesta), no en el camino crítico del request, así que el costo en CPU es absorbible. Si en el futuro se necesita mejor calidad, la abstracción del módulo `kb` permite cambiar de proveedor sin tocar el resto del sistema.

**Por qué solo markdown/texto:** la extracción de texto de PDFs es ruidosa (saltos de página, headers, footers, tablas mal formateadas) y degrada la calidad del RAG. Es preferible que el administrador convierta sus PDFs a markdown una vez, con la estructura limpia, que mantener un pipeline de extracción frágil. PDF se puede agregar en una fase posterior con extracción asistida.

---

## 12. Notificaciones en tiempo real

**Decisión:** **Server-Sent Events (SSE)** para el canal de notificaciones desde el backend hacia el cliente.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| SSE | Implementación simple, reconexión automática nativa del browser, un único stream HTTP, encaja con el caso de uso (server → cliente) | Solo unidireccional, no soporta chat bidireccional |
| Socket.io | Bidireccional, ecosistema maduro, soporte excelente en NestJS | Complejidad mayor, otro protocolo a operar, overkill para el caso |
| Polling cada N segundos | Trivial de implementar | Carga innecesaria al servidor, latencia alta |

**Por qué se eligió SSE:** El uso de tiempo real en Tikora es estrictamente unidireccional: el backend empuja al cliente eventos como "tienes un nuevo ticket asignado", "queda 25 % de SLA", "una respuesta de IA está lista para revisar". Las acciones del cliente (responder, tomar ticket, marcar resuelto) viajan por endpoints REST normales. SSE cubre exactamente ese caso con menos infraestructura que Socket.io y se mantiene en HTTP estándar, sin necesidad de configurar WebSocket en proxies o load balancers.

---

## 13. Proveedor de email transaccional

**Decisión:** **Resend** en su tier gratuito (3.000 correos/mes, 100/día).

**Opciones evaluadas:**

| Opción | Free tier | Pros | Contras |
|---|---|---|---|
| Resend | 3.000/mes, 100/día gratis | API moderna, templates con React, onboarding simple | Servicio relativamente nuevo |
| SendGrid | 100/día gratis | Madurez, dashboards completos | Free tier muy acotado, API más vieja |
| Mailgun | Solo trial pagado | Buen routing avanzado | Sin free tier permanente |
| AWS SES | 3.000/mes desde EC2 | Muy barato a volumen alto | Configuración manual de DKIM/SPF, requiere cuenta AWS |

**Por qué se eligió:** El free tier de Resend cubre con margen el volumen previsto del MVP (un correo por ticket creado, escalado, asignado, vencimiento de SLA y respuesta — para una empresa pequeña queda cómodo en menos de 100 correos diarios). La API es moderna y la integración con NestJS es directa. Si el volumen crece se migra a SES sin tocar el dominio, gracias a la abstracción en el módulo `email`.

---

## 14. Adjuntos en tickets

**Decisión:**

- **Tipos permitidos:** PDF, PNG, JPG, JPEG, GIF, WEBP, TXT, CSV, XLSX, DOCX.
- **Tamaño máximo por archivo:** 10 MB.
- **Cantidad máxima por ticket:** 5 archivos.
- **Almacenamiento:** **filesystem local** del servidor durante el desarrollo y el MVP.
- **Acceso:** los archivos se sirven con URLs autenticadas; ningún adjunto es accesible públicamente sin token.

**Opciones evaluadas para almacenamiento:**

| Opción | Costo | Pros | Contras |
|---|---|---|---|
| Filesystem local | Gratis | Sin dependencias, simple, sin egress fees | No escalable horizontalmente, requiere backup manual, riesgo de pérdida |
| AWS S3 | De pago | Durabilidad, escalable, URLs firmadas nativas | Costo desde el día 1, lock-in |
| Cloudflare R2 | Gratis hasta 10 GB | S3-compatible, sin egress fees | Configuración inicial extra |

**Por qué se eligió:** Mantenerse en cero costo durante el desarrollo y MVP. La capa de almacenamiento se encapsula detrás de un service del módulo `uploads` que expone una interfaz `StorageProvider` con métodos `save`, `read`, `delete`, `getSignedUrl`. Cuando se requiera escalar a producción multi-instancia o aumentar la durabilidad, se cambia la implementación a S3/R2 sin tocar el resto. La estructura de directorios local sigue el patrón `uploads/{tenantId}/{ticketId}/{filename}` para mantener aislamiento por tenant desde el inicio.

---

## 15. Convenciones de API REST

**Decisión:**

- **Prefijo global:** `/api/v1`.
- **Documentación:** Swagger en `/api/docs`.
- **Idioma de mensajes de error visibles al usuario:** español.
- **Mensajes de auth:** genéricos (no revelar si el email existe o no).
- **Códigos HTTP:** estándar (200, 201, 204, 400, 401, 403, 404, 409, 500).
- **Nomenclatura de rutas:** sustantivos en plural, kebab-case en rutas compuestas, IDs como parámetros de ruta, rutas anidadas para sub-recursos.

**Por qué se versiona desde el inicio:** Empezar con `/api/v1` evita un refactor doloroso cuando, en el futuro, una empresa cliente integre la API y haya que romper compatibilidad. Mantener el versionado desde el día uno deja la puerta abierta a `/api/v2` cuando llegue, sin afectar a clientes que aún consumen v1.

---

## 16. Estructura de carpetas por feature

**Decisión:** Cada módulo NestJS sigue esta organización interna:

```
src/{feature}/
├── {feature}.module.ts      # Módulo NestJS en la raíz del feature
├── controllers/             # Controllers HTTP del feature
├── services/                # Services con lógica de negocio
├── dto/                     # createZodDto envolviendo schemas de @tikora/core
├── schemas/                 # Schemas de Mongoose (cuando aplica)
├── templates/               # System prompts de IA (cuando aplica)
├── events/                  # Eventos de dominio que emite el módulo
└── __tests__/               # Tests unitarios e integración
```

**Reglas:**

- El `{feature}.module.ts` siempre va en la raíz de la carpeta del feature.
- Los DTOs usan `createZodDto()` con schemas tomados de `@tikora/core`. Nunca se definen schemas Zod directamente en el backend.
- Los tests viven en `__tests__/` con nomenclatura `{archivo}.spec.ts`.
- Los system prompts de IA viven como archivos `.md` en `templates/`, nunca inline en el código.
- Los tipos auxiliares internos del módulo (interfaces, types) viven al lado del archivo que los usa, salvo que sean compartidos por varios archivos del mismo módulo, en cuyo caso se mueven a una carpeta `interfaces/`.
- Cada módulo nuevo se registra explícitamente en `app.module.ts`.

---

## 17. Stack del frontend

**Decisión:** Frontend como **SPA** con **Vite + React 18 + TypeScript**, sirviendo estáticos. El backend solo expone API REST en `/api/v1`. La aplicación vive como app dentro del monorepo Nx en `apps/front/`.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Vite + React SPA (elegida) | Setup simple, HMR rápido, build a estáticos servibles desde cualquier CDN, sin servidor de Node en runtime | Sin SSR (irrelevante para una app interna autenticada) |
| Next.js (App Router con SSR) | SSR/streaming, convenciones fuertes, server actions | Costo operativo de un servidor Node en runtime, complejidad innecesaria para un panel autenticado sin SEO |
| Remix | Loaders por ruta, buena DX | Mismo costo operativo que Next, ecosistema más chico |

**Por qué se eligió:** Tikora es una plataforma B2B autenticada sin necesidad de SEO ni de pre-rendering — todas las rutas son privadas tras login. Vite SPA mantiene el deploy simple (HTML+JS+CSS estáticos), evita correr un proceso de Node solo para servir HTML, y reduce el costo operativo a cero. La velocidad de feedback en desarrollo (HMR sub-segundo) acelera la construcción de las múltiples vistas previstas.

---

## 18. Identidad visual y paleta

**Decisión:**

- **Logo (isotipo):** cuadrado con texto "TIK" sobre gradiente azul→sky (`from-blue-600 to-sky-500`), sin wordmark al lado.
- **Primarios:** `blue-600` / `blue-700` / `blue-50` (acentos, hover, fondos suaves).
- **Accent secundario:** `sky-500` / `sky-400`.
- **Neutros:** familia **slate** (`slate-50` … `slate-900`).
- **Estados:** `red-*`, `amber-*`, `emerald-*`, `slate-*`.
- **Tipografía:** Inter (self-hosted vía `@fontsource-variable/inter`).
- **Densidad:** compacta (filas de tabla 40-44 px, padding moderado).
- **Modo oscuro:** no en MVP. Las clases se escriben de forma compatible con `dark:` para facilitar la migración futura.
- **Tono de la interfaz:** español neutro empresarial.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Azules + slate (elegida) | Lectura corporativa seria, alto contraste, accesible, cubre toda la paleta sin saturar | Menos vibrante que un esquema multicolor |
| Indigo/purple/pink con gradientes vivos | Más visualmente atractivo en marketing | Demasiado expresivo para una plataforma operativa de uso diario; fatiga visual al mirar bandejas durante horas |
| Verde corporativo / monocromo | Distintivo | Menos versátil para diferenciar estados y acciones |

**Por qué se eligió:** El usuario primario de Tikora es un agente que mira tickets durante toda la jornada. La paleta tiene que ser **calma, legible y no fatigante**, dejando que los colores con peso (semáforo SLA, badges de prioridad, alertas) sobresalgan. Azul + slate es el lenguaje visual más adoptado en plataformas B2B de productividad por estas mismas razones. Slate sobre gray neutro porque tiene un sutil tinte frío que comunica seriedad sin volverse aséptico.

**Por qué Inter:** legibilidad alta en UIs densas, x-height generoso, soporte completo de pesos, gratis y self-hosteable. No depender de un CDN externo en runtime evita un punto de fallo y mantiene la privacidad del tenant.

---

## 19. Sistema de UI del frontend

**Decisión:**

- **Estilos:** **Tailwind CSS v4** (configuración en CSS via `@theme`).
- **Componentes base:** **shadcn/ui** copiado al repo (no como dependencia).
- **Iconos:** **Heroicons v2** outline, stroke 1.5.
- **Tablas:** **TanStack Table v8** (headless) compuesto con primitives de shadcn.
- **Gráficos:** **Recharts**.
- **Toasts / notificaciones efímeras:** **sonner**.

**Opciones evaluadas para componentes base:**

| Opción | Pros | Contras |
|---|---|---|
| shadcn/ui (elegida) | Componentes copiados al repo: control total, sin lock-in, sobre Radix con accesibilidad nativa | Cada componente requiere ser agregado manualmente |
| MUI / Mantine / Chakra | Ecosistema amplio | Estética opinada, difícil de personalizar profundamente, bundle pesado |
| Radix primitives sin shadcn | Sin opinión visual | Hay que reconstruir todo desde cero; lento al arrancar |
| Componentes propios desde cero | Máximo control | Tiempo invertido en reinventar primitives accesibles |

**Por qué se eligió shadcn/ui:** Da accesibilidad probada (Radix por debajo) y control absoluto sobre el código. La paleta y la densidad compacta de Tikora se aplican modificando el código local sin pelear con un sistema de overrides de tema. No hay overhead de runtime por features no usadas, y el upgrade es opt-in (cada componente se actualiza solo cuando se decide).

**Opciones evaluadas para iconos:**

| Opción | Pros | Contras |
|---|---|---|
| Heroicons (elegida) | Estilo outline coherente, stroke uniforme, mantenido por el equipo de Tailwind | Catálogo más acotado que Lucide |
| Lucide React | Catálogo amplio | Algo menos pulido en consistencia entre iconos |
| Iconos propios | Identidad propia | Costo de diseño y mantenimiento alto |

**Por qué Heroicons:** alineación visual con Tailwind, tamaño y stroke consistentes, API liviana. Si en el futuro hace falta un icono que Heroicons no tiene, se complementa puntualmente sin migrar el set entero.

**Por qué TanStack Table:** la bandeja del agente es la vista más densa de la app (filtros, sort, paginación, resaltado de filas). Una tabla headless da control total del render con primitives de shadcn manteniendo la lógica probada.

**Por qué Recharts:** ya integrado por convención con shadcn (existe `components/ui/chart.tsx` que envuelve Recharts), DX sencilla, suficiente para los dashboards de líder/admin previstos.

**Por qué sonner:** integra perfecto con shadcn, animaciones limpias, API simple, soporte de promesas para toasts asíncronos.

---

## 20. Gestión de estado en el frontend

**Decisión:**

- **Estado del servidor:** **TanStack Query v5**. Toda data del backend pasa por queries y mutations. Cero `useEffect + fetch`.
- **Estado del cliente:** **Zustand**. Stores pequeños y específicos (auth, notificaciones, UI, filtros), con `persist` middleware donde aplique.
- **Formularios:** **React Hook Form** con `@hookform/resolvers/zod` consumiendo schemas de `@tikora/core`.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| TanStack Query + Zustand (elegida) | Separación clara servidor/cliente, cache automático, invalidación granular, stores chicos sin boilerplate | Dos librerías a aprender |
| Redux Toolkit + RTK Query | Single source of truth, devtools maduras | Boilerplate alto, RTK Query menos flexible que TanStack Query para casos complejos de cache |
| Apollo Client | Excelente cache | Atado a GraphQL, no aplica con API REST |
| SWR | Liviano | Menos features que TanStack Query (mutations, infinite queries, prefetch) |
| Solo Context + useReducer | Sin dependencias | Re-renders ineficientes en stores grandes, sin cache de servidor |

**Por qué se eligió:** TanStack Query resuelve el patrón dominante de Tikora (listados con filtros + detalles + invalidación tras mutaciones + integración con SSE) con menos código que cualquier alternativa. Zustand cubre el resto del estado UI (sesión, sidebar, filtros persistentes) con un footprint mínimo y sin Provider hell. La división servidor/cliente es explícita: si una pieza de información viene del backend, vive en TanStack Query y nunca se duplica en Zustand.

**Por qué React Hook Form + zodResolver:** los schemas Zod del paquete `@tikora/core` se consumen directamente en el formulario, lo que garantiza que el frontend valida exactamente lo mismo que el backend, sin divergencias de regla. La performance de RHF (uncontrolled inputs) escala mejor que controladas a formularios complejos como creación de tickets con adjuntos o configuración admin.

---

## 21. Routing del frontend

**Decisión:** **React Router v7** en modo data router. Configuración centralizada en `pages/routes.tsx`. Protección por rol vía wrapper `<RequireRole>`. Sin separar `routes/` de `pages/`: el archivo de configuración convive con las páginas.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| React Router v7 (elegida) | Estándar de facto en SPAs React, data router con loaders/actions, lazy loading por ruta | API ligeramente cambiante entre versiones mayores |
| TanStack Router | Tipado fuerte de rutas, file-based opcional | Ecosistema más chico, curva de aprendizaje extra |
| Wouter | Muy liviano | Sin loaders ni nested layouts |

**Por qué se eligió:** React Router v7 cubre todo lo que la app necesita (nested layouts, lazy loading, error boundaries por ruta, protección por rol) con la mayor base de adopción y documentación. Centralizar la configuración en `pages/routes.tsx` mantiene el flujo de routing trazable desde un único lugar y elimina la dispersión que aparece cuando cada ruta declara su mapeo en archivos separados.

---

## 22. Persistencia de sesión en el cliente

**Decisión:** **Access token en memoria + refresh token en cookie `httpOnly`** emitida por el backend con `Secure` y `SameSite=Lax`. Interceptor de fetch en `lib/api-client.ts` maneja el refresh automático ante `401`. Logout multi-pestaña vía evento `storage`.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Access en memoria + refresh httpOnly cookie (elegida) | Mitiga XSS (JS no puede leer el refresh), access se pierde al cerrar pestaña reduciendo ventana de explotación, mitiga CSRF con `SameSite=Lax` | Requiere coordinación con CORS y cookies en backend |
| Ambos en `localStorage` | Simple de implementar | Vulnerable a XSS — un script malicioso puede exfiltrar ambos tokens |
| Ambos en cookies httpOnly | Máxima protección | Requiere endpoints CSRF-safe para mutaciones; complejidad mayor |
| Access en `sessionStorage` | Se limpia al cerrar pestaña | Sigue accesible vía XSS |

**Por qué se eligió:** Tikora maneja datos internos sensibles (tickets, KB, métricas). Que un access token comprometido no permita renovarse a sí mismo (porque el refresh es inalcanzable desde JS) eleva sustancialmente el costo de explotar un XSS. La complejidad incremental se concentra en `api-client.ts` y queda invisible para el resto del código del frontend, que consume `apiClient.get/post/...` sin preocuparse del refresh.

**Reglas operativas del interceptor:**
- Para evitar refrescos concurrentes, el cliente HTTP guarda un `refreshPromise` en vuelo. Múltiples 401 simultáneos esperan al mismo promise.
- El reintento del request original tras refresh ocurre **una sola vez**. Un segundo 401 dispara logout.
- El logout local sincroniza otras pestañas escribiendo en `localStorage` (clave `tikora.logout`) y reaccionando al evento `storage`.

---

## 23. Realtime en el cliente

**Decisión:** **Una sola conexión SSE global** establecida en `AppShell` cuando el usuario está autenticado. Cliente custom en `lib/sse-client.ts` con reconexión automática y soporte de `Last-Event-ID`. Los eventos disparan invalidaciones de TanStack Query, actualizaciones del store de notificaciones y toasts según corresponda.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Conexión SSE global única (elegida) | Una sola suscripción, fácil de razonar, eficiente en recursos del servidor | Requiere coordinar el dispatch hacia múltiples consumidores |
| Una conexión SSE por vista | Acotación natural de eventos | Múltiples streams duplicados, eventos perdidos al navegar entre vistas, costo operativo mayor |
| Polling periódico | Simplicidad | Latencia alta, carga innecesaria al servidor |

**Por qué se eligió:** El backend ya usa SSE como canal único de eventos (decidido en §12) y la lógica de qué hacer con cada evento es global (invalidar listas, actualizar contador de la campanita, mostrar toast). Una conexión global expone esa lógica en un único lugar (`sse-client.ts`) y los componentes consumen los efectos secundarios via TanStack Query y los stores, sin acoplarse al transporte. Si una vista necesita reaccionar a un evento puntual (ej. detalle abierto que recibe `TicketUpdated`), basta con observar la query correspondiente — no se requiere otra suscripción SSE.

**Optimistic updates** se aplican selectivamente en acciones reversibles y de bajo impacto (Tomar, Resolver, Marcar leída). Acciones críticas (Reasignar, Cancelar, Aprobar IA, CRUD admin) esperan la respuesta del backend para reflejar el cambio.

---

## 24. Estructura del frontend

**Decisión:** Estructura **mixta** dentro de `apps/front/src/`:

- **`components/`** — agnósticos al dominio: `ui/` (primitives shadcn), `atoms/`, `molecules/`, `organisms/`, `brand/`, `icons/`.
- **`features/`** — por dominio: `auth/`, `tickets/`, `kb/`, `notifications/`, `areas/`, `users/`, `sla/`, `ai/`, `admin/`. Cada feature tiene `api/`, `components/`, `hooks/`, `lib/`.
- **`pages/`** — rutas que componen features y layouts. Sin lógica de dominio. Incluye `routes.tsx` (configuración de React Router).
- **`layouts/`** — `auth-layout`, `app-shell`, `admin-layout`.
- **`lib/`** — `api-client`, `sse-client`, `query-client`, `permissions`, `ticket-state`, `format`, `env`.
- **`stores/`** — Zustand stores globales.
- **`hooks/`** — hooks reutilizables globales.
- **`styles/`** — `globals.css` con Tailwind v4 y tokens.

**Opciones evaluadas:**

| Opción | Pros | Contras |
|---|---|---|
| Mixta atomic + feature (elegida) | Composición clara de UI agnóstica + organización por dominio donde tiene sentido | Hay que decidir caso por caso si algo es agnóstico o de dominio |
| Solo atomic design puro | Reusabilidad máxima | Lógica de dominio queda dispersa, difícil rastrear de extremo a extremo |
| Solo feature folders | Cohesión alta por dominio | Componentes que sirven a varios dominios terminan duplicados o forzados a un feature |
| Carpetas por tipo (`components/`, `hooks/`, `services/`) | Familiar | No escala: un cambio funcional toca decenas de carpetas |

**Por qué se eligió:** Atomic design puro funciona para sistemas de diseño y feature folders puro para apps con dominios muy aislados. Tikora tiene **ambas caras**: necesita un sistema de UI compartido (botones, inputs, badges, semáforos, tablas) que viva una sola vez, y dominios fuertes (tickets, KB, IA, admin) cuya lógica es mejor que viva junta. La regla simple — "si el componente sabe de un concepto del negocio, va al feature; si no, va a `components/`" — hace clara la decisión en cada caso. `pages/` se mantiene fino (solo orquesta), lo que facilita que múltiples páginas compongan los mismos features sin lógica duplicada.
