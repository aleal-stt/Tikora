# Tikora — Integración WhatsApp Business API via n8n

> Plan diferido para habilitar la creación y consulta de tickets desde WhatsApp Business cuando se libere presupuesto para un número productivo. Documenta arquitectura, componentes y decisiones para retomar sin re-investigar. **No implementado todavía.**

---

## 1. Objetivo

Permitir que un empleado con cuenta en Tikora opere tickets desde WhatsApp **sin instalar Claude** ni configurar un connector. La conversación llega a un número de WhatsApp Business operado por la empresa: el empleado escribe "necesito días de vacaciones", el sistema responde con la info de la KB y, si corresponde, crea o consulta tickets.

**Diferencias con el MCP actual** ([[tikora-mcp]]):

- El MCP requiere que el empleado tenga app de Claude y configure un connector con su API key. La fricción es razonable para empleados técnicos pero alta para el resto.
- Con WhatsApp Business no hay fricción: el empleado solo guarda el contacto y escribe. La masa adoptable es mucho mayor.
- A cambio, hay costo por mensaje (Meta Cloud) o por minuto (Twilio), y un proceso de verificación de marca.

Ambos canales coexisten. El MCP no se retira — sigue siendo el camino para usuarios power que prefieren Claude, y para validar nuevas tools antes de exponerlas a WhatsApp.

---

## 2. Por qué n8n como gateway (no como orquestador)

WhatsApp no habla MCP. Es un canal de transporte: mensajes de texto entrando y saliendo. Quien tiene que decidir _qué hacer_ con cada mensaje (clasificarlo, llamar tools, redactar respuesta) es el orquestador conversacional. La pregunta es **dónde vive ese orquestador**.

Dos arquitecturas fueron evaluadas:

| Opción                                | Orquestador conversacional    | Tools                                                | Fuentes de verdad                                                                        |
| ------------------------------------- | ----------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| A — n8n hace todo                     | n8n AI Agent node (LangChain) | HTTP Request nodes en n8n que pegan a REST de Tikora | **Dos**: handlers MCP en `apps/back/src/mcp/tools/` + tools cableadas en el workflow n8n |
| **B — Back orquesta, n8n es gateway** | Worker NestJS con SDK del LLM | Handlers MCP existentes invocados in-process         | **Una**: handlers MCP, la misma que usa Claude Mobile                                    |

**Decisión: Opción B.** Las tools del MCP (`crear_ticket`, `listar_mis_tickets`, `obtener_ticket`, `agregar_mensaje_a_ticket`) ya están escritas, probadas y son la fuente de verdad para la operación de tickets vía conversación. Duplicarlas como nodos n8n para Opción A introduce drift: cada cambio en una tool hay que replicarlo en el workflow visual y nadie se acuerda. Ya pasa con tablas hardcoded en código; con lógica de negocio en visual workflows pasaría peor.

**Lo que sí hace n8n en Opción B:**

- Recibir webhooks de Twilio/Meta Cloud (verificar firma, parsear).
- Forwardear el mensaje al back como HTTP POST a `/api/v1/whatsapp/inbound`.
- Recibir el callback del back con la respuesta lista para enviar.
- Llamar al endpoint de Twilio/Meta para entregar el mensaje a WhatsApp.

n8n hace lo que mejor sabe: pegamentar APIs HTTP. No tiene estado, no decide nada, no llama LLMs. Si en algún momento se quiere cambiar Twilio por Meta Cloud, se cambia en n8n sin tocar el back. Si se quiere eliminar n8n (porque el back puede recibir el webhook directo), se quita el adaptador y el back queda igual.

---

## 3. Arquitectura

