/**
 * Parámetros de chunking para `kb_documents`. Match con
 * `tikora-embeddings.md` §7.2. No los expongo a env porque cambiarlos
 * obliga a reindexar toda la KB y queremos un cambio explícito en código
 * (con runbook), no un toggle accidental por env var.
 */
export const KB_CHUNK_CONFIG = {
  /** Tamaño objetivo del chunk en tokens. */
  targetTokens: 600,
  /** Mínimo aceptable; por debajo, el chunk se mergea con el anterior. */
  minTokens: 200,
  /** Máximo absoluto antes de forzar el corte (incluso a media oración). */
  maxTokens: 1000,
  /** Solapamiento entre chunks consecutivos para no perder contexto. */
  overlapTokens: 100,
} as const;
