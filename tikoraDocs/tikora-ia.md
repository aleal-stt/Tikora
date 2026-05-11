# Tikora — Componente de Inteligencia Artificial

> Documento técnico completo de la capa de IA de Tikora. Cubre modelos, pipelines, prompts, RAG, manejo de errores, seguridad, costos y evolución por fases.

---

## 1. Visión General

La IA en Tikora cumple **dos funciones de negocio** y un **rol auxiliar**:

1. **Clasificación de tickets** — analizar cada ticket recién creado y devolver el área, la prioridad, una confianza, un resumen y tags. Es la pieza que decide si el ticket se escala a un agente o si entra al flujo de auto-respuesta.
2. **Auto-respuesta** — para tickets de baja prioridad cuya consulta está cubierta por la base de conocimiento, generar una respuesta completa al usuario sin involucrar a un agente.
3. **Generación de embeddings** — transformar tickets y documentos de la KB a vectores para búsqueda semántica.

**Filosofía operativa:**

- **El humano siempre puede tomar el volante.** En toda etapa, un agente puede revertir, editar o anular lo que la IA hizo.
- **Trazabilidad total.** Cada decisión de la IA se persiste con prompt, modelo, versión, temperatura, score y fuentes consultadas.
- **Costo controlado.** Modelos elegidos por relación calidad-precio, prompt caching agresivo y embeddings 100 % locales.
- **Privacidad.** Solo los textos del ticket y los chunks relevantes de la KB viajan al proveedor externo. Nada más.

**Proveedores:**

- **SDK oficial de OpenAI** (`openai`) configurado con `baseURL` hacia un **endpoint OpenAI-compatible**. Proveedor por defecto en el setup actual: **Gemini free tier** (`https://generativelanguage.googleapis.com/v1beta/openai/`). Cambiar de proveedor (OpenAI directo, OpenRouter, vLLM self-hosted, Ollama, etc.) es solo cambiar `LLM_BASE_URL` + `LLM_API_KEY` + `LLM_MODEL_*`.
- **Transformers.js** (local) para embeddings.
- **MongoDB Atlas Vector Search** (mismo cluster que la BD) para búsqueda vectorial.

> Nota histórica: la decisión original (decisiones-tecnicas §3) fue usar el SDK de Anthropic con Claude Haiku/Sonnet. La revisión (§26) migró al SDK de OpenAI contra endpoint compatible por cero costo durante MVP. El cambio es transparente para el resto del backend porque `AiClientService` mantiene la misma interfaz.

---

## 2. Modelos y Selección

### 2.1 Modelos de generación

| Función                             | Modelo por defecto (setup actual) | Variable de entorno           |
| ----------------------------------- | --------------------------------- | ----------------------------- |
| Clasificación                       | `gemini-2.5-flash`                | `LLM_MODEL_CLASSIFICATION`    |
| Generación de respuesta             | `gemini-2.5-flash`                | `LLM_MODEL_RESPONSE`          |
| Revisión / segunda opinión (Fase 3) | (no activo aún)                   | `LLM_MODEL_REVIEW` (opcional) |

**Estrategia de selección de modelo:**

- **Modelo chico y rápido para clasificar**: la clasificación es comprensión + selección sobre un set acotado (áreas, prioridades). Un modelo de gama baja-media latencia < 1-2 s alcanza. Procesar con un modelo grande no agrega calidad significativa pero multiplica costo y latencia por volumen alto.
- **Modelo más capaz para responder**: la auto-respuesta requiere texto bien estructurado, empático, en español, citando información específica de la KB. Si se usa un proveedor con tiers (OpenAI mini vs full, Gemini Flash vs Pro, Claude Haiku vs Sonnet), conviene reservar el tier superior para respuesta. En setup actual ambos usan `gemini-2.5-flash` porque el free tier de Pro es restrictivo y Flash da calidad suficiente para piloto.
- **Configurable por env**: permite swap rápido a un modelo más nuevo o más barato sin redeploy. Cambiar `LLM_MODEL_*` es suficiente; el código no asume nada del modelo más allá de soportar el formato OpenAI-compat de chat completions.

**Notas sobre Gemini en particular:**

- `gemini-2.5-flash` reserva tokens internos para razonamiento ("thinking tokens") que se cuentan dentro de `max_tokens`. Por eso los defaults de `LLM_MAX_TOKENS_CLASSIFICATION` (2048) y `LLM_MAX_TOKENS_RESPONSE` (4096) están más altos que en un modelo regular sin thinking. Bajarlos puede dejar `completion_tokens=0` con la respuesta vacía.
- Free tier limita a ~15 RPM. Aceptable para MVP; BullMQ absorbe rate limits con backoff.

### 2.2 Modelo de embeddings

| Componente                              | Modelo                             | Configuración          |
| --------------------------------------- | ---------------------------------- | ---------------------- |
| Embeddings de chunks de KB y de tickets | **`Xenova/multilingual-e5-small`** | `EMBEDDING_MODEL_NAME` |

**Características:**

- Multilingüe, con buen soporte de español.
- 384 dimensiones (compacto, rápido en búsqueda).
- ~120 MB de tamaño en disco.
- Corre 100 % local vía Transformers.js (`@xenova/transformers`).
- Sin costo, sin rate limits, sin dependencia externa.

**Convención de los inputs E5:** los modelos de la familia E5 esperan un prefijo en cada texto que se va a indexar o consultar:

- Texto a indexar (chunk de KB): `passage: <texto>`
- Texto de consulta (ticket): `query: <texto>`

Esta convención es obligatoria — no respetarla degrada la calidad del retrieval. Se aplica en el módulo `kb` antes de generar el embedding.

---

## 3. Roadmap de Fases del Componente IA

La capa de IA evoluciona en tres fases. Cada fase mantiene operativo el flujo anterior y agrega capacidad nueva.

### Fase 1 — Clasificación + escalado humano

- La IA clasifica todo ticket entrante.
- Toda respuesta al usuario la escribe un agente humano (por correo, fuera de la plataforma en MVP).
- El módulo `auto-response` está construido pero **no ejecuta** generación: queda en stand-by hasta Fase 2.
- La KB puede empezarse a poblar para ir entrenando el corpus, pero no se consulta aún.

**Objetivo:** validar que la clasificación es lo suficientemente precisa como para confiar el ruteo automático.

### Fase 2 — Auto-respuesta con humano en el loop