```
┌────────────┐                                                              ┌────────────┐
│  Usuario   │                                                              │  Usuario   │
│ WhatsApp   │                                                              │ WhatsApp   │
└─────┬──────┘                                                              └─────▲──────┘
      │                                                                           │
      │ texto                                                                     │ respuesta
      ▼                                                                           │
┌─────────────────┐                                                       ┌──────────────────┐
│ Twilio / Meta   │                                                       │ Twilio / Meta    │
│ Cloud API       │                                                       │ Cloud API        │
└─────┬───────────┘                                                       └──────▲───────────┘
      │ webhook                                                                   │ POST Send Msg
      ▼                                                                           │
┌─────────────────┐                                                       ┌──────────────────┐
│ n8n             │ ──────POST /api/v1/whatsapp/inbound──────────────►   │ n8n              │
│ (Webhook        │                                                       │ (Callback        │
│  recibir)       │                                                       │  enviar)         │
└─────────────────┘                                                       └──────▲───────────┘
                                                                                  │ POST /n8n/callback
                                                                                  │
                              ┌──────────────────────────────────────────────────┘
                              │
                              ▼
                       ┌──────────────────────────────────────────────────┐
                       │ Back NestJS — módulo whatsapp                    │
                       │                                                  │
                       │ Controller /inbound ─► Queue BullMQ              │
                       │                                                  │
                       │   Worker:                                        │
                       │     1. phone → user                              │
                       │     2. carga conversación previa                 │
                       │     3. LLM con tools MCP (loop multi-turno)      │
                       │     4. handlers MCP invocados in-process         │
                       │     5. persiste conversación + ticket si aplica  │
                       │     6. POST a callback n8n                       │
                       └──────────────────────────────────────────────────┘
```

**Punto clave:** el worker llama a los handlers MCP **directamente como funciones TypeScript**, no por HTTP. Reusa exactamente el mismo código que sirve Claude Mobile vía el server MCP.

---

## 4. Componentes nuevos en el back

### 4.1 Módulo `apps/back/src/whatsapp/`

```
whatsapp/
├── whatsapp.module.ts
├── controllers/
│   └── whatsapp-inbound.controller.ts      # POST /api/v1/whatsapp/inbound
├── guards/
│   └── inbound-token.guard.ts              # valida X-Tikora-Inbound-Token contra env
├── services/
│   ├── whatsapp-agent.service.ts           # loop conversacional con LLM + tools MCP
│   ├── whatsapp-sender.service.ts          # POST a callback de n8n
│   └── whatsapp-conversation.service.ts    # CRUD de conversaciones, TTL
├── schemas/
│   └── whatsapp-conversation.schema.ts     # Mongo: turn history por user
├── queue/
│   └── whatsapp-inbound.processor.ts       # worker BullMQ
└── dto/
    └── inbound-message.dto.ts              # Zod
```

### 4.2 Schemas extendidos en colecciones existentes

- **`User`:** agregar `phoneE164: string | null` con índice `{tenantId, phoneE164}` único sparse. Si dos users del mismo tenant pretenden el mismo número, se rechaza en la UI de admin. Cross-tenant no aplica para WhatsApp porque cada tenant tendría un número propio.
- **`Ticket`:** agregar `channel: 'web' | 'whatsapp' | 'mcp'` (default `'web'`). El campo solo afecta dónde se notifica al requester cuando hay una respuesta del agente: para `web` se manda email como hoy; para `whatsapp` el back hace POST a n8n para que el agente envíe via WhatsApp; para `mcp` el empleado va a consultar él mismo desde Claude.

### 4.3 Nueva colección `whatsapp_conversations`

| Campo                 | Tipo                 | Nota                                                                                                        |
| --------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `_id`                 | ObjectId             |                                                                                                             |
| `tenantId`            | ObjectId             |                                                                                                             |
| `userId`              | ObjectId             | El user que conversó.                                                                                       |
| `phoneE164`           | string               | Snapshot del número; sirve para auditoría si el user cambia el suyo.                                        |
| `messages`            | `Array<TurnMessage>` | History completo de la conversación.                                                                        |
| `lastInboundAt`       | Date                 | Para TTL — si pasa más de `WHATSAPP_SESSION_TTL_MIN` (default 30), próxima inbound abre conversación nueva. |
| `createdAt/updatedAt` | Date                 |                                                                                                             |

