# Tikora — Embeddings y Búsqueda Semántica

> Documento técnico completo de la capa de embeddings de Tikora. Cubre desde los fundamentos conceptuales hasta los detalles de implementación, indexación, búsqueda, performance y mantenimiento.

---

## 1. ¿Qué es un embedding?

Un **embedding** es una representación numérica de un texto en forma de vector (una lista de números). El objetivo es que **textos con significado similar terminen con vectores numéricamente cercanos**, mientras que textos que hablan de cosas distintas terminen lejos.

**Analogía:** imaginá un mapa donde cada texto se ubica como un punto. Los textos sobre "vacaciones de empleados" se agrupan en una región; los textos sobre "errores de impresora", en otra región distinta. Cuando llega un ticket nuevo, lo ubicamos en ese mapa y miramos quiénes están cerca.

Ejemplo intuitivo en 2 dimensiones (la realidad usa 384):

```
                       (manual de impresoras)
                              •
                              •
                  (problema de impresión)


  (política de vacaciones)
         •
                  •
         (días por antigüedad)
```

Si llega un ticket sobre "tengo problemas para imprimir el reporte", su vector va a caer cerca de los puntos de impresoras y lejos de los de vacaciones.

**¿Por qué importa?** Porque la búsqueda por palabras clave falla cuando el usuario y el documento no usan exactamente las mismas palabras. Un usuario escribe "no me sale el informe en papel" y el manual dice "configuración de la impresora". Sin embeddings, una búsqueda literal no los conecta. Con embeddings, sí.

---

## 2. Rol de los embeddings en Tikora

Los embeddings se usan en **dos momentos** del flujo de Tikora:

### 2.1 Al indexar la base de conocimiento

Cuando un admin carga un documento de la KB, Tikora:

1. Parte el documento en fragmentos (chunks).
2. Genera el embedding de cada chunk.
3. Guarda el chunk + su embedding en la colección `kb_chunks`.

Esto sucede una sola vez por versión del documento, en background (no bloquea al admin).

### 2.2 Al evaluar un ticket para auto-respuesta

Cuando un ticket pasa a la fase de evaluación de auto-respuesta:

1. Se genera el embedding del texto del ticket (asunto + cuerpo).
2. Se buscan los chunks de la KB cuyos embeddings estén más cerca.
3. Si encontramos chunks suficientemente cercanos, los pasamos al modelo de generación para que redacte la respuesta.

Esto sucede en background, una vez por ticket candidato a auto-respuesta.

### 2.3 Lo que NO hacemos con embeddings (en MVP)

- No los usamos para clasificar tickets (eso lo hace Claude directamente).
- No los usamos para detectar tickets duplicados (puede ser una mejora futura).
- No los usamos para autocompletar mientras el usuario escribe.

---

## 3. Modelo elegido: `multilingual-e5-small`

**Identificador completo:** `Xenova/multilingual-e5-small` (versión empacada para Transformers.js).

| Característica             | Valor                                     |
| -------------------------- | ----------------------------------------- |
| Dimensiones del vector     | 384                                       |
| Tamaño en disco            | ~120 MB                                   |
| Idiomas soportados         | 100+ (incluye español, inglés, portugués) |
| Máximo de tokens por input | 512                                       |
| Tipo de pooling            | Mean pooling                              |
| Vectores normalizados      | Sí (longitud 1)                           |
| Licencia                   | MIT                                       |

**Por qué este modelo:**

1. **Multilingüe.** Tikora opera en español, pero la KB puede tener fragmentos en inglés (manuales de software, códigos de error). Un modelo monolingüe en español no manejaría eso bien; un modelo solo en inglés tampoco. E5 multilingüe atiende ambos lados sin penalidad.
2. **Tamaño manejable.** 120 MB se descarga en segundos y carga en RAM rápido. Variantes más grandes (`multilingual-e5-base`, ~450 MB; `multilingual-e5-large`, ~1.1 GB) dan mejor calidad pero al precio de más RAM y CPU.
3. **Calidad probada en retrieval.** La familia E5 es referencia en benchmarks de retrieval (MTEB) y rinde bien en español específicamente.
4. **Vectores compactos.** 384 dimensiones es la mitad que `text-embedding-3-small` (1536). Búsquedas más rápidas, índice más liviano.
5. **Vectores ya normalizados.** El modelo devuelve vectores de longitud 1, lo que simplifica usar similitud coseno (es equivalente al producto punto).