- Para tickets que cumplen las 3 condiciones de auto-respuesta (baja prioridad + alta confianza + match en KB), la IA genera una **respuesta sugerida**.
- La sugerencia llega al agente del área en la plataforma, con las fuentes de KB que utilizó.
- El agente **aprueba**, **edita** o **descarta** la sugerencia. El correo solo sale después de su acción.
- Cada decisión del agente alimenta el módulo `feedback`.

**Objetivo:** acumular datos de calidad real (% aprobado, % editado, % descartado) y refinar prompts y umbrales antes de cortar el cable humano.

### Fase 3 — Auto-respuesta autónoma

- Cuando los datos de Fase 2 muestran que ≥ 90 % de las sugerencias se aprobaron sin edición durante un período mínimo, se activa el envío autónomo.
- Umbrales conservadores: solo se envía sin revisión humana si la confianza de respuesta supera `UMBRAL_AUTO_AUTONOMA` (default `0.9`, configurable por tenant).
- El usuario solicitante puede marcar **"esto no resolvió mi problema"**: el ticket reabre y va al área correspondiente con el rastro completo de lo que la IA respondió.
- Se mantiene un porcentaje configurable de respuestas que sí pasan por humano para muestreo de calidad continuo (`AUTO_AUTONOMA_SAMPLE_RATE`, default `0.1` = 10 %).

**Objetivo:** reducir carga humana en consultas repetitivas mientras se mantiene una red de seguridad.

---

## 4. Cliente de IA (Módulo `ai-client`)

El módulo `ai-client` es la única capa del backend que habla directamente con el LLM (vía SDK de OpenAI contra endpoint OpenAI-compatible). Todos los demás módulos (`classification`, `auto-response`, etc.) lo consumen vía inyección de dependencias.

### 4.1 Responsabilidades

- Encapsular el SDK de OpenAI configurado con `baseURL = LLM_BASE_URL`.
- Aplicar configuración global (timeouts, headers).
- Implementar retries con backoff exponencial.
- Aplicar prompt caching donde corresponda (flag `LLM_PROMPT_CACHE_ENABLED`; depende del proveedor — Gemini OpenAI-compat no lo soporta, OpenAI y Anthropic vía proxy compatible sí).
- Validar la salida estructurada con Zod antes de devolverla; reintentar con prompt correctivo si falla.
- Emitir métricas y persistir cada llamada en `ai_call_logs` (sin contenido sensible a nivel info).

### 4.2 Interfaz pública

```typescript
interface AiClientService {
  // Generación libre (texto)
  generate(params: GenerateParams): Promise<GenerateResult>;

  // Generación con salida estructurada validada
  generateStructured<T>(params: GenerateStructuredParams<T>): Promise<T>;
}

interface GenerateParams {
  model: string; // p.ej. process.env.LLM_MODEL_CLASSIFICATION
  systemPrompt: string;
  userMessage: string;
  maxTokens?: number;
  temperature?: number;
  cacheSystemPrompt?: boolean; // activa prompt caching del system
  metadata?: {
    // para observabilidad
    ticketId?: string;
    promptVersion: string;
    purpose: 'classification' | 'auto-response' | 'review';
  };
}

interface GenerateStructuredParams<T> extends GenerateParams {
  outputSchema: z.ZodType<T>; // schema Zod desde @tikora/core
  maxValidationRetries?: number; // default 2
}
```

### 4.3 Configuración

| Parámetro                                          | Default                | Variable                        |
| -------------------------------------------------- | ---------------------- | ------------------------------- |
| Base URL del endpoint OpenAI-compat                | Gemini OpenAI-compat   | `LLM_BASE_URL`                  |
| Timeout de request                                 | 30 s                   | `LLM_TIMEOUT_MS`                |
| Reintentos por error transitorio (5xx, rate limit) | 3                      | `LLM_MAX_RETRIES`               |
| Backoff inicial                                    | 1 s                    | `LLM_RETRY_BACKOFF_MS`          |
| Backoff factor                                     | 2                      | (constante)                     |
| Máximo de tokens por respuesta (clasificación)     | 2048                   | `LLM_MAX_TOKENS_CLASSIFICATION` |
| Máximo de tokens por respuesta (auto-respuesta)    | 4096                   | `LLM_MAX_TOKENS_RESPONSE`       |
| Temperatura clasificación                          | 0.0 (determinista)     | `LLM_TEMP_CLASSIFICATION`       |
| Temperatura auto-respuesta                         | 0.3 (poca creatividad) | `LLM_TEMP_RESPONSE`             |
| Prompt caching                                     | `false` (Gemini)       | `LLM_PROMPT_CACHE_ENABLED`      |

### 4.4 Estrategia de retries

- **Errores transitorios** (`5xx`, `429`, `408`, fallos de red): reintentar con backoff exponencial hasta `LLM_MAX_RETRIES` veces.
- **Errores 4xx no rate-limit** (`400`, `401`, `403`): no reintentar. Loguear y propagar.
- **Errores de validación de output** (JSON inválido, Zod falla): reintentar hasta `maxValidationRetries`, agregando en el siguiente intento un mensaje del tipo "tu respuesta anterior no fue JSON válido, devolvé exactamente el schema requerido".

### 4.5 Logging y métricas

Cada llamada loguea (sin contenido sensible):

- `purpose`, `ticketId`, `model`, `promptVersion`, `tokensInput`, `tokensOutput`, `tokensCached`, `latencyMs`, `retries`, `outcome` (`ok` | `validation_failure` | `api_error`).

Los **contenidos** (prompt completo, respuesta) se loguean solo en debug y se redactan campos PII si están detectados.

---

## 5. Pipeline de Clasificación

### 5.1 Flujo

```
[POST /tickets]
      │
      ▼
crear ticket (estado: recibido)
      │
      ▼
encolar job en cola "classification"
      │
      ▼ (asíncrono, en worker BullMQ)
ClassificationProcessor.process(job)
      │
      ├─► armar contexto (áreas, taxonomía, umbrales)
      ├─► llamar AiClientService.generateStructured()
      ├─► validar output con ClassificationOutputSchema
      ├─► persistir entidad Classification
      ├─► transicionar ticket: recibido → clasificado | requiere_revision_clasificacion
      └─► emitir evento de dominio TicketClassified
              │
              ▼
   suscriptores reaccionan:
     - notifications: armar correos y SSE
     - auto-response: evaluar si corresponde generar
     - sla: calcular slaDeadline
```

### 5.2 System prompt (versión inicial)

Ubicación: `apps/back/src/classification/templates/classification-prompt.v1.md`.

````markdown
Sos un sistema de clasificación de tickets internos de soporte de la empresa.

