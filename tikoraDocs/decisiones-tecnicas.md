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

## Decisiones pendientes (próximas rondas)

- Lista definitiva de módulos NestJS para Fase 1.
- Estados del ticket y matriz de transiciones válidas.
- Modelo de roles y permisos (RBAC simple vs granular).
- Configuración de SLAs por defecto y calendario hábil.
- Formato de documentos y modelo de embeddings para la KB.
- Canal de notificaciones en tiempo real (Socket.io vs SSE).
- Proveedor de email transaccional (Resend / SendGrid / Mailgun).
- Política de adjuntos (tipos, tamaño máximo, almacenamiento).
- Versionado de la API (`/api` vs `/api/v1`).