### 3.1 Cuándo conviene cambiar de modelo

- **Si la calidad del retrieval no es suficiente** y la mejora de calidad justifica el costo: pasar a `multilingual-e5-base` o `multilingual-e5-large`.
- **Si el corpus crece a cientos de miles de documentos** y se nota deterioro en el ranking fino: evaluar un modelo de embeddings comercial (ej. Voyage) o un cross-encoder de re-ranking.
- **Si la latencia de generación se vuelve un cuello de botella**: el modelo `small` ya es rápido, pero podría aún achicarse a `multilingual-e5-tiny` si existe variante.

El módulo `kb` abstrae el modelo detrás de una interfaz `EmbeddingProvider`, así que cambiar implica reemplazar el provider y reindexar la KB. Sin tocar lógica de negocio.

---

## 4. La convención E5 — prefijos `passage:` y `query:`

Los modelos de la familia E5 fueron entrenados con la **convención obligatoria** de prefijar todo texto antes de embeberlo:

- `passage: <texto>` — para textos que se van a **indexar** (chunks de la KB).
- `query: <texto>` — para textos que se van a **buscar** (ticket entrante).

**¿Por qué importa?** Durante el entrenamiento, el modelo aprendió que los `passages` son textos largos y autocontenidos, mientras que los `queries` son consultas o preguntas. Si no respetás los prefijos, el modelo no sabe en qué rol está el texto y la calidad del retrieval baja notablemente (10-20 % de degradación, dependiendo del corpus).

### 4.1 Ejemplos correctos

**Indexando un chunk de KB:**

```
passage: Para solicitar vacaciones, el empleado debe completar el formulario digital disponible en el portal de RRHH con al menos 15 días de anticipación. La solicitud queda sujeta a aprobación del jefe directo y a la disponibilidad operativa del área.
```

**Embebiendo un ticket:**

```
query: ¿Cómo hago para pedir vacaciones? Tengo planeado viajar el mes que viene.
```

### 4.2 Aplicación en el código

El prefijo se agrega **dentro del módulo de embeddings**, no afuera. Quien consume el provider no debe preocuparse por agregarlo.

```typescript
// Pseudocódigo
class EmbeddingProvider {
  async embedPassage(text: string): Promise<number[]> {
    return this.embed(`passage: ${text}`);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(`query: ${text}`);
  }

  private async embed(input: string): Promise<number[]> {
    // ...llamada real al modelo
  }
}
```

### 4.3 Consecuencia de olvidarlo

Si por error se embeben passages como queries (o viceversa), el sistema sigue funcionando pero los scores de similitud bajan y los chunks correctos pueden no aparecer en el top-5. Esto se manifiesta como "la auto-respuesta nunca encuentra contenido" aunque la KB sí lo tenga.

---

## 5. Transformers.js como runtime

**Transformers.js** (`@xenova/transformers`) es la librería que ejecuta el modelo dentro del proceso Node.js, sin requerir Python ni un servicio externo.

### 5.1 Cómo funciona

- El modelo está empaquetado en formato **ONNX** (Open Neural Network Exchange).
- Transformers.js carga el ONNX y lo ejecuta vía **`onnxruntime-node`**, que internamente usa instrucciones SIMD del CPU.
- En la primera ejecución descarga el modelo desde Hugging Face Hub (~120 MB) y lo cachea en disco (`~/.cache/huggingface/` por defecto).
- En ejecuciones siguientes lo lee del cache local — sin red.

### 5.2 Ventajas operativas

- **Sin servicio externo.** No hay que correr un servidor Python aparte (FastAPI + sentence-transformers, por ejemplo). Todo en el mismo proceso del worker.
- **Sin costos.** No hay API a pagar.
- **Sin rate limits.** Generamos los embeddings que necesitemos al ritmo que la CPU permita.
- **Sin egress de datos.** El contenido nunca sale del servidor de Tikora.
- **Reproducible.** El modelo cacheado es el mismo bit a bit en cada deploy.

