import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { AreaMetricsQuery, AreaMetricsResponse, EstadoTicket, Prioridad } from '@tikora/core';
import { Model, Types } from 'mongoose';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';

const DEFAULT_RANGE_DAYS = 30;
const MS_PER_HOUR = 60 * 60 * 1000;

const ESTADO_KEYS: EstadoTicket[] = [
  'recibido',
  'clasificado',
  'requiere_revision_clasificacion',
  'escalado',
  'en_progreso',
  'cerrado',
  'reabierto',
  'cancelado',
];
const PRIORIDAD_KEYS: Prioridad[] = ['alta', 'media', 'baja'];

@Injectable()
export class MetricsService {
  constructor(
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
  ) {}

  async getAreaMetrics(
    caller: AuthenticatedUser,
    areaId: string,
    range: AreaMetricsQuery,
  ): Promise<AreaMetricsResponse> {
    const tenantId = new Types.ObjectId(caller.tenantId);
    const areaObjectId = this.toObjectId(areaId);
    const area = await this.areaModel.findOne({ _id: areaObjectId, tenantId }).exec();
    if (!area) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'AREA_NOT_FOUND', 'No se encontró el área.');
    }
    this.assertCanReadAreaMetrics(caller, area);

    const { from, to } = this.resolveRange(range);
    const baseMatch = {
      tenantId,
      areaId: areaObjectId,
      createdAt: { $gte: from, $lte: to },
    };

    // Tres aggregates en paralelo: totales/buckets, compliance SLA y promedio
    // de resolución. Cada uno tiene un $match estable que aprovecha los
    // índices `{tenantId, areaId, ...}` ya definidos en el schema.
    const [counts, slaCompliance, avgResolution] = await Promise.all([
      this.ticketModel.aggregate<{
        total: { count: number }[];
        byEstado: { _id: string; count: number }[];
        byPrioridad: { _id: string; count: number }[];
      }>([
        { $match: baseMatch },
        {
          $facet: {
            total: [{ $count: 'count' }],
            byEstado: [{ $group: { _id: '$estado', count: { $sum: 1 } } }],
            byPrioridad: [
              { $match: { prioridad: { $ne: null } } },
              { $group: { _id: '$prioridad', count: { $sum: 1 } } },
            ],
          },
        },
      ]),
      this.ticketModel.aggregate<{ total: number; compliant: number }>([
        {
          $match: {
            ...baseMatch,
            estado: 'cerrado',
            slaDeadline: { $ne: null },
            resolvedAt: { $ne: null },
          },
        },
        {
          $project: {
            compliant: {
              $cond: [{ $lte: ['$resolvedAt', '$slaDeadline'] }, 1, 0],
            },
          },
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            compliant: { $sum: '$compliant' },
          },
        },
      ]),
      this.ticketModel.aggregate<{ avg: number }>([
        {
          $match: {
            ...baseMatch,
            estado: 'cerrado',
            resolvedAt: { $ne: null },
          },
        },
        {
          $project: {
            hours: {
              $divide: [{ $subtract: ['$resolvedAt', '$createdAt'] }, MS_PER_HOUR],
            },
          },
        },
        { $group: { _id: null, avg: { $avg: '$hours' } } },
      ]),
    ]);

    const facet = counts[0] ?? { total: [], byEstado: [], byPrioridad: [] };
    const total = facet.total[0]?.count ?? 0;
    const byEstado = this.bucketize(facet.byEstado, ESTADO_KEYS);
    const byPrioridad = this.bucketize(facet.byPrioridad, PRIORIDAD_KEYS);

    const slaRow = slaCompliance[0];
    const sla = slaRow
      ? {
          complianceRate: slaRow.total > 0 ? slaRow.compliant / slaRow.total : null,
          breachedTotal: slaRow.total - slaRow.compliant,
        }
      : { complianceRate: null, breachedTotal: 0 };

    const avgHours = avgResolution[0]?.avg;

    return {
      areaId: area._id.toString(),
      rangeFrom: from.toISOString(),
      rangeTo: to.toISOString(),
      tickets: { total, byEstado, byPrioridad },
      sla,
      ai: {
        // Hasta que llegue el módulo IA con `classifications` y feedback,
        // estos valores quedan null — el cliente debe leerlo como "todavía
        // no medible", no como "0%".
        classificationAccuracy: null,
        autoResponseApprovalRate: null,
      },
      avgResolutionHours:
        typeof avgHours === 'number' && Number.isFinite(avgHours) ? avgHours : null,
    };
  }

  // -------- helpers --------

  private resolveRange(range: AreaMetricsQuery): { from: Date; to: Date } {
    const to = range.to ? new Date(range.to) : new Date();
    const from = range.from
      ? new Date(range.from)
      : new Date(to.getTime() - DEFAULT_RANGE_DAYS * 24 * 60 * 60 * 1000);
    return { from, to };
  }

  /**
   * Hidrata todas las claves del bucket con 0 cuando la agregación no las
   * devolvió. El front recibe siempre el shape completo.
   */
  private bucketize<K extends string>(
    rows: { _id: string; count: number }[],
    keys: readonly K[],
  ): Record<K, number> {
    const seed = Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;
    for (const row of rows) {
      if ((keys as readonly string[]).includes(row._id)) {
        seed[row._id as K] = row.count;
      }
    }
    return seed;
  }

  private assertCanReadAreaMetrics(caller: AuthenticatedUser, area: AreaDocument): void {
    if (caller.role === 'admin') return;
    if (caller.role === 'lider') {
      const leadsThis = area.leaderIds.some((id) => id.toString() === caller.userId);
      if (leadsThis) return;
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'AREA_METRICS_FORBIDDEN',
      'Solo podés ver métricas de áreas que liderás.',
    );
  }

  private toObjectId(id: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.NOT_FOUND, 'AREA_NOT_FOUND', 'No se encontró el área.');
    }
  }
}