`TurnMessage` = `{ role: 'user' | 'assistant' | 'tool', content: string, toolName?: string, toolCallId?: string, toolInput?: unknown, toolResult?: unknown, ts: Date }`. La estructura sigue el formato del SDK que se elija (Anthropic o OpenAI tool-use) para que serializar/deserializar sea directo.

### 4.4 Vars de entorno nuevas

| Variable                       | Default                                 | Nota                                                                                                                                                          |
| ------------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_INBOUND_TOKEN`       | requerido                               | Token compartido con n8n. Se valida en `inbound-token.guard.ts`.                                                                                              |
| `WHATSAPP_CALLBACK_URL`        | requerido                               | URL de n8n donde el back postea respuestas listas para enviar.                                                                                                |
| `WHATSAPP_AGENT_MODEL`         | `claude-haiku-4-5` o `gemini-2.5-flash` | Modelo para el agent loop. Si es Anthropic usa SDK propio; si es Gemini OpenAI-compat reusa `AiClient`. Conviene Anthropic por madurez del tool use (ver §6). |
| `WHATSAPP_SESSION_TTL_MIN`     | `30`                                    | Tras esta inactividad la próxima inbound empieza conversación nueva.                                                                                          |
| `WHATSAPP_MAX_TOOL_ITERATIONS` | `8`                                     | Cap para evitar loops infinitos del agente.                                                                                                                   |
| `WHATSAPP_MAX_OUTBOUND_CHARS`  | `1500`                                  | Splitting o truncado si la respuesta del LLM excede el límite del provider de WhatsApp.                                                                       |
| `WHATSAPP_RATE_LIMIT_PER_MIN`  | `10`                                    | Por user. Defensa contra abuso/loops del cliente.                                                                                                             |

### 4.5 Frontend

- **Perfil de usuario:** input para vincular phone E.164 propio + botón "Verificar" que envía OTP via WhatsApp (opcional para v1: dejar verificación manual por admin).
- **Admin de usuarios:** columna nueva `phone` editable con validación E.164 (`+5491145678901`).
- **Ticket detail:** badge mostrando `channel` ('Creado por WhatsApp', 'Por Claude', etc.) para que el agente sepa cómo va a salir su respuesta.

---

## 5. Componentes en n8n

Dos workflows simples. El usuario no es n8n el limitante.

### 5.1 Workflow "WhatsApp Inbound"

1. **Trigger:** Webhook node, path `/whatsapp/inbound`. Twilio/Meta lo invocan en cada mensaje del user.
2. **Verificar firma:** Function node con el secret de Twilio o Meta. Si firma no valida, devolver 401.
3. **Transform:** Extrae `{phoneFrom, text, providerMessageId, ts}` del payload del provider.
4. **HTTP Request:** POST `https://<back>/api/v1/whatsapp/inbound` con header `X-Tikora-Inbound-Token: <env>` y body `{phone: phoneFrom, text, providerMessageId, ts}`.
5. **Response:** 200 a Twilio/Meta inmediatamente (no esperar al back, que procesa async).

### 5.2 Workflow "WhatsApp Outbound"

1. **Trigger:** Webhook node, path `/whatsapp/outbound`. El back lo invoca cuando tiene respuesta lista.
2. **Verificar token:** Header `X-Tikora-Callback-Token` contra env compartido (para que el endpoint no sea abierto).
3. **HTTP Request:** POST a Twilio Messages API o Meta Cloud Send con el texto.
4. **Response:** 200 al back.

Tiempo de armado del workflow: ~2 horas la primera vez si nunca configuraste Twilio/Meta antes, ~30 minutos si ya lo hiciste.

---

## 6. Flujo end-to-end (ejemplo)

