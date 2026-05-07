import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { MetricsService } from './metrics.service';

const TENANT_ID = new Types.ObjectId();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT_ID.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function asLeader(userId: Types.ObjectId, areaId: string): AuthenticatedUser {
  return {
    userId: userId.toString(),
    tenantId: TENANT_ID.toString(),
    role: 'lider',
    areaIds: [areaId],
  };
}

interface FakeArea {
  _id: Types.ObjectId;
  tenantId: Types.ObjectId;
  leaderIds: Types.ObjectId[];
}

function buildHarness(opts: {
  area?: FakeArea | null;
  countsResult?: unknown;
  slaResult?: unknown;
  avgResult?: unknown;
}) {
  const ticketModel = {
    aggregate: vi
      .fn<(args: unknown[]) => Promise<unknown>>()
      .mockResolvedValueOnce(opts.countsResult ?? [])
      .mockResolvedValueOnce(opts.slaResult ?? [])
      .mockResolvedValueOnce(opts.avgResult ?? []),
  };
  const areaModel = {
    findOne: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(opts.area ?? null) })),
  };
  const service = new MetricsService(ticketModel as never, areaModel as never);
  return { service, ticketModel, areaModel };
}

describe('MetricsService.getAreaMetrics', () => {
  it('admin recibe totales, SLA, avg y ai en null', async () => {
    const areaId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [],
    };
    const { service } = buildHarness({
      area,
      countsResult: [
        {
          total: [{ count: 245 }],
          byEstado: [
            { _id: 'recibido', count: 3 },
            { _id: 'escalado', count: 12 },
            { _id: 'en_progreso', count: 18 },
            { _id: 'cerrado', count: 210 },
            { _id: 'cancelado', count: 2 },
          ],
          byPrioridad: [
            { _id: 'alta', count: 30 },
            { _id: 'media', count: 110 },
            { _id: 'baja', count: 105 },
          ],
        },
      ],
      slaResult: [{ total: 200, compliant: 180 }],
      avgResult: [{ avg: 6.25 }],
    });

    const result = await service.getAreaMetrics(asAdmin(), areaId.toString(), {});

    expect(result.tickets.total).toBe(245);
    expect(result.tickets.byEstado.recibido).toBe(3);
    expect(result.tickets.byEstado.cerrado).toBe(210);
    expect(result.tickets.byEstado.reabierto).toBe(0);
    expect(result.tickets.byPrioridad.alta).toBe(30);
    expect(result.sla.complianceRate).toBeCloseTo(0.9);
    expect(result.sla.breachedTotal).toBe(20);
    expect(result.avgResolutionHours).toBeCloseTo(6.25);
    expect(result.ai.classificationAccuracy).toBeNull();
    expect(result.ai.autoResponseApprovalRate).toBeNull();
  });

  it('LID que no lidera el área recibe AREA_METRICS_FORBIDDEN', async () => {
    const areaId = new Types.ObjectId();
    const otherLeaderId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [otherLeaderId],
    };
    const { service } = buildHarness({ area });

    const caller = asLeader(new Types.ObjectId(), areaId.toString());
    try {
      await service.getAreaMetrics(caller, areaId.toString(), {});
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_METRICS_FORBIDDEN',
      });
    }
  });

  it('LID que lidera el área puede ver las métricas', async () => {
    const areaId = new Types.ObjectId();
    const leaderId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [leaderId],
    };
    const { service } = buildHarness({ area });

    const result = await service.getAreaMetrics(
      asLeader(leaderId, areaId.toString()),
      areaId.toString(),
      {},
    );
    expect(result.tickets.total).toBe(0);
  });

  it('área inexistente devuelve AREA_NOT_FOUND', async () => {
    const { service } = buildHarness({ area: null });

    try {
      await service.getAreaMetrics(asAdmin(), new Types.ObjectId().toString(), {});
      throw new Error('debería haber lanzado');
    } catch (err) {
      expect((err as ApiException).getStatus()).toBe(HttpStatus.NOT_FOUND);
      expect((err as ApiException).getResponse()).toMatchObject({
        code: 'AREA_NOT_FOUND',
      });
    }
  });

  it('sin tickets cerrados con SLA, complianceRate es null', async () => {
    const areaId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [],
    };
    const { service } = buildHarness({
      area,
      countsResult: [{ total: [], byEstado: [], byPrioridad: [] }],
      slaResult: [],
      avgResult: [],
    });

    const result = await service.getAreaMetrics(asAdmin(), areaId.toString(), {});
    expect(result.sla.complianceRate).toBeNull();
    expect(result.sla.breachedTotal).toBe(0);
    expect(result.avgResolutionHours).toBeNull();
  });

  it('hidrata todas las claves de byEstado y byPrioridad con 0 cuando no hay datos', async () => {
    const areaId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [],
    };
    const { service } = buildHarness({
      area,
      countsResult: [{ total: [], byEstado: [], byPrioridad: [] }],
      slaResult: [],
      avgResult: [],
    });

    const result = await service.getAreaMetrics(asAdmin(), areaId.toString(), {});
    expect(result.tickets.total).toBe(0);
    expect(Object.values(result.tickets.byEstado).every((v) => v === 0)).toBe(true);
    expect(Object.values(result.tickets.byPrioridad).every((v) => v === 0)).toBe(true);
  });

  it('aplica el rango cuando from/to vienen en la query', async () => {
    const areaId = new Types.ObjectId();
    const area: FakeArea = {
      _id: areaId,
      tenantId: TENANT_ID,
      leaderIds: [],
    };
    const { service } = buildHarness({ area });

    const result = await service.getAreaMetrics(asAdmin(), areaId.toString(), {
      from: '2026-04-01T00:00:00.000Z',
      to: '2026-05-01T00:00:00.000Z',
    });
    expect(result.rangeFrom).toBe('2026-04-01T00:00:00.000Z');
    expect(result.rangeTo).toBe('2026-05-01T00:00:00.000Z');
  });
});