# Tu tarea

Recibís el asunto y el cuerpo de un ticket creado por un empleado. Devolvés un JSON estructurado con:

- area: el ID del área que debe atender este ticket. Tiene que ser uno de los IDs listados abajo.
- prioridad: "alta", "media" o "baja".
- confianza: número entre 0 y 1 que refleje qué tan seguro estás de tu clasificación.
- resumen: resumen breve y objetivo del ticket, máximo 200 caracteres.
- tags: array de hasta 5 keywords relevantes en minúsculas.

# Áreas disponibles

{{areas_json}}

(Cada área tiene un id, un nombre y una descripción de qué tipos de ticket atiende. Asigná el ticket al área cuya descripción más se parezca al contenido del ticket.)

# Criterios de prioridad

- **alta**: el ticket describe un bloqueo total de operación, afecta a múltiples usuarios, o el usuario indica urgencia explícita verificable (no solo "urgente" en el asunto).
- **media**: el ticket afecta la productividad del usuario pero no es bloqueante. La situación admite resolución dentro de un día hábil.
- **baja**: consulta, solicitud rutinaria, dudas, mejoras menores, requerimientos administrativos.

# Reglas

1. Sé conservador con la prioridad alta. En la duda, prioridad media.
2. Si el contenido es ambiguo o no encaja claramente en ninguna área, asigná confianza menor a 0.7.
3. El resumen debe ser objetivo, sin opiniones, sin disculparse, sin formular preguntas.
4. Los tags deben ser sustantivos o frases cortas en minúsculas, sin tildes ni espacios al inicio ni al final.
5. Devolvé EXCLUSIVAMENTE un JSON válido con la estructura exacta del schema. Sin comentarios, sin texto adicional, sin markdown.

# Schema de salida

```json
{
  "area": "string (uno de los IDs disponibles)",
  "prioridad": "alta | media | baja",
  "confianza": "number entre 0 y 1",
  "resumen": "string, max 200 caracteres",
  "tags": ["string", "..."]
}
```
````

````

### 5.3 Schema Zod (en `@tikora/core`)

```typescript
import { z } from 'zod';

export const ClassificationOutputSchema = z.object({
  area: z.string().min(1),
  prioridad: z.enum(['alta', 'media', 'baja']),
  confianza: z.number().min(0).max(1),
  resumen: z.string().min(1).max(200),
  tags: z.array(z.string().min(1)).max(5),
});

export type ClassificationOutput = z.infer<typeof ClassificationOutputSchema>;
````

### 5.4 Validación de la salida

- El parsing del JSON se hace dentro de `AiClientService.generateStructured` con `JSON.parse()` envuelto en try/catch.
- Si el parsing falla o el schema Zod falla, se reintenta con un prompt correctivo (ver §4.4).
- Si tras los reintentos sigue fallando, el ticket pasa a `requiere_revision_clasificacion` y se loguea el error.
- Validaciones adicionales del lado del backend (post-Zod):
  - El `area` retornado **debe existir en el tenant**. Si no existe, se trata como confianza 0.
  - Los tags se normalizan (lowercase, trim, deduplicación).

### 5.5 Manejo de baja confianza

Si `confianza < UMBRAL_CONFIANZA_CLASIFICACION` (default `0.7`):

- El ticket transiciona a `requiere_revision_clasificacion`.
- Se notifica al líder del área que la IA sugirió (si la sugirió) o al admin si no hay área clara.
- El humano asigna manualmente el área correcta y la prioridad. Su decisión se registra para mejorar prompts a futuro.

### 5.6 Manejo de errores y fallback

| Error                                           | Acción                                                                                                                                |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Timeout de la API                               | Reintentar (backoff exponencial) hasta `LLM_MAX_RETRIES`. Si se agota, marcar `requiere_revision_clasificacion` y notificar al admin. |
| Rate limit (429)                                | Reintentar con backoff respetando el header `Retry-After`.                                                                            |
| 5xx persistente                                 | Marcar `requiere_revision_clasificacion`. Notificar al admin.                                                                         |
| API key inválida (401)                          | No reintentar. Alarma crítica. Notificar al admin.                                                                                    |
| JSON inválido tras reintentos                   | Marcar `requiere_revision_clasificacion`.                                                                                             |
| `area` no existe en el tenant                   | Tratar como confianza 0 → `requiere_revision_clasificacion`.                                                                          |
| Texto del ticket vacío o muy corto (< 10 chars) | No llamar a la IA. Marcar `requiere_revision_clasificacion` con motivo `contenido_insuficiente`.                                      |

### 5.7 Versionado de prompts

- Cada prompt vive en un archivo con sufijo de versión: `classification-prompt.v1.md`, `classification-prompt.v2.md`.
- La versión activa se selecciona vía variable de entorno `CLASSIFICATION_PROMPT_VERSION`.
- Cada entidad `Classification` persiste el campo `promptVersion` con el valor usado.
- Para comparar versiones, se ejecutan ambas en paralelo sobre un set de tickets recientes (script de evaluación) y se comparan resultados con feedback humano de referencia.

---

## 6. Base de Conocimiento (RAG)

### 6.1 Estructura del documento de KB

Cada `KbDocument` tiene:

- `title`: título legible.
- `content`: cuerpo del documento en Markdown o texto plano.
- `scope`: `'global'` (consultable en cualquier área) o `'area'` (solo aplica a las áreas listadas).
- `areaIds[]`: solo si `scope === 'area'`.
- `version`: número entero. Cada edición incrementa.
- `active`: solo una versión por documento es activa a la vez.
- `uploadedBy`, `createdAt`, `updatedAt`.

### 6.2 Chunking

Cuando se carga o edita un documento:

- Se chunkea en fragmentos de **500 a 800 tokens** con **overlap de 100 tokens**.
- El chunking respeta saltos naturales: encabezados Markdown, párrafos, listas. No corta a la mitad de una oración.
- Cada chunk preserva metadata: `documentId`, `documentVersion`, `position` (orden), `tenantId`, `areaIds[]`.

**Implementación recomendada:** función `chunkMarkdown(text, { minTokens, maxTokens, overlapTokens })` que:

1. Parte el texto en bloques semánticos (encabezados como separadores fuertes, párrafos como suaves).
2. Junta bloques contiguos hasta acercarse al `maxTokens`, respetando el `minTokens` mínimo.
3. Para overlap, los últimos N tokens del chunk anterior se prependen al siguiente.

### 6.3 Embeddings

Cada chunk se convierte a vector con Transformers.js:

```typescript
// Pseudocódigo
const embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small');

