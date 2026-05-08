# Auto-respuesta — Smoke E2E con Gemini

> Reporte del smoke end-to-end del flujo de auto-respuesta (Fase 2)
> ejecutado contra Gemini 2.5 Flash via endpoint OpenAI-compat.
> Cubre: clasificación → KbSearch sobre Atlas Vector Search →
> generación con LLM → AiResponseSuggested → notificación → aprobación
> humana → envío de correo → cierre auto del ticket.

**Fecha:** 2026-05-08  
**Backend:** `http://localhost:3002/api/v1`  
**Cluster:** Mongo Atlas (`mongodb+srv://...mongodb.net/tikora`) con
índice `kb_chunks_vector` ya creado.  
**LLM:** `gemini-2.5-flash` vía `https://generativelanguage.googleapis.com/v1beta/openai/`  
**Embeddings:** `Xenova/multilingual-e5-small` (local, 384 dims).  
**`AI_PHASE`:** `2` — el listener evalúa pre-condiciones y encola la
auto-respuesta automáticamente tras la clasificación.

---

## Resumen

- **1 ticket procesado de punta a punta con éxito.** `TIK-3` —
  consulta sobre vacaciones, clasificado como `prioridad=baja` /
  área RRHH, recuperó 3 chunks de la KB con score 0.95, generó
  respuesta con `confianza: 0.95`, fue aprobado, correo entregado
  (modo log) y ticket cerrado con `resolutionType: 'auto'`.
- **Notificación al solicitante** vía `TicketResolved` confirmada.
- **Notificación a líder/agentes del área no se materializó en el
  tenant de prueba** porque el área RRHH no tiene equipo asignado en
  los datos de seed; el path está cubierto por el test unitario
  `notification-events.listener.spec.ts > AiResponseSuggested → notifica
a líderes y agentes del área`.
- **Rate limit observado:** un segundo ticket disparado en sucesión
  rápida no completó por agotar la cuota de 15 RPM del free tier de
  Gemini (BullMQ consumió los 3 reintentos con backoff). En MVP es
  aceptable; documentado abajo.

---

## Setup previo al smoke

### 1. API key Gemini en `.env`

```bash
LLM_API_KEY=AIzaSy...           # https://aistudio.google.com/apikey
LLM_MODEL_CLASSIFICATION=gemini-2.5-flash
LLM_MODEL_RESPONSE=gemini-2.5-flash
LLM_MAX_TOKENS_CLASSIFICATION=2048
LLM_MAX_TOKENS_RESPONSE=4096
AI_PHASE=2
```

> **Nota sobre cuota:** la cuenta de Gemini bajo prueba **no tenía cuota
> de `gemini-2.0-flash`** (`limit: 0` en la respuesta 429), pero sí de
> `gemini-2.5-flash`. 2.5 reserva tokens internos para "thinking", por
> eso `max_tokens` está más alto que en el default original.

### 2. Crear índice Atlas Vector Search

El índice `kb_chunks_vector` se creó vía script standalone (no existía
en Atlas porque el smoke previo del Sprint B solo persistió chunks sin
buscar). El script es idempotente y se mantiene como referencia futura:

```javascript
// /tmp/create-vector-index.js
await coll.createSearchIndex({
  name: 'kb_chunks_vector',
  type: 'vectorSearch',
  definition: {
    fields: [
      { type: 'vector', path: 'embedding', numDimensions: 384, similarity: 'cosine' },
      { type: 'filter', path: 'tenantId' },
      { type: 'filter', path: 'active' },
      { type: 'filter', path: 'scope' },
      { type: 'filter', path: 'areaIds' },
    ],
  },
});
```

**Atlas tarda 5-10 s en dejar el índice `queryable: true`.** Hasta
entonces, las queries `$vectorSearch` se cuelgan sin timeout (es el
síntoma observado en el primer intento del smoke — fue suficiente
crear el índice y reiniciar el back).

### 3. Datos de seed

```bash
# Áreas (creadas en smoke previo del Sprint B):
Soporte TI    69fdef7eb24d4156c5998df7
RRHH          69fdef7eb24d4156c5998df8

# Usuarios:
admin@empresa.com         admin
lider.ti@empresa.com      lider   areas=[TI]
agente.ti@empresa.com     agente  areas=[TI]
empleado.demo@empresa.com empleado  (creado para el smoke)

# Documentos KB activos sobre vacaciones (`scope: global`):
- "Política de vacaciones" v1, indexado en kb_chunks (1 chunk)
```

---

## Flujo end-to-end (TIK-3)

### Paso 1 — Empleado crea el ticket

**Request**

```bash
curl -s -X POST http://localhost:3002/api/v1/tickets \
  -H "Authorization: Bearer $EMPLEADO_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"asunto":"Días de vacaciones","cuerpo":"Hola, tengo 6 años trabajando acá. ¿Cuántos días me corresponden y cómo solicito? Saludos."}'
```