### 5.3 Costos operativos

- **RAM.** El modelo cargado ocupa ~200 MB de RAM (modelo + buffers de inferencia).
- **CPU.** Cada embedding toma típicamente entre **30 y 150 ms** en CPU moderno (varía según largo del texto y número de cores). Procesar un documento de 50 chunks toma ~3 a 7 segundos.
- **Disco.** ~120 MB del modelo cacheado.

Como ambos procesamientos (indexación y búsqueda) corren en workers de BullMQ, no impactan la latencia del request del usuario.

---

## 6. Pipeline de generación de embeddings

### 6.1 Indexación de un documento de KB

```
[admin sube/edita documento]
         │
         ▼
guardar KbDocument con version+1, active=false
         │
         ▼
encolar job en cola "embeddings"
         │
         ▼ (worker BullMQ)
KbIndexProcessor.process(job)
         │
         ├─► leer documento desde Mongo
         ├─► chunkear contenido (500-800 tokens, overlap 100)
         ├─► para cada chunk:
         │     ├─► prefijo "passage: " + contenido
         │     ├─► generar embedding (Transformers.js)
         │     └─► persistir KbChunk con tenantId, documentId, version, embedding
         ├─► marcar nueva versión del documento como active=true
         ├─► marcar versión anterior y sus chunks como active=false
         └─► emitir evento KbDocumentIndexed
```

### 6.2 Embedding de un ticket para búsqueda

```
[ticket clasificado, candidato a auto-respuesta]
         │
         ▼
AutoResponseProcessor.process(job)
         │
         ├─► armar input: asunto + "\n\n" + cuerpo
         ├─► prefijo "query: " + input
         ├─► generar embedding (Transformers.js)
         ├─► ejecutar $vectorSearch en kb_chunks
         └─► continuar el pipeline de auto-respuesta...
```

### 6.3 Pseudocódigo del provider

```typescript
import { pipeline, FeatureExtractionPipeline } from '@xenova/transformers';

class TransformersJsEmbeddingProvider implements EmbeddingProvider {
  private extractor: FeatureExtractionPipeline | null = null;

  async init(): Promise<void> {
    if (this.extractor) return;
    this.extractor = await pipeline(
      'feature-extraction',
      process.env.EMBEDDING_MODEL_NAME, // 'Xenova/multilingual-e5-small'
      { quantized: true },
    );
  }

  async embedPassage(text: string): Promise<number[]> {
    return this.embed(`passage: ${this.truncate(text)}`);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(`query: ${this.truncate(text)}`);
  }

  private async embed(input: string): Promise<number[]> {
    if (!this.extractor) await this.init();
    const output = await this.extractor!(input, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data); // 384 floats, longitud 1
  }

  private truncate(text: string, maxChars = 2000): string {
    // El modelo soporta 512 tokens (~2000 chars en español).
    // Cortamos para evitar errores y warnings.
    return text.length > maxChars ? text.slice(0, maxChars) : text;
  }
}
```

---

## 7. Chunking de documentos

El chunking parte un documento largo en fragmentos más chicos, cada uno con su propio embedding. La estrategia de chunking afecta directamente la calidad del retrieval.

### 7.1 Por qué chunkear

1. **Límite del modelo de embeddings.** Solo procesa 512 tokens. Documentos más largos no entran enteros.
2. **Granularidad de la búsqueda.** Si un documento de 30 páginas se embebe como un solo vector, ese vector promedia todo el contenido y pierde especificidad. Partido en 30 chunks, cada chunk representa un tema concreto.
3. **Costo de generación.** En el RAG, le pasamos al modelo de generación los chunks recuperados. Mandar todo el documento desperdicia tokens.

### 7.2 Estrategia de Tikora