```
[T+0]   User WhatsApp: "Hola, ¿cuántos días de vacaciones me corresponden?"
[T+0]   Twilio recibe el mensaje, dispara webhook a n8n.
[T+0.1] n8n verifica firma, transforma, POST a back /inbound.
[T+0.2] Back guard valida X-Tikora-Inbound-Token, controller encola en BullMQ.
[T+0.2] Back responde 202 a n8n inmediatamente. n8n responde 200 a Twilio.
[T+0.3] Worker BullMQ levanta el job:
        - phone +5491145678901 → user empleado.demo@empresa.com
        - No hay conversación activa (>30 min), abre una nueva
        - Llama LLM con system prompt + tools del MCP
[T+1.5] LLM responde con tool_use: listar_mis_tickets(estado='abierto')
[T+1.5] Worker invoca handler MCP directamente (in-process), pushea tool_result
[T+3.0] LLM responde con texto final: "Hola Juan, según tu antigüedad de 4 años
        te corresponden 21 días hábiles..."
[T+3.0] Worker persiste turno completo en whatsapp_conversations
[T+3.0] Worker POST a n8n /whatsapp/outbound con texto + phoneTo
[T+3.1] n8n POST a Twilio Send
[T+3.5] Twilio entrega el mensaje al user
```

Latencia total observable por el user: ~3 segundos (cuello: el LLM, no el transporte).

---

## 7. Decisiones pendientes antes de codear

Estas se cierran cuando se retome el plan; algunas requieren chequear precios o capacidades del provider que pueden haber cambiado. La decisión de provider y operación está cerrada — ver §11.

| #   | Pregunta                                                | Opciones                                                                                                                                                                                                                                                                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Modelo LLM para el agent loop                           | **Anthropic Claude Haiku** (mejor experiencia de tool use, costo bajo, requiere cuenta Anthropic). **Gemini Flash** (reusa `AiClient` actual, tool use vía función calling de OpenAI-compat es serviciable pero menos robusto en loops largos). Anthropic preferido si presupuesto OK.                  |
| 2   | Identificación del user en el primer mensaje            | **Solo users registrados** con phone vinculado por admin (consistente con MCP). **Auto-registro** vía OTP por WhatsApp cuando el phone no matchea (más fricción de implementación, mejor UX para empleados nuevos).                                                                                     |
| 3   | Adjuntos (imagen, audio, PDF)                           | **No en v1** (consistente con MCP). El user que mande imagen recibe un mensaje "no soporto imágenes todavía, describí qué necesitás". v2 puede integrarse con el módulo `attachments` existente (ver [[tikora-mcp]] §6).                                                                                |
| 4   | TTL de conversación                                     | **30 minutos** de inactividad → nueva conversación. Justificación: balancea contexto útil vs. tokens innecesarios; coincide con el patrón de uso esperado (consultas cortas). Configurable por `WHATSAPP_SESSION_TTL_MIN`.                                                                              |
| 5   | Notificaciones push del agente al empleado              | El back ya puede hacer POST a n8n outbound desde cualquier punto, no solo desde el agent loop. Cuando un agente humano responde un ticket creado por WhatsApp, el back puede mandar la respuesta como mensaje proactivo. **Requiere ventana de 24h del provider** (mensaje business-initiated cobrado). |
| 6   | Rate limiting                                           | Por user: `WHATSAPP_RATE_LIMIT_PER_MIN=10`. Por tenant: cap mensual configurable para no exceder el crédito de Twilio. Cuando se supera, respuesta automática "Estás enviando muchos mensajes, esperá un momento".                                                                                      |
| 7   | Migración del Ticket existente al nuevo `channel` field | Migration script que setee `channel='web'` para todos los tickets actuales. Tickets pre-migración no tienen forma de saber su canal original, queda 'web' como default razonable.                                                                                                                       |

---

## 8. Plan de implementación en fases

Esfuerzo estimado total: **~3 días de dev** + 1 día de integración con Twilio/Meta. Desglose:

### Fase A — Setup infra y skeleton (0.5 día)

- Crear cuenta Twilio o app Meta Business.
- Configurar n8n self-hosted (Docker compose) si no existe ya, o usar n8n cloud free tier.
- Armar los dos workflows básicos (Inbound + Outbound) con HTTP requests mock al back.
- Crear ngrok tunnel separado para n8n (no se mezcla con el del MCP).