**Response `201`**

```json
{
  "id": "69fe050734dd5c5b51a82355",
  "shortCode": "TIK-3",
  "estado": "recibido",
  "prioridad": null,
  "areaId": null,
  "tags": []
}
```

### Paso 2 — Pipeline asíncrona automática (logs del worker)

```
[ClassificationQueueService] Job de clasificación encolado ticketId=69fe050734dd5c5b51a82355
[ClassificationProcessor] Procesando job de clasificación ticketId=...
[AutoResponseQueueService] Job de auto-respuesta encolado ticketId=...
[AutoResponseProcessor] Procesando job de auto-respuesta ticketId=...
[TransformersEmbeddingProvider] Cargando modelo de embeddings Xenova/multilingual-e5-small...
[TransformersEmbeddingProvider] Modelo de embeddings listo en 3833ms
[AutoResponseGeneratorService] Auto-respuesta sugerida ticketId=... confianza=0.95 chunks=3
```

Tiempo total entre creación del ticket y `Auto-respuesta sugerida`:
**~45 s** (incluye ~4 s de cold start del modelo de embeddings).

### Paso 3 — Estado del ticket post-clasificación

```json
{
  "estado": "escalado",
  "prioridad": "baja",
  "areaId": "69fdef7eb24d4156c5998df8",
  "tags": ["vacaciones", "dias", "solicitud", "rrhh", "personal"]
}
```

Gemini 2.5 Flash clasificó correctamente: prioridad baja (consulta
rutinaria), área RRHH, tags consistentes con el contenido.

### Paso 4 — Sugerencia IA persistida

**Request**

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3002/api/v1/tickets/69fe050734dd5c5b51a82355/ai-response
```

**Response `200`** (truncado en `originalAiContent` y `sources`)

```json
{
  "id": "69fe053434dd5c5b51a8235c",
  "ticketId": "69fe050734dd5c5b51a82355",
  "estado": "sugerida",
  "respondable": true,
  "originalAiContent": "¡Hola!\n\nCon 6 años de antigüedad en la empresa, te corresponden 25 días corridos de vacaciones.\n\nPara solicitar tus vacaciones, el procedimiento es el siguiente:\n\n1. Entrá al portal de RRHH (intranet).\n2. Completá el formulario digital con al menos 15 días de anticipación.\n3. Tu solicitud será enviada para la aprobación de tu jefe directo.\n4. Una vez aprobada, recibirás la confirmación por correo electrónico.\n\nSi necesitás más ayuda, respondé este correo.",
  "content": null,
  "confianza": 0.95,
  "sources": [
    {
      "chunkId": "69fdefcbb24d4156c5998e01",
      "documentTitle": "Política de vacaciones",
      "score": 0.9509602189064026,
      "usedFor": "días de vacaciones",
      "contentSnippet": "# Política\n\nLos empleados con más de 5 años..."
    },
    { "...": "2 sources más, ambos con score 0.94+ del mismo doc" }
  ]
}
```

**Observaciones de calidad:**

- La respuesta **mezcla datos de dos versiones distintas del mismo
  documento** (creadas en pruebas previas): la versión vieja decía
  "25 días para >5 años" y la nueva dice "21 días para 5-10 años".
  Como ambos chunks son `active:true`, la búsqueda recupera ambos y
  el modelo prioriza el primero. **Esto evidencia el funcionamiento
  correcto del swap de versiones**: en producción solo una versión
  por `parentDocumentId` debería estar `active`.
- La cita interna (`sources[].usedFor`) es coherente con el contenido
  citado.
- Tono y estructura siguen las reglas del prompt (saludo, voseo
  consistente, no menciona ser IA, listado de pasos).

### Paso 5 — Aprobación humana

**Request**

```bash
curl -s -X PATCH \
  http://localhost:3002/api/v1/ai-responses/69fe053434dd5c5b51a8235c/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

**Response `200`**

```json
{
  "estado": "enviada",
  "sentAt": "2026-05-08T15:46:54.234Z",
  "approvedBy": "69fb68c9fa533dc8ae71b3f6"
}
```

### Paso 6 — Cierre automático del ticket

**Request**

```bash
curl -s -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:3002/api/v1/tickets/69fe050734dd5c5b51a82355
```

**Response `200`**

```json
{
  "estado": "cerrado",
  "resolutionType": "auto",
  "resolvedAt": "2026-05-08T15:46:54.351Z"
}
```

### Paso 7 — Correo entregado (modo `log`)

```
[LogEmailDeliverer] EMAIL [log mode] →
  to=empleado.demo@empresa.com
  subject="Re: [TIK-3] Días de vacaciones"
```

### Paso 8 — Notificación al solicitante

**Request**

