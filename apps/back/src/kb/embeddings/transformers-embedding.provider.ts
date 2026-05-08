import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import type { EmbeddingProvider } from './embedding-provider';

// Tipos opacos: importamos los símbolos de runtime perezosamente con
// `await import('@xenova/transformers')` para que el HTTP server no
// resuelva la librería al arrancar (evita cargar deps pesadas como
// onnxruntime-node si nunca se embebe nada en este proceso).
type Extractor = (
  texts: string | string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

type Tokenizer = (
  text: string,
  opts?: { return_tensor?: boolean },
) => {
  input_ids: { data: ArrayLike<number> } | ArrayLike<number>;
};

/**
 * Si truncamos por chars antes de tokenizar, evitamos el warning del
 * modelo y los costos de tokenizar texto que igual va a descartarse.
 * El modelo soporta 512 tokens; 1 token ≈ 4 chars en español, así que
 * 2000 chars deja margen incluso para texto denso de tokens cortos.
 * Ver `tikora-embeddings.md` §6.3.
 */
const TRUNCATE_CHARS = 2000;

/**
 * Implementación del `EmbeddingProvider` basada en Transformers.js corriendo
 * 100% local con el modelo `multilingual-e5-small` (384 dims, vectores
 * normalizados). Patrón singleton por proceso (`tikora-embeddings.md` §10.1):
 * el modelo se carga una vez y se reutiliza para todas las llamadas
 * subsiguientes.
 *
 * Lazy init: ni el modelo ni el tokenizer se cargan hasta que se llama
 * `init()` o un método público por primera vez. Esto mantiene livianos los
 * procesos que importan el módulo `kb` pero nunca embeben nada (por
 * ejemplo, un test que solo prueba el controller sin tocar la cola).
 *
 * Concurrencia: si dos llamadas se solapan durante la primera carga, ambas
 * esperan la misma promesa (`initPromise`). Una sola descarga, ambas
 * resuelven a la vez.
 */
@Injectable()
export class TransformersEmbeddingProvider implements EmbeddingProvider, OnModuleInit {
  private readonly logger = new Logger(TransformersEmbeddingProvider.name);
  private extractor: Extractor | null = null;
  private tokenizer: Tokenizer | null = null;
  private initPromise: Promise<void> | null = null;

  constructor(@Inject(ConfigService) private readonly config: ConfigService<Env, true>) {}

  /**
   * NestJS llama `onModuleInit` después de instanciar todos los providers.
   * No bloqueamos el bootstrap en la carga del modelo (puede tardar 10-20s
   * con cache miss): solo seteamos el cacheDir. La carga real ocurre en la
   * primera llamada o cuando un worker explícitamente invoca `init()`.
   */
  async onModuleInit(): Promise<void> {
    const cacheDir = this.config.get('TRANSFORMERS_CACHE', { infer: true });
    try {
      const { env } = await import('@xenova/transformers');
      env.cacheDir = cacheDir;
      // Off-by-default en algunas instalaciones: forzamos cache de FS.
      env.useFSCache = true;
    } catch (err) {
      this.logger.error(
        `No se pudo configurar @xenova/transformers env: ${this.errorMessage(err)}`,
      );
    }
  }

  async init(): Promise<void> {
    if (this.extractor && this.tokenizer) return;
    if (!this.initPromise) {
      this.initPromise = this.loadModel().catch((err) => {
        // Permitir reintentar la carga en una llamada futura si esta falló
        // (ej. red caída en el primer arranque).
        this.initPromise = null;
        throw err;
      });
    }
    return this.initPromise;
  }

  async embedPassage(text: string): Promise<number[]> {
    return this.embed(`passage: ${this.truncate(text)}`);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(`query: ${this.truncate(text)}`);
  }

  async embedPassages(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const extractor = await this.ensureExtractor();
    const batchSize = this.config.get('EMBEDDING_BATCH_SIZE', { infer: true });
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => `passage: ${this.truncate(t)}`);
      const output = await extractor(batch, { pooling: 'mean', normalize: true });
      // Transformers.js devuelve un tensor "aplanado" con dims=[N, 384].
      // Lo partimos en N vectores de 384 floats.
      const dims = output.dims;
      const totalLen = dims.reduce((a, b) => a * b, 1);
      const data =
        output.data instanceof Float32Array ? output.data : new Float32Array(output.data);
      if (data.length !== totalLen) {
        throw new Error(
          `Tamaño de salida inesperado: data.length=${data.length} dims=${dims.join('x')}`,
        );
      }
      const vectorSize = dims[dims.length - 1] ?? 0;
      for (let b = 0; b < batch.length; b++) {
        const start = b * vectorSize;
        results.push(Array.from(data.slice(start, start + vectorSize)));
      }
    }
    return results;
  }

  async countTokens(text: string): Promise<number> {
    const tokenizer = await this.ensureTokenizer();
    const input = tokenizer(text);
    // El tokenizer devuelve estructuras distintas según versión: `Tensor`
    // con `.data` ArrayLike o un array plano. Normalizamos.
    const ids = (input as { input_ids: { data?: ArrayLike<number> } | ArrayLike<number> })
      .input_ids;
    if (ids && typeof ids === 'object' && 'data' in ids && ids.data) {
      return ids.data.length;
    }
    if (Array.isArray(ids)) {
      return ids.length;
    }
    if (ids && typeof (ids as ArrayLike<number>).length === 'number') {
      return (ids as ArrayLike<number>).length;
    }
    // Fallback heurístico (1 token ≈ 4 chars en español) — preferible a
    // arrojar: el chunker queda algo grueso pero opera. Logueamos para
    // detectar el problema.
    this.logger.warn(
      'No se pudo extraer input_ids del tokenizer, cayendo a heurística 4 chars/token.',
    );
    return Math.ceil(text.length / 4);
  }

  // -------- internos --------

  private async embed(input: string): Promise<number[]> {
    const extractor = await this.ensureExtractor();
    const output = await extractor(input, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  private async ensureExtractor(): Promise<Extractor> {
    await this.init();
    if (!this.extractor) {
      throw new Error('Extractor de embeddings no inicializado.');
    }
    return this.extractor;
  }

  private async ensureTokenizer(): Promise<Tokenizer> {
    await this.init();
    if (!this.tokenizer) {
      throw new Error('Tokenizer de embeddings no inicializado.');
    }
    return this.tokenizer;
  }

  private truncate(text: string): string {
    return text.length > TRUNCATE_CHARS ? text.slice(0, TRUNCATE_CHARS) : text;
  }

  private async loadModel(): Promise<void> {
    const modelName = this.config.get('EMBEDDING_MODEL_NAME', { infer: true });
    const start = Date.now();
    this.logger.log(`Cargando modelo de embeddings ${modelName}...`);

    const { pipeline, AutoTokenizer } = await import('@xenova/transformers');

    const [extractor, tokenizer] = await Promise.all([
      pipeline('feature-extraction', modelName, { quantized: true }) as Promise<Extractor>,
      AutoTokenizer.from_pretrained(modelName) as Promise<Tokenizer>,
    ]);

    this.extractor = extractor;
    this.tokenizer = tokenizer;
    this.logger.log(`Modelo de embeddings listo en ${Date.now() - start}ms`);
  }

  private errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