### Fase B — Módulo back sin LLM (0.5 día)

- Schema `whatsapp_conversations`, schemas extendidos `User.phoneE164`, `Ticket.channel`.
- Controller `/inbound` + guard de token + DTO Zod.
- Service `WhatsappConversationService` con CRUD y TTL.
- Service `WhatsappSenderService` que postea a `WHATSAPP_CALLBACK_URL`.
- Sin LLM aún: el worker responde "Hola, recibí tu mensaje" estático para validar el ping-pong end-to-end.

### Fase C — Agent loop con tools MCP (1 día)

- `WhatsappAgentService` con el loop multi-turno. Inyecta los handlers MCP existentes (`McpToolsModule.exports`) sin pasar por HTTP.
- Persistencia del turn history por iteración (para que un crash del worker no pierda contexto).
- Cap de iteraciones, manejo de errores del LLM (timeout → mensaje de fallback al user).
- System prompt en español, con instrucciones de tono y cuándo usar cada tool.

### Fase D — Frontend admin (0.5 día)

- Columna `phone` en `/admin/users` con validación E.164.
- Sección "vincular WhatsApp" en `/perfil`.
- Badge `channel` en ticket detail.

### Fase E — Smoke real (0.5 día)

- Probar el flujo completo end-to-end con un número Twilio sandbox.
- Validar que la conversación multi-turno mantiene contexto.
- Validar que se crea un ticket real y queda con `channel='whatsapp'`.
- Validar que el agente humano puede responder y la respuesta llega via WhatsApp (push).

---

## 9. Riesgos y mitigaciones

| Riesgo                                                               | Mitigación                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| El LLM entra en loop infinito de tool calls                          | Cap `WHATSAPP_MAX_TOOL_ITERATIONS=8`. Si se alcanza, abortar con mensaje de fallback al user.                                                                                                                |
| Mensaje del LLM excede límite de WhatsApp (~1600 chars en Twilio)    | Truncado con suffix "...(continúa, pedime que siga)" o splitting en N mensajes con micro-delay entre ellos.                                                                                                  |
| El back se reinicia en medio de un loop                              | BullMQ persiste el job; al retomar, el turn history en Mongo permite reconstruir el estado y reintentar desde el último turno completo.                                                                      |
| Costo de Meta Cloud explota por loop del cliente o spam              | Rate limit por user + cap mensual por tenant. Alarma cuando se cruza 70% del cap.                                                                                                                            |
| Cambio en API de Twilio/Meta rompe el workflow                       | n8n encapsula el cambio; el back no se entera. Versionar el workflow y testearlo en sandbox antes de promover a prod.                                                                                        |
| Un user con phone mal vinculado recibe respuestas que no son para él | Doble check en el worker: phone del mensaje entrante debe matchear `User.phoneE164` exactamente. Si no, "Tu número no está vinculado a ninguna cuenta. Contactá al admin." Auditar todos los inbound en log. |
| Si en algún momento querés deshacerte de n8n                         | El back ya está expuesto vía HTTP, basta apuntar el webhook de Twilio directo al back y eliminar n8n. La interfaz del controller `/inbound` está estabilizada por DTO, no por implementación de n8n.         |
| Conflicto de modelo entre WhatsApp y MCP                             | Ambos usan los mismos handlers de tools. Si una tool se actualiza, ambos canales se benefician. No hay duplicación.                                                                                          |

---

## 10. Definición de "done" para la v1

- [ ] Un admin puede vincular el phone E.164 a un user existente desde el front.
- [ ] Un user con phone vinculado puede crear un ticket mandando "necesito ayuda con X" al número de WhatsApp.
- [ ] El ticket queda con `channel='whatsapp'`.
- [ ] El user puede preguntar "¿qué pasó con mi último ticket?" y recibir el estado.
- [ ] Cuando un agente responde el ticket desde la UI, el user recibe la respuesta via WhatsApp (no email).
- [ ] La conversación con TTL de 30 min funciona: dos mensajes consecutivos comparten contexto, dos separados por 1h no.
- [ ] Mensaje desde un phone no registrado recibe "no estás registrado" sin crashear ni filtrar info.
- [ ] Rate limit por user funciona: 11 mensajes en 1 minuto y el 11º recibe el mensaje de "esperá".
- [ ] Métricas mínimas: tickets creados por canal, mensajes inbound/outbound por día, tasa de error del LLM.