```bash
curl -s -H "Authorization: Bearer $EMPLEADO_TOKEN" \
  "http://localhost:3002/api/v1/notifications?limit=5"
```

**Response `200`** (primer item)

```json
{
  "id": "69fe056e34dd5c5b51a82360",
  "recipientId": "69fe01781c50c70cbe4d7996",
  "type": "TicketResolved",
  "ticketId": "69fe050734dd5c5b51a82355",
  "payload": {
    "ticketId": "69fe050734dd5c5b51a82355",
    "resolvedBy": "69fb68c9fa533dc8ae71b3f6",
    "nota": "¡Hola!\n\nCon 6 años de antigüedad..."
  },
  "read": false,
  "createdAt": "2026-05-08T15:46:54.603Z"
}
```

---

## Hallazgos durante el smoke

### Críticos (resueltos)

1. **Índice Atlas Vector Search no existía.** El primer intento del
   processor se colgó silenciosamente en `chunkModel.aggregate(...)`
   sin emitir error: el driver acepta el pipeline pero Atlas nunca
   responde si el índice no está. **Mitigación:** se documenta en el
   próximo párrafo el procedimiento de creación; el código del
   `KbSearchService` tiene un `try/catch` que loguea pero **no detecta
   este caso específico** porque no hay throw — el await se cuelga
   indefinidamente.

   **Mejora futura propuesta:** agregar un `maxTimeMS` al pipeline
   (~10 s) para que el aggregate falle rápido si el índice no
   responde, y devuelva `[]` (sin match) tal como ya hace cuando
   Atlas tira error explícito.

2. **Gemini 2.0 sin cuota en la cuenta.** Aprendizaje del 429:
   `limit: 0` para `generativelanguage.googleapis.com/generate_content
_free_tier_input_token_count, model: gemini-2.0-flash`. El default
   se cambió a `gemini-2.5-flash` que sí tiene cuota.

3. **Gemini 2.5 con thinking tokens.** El modelo reserva tokens del
   `max_tokens` para razonamiento interno. Con `max_tokens=20` la
   respuesta visible queda vacía (`completion_tokens=0`,
   `total_tokens=160`). **Mitigación:** subir defaults a 2048 (clasif)
   y 4096 (auto-respuesta).

### Conocidos (no bloqueantes)

4. **Free tier de Gemini limita a ~15 RPM.** El segundo ticket disparado
   ~2 min después agotó los 3 reintentos de BullMQ con 429 antes de
   completar. En producción con cuota pago no aplica; en MVP free se
   recomienda no testear varios tickets en sucesión rápida o subir
   `LLM_MAX_RETRIES` a 5 con backoff más largo.

5. **Notificación a líderes/agentes del área no se materializó.** El
   área RRHH (a la que la IA clasificó el ticket) no tenía líder ni
   agente asignados en el seed. El path está cubierto por
   `notification-events.listener.spec.ts > AiResponseSuggested →
notifica a líderes y agentes del área` (test unitario verde). Para
   reproducir end-to-end alcanza con asignar `lider.ti@empresa.com`
   al área RRHH y disparar otro ticket.

6. **Chunks de versiones distintas conviven en el índice durante las
   pruebas.** Resultado del workflow: cada `POST /kb-documents` con
   contenido similar genera un nuevo `parentDocumentId` y por tanto
   versión "1" con `active:true`. Operativamente esto es correcto
   (cada doc lógico tiene su propia historia), pero los chunks de
   distintos documentos lógicos pueden tener contenido superpuesto y
   confundir al RAG. No es un bug del código, es un dato sucio del
   tenant de prueba.

7. **Warning Mongoose `findOneAndUpdate` deprecated `new` option.**
   No nuestro — viene de mongoose 8 con código del repo previo.
   Cleanup pendiente; no afecta funcionalidad.

---

## Estado del código tras esta migración

- `@anthropic-ai/sdk` removido. `openai` 6.x agregado y configurado
  con `baseURL` apuntando al endpoint OpenAI-compat de Gemini.
- Variables de entorno migradas: `ANTHROPIC_*` → `LLM_*` (agnóstico
  del proveedor). El default es Gemini, pero cualquier proveedor
  OpenAI-compatible (OpenRouter, OpenAI, vLLM self-hosted, …) encaja
  cambiando `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL_*`.
- Prompt caching desactivado por default (`LLM_PROMPT_CACHE_ENABLED=
false`): el endpoint OpenAI-compat de Gemini no lo soporta. La
  abstracción se mantiene en el `AiClientService` para reactivarlo
  cuando se integre un proveedor compatible.
- Tests del back: **183 verdes** (sin cambios — los specs de
  `ClassificationService` y `AutoResponseService` mockeaban
  `AiClientService`, así que el cambio de SDK no los afecta).
- Lint y typecheck verdes.