| Parámetro                         | Valor por defecto        |
| --------------------------------- | ------------------------ |
| Tamaño objetivo                   | 500-800 tokens por chunk |
| Mínimo aceptable                  | 200 tokens               |
| Máximo absoluto                   | 1000 tokens              |
| Overlap entre chunks consecutivos | 100 tokens               |

### 7.3 Respeto de límites semánticos

El chunker no corta en medio de oraciones ni en medio de elementos estructurales. Prioriza separadores en este orden:

1. **Encabezados Markdown** (`#`, `##`, `###`) — separador fuerte. Un chunk no cruza un cambio de sección si tiene tamaño suficiente.
2. **Saltos de párrafo** (línea vacía) — separador medio.
3. **Saltos de oración** (puntos seguidos de mayúscula) — separador suave.
4. **Espacios** — solo como último recurso.

**Algoritmo de alto nivel:**

```
fragmentos := []
acumulador := ""
para cada bloque en parsear(documento):
    si tamaño(acumulador + bloque) > MAX:
        fragmentos.push(acumulador)
        acumulador := tomar_overlap(acumulador) + bloque
    si no:
        acumulador += bloque
si tamaño(acumulador) >= MIN:
    fragmentos.push(acumulador)
si no:
    último.merge(acumulador)  // pegamos el residuo al chunk anterior
```

### 7.4 Overlap

El overlap copia los últimos ~100 tokens de un chunk al inicio del siguiente. Esto evita que un concepto importante quede partido entre dos chunks y se pierda en la búsqueda.

**Ejemplo sin overlap (mal):**

```
Chunk 7: ...los empleados con más de 5 años de antigüedad
Chunk 8: tienen derecho a 25 días corridos de vacaciones...
```

Una búsqueda por "5 años antigüedad días vacaciones" puede no rankear bien ningún chunk individual porque la información está partida.

**Ejemplo con overlap (bien):**

```
Chunk 7: ...los empleados con más de 5 años de antigüedad
Chunk 8: con más de 5 años de antigüedad tienen derecho a 25 días...
```

Ahora el chunk 8 contiene el contexto completo y va a rankear bien para la consulta.

### 7.5 Edge cases