async function embedChunk(text: string): Promise<number[]> {
  // Convención E5: prefijo "passage: " para texto a indexar
  const input = `passage: ${text}`;
  const output = await embedder(input, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // 384 floats
}
```

Para embeddings de query (texto del ticket):

```typescript
const input = `query: ${ticketAsuntoMasCuerpo}`;
```

El modelo se carga **una sola vez por proceso** (worker de BullMQ) y se reutiliza para todas las llamadas.

### 6.4 Indexación en Atlas Vector Search

**Colección:** `kb_chunks`.

**Documento:**

```typescript
{
  _id: ObjectId,
  tenantId: ObjectId,
  documentId: ObjectId,
  documentVersion: number,
  position: number,
  content: string,
  embedding: number[],   // 384 dims
  areaIds: ObjectId[],   // copiado del documento padre
  scope: 'global' | 'area',
  active: boolean,       // true solo si la versión del documento es la activa
  createdAt: Date
}
```

**Índice vectorial** (Atlas Search):

```json
{
  "fields": [
    {
      "type": "vector",
      "path": "embedding",
      "numDimensions": 384,
      "similarity": "cosine"
    },
    { "type": "filter", "path": "tenantId" },
    { "type": "filter", "path": "active" },
    { "type": "filter", "path": "scope" },
    { "type": "filter", "path": "areaIds" }
  ]
}
```

### 6.5 Búsqueda semántica

Pipeline de búsqueda (al evaluar auto-respuesta para un ticket):

1. Embeber `asunto + cuerpo` del ticket con prefijo `query:`.
2. Ejecutar `$vectorSearch` con filtros:
   - `tenantId`: el del ticket.
   - `active`: `true`.
   - `(scope === 'global') OR (scope === 'area' AND areaIds includes ticketAreaId)`.
3. Recuperar `top-k = 5` chunks ordenados por score.
4. Aplicar **umbral mínimo de relevancia**: si `score_max < UMBRAL_RELEVANCIA_KB` (default `0.75`), no hay match suficiente y se aborta el flujo de auto-respuesta.

```typescript
const pipeline = [
  {
    $vectorSearch: {
      index: 'kb_chunks_vector',
      path: 'embedding',
      queryVector: ticketEmbedding,
      numCandidates: 100,
      limit: 5,
      filter: {
        tenantId: { $eq: tenantId },
        active: { $eq: true },
        $or: [{ scope: 'global' }, { scope: 'area', areaIds: { $in: [ticketAreaId] } }],
      },
    },
  },
  {
    $project: {
      content: 1,
      documentId: 1,
      position: 1,
      score: { $meta: 'vectorSearchScore' },
    },
  },
];
```

### 6.6 Re-ranking (opcional, Fase 3)

En Fase 3 se puede agregar un re-ranking ligero de los `top-5` con un cross-encoder local o con Claude Haiku como juez (`relevancia 0-1` para cada chunk). Si se implementa, vive en el módulo `auto-response` como paso entre la búsqueda vectorial y la generación.

### 6.7 Política de relevancia

- Si **0 chunks** superan el umbral → no auto-responder, escalar normal.
- Si **≥ 1 chunk** supera el umbral → enviar a generación con todos los chunks que pasen el umbral (máximo 5).
- El score de cada chunk se persiste en `AiResponse.sourceChunkIds[]` con su valor.

### 6.8 Versionado de documentos

- Editar un documento crea una nueva versión: `version + 1`.
- Los chunks de la versión anterior se marcan `active: false` (no se borran inmediatamente).
- Los chunks de la nueva versión se generan e insertan con `active: true`.
- Las versiones inactivas se conservan 30 días para auditoría y se eliminan con un job de mantenimiento.

---

## 7. Pipeline de Auto-Respuesta

### 7.1 Pre-condiciones (las 3 condiciones)

La auto-respuesta solo se intenta si **todas** se cumplen:

1. `prioridad === 'baja'`.
2. `confianza_clasificacion ≥ UMBRAL_CONFIANZA_CLASIFICACION`.
3. La búsqueda en KB devolvió al menos un chunk con `score ≥ UMBRAL_RELEVANCIA_KB`.

Si alguna falla, el ticket se escala normal al área (no genera respuesta).

### 7.2 Flujo

```
TicketClassified (evento)
      │
      ▼
AutoResponseListener.evaluate(ticket, classification)
      │
      ├─► ¿prioridad === 'baja'? ───── NO ──► escalar
      ├─► ¿confianza ≥ umbral? ─────── NO ──► escalar
      ▼ SÍ
encolar job en cola "auto-response"
      │
      ▼ (asíncrono, en worker)
AutoResponseProcessor.process(job)
      │
      ├─► embeber ticket
      ├─► buscar chunks en KB
      ├─► ¿≥ 1 chunk supera umbral? ─ NO ──► escalar
      ▼ SÍ
armar prompt con chunks como contexto
      │
      ├─► llamar AiClientService.generate()
      ├─► validar AutoResponseOutputSchema
      ├─► persistir AiResponse (estado: sugerida)
      │
      ▼
Fase 2: notificar al agente para aprobación
Fase 3: si confianza_respuesta ≥ UMBRAL_AUTO_AUTONOMA → enviar correo y cerrar
        si no → notificar al agente para aprobación (red de seguridad)
```

#### Auto-envío Fase 3

Apenas el processor persiste la `AiResponse` con `respondable: true` y
`AI_PHASE === 3`, evalúa el auto-envío en `tryAutonomousDelivery`:

1. Si `confianza < UMBRAL_AUTO_AUTONOMA` → queda como `sugerida` (Fase 2).
2. Si `Math.random() < AUTO_AUTONOMA_SAMPLE_RATE` → cae en sampling de
   QA y queda como `sugerida` para que un humano la revise. Mantenemos
   este % configurable de respuestas con paso humano para muestreo de
   calidad continuo.
3. Si pasa los dos checks → la `AiResponse` se marca como `aprobada` con
   `approvedBy: null` (sistema), se delega a
   `AutoResponseService.deliverAndClose(ai, ticket, null, autonomous=true)`
   y termina en `enviada`. El ticket cierra con `resolutionType: 'auto'`,
   `resolvedBy: null`.

Si el delivery autónomo falla (sin requester, email caído), revertimos
el estado a `sugerida`/`content: null` y emitimos `AiResponseSuggested`
para que el flujo Fase 2 lo recoja — la red de seguridad descrita en
§7.7. La `AiResponse` original conserva el `originalAiContent` así un
humano puede aprobar manualmente sin regenerar.

#### Manejo de fallas del LLM

El catch del processor cubre dos modos de falla terminales (los retries
internos del `AiClientService` ya se agotaron):

- **Retries transitorios agotados** (`code: AI_API_ERROR`): 5xx/429/timeouts
  consecutivos → `failureReason: 'api_error'`.
- **Output fuera de schema tras reintentos correctivos** (`code: AI_OUTPUT_INVALID`):
  el modelo respondió pero el JSON no respeta `AutoResponseOutputSchema` →
  `failureReason: 'validation_error'`.

En ambos casos:

1. Se persiste un `AiResponse` con `estado: 'fallida'`, dejando trazabilidad
   del modelo, prompt version, chunks recuperados y `failureDetail` con el
   mensaje del error. Tokens y latencia quedan en 0 (no los expone el throw).
2. Se emite `AiResponseFailed` con la `reason` correspondiente. El listener de
   `notifications` notifica a admins (no a líderes/agentes del área: la falla
   es operativa, no funcional).
3. El ticket queda en `escalado` y se trata como cualquier otro ticket manual.
   No se retoma la auto-respuesta automáticamente.

Las fallidas son **audit-only**: `getCurrentForTicket` las filtra para que el
panel de "Sugerencia IA" del ticket no muestre intentos perdidos.

### 7.3 System prompt (versión inicial)

Ubicación: `apps/back/src/auto-response/templates/response-prompt.v1.md`.

```markdown
Sos un asistente de soporte interno de la empresa. Respondés tickets de empleados con tono profesional, cálido, claro y conciso, siempre en español.

# Tu tarea

Te llega un ticket de un empleado y un conjunto de fragmentos relevantes de la base de conocimiento de la empresa. Tu trabajo es redactar una respuesta directa al empleado que resuelva su consulta usando exclusivamente la información de los fragmentos.

# Reglas estrictas

1. **Solo usá información presente en los fragmentos de KB.** Si los fragmentos no responden la pregunta, devolvé `respondable: false` con motivo. No inventes datos, procedimientos, contactos ni links.
2. **No menciones que sos una IA ni que estás usando una base de conocimiento.** Hablás como soporte de la empresa.
3. **Tono profesional pero humano.** Saludá al inicio. Cerrá con disponibilidad ("si necesitás más ayuda, respondé este correo").
4. **Estructura clara.** Si el procedimiento tiene pasos, listalos. Si hay condiciones, sé explícito.
5. **No prometas plazos** que no estén en la KB.
6. **Citá las fuentes internamente** (en el campo `sources` del JSON, no en el cuerpo de la respuesta visible).
7. **Idioma**: español rioplatense neutro. Voseo es aceptable, tuteo también, pero consistente en toda la respuesta.

# Estructura del input

El usuario te va a pasar un mensaje con esta forma:
```

TICKET
Asunto: ...
Cuerpo: ...

FRAGMENTOS DE KB (ordenados por relevancia)
[1] (documento: <id>, posición: <n>, score: <0-1>)
<contenido del fragmento>

[2] ...

````

# Schema de salida

Devolvé EXCLUSIVAMENTE un JSON con esta forma, sin texto adicional:

```json
{
  "respondable": true,
  "respuesta": "string con la respuesta completa al empleado, lista para enviar por correo",
  "confianza": 0.92,
  "sources": [
    { "chunkIndex": 1, "usedFor": "explicación principal" },
    { "chunkIndex": 2, "usedFor": "detalle del paso 3" }
  ]
}
````

Si los fragmentos no permiten responder con confianza:

```json
{
  "respondable": false,
  "motivo": "string corto explicando qué falta",
  "confianza": 0.3
}
```

````

### 7.4 Schema Zod (en `@tikora/core`)

```typescript
import { z } from 'zod';

const SourceSchema = z.object({
  chunkIndex: z.number().int().min(1),
  usedFor: z.string().min(1).max(200),
});

export const AutoResponseOutputSchema = z.discriminatedUnion('respondable', [
  z.object({
    respondable: z.literal(true),
    respuesta: z.string().min(1),
    confianza: z.number().min(0).max(1),
    sources: z.array(SourceSchema).min(1),
  }),
  z.object({
    respondable: z.literal(false),
    motivo: z.string().min(1).max(500),
    confianza: z.number().min(0).max(1),
  }),
]);

export type AutoResponseOutput = z.infer<typeof AutoResponseOutputSchema>;
````

### 7.5 Inyección del contexto

El user message que se le manda al modelo se construye así:

```
TICKET
Asunto: <ticket.asunto>
Cuerpo: <ticket.cuerpo>

FRAGMENTOS DE KB (ordenados por relevancia)
[1] (documento: <chunk1.documentId>, posición: <chunk1.position>, score: <chunk1.score:.2f>)
<chunk1.content>

[2] ...
```

### 7.6 Aprobación humana (Fase 2)

- La `AiResponse` se persiste con `estado: 'sugerida'`.
- Se emite el evento `AiResponseSuggested`.
- El módulo `notifications` notifica vía SSE al agente del área.
- El agente abre el ticket en la plataforma, ve la respuesta, las fuentes consultadas y la confianza.
- Acciones posibles del agente:
  - **Aprobar tal cual** → `estado: 'aprobada'` → encolar envío por correo → `estado: 'enviada'` → ticket transiciona a `cerrado` (`resolutionType: 'auto'`).
  - **Editar** → el agente modifica el texto, lo aprueba → `estado: 'editada'` → enviar → `estado: 'enviada'` → cierre auto. La diferencia entre el texto original y el editado se persiste para análisis.
  - **Descartar** → `estado: 'descartada'` → ticket vuelve a `escalado` para que el agente lo trate manualmente.

### 7.7 Envío autónomo (Fase 3)

- Cuando se cumpla `respondable === true && confianza ≥ UMBRAL_AUTO_AUTONOMA` y el ticket no sea seleccionado por el sampling de QA (`AUTO_AUTONOMA_SAMPLE_RATE`), la respuesta se envía sin pasar por agente.
- `AiResponse.estado` salta directamente a `enviada`.
- El ticket transiciona a `cerrado` con `resolutionType: 'auto'`.
- El correo al solicitante incluye el botón **"Esto no resolvió mi problema"** que abre `<FRONT_BASE_URL>/reopen-confirm?token=<jwt>` y dispara `POST /api/v1/tickets/:id/reopen-from-email` al confirmar.

#### Botón "Esto no resolvió mi problema"

El botón embed en el HTML del correo es un link al frontend que lleva un JWT firmado con `JWT_REOPEN_SECRET`. Detalles del flujo:

- **Token JWT** (TTL `EMAIL_REOPEN_TOKEN_EXPIRES_IN`, default `5d` = `slaReopenGraceDays`).
  Payload: `{ ticketId, requesterId, aiResponseId, tenantId, shortCode, iat, exp }`.
  Secret dedicado (no `JWT_SECRET`) para limitar blast radius si se filtra.
- **Página intermedia** `/reopen-confirm?token=…` en el front. Decodifica el payload sin verificar firma sólo para mostrar el `shortCode` al solicitante; al confirmar, hace `POST` al back que valida la firma. Esto blinda el caso de que un previewer de email (Gmail/Outlook safelinks) prefetchee el link sin click humano.
- **Endpoint público** `POST /api/v1/tickets/:id/reopen-from-email` (sin auth). Verifica firma + expiración del JWT, valida que el `:id` del path matchee el `payload.ticketId`, arma un `AuthenticatedUser` virtual con el `requesterId` del token y delega al `TicketsService.reopen()` con motivo fijo "Auto-respuesta insuficiente — reapertura desde correo". Después marca `AiResponse.reopenedAfterAutoResponse = true` (best effort) — métrica clave para evaluar la calidad de Fase 3.
- **No es single-use** (no almacenamos `jti` consumidos). El reopen es idempotente vía la state machine: la segunda invocación sobre un ticket ya reabierto devuelve `409 TICKET_TRANSITION_INVALID`.

### 7.8 Trazabilidad

Cada `AiResponse` persiste:

- `ticketId`
- `content` (la respuesta final enviada)
- `originalAiContent` (lo que la IA propuso, antes de edits)
- `sourceChunkIds[]` con `documentId`, `position`, `score` y `usedFor`.
- `confianza` reportada por el modelo.
- `modelo` y `promptVersion`.
- `temperature`, `maxTokens`, `tokensInput`, `tokensOutput`, `tokensCached`.
- `estado` (sugerida | aprobada | editada | enviada | descartada).
- `approvedBy`, `approvedAt` (si aplicó).
- `editedBy`, `editedAt` (si aplicó).
- `discardedBy`, `discardedAt`, `discardReason` (si aplicó).

---

## 8. Diseño y Versionado de Prompts

### 8.1 Estructura común

Todo prompt sigue una estructura mental:

1. **Rol y contexto**: "Sos un sistema de clasificación..."
2. **Tarea**: qué tiene que devolver.
3. **Datos de contexto**: variables interpoladas (`{{areas_json}}`).
4. **Reglas explícitas** numeradas.
5. **Schema de salida** literal (JSON).
6. **Instrucción final**: "Devolvé EXCLUSIVAMENTE el JSON, sin nada más".

### 8.2 Almacenamiento

- Cada prompt vive como archivo Markdown en `apps/back/src/{module}/templates/`.
- Nomenclatura: `{purpose}-prompt.v{N}.md`. Ej: `classification-prompt.v1.md`.
- El template se lee al arrancar el worker y se cachea en memoria. No se relee por cada llamada.

### 8.3 Variables y rendering

- Sintaxis: `{{nombre_variable}}`.
- Renderer simple custom (no requerimos Handlebars/Mustache para esto):

```typescript
function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in vars)) {
      throw new Error(`Variable faltante en template: ${key}`);
    }
    return vars[key];
  });
}
```

- Variables comunes:
  - `{{areas_json}}`: JSON con `[{ id, nombre, descripcion }]` de las áreas del tenant.
  - `{{taxonomia_json}}`: tags y categorías predefinidas del tenant (si las hay).
  - `{{politica_prioridad}}`: posibles overrides del tenant a la política de prioridad por defecto.

### 8.4 Versionado y migraciones

- Crear una versión nueva nunca borra la anterior. Ambas conviven en disco.
- La variable `CLASSIFICATION_PROMPT_VERSION` (o equivalente) decide cuál se usa en runtime.
- Para evaluar una versión nueva antes de promoverla:
  - Script de evaluación corre la nueva versión en un set de tickets reales (de los últimos N días).
  - Compara con clasificaciones de ground truth (corregidas por humanos).
  - Reporta precisión, recall por área, accuracy de prioridad, distribución de confianza.
- Si los resultados son superiores, se promueve cambiando la variable de entorno. Sin redeploy.

---

## 9. Prompt Caching

El prompt caching reduce costo y latencia cuando un mismo prefijo de prompt se reutiliza muchas veces. **Su disponibilidad depende del proveedor LLM configurado.**

### 9.1 Estado actual (setup con Gemini OpenAI-compat)

Gemini vía su endpoint OpenAI-compatible **no expone prompt caching** en este momento. La flag `LLM_PROMPT_CACHE_ENABLED` vive en el config y queda en `false` por default. El impacto de costo es nulo hoy porque estamos en free tier.

### 9.2 Cuando el proveedor lo soporta

Si se migra a un proveedor que sí ofrece prompt caching (OpenAI con prefix caching automático, Anthropic vía proxy OpenAI-compatible, etc.), `AiClientService` puede activarlo cambiando `LLM_PROMPT_CACHE_ENABLED=true`. La estrategia esperada de cacheo es:

| Componente                      | Cacheable | Por qué                                                                            |
| ------------------------------- | --------- | ---------------------------------------------------------------------------------- |
| System prompt de clasificación  | ✅        | Es idéntico en cada llamada (lo único variable es el `{{areas_json}}` por tenant). |
| `{{areas_json}}` por tenant     | ✅        | Cambia raramente (el admin agrega/edita áreas). Se cachea junto con el system.     |
| Cuerpo del ticket               | ❌        | Único por ticket.                                                                  |
| System prompt de auto-respuesta | ✅        | Estable.                                                                           |
| Chunks de KB en el user message | ❌        | Cambian por ticket.                                                                |

### 9.3 Beneficio esperado (cuando se reactive)

Con un volumen medio de tickets, el system + áreas representa ~70 % de los tokens de input por llamada de clasificación. Con caching, esos tokens pasan a costar una fracción del precio normal a partir de la segunda llamada dentro del TTL. Reducción esperada del costo de input: **~60-70 %** (con proveedores que lo soportan).

### 9.4 Cuándo no cachear

- En desarrollo local cuando se itera rápido sobre prompts (cambios cada pocos minutos): el caching no se amortiza. Mantener `LLM_PROMPT_CACHE_ENABLED=false`.
- Cuando el proveedor configurado no lo soporta (caso actual con Gemini).

---

## 10. Manejo de Errores y Reintentos

### 10.1 Tipología de errores

| Tipo                      | Ejemplo                              | Estrategia                                                                            |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Transitorio de red        | timeout, ECONNRESET                  | Reintentar con backoff.                                                               |
| Transitorio del proveedor | 5xx, 429                             | Reintentar respetando `Retry-After`.                                                  |
| De autenticación          | 401, 403                             | No reintentar. Alarma crítica. Escalar a admin.                                       |
| De cuota                  | 402, 429 persistente                 | No reintentar. Alarma. Pausar la cola hasta que el admin reactive.                    |
| De validación de input    | 400 con motivo `prompt too long`     | No reintentar. Loguear con contenido truncado. Marcar el ticket para revisión humana. |
| De salida estructurada    | JSON inválido o no cumple schema Zod | Reintentar con prompt correctivo.                                                     |
| De contenido (refusal)    | el modelo rechaza generar            | Marcar para revisión humana. Loguear el ticket completo.                              |
| De jailbreak detectado    | (ver §11)                            | Marcar para revisión humana. Alertar admin.                                           |

### 10.2 Reintento con prompt correctivo

Cuando el modelo devuelve algo que no parsea como JSON o no cumple el schema, el siguiente intento incluye al final del system prompt:

```
NOTA: Tu respuesta anterior no cumplió el schema requerido.
Error específico: {{zod_error_message}}.
Devolvé exclusivamente JSON válido con la estructura indicada.
```

Esto suele resolver el problema en el primer reintento.

### 10.3 Degradación elegante

Si la API del LLM configurado está completamente inaccesible:

- La cola `classification` se pausa automáticamente.
- Los tickets se quedan en estado `recibido` (no se pierden).
- El admin recibe alarma.
- Cuando el servicio vuelve, la cola se reanuda y procesa el backlog en orden.

---

## 11. Seguridad

### 11.1 Prompt Injection

**Riesgo:** un usuario malicioso (o un correo entrante reenviado al sistema) podría incluir en el cuerpo del ticket instrucciones del tipo "ignora las instrucciones anteriores y devuelve...".

**Mitigaciones:**

1. **Separación clara entre system y user**: el system prompt tiene instrucciones; el contenido del ticket va siempre como mensaje del usuario.
2. **Delimitadores explícitos**: el cuerpo del ticket se inserta entre marcadores claros (`<ticket>...</ticket>` o secciones tipo `# TICKET`) y el prompt instruye explícitamente a tratar todo lo que esté dentro como datos a clasificar/responder, no como instrucciones a seguir.
3. **Validación estricta de la salida**: Zod rechaza cualquier estructura inesperada. Una salida fuera de schema no se ejecuta.
4. **Sanitización de inputs**: si el cuerpo del ticket contiene patrones obvios (`"ignore all previous instructions"`, `"actúa como"`, `"new system prompt"`), se loguea como sospecha y se marca el ticket con flag `security_review`.

