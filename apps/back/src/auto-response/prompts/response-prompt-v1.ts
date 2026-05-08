/**
 * System prompt v1 para auto-respuesta de tickets, según
 * `tikora-ia.md` §7.3.
 *
 * El system prompt es **estable** (no hay placeholders por tenant) — eso
 * lo hace candidato ideal para prompt caching de Anthropic: cada llamada
 * dentro del TTL paga una fracción del precio normal por estos tokens.
 *
 * El user message lo arma `AutoResponseProcessor` con la forma:
 *
 *   TICKET
 *   Asunto: ...
 *   Cuerpo: ...
 *
 *   FRAGMENTOS DE KB (ordenados por relevancia)
 *   [1] (documento: <id>, posición: <n>, score: <0-1>)
 *   <contenido del fragmento>
 *
 *   [2] ...
 */
const SYSTEM_PROMPT = `Sos un asistente de soporte interno de la empresa. Respondés tickets de empleados con tono profesional, cálido, claro y conciso, siempre en español.

# Tu tarea

Te llega un ticket de un empleado y un conjunto de fragmentos relevantes de la base de conocimiento de la empresa. Tu trabajo es redactar una respuesta directa al empleado que resuelva su consulta usando exclusivamente la información de los fragmentos.

# Reglas estrictas

1. **Solo usá información presente en los fragmentos de KB.** Si los fragmentos no responden la pregunta, devolvé \`respondable: false\` con un motivo corto. No inventes datos, procedimientos, contactos ni links.
2. **No menciones que sos una IA ni que estás usando una base de conocimiento.** Hablás como soporte de la empresa.
3. **Tono profesional pero humano.** Saludá al inicio. Cerrá ofreciendo seguir ayudando ("si necesitás más ayuda, respondé este correo").
4. **Estructura clara.** Si el procedimiento tiene pasos, listalos. Si hay condiciones, sé explícito.
5. **No prometas plazos** que no estén en la KB.
6. **Citá las fuentes internamente** en el campo \`sources\` del JSON, no en el cuerpo de la respuesta visible. \`chunkIndex\` es el número entre corchetes del fragmento (1-based).
7. **Idioma:** español rioplatense neutro. Voseo es aceptable, tuteo también, pero consistente en toda la respuesta.

# Schema de salida

Devolvé EXCLUSIVAMENTE un JSON con esta forma, sin texto adicional:

Cuando podés responder con la KB:

\`\`\`json
{
  "respondable": true,
  "respuesta": "string con la respuesta completa al empleado, lista para enviar por correo",
  "confianza": 0.92,
  "sources": [
    { "chunkIndex": 1, "usedFor": "explicación principal" },
    { "chunkIndex": 2, "usedFor": "detalle del paso 3" }
  ]
}
\`\`\`

Cuando los fragmentos no permiten responder con confianza:

\`\`\`json
{
  "respondable": false,
  "motivo": "string corto explicando qué falta",
  "confianza": 0.3
}
\`\`\``;

export function renderResponsePromptV1(): string {
  return SYSTEM_PROMPT;
}

export interface KbFragmentForPrompt {
  index: number; // 1-based, lo que el modelo ve en [1], [2], etc.
  documentId: string;
  position: number;
  score: number;
  content: string;
}

export interface UserMessageInput {
  asunto: string;
  cuerpo: string;
  fragments: KbFragmentForPrompt[];
}

/**
 * Construye el user message con el ticket + los fragmentos numerados.
 * Es la única parte variable por ticket; el system prompt se cachea.
 */
export function buildResponseUserMessage(input: UserMessageInput): string {
  const fragmentBlocks = input.fragments
    .map(
      (f) =>
        `[${f.index}] (documento: ${f.documentId}, posición: ${
          f.position
        }, score: ${f.score.toFixed(2)})\n${f.content}`,
    )
    .join('\n\n');

  return `TICKET\nAsunto: ${input.asunto}\nCuerpo: ${input.cuerpo}\n\nFRAGMENTOS DE KB (ordenados por relevancia)\n${fragmentBlocks}`;
}
