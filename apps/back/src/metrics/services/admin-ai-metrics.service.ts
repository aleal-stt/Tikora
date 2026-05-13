import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  AiCallOutcome,
  AiCallPurpose,
  AiMetricsByModelRow,
  AiMetricsByPurposeRow,
  AiMetricsQuery,
  AiMetricsResponse,
  AiMetricsTimelinePoint,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import { AiCallLog, AiCallLogDocument } from '../../ai-client/schemas/ai-call-log.schema';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { computeCostUsd, type TokenCounts } from '../ai-pricing';

const DEFAULT_RANGE_DAYS = 30;

const PURPOSE_KEYS: AiCallPurpose[] = ['classification', 'auto-response', 'review'];
const OUTCOME_KEYS: AiCallOutcome[] = ['ok', 'validation_failure', 'api_error'];

interface FacetTotalsRow {
  calls: number;
  tokensInput: number;
  tokensInputCached: number;
  tokensOutput: number;
  retries: number;
  avgLatencyMs: number | null;
  latencies: number[];
}

interface FacetByPurposeModelRow {
  _id: { purpose: AiCallPurpose; modelo: string };
  calls: number;
  tokensInput: number;
  tokensInputCached: number;
  tokensOutput: number;
  avgLatencyMs: number | null;
}

interface FacetByModelRow {
  _id: string;
  calls: number;
  tokensInput: number;
  tokensInputCached: number;
  tokensOutput: number;
}

interface FacetByOutcomeRow {
  _id: AiCallOutcome;
  calls: number;
}

interface FacetTimelineRow {
  _id: { date: string; modelo: string };
  calls: number;
  tokensInput: number;
  tokensInputCached: number;
  tokensOutput: number;
}

interface FacetResult {
  totals: FacetTotalsRow[];
  byPurposeModel: FacetByPurposeModelRow[];
  byModel: FacetByModelRow[];
  byOutcome: FacetByOutcomeRow[];
  timelineByModel: FacetTimelineRow[];
}

/**
 * Métricas agregadas de uso de IA por tenant. Lee de `ai_call_logs`
 * (append-only) y aplica la tabla de pricing del back para devolver el
 * costo en USD estimado. La autorización a rol `admin` la hace el
 * controller con `@Roles('admin')`.
 *
 * Estrategia de costo: para que el USD sea coherente en cualquier
 * dimensión (purpose / modelo / día), agrupamos siempre por **modelo** en
 * la agregación raw y aplicamos la tabla de pricing per-bucket. Después
 * doblamos por purpose o por día con sumas — el costo total no depende del
 * orden en que se sume.
 */
@Injectable()
export class AdminAiMetricsService {
  constructor(
    @InjectModel(AiCallLog.name)
    private readonly aiCallLogModel: Model<AiCallLogDocument>,
  ) {}