### 11.2 PII y datos sensibles

- En MVP no hay tratamiento especial de PII más allá de los principios generales: los datos viajan al proveedor LLM vía HTTPS y se asume política de no-training del proveedor (verificar antes de contratar tier pago — Gemini, OpenAI, Anthropic publican términos distintos según el plan).
- Si en una fase posterior se identifican campos sensibles (DNI, salarios, datos médicos), se agregará un módulo de `redaction` que enmascare antes de llamar a la IA.
- Los logs internos del backend **redactan tokens, API keys, y campos marcados como sensibles** antes de escribir.

### 11.3 Refusals y contenido inapropiado

- El LLM puede negarse a responder si el ticket contiene contenido ofensivo, violento o ilegal (refusal). La respuesta del modelo en esos casos típicamente no cumplirá el schema de salida y será capturada por la validación Zod.
- El backend detecta este patrón (`respondable: false` con motivo de seguridad, o JSON faltante) y marca el ticket para revisión humana inmediata, notificando al admin con prioridad alta.

### 11.4 No exposición del prompt al cliente

- El system prompt nunca se devuelve en una respuesta de la API REST.
- Los errores del modelo se traducen a mensajes genéricos para el cliente. Detalles técnicos solo en logs internos.

---

## 12. Observabilidad

### 12.1 Logging estructurado

