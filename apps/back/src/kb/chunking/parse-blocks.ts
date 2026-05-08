/**
 * Parser estructural muy ligero para Markdown. Devuelve los "bloques"
 * naturales del documento (encabezados, fences de código y párrafos) en
 * orden. No interpreta el contenido — solo lo segmenta para que el
 * packer pueda combinar/cortar respetando límites semánticos.
 *
 * Ver `tikora-embeddings.md` §7.3.
 */

export type BlockKind = 'heading' | 'fence' | 'paragraph';

export interface Block {
  kind: BlockKind;
  text: string;
  /**
   * Fuerza con que este bloque sugiere cortar el chunk antes de él.
   * - `strong`: encabezados, fences. Cortar siempre que el chunk actual
   *   tenga al menos `targetTokens`.
   * - `medium`: párrafos. Cortar si el siguiente bloque haría exceder
   *   `maxTokens`.
   */
  breakStrength: 'strong' | 'medium';
}

const FENCE_LINE = /^```/;
const HEADING_LINE = /^#{1,6}\s/;

/**
 * Devuelve los bloques en orden. Garantías:
 *
 * - Un fence (línea ```...``` con su contenido y el cierre) **no se parte**:
 *   queda como un único bloque, incluso si supera `maxTokens` (el packer
 *   se encarga del overflow vía `splitOversized`).
 * - Encabezados Markdown (`#`, `##`, `###`...) son bloques de break fuerte
 *   — el packer prefiere cerrar el chunk antes de ellos.
 * - Párrafos se separan por **líneas vacías**. Listas y citas se tratan
 *   como un párrafo continuo (no las descomponemos por item porque eso
 *   ahoga el contexto).
 */
export function parseBlocks(content: string): Block[] {
  const lines = content.split(/\r?\n/);
  const blocks: Block[] = [];

  let i = 0;
  let paragraphBuf: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuf.length === 0) return;
    const text = paragraphBuf.join('\n').trim();
    paragraphBuf = [];
    if (text.length === 0) return;
    blocks.push({ kind: 'paragraph', text, breakStrength: 'medium' });
  };

  while (i < lines.length) {
    const raw = lines[i] ?? '';
    const line = raw;

    // Apertura de fence: capturamos hasta el cierre como un solo bloque.
    if (FENCE_LINE.test(line.trimStart())) {
      flushParagraph();
      const fenceLines: string[] = [line];
      i++;
      while (i < lines.length) {
        const inner = lines[i] ?? '';
        fenceLines.push(inner);
        if (FENCE_LINE.test(inner.trimStart())) {
          i++;
          break;
        }
        i++;
      }
      blocks.push({
        kind: 'fence',
        text: fenceLines.join('\n'),
        breakStrength: 'strong',
      });
      continue;
    }

    // Encabezado: bloque propio de break fuerte.
    if (HEADING_LINE.test(line)) {
      flushParagraph();
      blocks.push({
        kind: 'heading',
        text: line.trim(),
        breakStrength: 'strong',
      });
      i++;
      continue;
    }

    // Línea vacía: cierra el párrafo en curso.
    if (line.trim() === '') {
      flushParagraph();
      i++;
      continue;
    }

    paragraphBuf.push(line);
    i++;
  }

  flushParagraph();
  return blocks;
}
