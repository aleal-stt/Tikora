import { KB_CHUNK_CONFIG } from './constants';
import { Block, parseBlocks } from './parse-blocks';

/**
 * Chunker de documentos Markdown para indexación de KB. Match con la
 * estrategia descrita en `tikora-embeddings.md` §7.
 *
 * Decisiones clave:
 *
 * - **Diseño puro y testeable**: la función recibe `countTokens` como
 *   inyección. En producción se pasa el tokenizer real del modelo; en
 *   tests, una heurística sincrónica (`(t) => t.length/4`).
 * - **Overlap por chars**: tomamos el sufijo del chunk anterior con un
 *   recorte por espacio para no partir palabras. Aproxima ~100 tokens
 *   sin tener que tokenizar el sufijo. Costo: el overlap real puede
 *   variar en ±20 tokens según densidad del texto. Lo aceptamos para
 *   no encadenar awaits dentro del loop de packing.
 * - **Bloques atómicos no se rompen** (fences). Si un fence solo excede
 *   `maxTokens`, el chunk resultante queda más grande que el techo —
 *   lo logueamos pero priorizamos no destrozar código.
 * - **Bloques de texto que exceden** `maxTokens` se parten primero por
 *   oraciones, después por palabras, como último recurso.
 * - **Residuo final**: si el último chunk queda por debajo de `minTokens`,
 *   se mergea con el anterior (evita un chunk de 30 tokens al final).
 */

export interface ChunkResult {
  position: number;
  content: string;
  tokensCount: number;
}

export interface ChunkOptions {
  countTokens: (text: string) => Promise<number> | number;
  config?: Partial<typeof KB_CHUNK_CONFIG>;
}

/**
 * Aproximación inversa al conteo: 1 token ≈ 4 chars en español. Sirve
 * solo para calcular el sufijo de overlap. El conteo real lo hacemos
 * con el tokenizer del modelo en otros pasos.
 */
const APPROX_CHARS_PER_TOKEN = 4;

const SENTENCE_SPLIT = /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÑ¿¡])/u;

export async function chunkMarkdown(
  content: string,
  options: ChunkOptions,
): Promise<ChunkResult[]> {
  const cfg = { ...KB_CHUNK_CONFIG, ...(options.config ?? {}) };
  const count = (text: string) => Promise.resolve(options.countTokens(text));

  const blocks = parseBlocks(content);
  if (blocks.length === 0) return [];

  // Acumulador de bloques que conformarán el chunk en construcción.
  const acumulador: string[] = [];
  let acumuladorTokens = 0;
  let overlapText = '';
  const chunks: ChunkResult[] = [];

  const flush = async () => {
    if (acumulador.length === 0) return;
    const body = acumulador.join('\n\n');
    const text = overlapText ? `${overlapText}\n\n${body}` : body;
    const tokensCount = await count(text);
    chunks.push({ position: chunks.length, content: text, tokensCount });
    overlapText = takeOverlapByChars(text, cfg.overlapTokens);
    acumulador.length = 0;
    acumuladorTokens = 0;
  };

  for (const block of blocks) {
    const blockTokens = await count(block.text);

    // Caso 1: el bloque solo supera el máximo. Cerramos lo acumulado y lo
    // partimos en sub-chunks por oraciones / palabras.
    if (blockTokens > cfg.maxTokens) {
      await flush();
      const sub = await splitOversized(block, cfg, count);
      for (const piece of sub) {
        const pieceText = overlapText ? `${overlapText}\n\n${piece}` : piece;
        const pieceTokens = await count(pieceText);
        chunks.push({ position: chunks.length, content: pieceText, tokensCount: pieceTokens });
        overlapText = takeOverlapByChars(pieceText, cfg.overlapTokens);
      }
      continue;
    }

    // Caso 2: agregar este bloque excedería el máximo. Cerramos y abrimos
    // chunk nuevo con este bloque.
    if (acumuladorTokens > 0 && acumuladorTokens + blockTokens > cfg.maxTokens) {
      await flush();
      acumulador.push(block.text);
      acumuladorTokens = blockTokens;
      continue;
    }

    // Caso 3: break fuerte (heading / fence) y ya alcanzamos el target.
    // Cerramos para empezar el nuevo chunk en el límite semántico.
    if (
      block.breakStrength === 'strong' &&
      acumuladorTokens >= cfg.targetTokens &&
      acumulador.length > 0
    ) {
      await flush();
      acumulador.push(block.text);
      acumuladorTokens = blockTokens;
      continue;
    }

    acumulador.push(block.text);
    acumuladorTokens += blockTokens;
  }

  // Cerrar el residuo. Si el último chunk queda por debajo del mínimo,
  // lo mergeamos con el anterior — evita el "chunk huérfano" de 30 tokens
  // que rankea mal por sí solo.
  if (acumulador.length > 0) {
    const body = acumulador.join('\n\n');
    const text = overlapText ? `${overlapText}\n\n${body}` : body;
    const tokensCount = await count(text);
    const previous = chunks[chunks.length - 1];
    if (previous && tokensCount < cfg.minTokens) {
      const merged = `${previous.content}\n\n${body}`;
      const mergedTokens = await count(merged);
      chunks[chunks.length - 1] = {
        position: previous.position,
        content: merged,
        tokensCount: mergedTokens,
      };
    } else {
      chunks.push({ position: chunks.length, content: text, tokensCount });
    }
  }

  return chunks;
}