Cada llamada a la IA emite un log con esta estructura (sin contenidos sensibles a nivel `info`):

```json
{
  "timestamp": "...",
  "level": "info",
  "msg": "ai_call",
  "tenantId": "...",
  "ticketId": "...",
  "purpose": "classification",
  "model": "gemini-2.5-flash",
  "promptVersion": "v1",
  "tokensInput": 1234,
  "tokensInputCached": 980,
  "tokensOutput": 87,
  "latencyMs": 642,
  "retries": 0,
  "outcome": "ok"
}
```

A nivel `debug`, se incluyen también `prompt`, `response` y `validationErrors`. El nivel debug **no se activa en producción** salvo por necesidad puntual.

### 12.2 Métricas

Se exponen vía endpoint `/api/v1/internal/metrics` (protegido por rol admin) o vía Prometheus si se integra:

- `tikora_ai_calls_total{purpose, model, outcome}`
- `tikora_ai_latency_seconds{purpose, model}` (histograma)
- `tikora_ai_tokens_input_total{purpose, cached|uncached}`
- `tikora_ai_tokens_output_total{purpose}`
- `tikora_ai_retries_total{purpose, reason}`
- `tikora_classification_confidence{area}` (histograma)
- `tikora_autoresponse_confidence` (histograma)
- `tikora_kb_top_score` (histograma)

