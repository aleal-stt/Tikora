/**
 * Tabla de pricing por modelo LLM — USD por 1M tokens.
 *
 * El costo que devolvemos en `/admin/ai-metrics` es una **estimación** sobre
 * estos valores; no refleja descuentos por free-tier, créditos negociados ni
 * el precio real facturado. Se documenta así en el front (badge "estimado").
 *
 * Mantener actualizada cuando se cambien modelos en `LLM_MODEL_*`. Si un
 * modelo no está acá, el cálculo devuelve 0 USD y `pricingKnown=false` para
 * que la UI muestre el tag de "sin pricing".
 *
 * Fuentes (snapshots al cutoff, sujetas a cambio del provider):
 * - Gemini: https://ai.google.dev/pricing
 * - Anthropic: https://www.anthropic.com/pricing
 */

export interface ModelPricing {
  /** USD por 1M tokens de input (sin cachear). */
  inputUsdPer1M: number;
  /** USD por 1M tokens de input servidos desde cache. */
  cachedInputUsdPer1M: number;
  /** USD por 1M tokens de output. */
  outputUsdPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Gemini — endpoint OpenAI-compat (free tier hasta cierta cuota; este es el
  // precio de tier pago para referencia).
  'gemini-2.5-flash-lite': {
    inputUsdPer1M: 0.1,
    cachedInputUsdPer1M: 0.025,
    outputUsdPer1M: 0.4,
  },
  'gemini-2.5-flash': {
    inputUsdPer1M: 0.3,
    cachedInputUsdPer1M: 0.075,
    outputUsdPer1M: 2.5,
  },

  // Anthropic — pricing oficial de tier pago.
  'claude-haiku-4-5': {
    inputUsdPer1M: 1.0,
    cachedInputUsdPer1M: 0.1,
    outputUsdPer1M: 5.0,
  },
  'claude-sonnet-4-6': {
    inputUsdPer1M: 3.0,
    cachedInputUsdPer1M: 0.3,
    outputUsdPer1M: 15.0,
  },
  'claude-opus-4-7': {
    inputUsdPer1M: 15.0,
    cachedInputUsdPer1M: 1.5,
    outputUsdPer1M: 75.0,
  },
};

export interface TokenCounts {
  input: number;
  inputCached: number;
  output: number;
}

export interface CostBreakdown {
  costUsd: number;
  pricingKnown: boolean;
}

/**
 * Calcula el costo en USD para un conjunto de tokens contra un modelo dado.
 * Si el modelo no está en la tabla, devuelve 0 con `pricingKnown=false`.
 */
export function computeCostUsd(modelo: string, tokens: TokenCounts): CostBreakdown {
  const pricing = PRICING[modelo];
  if (!pricing) {
    return { costUsd: 0, pricingKnown: false };
  }
  const costUsd =
    (tokens.input * pricing.inputUsdPer1M +
      tokens.inputCached * pricing.cachedInputUsdPer1M +
      tokens.output * pricing.outputUsdPer1M) /
    1_000_000;
  return { costUsd, pricingKnown: true };
}

/** Listado de modelos con pricing definido — útil para tests y UI futura. */
export function knownPricedModels(): string[] {
  return Object.keys(PRICING);
}