  async getTenantAiMetrics(
    caller: AuthenticatedUser,
    range: AiMetricsQuery,
  ): Promise<AiMetricsResponse> {
    const tenantId = new Types.ObjectId(caller.tenantId);
    const { from, to } = this.resolveRange(range);
    const baseMatch = { tenantId, createdAt: { $gte: from, $lte: to } };

    const aggResult = await this.aiCallLogModel.aggregate<FacetResult>([
      { $match: baseMatch },
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                calls: { $sum: 1 },
                tokensInput: { $sum: '$tokensInput' },
                tokensInputCached: { $sum: '$tokensInputCached' },
                tokensOutput: { $sum: '$tokensOutput' },
                retries: { $sum: '$retries' },
                avgLatencyMs: { $avg: '$latencyMs' },
                // Para p95 traemos el array de latencias y lo procesamos en
                // memoria — volumen manejable (cientos a miles por rango).
                // Si crece mucho, mover a $percentile (Mongo 7+).
                latencies: { $push: '$latencyMs' },
              },
            },
          ],
          byPurposeModel: [
            {
              $group: {
                _id: { purpose: '$purpose', modelo: '$modelo' },
                calls: { $sum: 1 },
                tokensInput: { $sum: '$tokensInput' },
                tokensInputCached: { $sum: '$tokensInputCached' },
                tokensOutput: { $sum: '$tokensOutput' },
                avgLatencyMs: { $avg: '$latencyMs' },
              },
            },
          ],
          byModel: [
            {
              $group: {
                _id: '$modelo',
                calls: { $sum: 1 },
                tokensInput: { $sum: '$tokensInput' },
                tokensInputCached: { $sum: '$tokensInputCached' },
                tokensOutput: { $sum: '$tokensOutput' },
              },
            },
            { $sort: { calls: -1 } },
          ],
          byOutcome: [{ $group: { _id: '$outcome', calls: { $sum: 1 } } }],
          timelineByModel: [
            {
              $group: {
                _id: {
                  date: {
                    $dateToString: {
                      format: '%Y-%m-%d',
                      date: '$createdAt',
                      timezone: 'UTC',
                    },
                  },
                  modelo: '$modelo',
                },
                calls: { $sum: 1 },
                tokensInput: { $sum: '$tokensInput' },
                tokensInputCached: { $sum: '$tokensInputCached' },
                tokensOutput: { $sum: '$tokensOutput' },
              },
            },
          ],
        },
      },
    ]);

    // `$facet` siempre devuelve un único documento, pero si la colección no
    // tiene matches Mongo igual responde con `[{ totals: [], ... }]`. Si por
    // alguna razón viene vacío (no debería), caemos a un facet vacío para
    // que `toResponse` devuelva ceros en todos los buckets.
    const facet: FacetResult = aggResult[0] ?? {
      totals: [],
      byPurposeModel: [],
      byModel: [],
      byOutcome: [],
      timelineByModel: [],
    };
    return this.toResponse(from, to, facet);
  }

  // -------- helpers --------

  private toResponse(from: Date, to: Date, facet: FacetResult): AiMetricsResponse {
    const byModel = this.buildByModel(facet.byModel);
    const byPurpose = this.buildByPurpose(facet.byPurposeModel);
    const byOutcome = this.buildByOutcome(facet.byOutcome);
    const timeline = this.buildTimeline(facet.timelineByModel);
    const totalCostUsd = byModel.reduce((acc, r) => acc + r.costUsd, 0);

    const totalsRow = facet.totals[0];
    const latencies = totalsRow?.latencies ?? [];

    return {
      rangeFrom: from.toISOString(),
      rangeTo: to.toISOString(),
      totals: {
        calls: totalsRow?.calls ?? 0,
        tokens: {
          input: totalsRow?.tokensInput ?? 0,
          inputCached: totalsRow?.tokensInputCached ?? 0,
          output: totalsRow?.tokensOutput ?? 0,
        },
        costUsd: totalCostUsd,
        latency: {
          avgMs: totalsRow?.avgLatencyMs ?? null,
          p95Ms: this.percentile(latencies, 95),
        },
        retries: totalsRow?.retries ?? 0,
      },
      byPurpose,
      byModel,
      byOutcome,
      timeline,
    };
  }

  private buildByModel(rows: FacetByModelRow[]): AiMetricsByModelRow[] {
    return rows.map((row) => {
      const tokens: TokenCounts = {
        input: row.tokensInput,
        inputCached: row.tokensInputCached,
        output: row.tokensOutput,
      };
      const { costUsd, pricingKnown } = computeCostUsd(row._id, tokens);
      return {
        modelo: row._id,
        calls: row.calls,
        tokens,
        costUsd,
        pricingKnown,
      };
    });
  }

  private buildByPurpose(rows: FacetByPurposeModelRow[]): AiMetricsByPurposeRow[] {
    // Para cada purpose, sumar tokens y costo de todos los modelos que lo
    // sirvieron en el rango. Hidratar los 3 purposes aunque algunos vengan
    // en cero — el front siempre recibe la misma forma.
    return PURPOSE_KEYS.map((purpose) => {
      const purposeRows = rows.filter((r) => r._id.purpose === purpose);
      if (purposeRows.length === 0) {
        return {
          purpose,
          calls: 0,
          tokens: { input: 0, inputCached: 0, output: 0 },
          costUsd: 0,
          latencyAvgMs: null,
        };
      }
      let calls = 0;
      let costUsd = 0;
      const tokens: TokenCounts = { input: 0, inputCached: 0, output: 0 };
      let weightedLatencySum = 0;
      let totalCallsForLatency = 0;
      for (const row of purposeRows) {
        calls += row.calls;
        tokens.input += row.tokensInput;
        tokens.inputCached += row.tokensInputCached;
        tokens.output += row.tokensOutput;
        costUsd += computeCostUsd(row._id.modelo, {
          input: row.tokensInput,
          inputCached: row.tokensInputCached,
          output: row.tokensOutput,
        }).costUsd;
        if (row.avgLatencyMs !== null && row.avgLatencyMs !== undefined) {
          weightedLatencySum += row.avgLatencyMs * row.calls;
          totalCallsForLatency += row.calls;
        }
      }
      return {
        purpose,
        calls,
        tokens,
        costUsd,
        latencyAvgMs: totalCallsForLatency > 0 ? weightedLatencySum / totalCallsForLatency : null,
      };
    });
  }

  private buildByOutcome(rows: FacetByOutcomeRow[]): Record<AiCallOutcome, number> {
    const seed = { ok: 0, validation_failure: 0, api_error: 0 } satisfies Record<
      AiCallOutcome,
      number
    >;
    for (const row of rows) {
      if (OUTCOME_KEYS.includes(row._id)) seed[row._id] = row.calls;
    }
    return seed;
  }

  private buildTimeline(rows: FacetTimelineRow[]): AiMetricsTimelinePoint[] {
    // Agrupar por día, sumando tokens y aplicando pricing por modelo en cada
    // sub-fila. El orden final es cronológico ascendente.
    const byDate = new Map<string, { calls: number; tokens: TokenCounts; costUsd: number }>();
    for (const row of rows) {
      const key = row._id.date;
      const tokens: TokenCounts = {
        input: row.tokensInput,
        inputCached: row.tokensInputCached,
        output: row.tokensOutput,
      };
      const { costUsd } = computeCostUsd(row._id.modelo, tokens);
      const acc = byDate.get(key) ?? {
        calls: 0,
        tokens: { input: 0, inputCached: 0, output: 0 },
        costUsd: 0,
      };
      acc.calls += row.calls;
      acc.tokens.input += tokens.input;
      acc.tokens.inputCached += tokens.inputCached;
      acc.tokens.output += tokens.output;
      acc.costUsd += costUsd;
      byDate.set(key, acc);
    }
    return Array.from(byDate.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({ date, ...v }));
  }

  private resolveRange(range: AiMetricsQuery): { from: Date; to: Date } {
    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from
      ? new Date(range.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  private percentile(values: number[], p: number): number | null {
    if (values.length === 0) return null;
    const sorted = [...values].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
    return sorted[Math.max(0, idx)] ?? null;
  }
}