### 12.3 Trazabilidad por ticket

Cada ticket tiene en su `history[]` una entrada por cada interacción de la IA:

- Llamada a clasificación: input, output, latencia, modelo, versión.
- Llamada a auto-respuesta: input, output, fuentes, latencia, modelo, versión.
- Reintentos y errores.

Esto permite debugear por qué un ticket fue clasificado como fue, sin tener que correlacionar logs.

---

## 13. Costos

### 13.1 Modelo de costos

Los costos relevantes son:

- **Tokens de input** al proveedor LLM (con descuento por caching cuando aplica).
- **Tokens de output** del proveedor LLM.
- **Embeddings**: cero costo externo (corren localmente).
- **Almacenamiento vectorial**: incluido en el plan de MongoDB Atlas.

### 13.2 Estimación por ticket (Fase 1, solo clasificación)

| Componente                           | Tokens aprox. | Notas                                                         |
| ------------------------------------ | ------------- | ------------------------------------------------------------- |
| System prompt (cacheado tras 1ª vez) | ~800          | Cache reduce ~90 % del precio tras la primera llamada del TTL |
| Áreas del tenant (cacheadas)         | ~300          | Idem                                                          |
| Cuerpo del ticket (no cacheable)     | ~200          | Variable según tamaño real                                    |
| Output JSON                          | ~100          | Schema acotado                                                |