- **Documento más chico que el mínimo.** Se embebe como un solo chunk de tamaño completo, sin partir.
- **Documento sin estructura (texto corrido).** Se cae a separadores más débiles (oraciones).
- **Líneas muy largas (ej. una tabla en una sola línea).** Si una línea sola excede el máximo, se corta por palabra.
- **Código embebido en markdown.** Se preserva como bloque (los chunkers no parten dentro de un fence ` ``` `).

### 7.6 Conteo de tokens

Para chunkear con un objetivo en tokens, hace falta saber cuántos tokens tiene un texto. Usar el tokenizer del propio modelo es lo más preciso:

```typescript
const tokenizer = await AutoTokenizer.from_pretrained('Xenova/multilingual-e5-small');
const tokens = await tokenizer(text, { return_tensor: false });
const tokenCount = tokens.input_ids.length;
```

Como aproximación rápida durante desarrollo, sirve la heurística **1 token ≈ 4 caracteres en español**, pero el conteo real se hace siempre con el tokenizer del modelo.

---

## 8. Almacenamiento en MongoDB Atlas Vector Search

Los embeddings se guardan en la colección `kb_chunks` del mismo cluster de MongoDB que el resto de los datos.

### 8.1 Estructura del documento

```typescript
interface KbChunk {
  _id: ObjectId;
  tenantId: ObjectId; // filtro multi-tenant obligatorio
  documentId: ObjectId; // referencia al KbDocument
  documentVersion: number; // versión del documento al que pertenece
  position: number; // orden del chunk dentro del documento (0..N)
  content: string; // texto del chunk (sin el prefijo "passage:")
  embedding: number[]; // 384 floats
  scope: 'global' | 'area'; // copiado del documento padre
  areaIds: ObjectId[]; // copiado del documento padre (vacío si scope=global)
  active: boolean; // true solo para la versión activa del documento
  tokensCount: number; // tamaño del chunk en tokens
  createdAt: Date;
}
```

### 8.2 Índices regulares (no vectoriales)

```javascript
db.kb_chunks.createIndex({ tenantId: 1, documentId: 1, documentVersion: 1 });
db.kb_chunks.createIndex({ tenantId: 1, active: 1 });
db.kb_chunks.createIndex({ documentId: 1 }); // para borrado por documento
```

### 8.3 Índice vectorial de Atlas Search

Configuración del índice (definido en Atlas o vía CLI):

```json
{
  "name": "kb_chunks_vector",
  "type": "vectorSearch",
  "definition": {
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
}
```

**Decisiones del índice:**

- `numDimensions: 384` — coincide con la salida del modelo. Cambiar de modelo con dimensiones distintas requiere recrear el índice.
- `similarity: cosine` — apropiado para vectores normalizados. Equivale al producto punto en este caso.
- Campos de filtro listados — cualquier filtro que se aplique en `$vectorSearch` debe estar declarado acá. Otros campos (no filtrables) se pueden recuperar pero no usar como filtro.

### 8.4 Por qué Atlas Vector Search y no otra solución

| Opción                            | Pros                                                                                                | Contras                                                              |
| --------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| **Atlas Vector Search** (elegida) | Mismo cluster que la BD, transacciones consistentes con el resto de la data, sin servicio adicional | Atado a Atlas (no aplica si se decide self-hosting de Mongo)         |
| Pinecone / Weaviate / Qdrant      | Especializados, buena performance a gran escala                                                     | Servicio externo de pago, datos viajan fuera, dependencia adicional  |
| pgvector (Postgres)               | Solid choice si la BD principal fuera Postgres                                                      | Stack diferente al elegido                                           |
| FAISS / Annoy local               | Gratis                                                                                              | Sin durabilidad, hay que persistir aparte, no escala horizontalmente |

Atlas Vector Search es la opción que mantiene el principio de "una sola BD para todo el dominio", reduce piezas operativas y evita costos adicionales mientras la KB sea de tamaño razonable.

---

## 9. Búsqueda vectorial con `$vectorSearch`

### 9.1 Pipeline básico

```typescript
const queryVector = await embeddingProvider.embedQuery(`${ticket.asunto}\n\n${ticket.cuerpo}`);

const pipeline = [
  {
    $vectorSearch: {
      index: 'kb_chunks_vector',
      path: 'embedding',
      queryVector,
      numCandidates: 100, // pre-selección amplia
      limit: 5, // resultado final
      filter: {
        tenantId: { $eq: ticket.tenantId },
        active: { $eq: true },
        $or: [{ scope: 'global' }, { scope: 'area', areaIds: { $in: [ticket.areaId] } }],
      },
    },
  },
  {
    $project: {
      content: 1,
      documentId: 1,
      documentVersion: 1,
      position: 1,
      areaIds: 1,
      score: { $meta: 'vectorSearchScore' },
    },
  },
];

const results = await db.collection('kb_chunks').aggregate(pipeline).toArray();
```

### 9.2 `numCandidates` vs `limit`

- `numCandidates` es cuántos vectores el índice considera durante la búsqueda aproximada (HNSW). Más candidatos → mejor recall pero más latencia.
- `limit` es cuántos resultados finales devolvés.
- Regla práctica: `numCandidates` entre 10× y 20× el `limit`. Para `limit: 5`, usar `numCandidates: 100`.

### 9.3 Filtros obligatorios

**Toda búsqueda incluye `tenantId`.** Sin excepción. Olvidar este filtro expone datos de otros tenants — es el bug de seguridad más serio que puede ocurrir en este sistema.

**Toda búsqueda incluye `active: true`.** Sin esto, los chunks de versiones viejas siguen apareciendo y la auto-respuesta cita información obsoleta.

**Filtro de scope/área:** un chunk se considera relevante si:

- Su `scope` es `global` (aplica a cualquier ticket del tenant), **o**
- Su `scope` es `area` y el área del ticket está en sus `areaIds`.

### 9.4 Score y umbral de relevancia

`$vectorSearch` devuelve un score normalizado entre 0 y 1 (con `similarity: cosine`):

| Score       | Interpretación cualitativa                            |
| ----------- | ----------------------------------------------------- |
| > 0.90      | Match muy fuerte — el chunk responde directamente.    |
| 0.80 - 0.90 | Match bueno — el chunk es claramente relevante.       |
| 0.75 - 0.80 | Match aceptable — relacionado pero no idéntico.       |
| 0.65 - 0.75 | Match débil — tiene similitud pero puede no ser útil. |
| < 0.65      | Match irrelevante — descartar.                        |

**Política de Tikora:**

- Umbral por defecto: `UMBRAL_RELEVANCIA_KB = 0.75`.
- Si el `score` máximo del top-5 está por debajo del umbral, **no hay match suficiente** y se aborta el flujo de auto-respuesta. El ticket se escala normal.
- Si al menos uno supera el umbral, los chunks que pasen el umbral se mandan al modelo de generación. Los que no pasen, se descartan.

El umbral es configurable por tenant (algunos corpus son más densos y requieren umbral más alto, otros más laxos).

### 9.5 Casos límite

- **`numCandidates` mayor que la colección.** No es problema; el índice devuelve todo lo que tiene.
- **Filtro que no matchea nada.** Devuelve array vacío. El pipeline lo trata como "sin match", sin error.
- **Vector de query con NaN.** Indica fallo de generación de embedding aguas arriba. Se loguea como error y el job se reintenta.

---

## 10. Carga e inicialización del modelo

### 10.1 Patrón singleton por proceso

El modelo se carga **una sola vez por proceso (worker)** y se reutiliza para todas las llamadas. Cargarlo en cada llamada es prohibitivo (varios segundos por llamada).

```typescript
// embedding.module.ts
@Module({
  providers: [
    {
      provide: 'EMBEDDING_PROVIDER',
      useFactory: async () => {
        const provider = new TransformersJsEmbeddingProvider();
        await provider.init(); // descarga + carga el modelo
        return provider;
      },
    },
  ],
  exports: ['EMBEDDING_PROVIDER'],
})
export class EmbeddingModule {}
```

### 10.2 Cuándo se carga

- **En workers de BullMQ:** al arrancar el worker. La primera vez en una máquina nueva tarda ~10-20 s (descarga del modelo desde HF Hub). En los siguientes arranques, ~1-3 s (carga desde cache local).
- **En el server HTTP de NestJS:** **no se carga.** Los embeddings se generan solo en workers. El server HTTP no necesita el modelo.

### 10.3 Cache del modelo en disco

- Ubicación por defecto: `~/.cache/huggingface/`.
- Override vía variable de entorno `TRANSFORMERS_CACHE` (recomendado en Docker para mapear un volumen persistente).
- En contenedores efímeros, montar el cache como volumen evita re-descargar el modelo en cada deploy.

### 10.4 Cold start

Para reducir el cold start en producción:

- **Pre-descargar el modelo en el `Dockerfile`** durante el build, no en runtime.
- **Healthcheck del worker** que solo pase a "ready" cuando el modelo terminó de cargar.
- **Embeddings warm-up:** ejecutar un embedding dummy al arranque (`provider.embedQuery('hola')`) para forzar la inicialización completa antes de aceptar jobs.

```typescript
// En el bootstrap del worker
await embeddingProvider.init();
await embeddingProvider.embedQuery('warmup');
console.log('Embedding worker ready');
```

---

## 11. Performance

### 11.1 Latencia típica por embedding

En un servidor con CPU x86_64 moderno (4 cores, sin GPU):

| Operación                                        | Latencia   |
| ------------------------------------------------ | ---------- |
| Embedding de un texto corto (< 100 tokens)       | 30-60 ms   |
| Embedding de un texto medio (300 tokens)         | 60-120 ms  |
| Embedding de un texto largo (500 tokens, máximo) | 100-150 ms |
| Carga inicial del modelo (cache miss)            | 10-20 s    |
| Carga inicial del modelo (cache hit)             | 1-3 s      |

### 11.2 Throughput

- **Sin batching:** ~10 embeddings/segundo en CPU.
- **Con batching (procesar varios chunks en una sola pasada):** 2-3× más rápido para chunks similares en tamaño.

Transformers.js soporta batching pasando un array de strings:

```typescript
const outputs = await this.extractor(['passage: ...', 'passage: ...'], {
  pooling: 'mean',
  normalize: true,
});
```

Tikora usa batching de hasta 16 chunks por llamada en el indexador de KB. La cola de búsqueda (queries por ticket) no batchea — cada ticket viene por separado.

### 11.3 Concurrencia

- Cada worker BullMQ puede procesar 1 embedding a la vez (Transformers.js no es thread-safe en el mismo proceso, pero usa SIMD del CPU internamente).
- Para escalar throughput, se corren **múltiples workers** (en paralelo o en máquinas distintas), cada uno con su propio modelo cargado.
- En MVP con un solo worker, el throughput esperado alcanza para 1000+ tickets/día y cargas de KB de cientos de chunks sin congestión.

### 11.4 Memoria

- Modelo cargado: ~200 MB de RAM constantes.
- Buffer de inferencia: <50 MB pico por embedding.
- Embeddings en memoria de Node.js (mientras se procesan en lote): ~6 KB cada uno (384 floats × 4 bytes + overhead JSON).

Con un worker activo, el uso total estable es ~250-300 MB de RAM dedicados a embeddings.

---

## 12. Re-indexación

### 12.1 Cuándo re-indexar

- **Automático** al editar un documento de KB → solo regenera los chunks de ese documento.
- **Manual** cuando:
  - Se cambia el modelo de embeddings (todos los chunks viejos quedan obsoletos — sus vectores no son comparables con los nuevos).
  - Se cambian los parámetros de chunking (tamaño, overlap).
  - Se sospecha corrupción del índice.
  - Se migra a una versión mayor del modelo (cambia las dimensiones).

### 12.2 Comando de re-indexación masiva

```bash
npx nx run back:reindex-kb -- --tenantId <id> [--dry-run]
```

**Comportamiento:**

1. Itera todos los documentos activos del tenant.
2. Para cada documento, regenera chunks y embeddings con la configuración actual.
3. Inserta los nuevos chunks como `active: true` y los viejos como `active: false`.
4. Cuando termina con todos, elimina los chunks viejos.

**Estrategia sin downtime:**

- Durante la re-indexación, las búsquedas siguen funcionando contra los chunks viejos hasta que la nueva versión esté completa.
- El cambio de "activo" se hace al final, en una operación atómica por documento.
- Si la re-indexación se interrumpe a la mitad, el sistema sigue sirviendo desde el estado anterior.

### 12.3 Cambio de modelo (con dimensiones distintas)

Si se cambia, por ejemplo, a `multilingual-e5-base` (768 dimensiones en vez de 384):

1. **Actualizar el índice de Atlas:** crear un índice nuevo `kb_chunks_vector_v2` con `numDimensions: 768`.
2. **Re-indexar toda la KB** generando vectores nuevos con el modelo nuevo.
3. **Apuntar las búsquedas al nuevo índice** vía variable de entorno (`KB_VECTOR_INDEX_NAME`).
4. **Eliminar el índice viejo** una vez verificado que todo funciona.

Este proceso debe documentarse en un runbook antes de ejecutarse en producción.

---

## 13. Manejo de errores

### 13.1 Modelo no carga al inicio

**Causas posibles:**

- Sin conexión a internet en el primer arranque (no puede descargar de HF Hub).
- Cache corrupto.
- Versión del modelo no existe.

**Estrategia:**

- El worker no pasa el healthcheck. No empieza a procesar jobs.
- Loguear el error con el detalle de la causa.
- Si está en producción y la cache estaba pre-poblada en el build, este error indica un problema serio de infraestructura — alarma crítica.

### 13.2 Embedding falla

**Causas posibles:**

- Texto vacío o inválido.
- OOM transitorio.
- Bug en una versión de Transformers.js.

**Estrategia:**

- Try/catch alrededor de cada `extractor()`.
- Si falla, reintentar 1 vez.
- Si vuelve a fallar:
  - En indexación: marcar el chunk con `embeddingError` y continuar con los demás. Notificar al admin.
  - En búsqueda: abortar el flujo de auto-respuesta para ese ticket (escalar normalmente). Loguear.

### 13.3 Atlas Vector Search no responde

**Causas posibles:**

- Cluster en mantenimiento.
- Índice no creado o no listo (puede tomar minutos en construirse tras un cambio de definición).
- Filtro que viola la definición del índice.

**Estrategia:**

- Reintentos de Mongoose con backoff.
- Si persiste: alarma crítica. La auto-respuesta se desactiva temporalmente (los tickets se escalan al área igual que si ningún chunk superara el umbral). El servicio sigue operativo.

### 13.4 Filtro vacío o sin resultados

No es un error: significa que no hay chunks que coincidan. El flujo de auto-respuesta interpreta `results.length === 0` como "no hay match" y escala al área. Sin reintentos, sin alarma.

---

## 14. Mantenimiento

### 14.1 Limpieza de chunks inactivos

Cron diario (`MaintenanceService.cleanupInactiveKbChunks`):

- Borra chunks con `active: false` y `createdAt` mayor a `KB_INACTIVE_CHUNKS_RETENTION_DAYS` (default 30).
- No borra documentos `KbDocument` inactivos: solo sus chunks, para liberar el índice vectorial.
- Si se necesita auditoría histórica, los `KbDocument` permanecen.

### 14.2 Verificación de consistencia

Cron semanal (`MaintenanceService.verifyKbConsistency`):

- Verifica que cada `KbDocument` con `active: true` tenga al menos 1 chunk con `active: true`.
- Verifica que los chunks tengan embeddings con la dimensión esperada.
- Verifica que los chunks no tengan embeddings nulos o con NaN.
- Reporta inconsistencias al admin.

### 14.3 Métricas a monitorear

| Métrica                                         | Por qué importa                                              |
| ----------------------------------------------- | ------------------------------------------------------------ |
| Latencia de generación de embeddings (P50, P95) | Detecta degradación de performance del worker                |
| Tasa de errores en `embedPassage`/`embedQuery`  | Detecta problemas con el modelo                              |
| Tasa de búsquedas con score < umbral            | Si sube, indica que la KB no está cubriendo bien los tickets |
| Tamaño de la colección `kb_chunks`              | Para planificar capacidad y costos de Atlas                  |
| Tiempo desde la última indexación por tenant    | Detectar tenants que dejaron de mantener la KB               |

### 14.4 Backups

- Los embeddings son **regenerables** desde los `KbDocument`: si se pierden, se recalculan corriendo el reindex. No es un dato de origen.
- Los `KbDocument` sí son origen: se respaldan junto con el resto de la BD.
- Esto significa que ante una restauración, hay que re-correr la indexación tras restaurar los documentos.

---

## 15. Reglas para Implementación

- **Toda generación de embeddings pasa por el `EmbeddingProvider`.** Ningún módulo importa Transformers.js directamente.
- **El prefijo E5** (`passage:` / `query:`) lo agrega el provider, no el consumidor. Quien llama no debe preocuparse.
- **Toda búsqueda en `kb_chunks` lleva `tenantId` y `active: true` en los filtros.** Sin excepciones.
- **El umbral de relevancia** se lee de `UMBRAL_RELEVANCIA_KB`, nunca hardcodeado.
- **El modelo se carga una sola vez por proceso.** Patrón singleton, inicialización en el bootstrap del worker.
- **La generación de embeddings vive en workers de BullMQ**, nunca en el camino del request HTTP.
- **El chunker respeta los límites estructurales** del Markdown: encabezados, párrafos, código.
- **Cada chunk persiste su `tokensCount`** para diagnóstico y métricas.
- **El cambio de modelo** requiere reindexación completa documentada como runbook. No es una migración silenciosa.
- **Los logs de indexación no incluyen el contenido completo de los chunks**. Loguean `documentId`, `position`, `tokensCount`, `latencyMs`.
- **La interfaz `EmbeddingProvider` se mantiene estable** aunque cambie el motor por debajo. Eso permite migrar de Transformers.js a otro proveedor sin tocar consumidores.
