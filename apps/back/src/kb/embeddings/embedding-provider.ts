/**
 * Token de DI para el provider de embeddings. Usar este símbolo al inyectar
 * en lugar de la clase concreta — así podemos cambiar la implementación
 * (Transformers.js → API externa, o un fake en tests) sin tocar consumidores.
 */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';

/**
 * Interfaz de generación de embeddings. Cualquier implementación debe:
 *
 * 1. Aplicar el prefijo E5 (`passage:` / `query:`) **dentro** del provider.
 *    El consumidor pasa texto pelado; el provider lo prefija. Ver
 *    `tikora-embeddings.md` §4.
 * 2. Devolver vectores normalizados (longitud 1) — el índice de Atlas usa
 *    `similarity: cosine` con esa asunción.
 * 3. Cargar el modelo una sola vez por proceso (`tikora-embeddings.md` §10.1).
 *
 * Las llamadas son asíncronas pero no thread-safe a nivel de instancia —
 * un worker BullMQ procesa de a 1 job por vez en el mismo proceso.
 */
export interface EmbeddingProvider {
  /**
   * Carga el modelo + tokenizer si aún no están cargados. Idempotente.
   * Llamar al bootstrap del worker para que el primer job no pague el
   * cold start.
   */
  init(): Promise<void>;

  /**
   * Embebe un texto destinado a indexarse en `kb_chunks` (un fragmento de
   * un documento de KB). Aplica el prefijo `passage:`.
   */
  embedPassage(text: string): Promise<number[]>;

  /**
   * Embebe un texto destinado a buscarse contra el índice (típicamente
   * `asunto + cuerpo` de un ticket). Aplica el prefijo `query:`.
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * Versión batched de `embedPassage`. Mejor throughput cuando hay que
   * embeber varios chunks de un mismo documento. La implementación es
   * libre de partir el array en sub-batches del tamaño que prefiera.
   */
  embedPassages(texts: string[]): Promise<number[][]>;

  /**
   * Conteo de tokens del texto **tal como lo tokenizaría el modelo**.
   * Crítico para chunkear: el chunker necesita saber cuánto "ocupa" un
   * bloque para no exceder `maxTokens`. Si el tokenizer no está disponible,
   * la implementación puede caer a una heurística documentada.
   */
  countTokens(text: string): Promise<number>;
}