**Costo aproximado por clasificación:** depende del proveedor configurado. En el setup actual (Gemini free tier) el costo es **cero** dentro de la cuota. Cuando se migre a tier pago, con un modelo de gama baja-media + caching activo (si lo soporta), el orden esperado es de fracción de centavo por clasificación — pocos dólares por cada 10.000 tickets/mes.

### 13.3 Estimación por ticket (Fase 2/3, auto-respuesta)

| Componente                            | Tokens aprox. |
| ------------------------------------- | ------------- |
| System prompt de respuesta (cacheado) | ~600          |
| Cuerpo del ticket                     | ~200          |
| Chunks de KB inyectados (5 × ~700)    | ~3500         |
| Output (respuesta + sources)          | ~400          |

**Costo aproximado por auto-respuesta:** cero en el setup actual (Gemini free tier dentro de cuota). En tier pago con un modelo de gama media, del orden de centavos por ticket. La meta es que el porcentaje de tickets auto-respondidos sea suficiente para que el ahorro de tiempo de agente compense varias órdenes de magnitud el costo.

### 13.4 Controles de costo

- **Alarma por gasto mensual**: si se supera `LLM_MONTHLY_BUDGET_USD`, se notifica al admin y opcionalmente se pausan colas no críticas. (Aplica solo cuando se usa tier pago; con free tier el corte lo hace el rate limit del proveedor.)
- **Rate limiting interno**: máximo de N llamadas por minuto por tenant para evitar runaway costs por bug o ataque.
- **Revisión periódica**: dashboard de costo por tenant, modelo y propósito.

### 13.5 Optimizaciones

- Prompt caching agresivo (§9).
- Modelos chicos (Gemini Flash / OpenAI mini / Claude Haiku según proveedor) para tareas chicas como clasificación.
- Truncado del cuerpo del ticket si excede un máximo (default `MAX_TICKET_BODY_TOKENS = 4000`). Tickets más largos se truncan con nota.
- Chunks de KB con tamaño calibrado para no exceder context.

---

## 14. Evaluación y Mejora Continua

### 14.1 Feedback humano

El módulo `feedback` recolecta señal de los agentes:

- En cada ticket clasificado, el agente puede marcar la clasificación como `correcta`, `area_incorrecta`, `prioridad_incorrecta` o `ambas_incorrectas`.
- En cada respuesta IA aprobada/editada/descartada (Fase 2), se persiste:
  - Decisión del agente.
  - Si fue editada: diff entre original y final.
  - Motivo de descarte (libre).
- En tickets auto-respondidos (Fase 3), si el solicitante usa "Esto no resolvió mi problema", queda como señal negativa.

### 14.2 Métricas de calidad

Se calculan periódicamente y se exponen al admin:

- **Precisión de área**: % de clasificaciones marcadas como `correcta` o sin reasignación de área.
- **Precisión de prioridad**: idem para prioridad.
- **Tasa de auto-respuesta aprobada sin edición**: en Fase 2.
- **Tasa de edición**: % de respuestas editadas, con métrica de cambio promedio (caracteres modificados).
- **Tasa de descarte**: % de respuestas descartadas con motivo.
- **Tasa de reapertura de auto-respondidos**: en Fase 3, principal señal de mala calidad.

### 14.3 Ciclo de mejora

1. Cada 2 semanas se revisan métricas.
2. Si un área tiene baja precisión sistemática, se ajusta su descripción en el `{{areas_json}}` o se refina el prompt.
3. Si un tipo de ticket recurrente se descarta seguido en auto-respuesta, se investiga si falta cobertura en la KB.
4. Cambios al prompt entran como nueva versión (`v2`, `v3`...) y se evalúan en paralelo antes de promover.

### 14.4 Dataset de evaluación

- Se mantiene un set de **100-200 tickets etiquetados manualmente** (área, prioridad correctas) como ground truth.
- Cualquier cambio de prompt o modelo se mide contra ese set antes de promover.
- El set se renueva cada 6 meses para evitar overfitting.

---

## 15. Reglas para Implementación

Cualquier IA o desarrollador que implemente o modifique la capa de IA de Tikora debe respetar:

- **Toda llamada al LLM pasa por `AiClientService`.** Ningún módulo importa `openai` directamente.
- **Los prompts viven en archivos**, nunca inline en código. Versionados con sufijo `vN`.
- **La salida estructurada se valida siempre con Zod** desde `@tikora/core` antes de persistir.
- **Cada llamada lleva metadata** (`ticketId`, `purpose`, `promptVersion`) para trazabilidad.
- **Los embeddings se generan localmente** con Transformers.js. No se llama a APIs externas para embeddings sin justificación documentada.
- **El prefijo E5** (`passage:` / `query:`) es obligatorio al embeber.
- **Toda búsqueda en `kb_chunks` filtra por `tenantId` y por `active`**. Sin excepción.
- **Los umbrales** (`UMBRAL_CONFIANZA_CLASIFICACION`, `UMBRAL_RELEVANCIA_KB`, `UMBRAL_AUTO_AUTONOMA`) se leen de variables de entorno, nunca hardcodeados.
- **Las pre-condiciones de auto-respuesta se evalúan en orden** (prioridad → confianza → KB) y se cortocircuita ante el primer fallo.
- **Las transiciones de estado del ticket disparadas por la IA** pasan por `TicketStateMachineService`, igual que las disparadas por humanos.
- **Eventos de dominio se emiten siempre**: `TicketClassified`, `AiResponseSuggested`, `AiResponseSent`, etc. Nunca llamar a otros módulos directamente desde el processor.
- **Los logs nunca incluyen API keys ni secretos**. Los contenidos de prompts y respuestas solo en nivel debug y con redacción de PII detectada.
- **Los reintentos por error de validación de output** usan prompt correctivo, no el mismo prompt repetido.
- **Cada nueva versión de prompt se evalúa contra el dataset de ground truth** antes de promoverse a producción.