/**
 * Devuelve el sufijo del texto con ~`overlapTokens` tokens, recortado en
 * el último espacio para no romper palabras. Aproximación por chars: a la
 * densidad de tokens del español (~4 chars/token) sale entre 80-130 tokens
 * reales, lo cual cae cómodamente en el rango "útil para overlap".
 */
function takeOverlapByChars(text: string, overlapTokens: number): string {
  const targetChars = overlapTokens * APPROX_CHARS_PER_TOKEN;
  if (text.length <= targetChars) return text;
  const sliced = text.slice(text.length - targetChars);
  const firstSpace = sliced.indexOf(' ');
  // Si no hay espacio, devolvemos el slice tal cual (caso patológico:
  // texto sin espacios).
  return firstSpace === -1 ? sliced : sliced.slice(firstSpace + 1);
}

/**
 * Parte un bloque que excede `maxTokens` en sub-chunks que respeten el
 * techo. Estrategia:
 *
 * 1. Si el bloque es un fence, intentamos no partirlo — devolvemos el
 *    bloque entero aunque exceda. Romper código a la mitad es peor que
 *    un chunk grande.
 * 2. Si es texto, partimos por oraciones. Cada acumulado se va cerrando
 *    al alcanzar `targetTokens`.
 * 3. Si una sola oración sigue excediendo, partimos por palabras.
 */
async function splitOversized(
  block: Block,
  cfg: typeof KB_CHUNK_CONFIG,
  count: (text: string) => Promise<number>,
): Promise<string[]> {
  if (block.kind === 'fence') {
    // Decisión documentada: preferimos un chunk más grande a partir un
    // bloque de código por la mitad. Si esto se vuelve un problema en la
    // práctica (fences gigantes), agregamos lógica específica luego.
    return [block.text];
  }

  const sentences = block.text.split(SENTENCE_SPLIT).filter((s) => s.trim().length > 0);
  if (sentences.length <= 1) {
    // No pudimos partir por oraciones: caemos a partición por palabras.
    return splitByWords(block.text, cfg.maxTokens, count);
  }

  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  for (const sentence of sentences) {
    const sentenceTokens = await count(sentence);

    if (sentenceTokens > cfg.maxTokens) {
      // Esta oración sola excede el máximo (rarísimo: una "oración" sin
      // puntuación interna de >1000 tokens). Vaciamos buffer y partimos
      // por palabras.
      if (buf.length > 0) {
        out.push(buf.join(' '));
        buf = [];
        bufTokens = 0;
      }
      const wordPieces = await splitByWords(sentence, cfg.maxTokens, count);
      out.push(...wordPieces);
      continue;
    }

    if (bufTokens + sentenceTokens > cfg.maxTokens && buf.length > 0) {
      out.push(buf.join(' '));
      buf = [sentence];
      bufTokens = sentenceTokens;
      continue;
    }

    buf.push(sentence);
    bufTokens += sentenceTokens;

    if (bufTokens >= cfg.targetTokens) {
      out.push(buf.join(' '));
      buf = [];
      bufTokens = 0;
    }
  }

  if (buf.length > 0) {
    out.push(buf.join(' '));
  }
  return out;
}

async function splitByWords(
  text: string,
  maxTokens: number,
  count: (text: string) => Promise<number>,
): Promise<string[]> {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  const out: string[] = [];
  let buf: string[] = [];
  let bufTokens = 0;

  for (const word of words) {
    const wordTokens = await count(word);
    if (bufTokens + wordTokens > maxTokens && buf.length > 0) {
      out.push(buf.join(' '));
      buf = [word];
      bufTokens = wordTokens;
      continue;
    }
    buf.push(word);
    bufTokens += wordTokens;
  }
  if (buf.length > 0) {
    out.push(buf.join(' '));
  }
  return out;
}