---

## 11. Operación y costos

### 11.1 n8n — Community Edition self-hosted

**Decisión cerrada: n8n Community Edition.** Es la versión open source self-hosted, gratis para siempre, sin límite de workflows ni ejecuciones. Lo único que se "paga" es el host donde corre.

**Setup elegido para la v1:** Docker compose en el mismo host donde corre Tikora, sumándolo a `docker-compose.dev.yml` junto a Mongo y Redis. Cero costo, cero login adicional, cero servicio extra que aprovisionar.

**Lo que no incluye Community Edition** (vs. Cloud o Enterprise) y por qué no nos limita en la v1:

| Feature ausente            | Por qué no importa hoy                                                           |
| -------------------------- | -------------------------------------------------------------------------------- |
| SSO empresarial            | El acceso a n8n queda restringido a operadores de Tikora; basta user/pass.       |
| Audit logs detallados      | El back ya audita todos los inbound/outbound en `whatsapp_conversations`.        |
| Environments dev/prod      | Para piloto basta una instancia; cuando se separe, dos docker-compose distintos. |
| Soporte 24/7               | Comunidad activa y docs públicas son suficientes para el setup que hacemos.      |
| Version control git nativo | Los 2 workflows se exportan a JSON y se versionan en el repo manualmente.        |

**Path de migración futuro (si se justifica):** los workflows de n8n se exportan/importan como JSON. Pasar de Community self-hosted a n8n Cloud o viceversa es trivial — copiar el JSON y reconfigurar credentials. No hay lock-in, así que la decisión "Community vs Cloud" es reversible sin re-implementación.

### 11.2 Provider de WhatsApp — Twilio elegido para la v1

**Decisión cerrada: Twilio.** Razón principal: **arrancar ya sin esperar Business Verification** de Meta (1–7 días hábiles), que requiere documentos legales de la empresa y aprobación manual de un revisor de Meta. Twilio te activa la cuenta inmediatamente.

#### Twilio WhatsApp Sandbox — la pieza de la v1

| Característica           | Detalle                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| Costo                    | $0                                                                                                                                  |
| Setup                    | Minutos: crear cuenta Twilio, activar Sandbox de WhatsApp, copiar credentials.                                                      |
| Número                   | Compartido de Twilio (formato `+1 415-…`); no es número propio.                                                                     |
| Fricción para el usuario | Cada destinatario debe enviar `join <código-de-3-palabras>` al número antes del primer mensaje (una vez, dura 72h o hasta `leave`). |
| Volumen                  | Sin límite duro para sandbox dentro del crédito trial (~$15 USD que prácticamente no se consumen en sandbox).                       |
| Cuándo NO sirve          | Demo a cliente externo donde no se puede explicar el `join`. Para esos casos, ver §11.4.                                            |

#### Twilio WhatsApp Producción — cuando se quiera cortar el `join`

Cuando el piloto interno valide el flujo y se quiera mostrar a un cliente externo con número propio sin fricción:

| Requisito                                     | Tiempo / Costo                                                                                                                                                                |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Número propio aprovisionado en Twilio         | $1–$3 USD/mes según país.                                                                                                                                                     |
| Registración del número con Meta (via Twilio) | 1–2 días hábiles; menos doloroso que Meta directo porque Twilio actúa como BSP y acelera.                                                                                     |
| Display name approval                         | 1–2 días extra; el nombre que ve el remitente debe ser aprobado por Meta.                                                                                                     |
| Costo por mensaje                             | Variable por país. Para Argentina, fracción de centavo por mensaje service (within 24h window). Mensaje business-initiated (template aprobado, fuera de ventana) es más caro. |
| Templates                                     | Cada template para mensajes proactivos requiere aprobación, suele tardar horas.                                                                                               |

