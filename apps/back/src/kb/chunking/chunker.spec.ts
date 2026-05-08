import { chunkMarkdown } from './chunker';
import { parseBlocks } from './parse-blocks';

/**
 * Heurística determinista para tests: 1 token ≈ 4 chars. Permite probar
 * el packer sin cargar el tokenizer real del modelo.
 */
const fakeCount = (text: string) => Math.ceil(text.length / 4);

describe('parseBlocks', () => {
  it('separa headings, párrafos y fences', () => {
    const md = `# Título\n\nPrimer párrafo de prueba.\n\n## Sección\n\nOtro párrafo.\n\n\`\`\`ts\nconst x = 1;\nconst y = 2;\n\`\`\`\n\nÚltimo párrafo.`;
    const blocks = parseBlocks(md);
    expect(blocks.map((b) => b.kind)).toEqual([
      'heading',
      'paragraph',
      'heading',
      'paragraph',
      'fence',
      'paragraph',
    ]);
  });

  it('mantiene un fence completo aun con líneas vacías adentro', () => {
    const md = '```\nlínea 1\n\nlínea 3\n```';
    const blocks = parseBlocks(md);
    expect(blocks).toHaveLength(1);
    const [fence] = blocks;
    expect(fence?.kind).toBe('fence');
    expect(fence?.text).toContain('línea 1');
    expect(fence?.text).toContain('línea 3');
  });

  it('descarta líneas vacías al final sin generar bloques fantasma', () => {
    const md = 'Solo un párrafo.\n\n\n\n';
    const blocks = parseBlocks(md);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.kind).toBe('paragraph');
  });
});

describe('chunkMarkdown', () => {
  it('devuelve un solo chunk para documento corto', async () => {
    const md = '# Título\n\nUn párrafo corto de prueba.';
    const chunks = await chunkMarkdown(md, { countTokens: fakeCount });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.position).toBe(0);
    expect(chunks[0]?.content).toContain('Un párrafo corto');
  });

  it('respeta maxTokens partiendo en varios chunks', async () => {
    // 10 párrafos de 800 chars (~200 tokens) — total ~2000 tokens.
    // Con max=600, target=400, debe haber al menos 3 chunks.
    const paragraphs = Array.from(
      { length: 10 },
      (_, i) => `Párrafo número ${i}: ` + 'palabra '.repeat(100),
    );
    const md = paragraphs.join('\n\n');
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 100, targetTokens: 400, maxTokens: 600, overlapTokens: 50 },
    });
    expect(chunks.length).toBeGreaterThanOrEqual(3);
    for (const c of chunks) {
      // Permitimos un margen pequeño porque el overlap se prepende
      // después de medir, así que el conteo final puede pasar el max
      // por unos pocos tokens.
      expect(c.tokensCount).toBeLessThanOrEqual(700);
    }
  });

  it('aplica overlap reusando el sufijo del chunk anterior', async () => {
    const md = Array.from(
      { length: 8 },
      (_, i) => `Frase distintiva número ${i}: ${'X'.repeat(200)}`,
    ).join('\n\n');
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 50, targetTokens: 200, maxTokens: 300, overlapTokens: 30 },
    });
    // Si hay >1 chunk, los chunks 1+ deben empezar con material del anterior.
    expect(chunks.length).toBeGreaterThan(1);
    for (let i = 1; i < chunks.length; i++) {
      const prev = chunks[i - 1];
      const curr = chunks[i];
      if (!prev || !curr) continue;
      const overlap = prev.content
        .slice(-30)
        .split(' ')
        .find((w) => w.length > 3);
      if (overlap) {
        expect(curr.content).toContain(overlap);
      }
    }
  });

  it('mergea el residuo final si queda por debajo de minTokens', async () => {
    // 3 párrafos: dos grandes y uno chico al final.
    const md = ['Primero ' + 'X'.repeat(800), 'Segundo ' + 'Y'.repeat(800), 'Cola corta.'].join(
      '\n\n',
    );
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 50, targetTokens: 150, maxTokens: 250, overlapTokens: 20 },
    });
    // El último chunk no debería ser solo "Cola corta." — debió mergearse.
    const last = chunks[chunks.length - 1];
    expect(last?.content).toContain('Cola corta');
    // Sanity: el chunk final tiene más tokens que el residuo mínimo.
    expect(last?.tokensCount).toBeGreaterThanOrEqual(50);
  });

  it('no parte un fence aunque exceda maxTokens', async () => {
    const fence = '```\n' + 'codigo '.repeat(400) + '\n```'; // ~700 tokens
    const md = `# Header\n\n${fence}\n\nOtro párrafo.`;
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 50, targetTokens: 200, maxTokens: 300, overlapTokens: 20 },
    });
    // El fence completo debe estar presente en algún chunk, sin partirse.
    const containsFenceOpen = chunks.some((c) => c.content.includes('```'));
    const fenceChars = (chunks.find((c) => c.content.includes('```'))?.content.match(/```/g) ?? [])
      .length;
    expect(containsFenceOpen).toBe(true);
    // Si está, deben aparecer los DOS marcadores (apertura y cierre).
    expect(fenceChars).toBeGreaterThanOrEqual(2);
  });

  it('empieza chunk nuevo en heading fuerte cuando ya alcanzó target', async () => {
    const md = [
      '# A',
      'X'.repeat(600), // ~150 tokens
      '## B',
      'Y'.repeat(600), // ~150 tokens
      '## C',
      'Z'.repeat(600), // ~150 tokens
    ].join('\n\n');
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 30, targetTokens: 150, maxTokens: 400, overlapTokens: 20 },
    });
    // Esperamos cortes en cada heading porque tras cada párrafo ya se
    // alcanza el target. Al menos 2 chunks (no necesariamente 3 por el
    // residuo del último que puede mergearse).
    expect(chunks.length).toBeGreaterThanOrEqual(2);
  });

  it('parte un párrafo gigante por oraciones', async () => {
    // Un solo párrafo con muchas oraciones cortas — total >> max.
    const oraciones = Array.from(
      { length: 50 },
      (_, i) => `Esta es la oración número ${i} que tiene contenido extra para alargarla.`,
    );
    const md = oraciones.join(' ');
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 30, targetTokens: 100, maxTokens: 200, overlapTokens: 10 },
    });
    expect(chunks.length).toBeGreaterThan(1);
    // Cada chunk no debería superar mucho el max.
    for (const c of chunks) {
      expect(c.tokensCount).toBeLessThanOrEqual(250);
    }
  });

  it('devuelve [] para input vacío', async () => {
    const chunks = await chunkMarkdown('', { countTokens: fakeCount });
    expect(chunks).toEqual([]);
  });

  it('positions son 0-based y consecutivos', async () => {
    const md = Array.from({ length: 6 }, (_, i) => `Párrafo ${i}: ` + 'X'.repeat(500)).join('\n\n');
    const chunks = await chunkMarkdown(md, {
      countTokens: fakeCount,
      config: { minTokens: 50, targetTokens: 200, maxTokens: 350, overlapTokens: 20 },
    });
    for (let i = 0; i < chunks.length; i++) {
      expect(chunks[i]?.position).toBe(i);
    }
  });
});
