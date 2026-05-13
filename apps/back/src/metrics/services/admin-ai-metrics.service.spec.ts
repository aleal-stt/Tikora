import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { AdminAiMetricsService } from './admin-ai-metrics.service';

const TENANT_ID = new Types.ObjectId();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function buildHarness(facet: unknown) {
  const aiCallLogModel = {
    aggregate: vi.fn().mockResolvedValue(facet === undefined ? [] : [facet]),
  };
  const service = new AdminAiMetricsService(aiCallLogModel as never);
  return { service, aiCallLogModel };
}

describe('AdminAiMetricsService', () => {
  it('devuelve ceros y los 3 purposes hidratados cuando no hay llamadas en el rango', async () => {
    const { service } = buildHarness({
      totals: [],
      byPurposeModel: [],
      byModel: [],
      byOutcome: [],
      timelineByModel: [],
    });

    const res = await service.getTenantAiMetrics(asAdmin(), {});

    expect(res.totals).toEqual({
      calls: 0,
      tokens: { input: 0, inputCached: 0, output: 0 },
      costUsd: 0,
      latency: { avgMs: null, p95Ms: null },
      retries: 0,
    });
    expect(res.byPurpose).toHaveLength(3);
    expect(res.byPurpose.map((p) => p.purpose)).toEqual([
      'classification',
      'auto-response',
      'review',
    ]);
    for (const row of res.byPurpose) {
      expect(row.calls).toBe(0);
      expect(row.costUsd).toBe(0);
      expect(row.latencyAvgMs).toBeNull();
    }
    expect(res.byModel).toEqual([]);
    expect(res.byOutcome).toEqual({ ok: 0, validation_failure: 0, api_error: 0 });
    expect(res.timeline).toEqual([]);
  });

  it('calcula costo USD por modelo y suma totals coherente con byModel', async () => {
    const { service } = buildHarness({
      totals: [
        {
          calls: 3,
          tokensInput: 11_000,
          tokensInputCached: 0,
          tokensOutput: 1_500,
          retries: 0,
          avgLatencyMs: 500,
          latencies: [400, 500, 600],
        },
      ],
      byPurposeModel: [
        {
          _id: { purpose: 'classification', modelo: 'gemini-2.5-flash-lite' },
          calls: 2,
          tokensInput: 1_000,
          tokensInputCached: 0,
          tokensOutput: 500,
          avgLatencyMs: 500,
        },
        {
          _id: { purpose: 'auto-response', modelo: 'gemini-2.5-flash-lite' },
          calls: 1,
          tokensInput: 10_000,
          tokensInputCached: 0,
          tokensOutput: 1_000,
          avgLatencyMs: 500,
        },
      ],
      byModel: [
        {
          _id: 'gemini-2.5-flash-lite',
          calls: 3,
          tokensInput: 11_000,
          tokensInputCached: 0,
          tokensOutput: 1_500,
        },
      ],
      byOutcome: [{ _id: 'ok', calls: 3 }],
      timelineByModel: [],
    });

    const res = await service.getTenantAiMetrics(asAdmin(), {});

    // 11_000 input * 0.10/1M + 1_500 output * 0.40/1M = 0.0011 + 0.0006 = 0.0017
    expect(res.byModel).toHaveLength(1);
    expect(res.byModel[0]?.pricingKnown).toBe(true);
    expect(res.byModel[0]?.costUsd).toBeCloseTo(0.0017, 6);
    expect(res.totals.costUsd).toBeCloseTo(0.0017, 6);
    // Suma de byPurpose = total
    const sumPurpose = res.byPurpose.reduce((a, r) => a + r.costUsd, 0);
    expect(sumPurpose).toBeCloseTo(res.totals.costUsd, 6);
    expect(res.totals.latency.avgMs).toBe(500);
    expect(res.totals.latency.p95Ms).toBe(600);
    expect(res.byOutcome.ok).toBe(3);
  });

  it('marca pricingKnown=false para modelos sin tabla de precios', async () => {
    const { service } = buildHarness({
      totals: [
        {
          calls: 1,
          tokensInput: 1_000,
          tokensInputCached: 0,
          tokensOutput: 100,
          retries: 0,
          avgLatencyMs: 250,
          latencies: [250],
        },
      ],
      byPurposeModel: [
        {
          _id: { purpose: 'classification', modelo: 'modelo-fantasma' },
          calls: 1,
          tokensInput: 1_000,
          tokensInputCached: 0,
          tokensOutput: 100,
          avgLatencyMs: 250,
        },
      ],
      byModel: [
        {
          _id: 'modelo-fantasma',
          calls: 1,
          tokensInput: 1_000,
          tokensInputCached: 0,
          tokensOutput: 100,
        },
      ],
      byOutcome: [{ _id: 'ok', calls: 1 }],
      timelineByModel: [],
    });

    const res = await service.getTenantAiMetrics(asAdmin(), {});

    expect(res.byModel[0]?.pricingKnown).toBe(false);
    expect(res.byModel[0]?.costUsd).toBe(0);
    expect(res.totals.costUsd).toBe(0);
  });

  it('arma timeline ordenado cronológico con costo por día sumando modelos', async () => {
    const { service } = buildHarness({
      totals: [],
      byPurposeModel: [],
      byModel: [],
      byOutcome: [],
      timelineByModel: [
        {
          _id: { date: '2026-05-10', modelo: 'gemini-2.5-flash-lite' },
          calls: 1,
          tokensInput: 1_000,
          tokensInputCached: 0,
          tokensOutput: 0,
        },
        {
          _id: { date: '2026-05-09', modelo: 'gemini-2.5-flash-lite' },
          calls: 2,
          tokensInput: 2_000,
          tokensInputCached: 0,
          tokensOutput: 0,
        },
        {
          _id: { date: '2026-05-10', modelo: 'modelo-fantasma' },
          calls: 1,
          tokensInput: 500,
          tokensInputCached: 0,
          tokensOutput: 0,
        },
      ],
    });

    const res = await service.getTenantAiMetrics(asAdmin(), {});

    expect(res.timeline.map((t) => t.date)).toEqual(['2026-05-09', '2026-05-10']);
    // Día 2026-05-09: 2_000 * 0.10/1M = 0.0002
    expect(res.timeline[0]?.costUsd).toBeCloseTo(0.0002, 6);
    expect(res.timeline[0]?.calls).toBe(2);
    // Día 2026-05-10: 1_000 * 0.10/1M (lite) + 0 (fantasma sin pricing) = 0.0001
    expect(res.timeline[1]?.costUsd).toBeCloseTo(0.0001, 6);
    expect(res.timeline[1]?.calls).toBe(2);
    expect(res.timeline[1]?.tokens.input).toBe(1_500);
  });
});