**Pricing exacto:** no se cita acá porque Twilio actualiza tarifas y conviene mirar `https://www.twilio.com/whatsapp/pricing/<país>` al momento de migrar.

### 11.3 Costos por fase de Tikora

| Fase                                    | n8n              | WhatsApp provider                                    | LLM (agent loop)                               | Total estimado  |
| --------------------------------------- | ---------------- | ---------------------------------------------------- | ---------------------------------------------- | --------------- |
| Dev + smoke (decenas de mensajes/día)   | $0 (Community)   | $0 (Twilio sandbox)                                  | $0 (Gemini free tier) o ~$1/mes (Claude Haiku) | **~$0–1/mes**   |
| Piloto cliente con `join` aceptado      | $0               | $0 (Twilio sandbox)                                  | Idem dev                                       | **~$0–1/mes**   |
| Cliente con número propio (cientos/mes) | $0               | ~$2/mes número + ~$5–10/mes mensajes (estimación AR) | ~$2–10/mes según volumen                       | **~$10–25/mes** |
| Crecimiento (miles de mensajes/mes)     | $0 o ~$5/mes VPS | depende volumen y país                               | escala lineal con tokens                       | **revisitar**   |

La línea con el crédito trial de Twilio (~$15 USD) cubre el setup y los primeros mensajes de producción sin desembolso.

### 11.4 Meta Cloud API — alternativa diferida

Se evaluó y queda registrada como alternativa para cuando el volumen o el costo justifiquen migrar fuera de Twilio.

| Aspecto               | Meta Cloud API                                                                                                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Costo por mensaje     | Más barato que Twilio (sin platform fee intermedio).                                                                                                        |
| Free tier real        | **1000 service conversations/mes gratis** (una conversation = ventana 24h iniciada por el user). Cubre piloto chico sin desembolso.                         |
| Setup                 | Más complejo: Meta Business Manager, app de Meta, webhooks directos.                                                                                        |
| Business Verification | **1–7 días hábiles**, manual, requiere documentos legales de la empresa. Es exactamente la fricción que estamos evitando hoy.                               |
| Test number           | Disponible inmediatamente sin verification, pero limitado a **5 destinatarios pre-registrados** — sirve para dev pero no para piloto con usuarios externos. |
| Display name approval | 1–2 días extra; misma política que Twilio.                                                                                                                  |

**Cuándo conviene migrar a Meta Cloud:**

- Cuando el volumen mensual de mensajes haga que el costo Twilio (incluyendo su platform fee) sea sensible comparado con Meta directo.
- Cuando ya exista una Business Account de la empresa con verification previa (por ejemplo, porque ya corren Facebook/Instagram Ads), porque entonces la fricción de verification desaparece.
- Si se quiere reducir intermediarios para auditoría o compliance.

**Cuándo NO conviene migrar:**

- Mientras el volumen sea bajo y el costo Twilio sea marginal.
- Si la empresa no tiene presencia digital comprobable (sitio web, documentos legales accesibles), porque la verification se atascará.

**Cómo se haría la migración con la arquitectura actual:** cambiar el provider en los workflows de n8n (Twilio nodes → Meta Cloud nodes) y rotar credentials. El back no se toca — el contrato `/api/v1/whatsapp/inbound` y el callback se mantienen idénticos porque n8n encapsula el provider. Tiempo estimado del switch: medio día de trabajo + el tiempo de Business Verification de Meta.

### 11.5 Resumen de la decisión

- **Hoy y piloto interno:** n8n Community self-hosted + Twilio Sandbox. Costo total: $0.
- **Demo a cliente externo con número propio sin `join`:** Twilio producción con número propio (~$2–10/mes según volumen). Setup: 1–2 días para que Meta apruebe display name via Twilio.
- **Producción a escala (futuro):** revisitar Meta Cloud si el volumen lo justifica y la empresa ya tiene Business Verification hecha.
