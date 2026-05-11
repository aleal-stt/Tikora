import { Types } from 'mongoose';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SlaCheckerService } from './sla-checker.service';

const TENANT = new Types.ObjectId();
const AREA = new Types.ObjectId();

function buildTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new Types.ObjectId(),
    tenantId: TENANT,
    areaId: AREA,
    assignedAgentId: null as Types.ObjectId | null,
    estado: 'escalado' as 'escalado' | 'en_progreso' | 'cerrado',
    prioridad: 'alta' as 'alta' | 'media' | 'baja',
    slaDeadline: new Date('2026-05-08T15:00:00Z'),
    slaApproachingNotifiedAt: null as Date | null,
    slaBreachNotifiedAt: null as Date | null,
    closedDefinitivelyAt: null as Date | null,
    resolvedAt: null as Date | null,
    ...overrides,
  };
}

interface HarnessOpts {
  // Tickets que `find().limit().exec()` devuelve para approaching.
  approachingCandidates?: ReturnType<typeof buildTicket>[];
  // Idem breach.
  breachCandidates?: ReturnType<typeof buildTicket>[];
  // Idem auto-close por tenant.
  closeCandidates?: ReturnType<typeof buildTicket>[];
  // Si findOneAndUpdate devuelve null se simula que otro ejecutor ganó la carrera.
  findOneAndUpdateLoses?: boolean;
  areaSlas?: { alta: number; media: number; baja: number };
  areaLeaders?: Types.ObjectId[];
  tenantSettings?: { slaAutoCloseDays: number };
  thresholdPercent?: number;
}

function buildHarness(opts: HarnessOpts = {}) {
  const ticketModel = {
    find: vi.fn((query: Record<string, unknown>) => ({
      limit: vi.fn().mockReturnThis(),
      exec: vi.fn().mockImplementation(async () => {
        if (query.estado && (query.estado as { $in: string[] }).$in?.includes('escalado')) {
          if (query.slaApproachingNotifiedAt === null) {
            return opts.approachingCandidates ?? [];
          }
          if (query.slaBreachNotifiedAt === null) {
            return opts.breachCandidates ?? [];
          }
        }
        if (query.estado === 'cerrado') {
          return opts.closeCandidates ?? [];
        }
        return [];
      }),
    })),
    findOneAndUpdate: vi
      .fn()
      .mockImplementation(async () =>
        opts.findOneAndUpdateLoses ? null : { _id: new Types.ObjectId() },
      ),
  };

  const areaModel = {
    findOne: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue({
        slas: opts.areaSlas ?? { alta: 4, media: 24, baja: 48 },
        leaderIds: opts.areaLeaders ?? [],
      }),
    })),
  };

  const tenantModel = {
    find: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue([
        {
          _id: TENANT,
          settings: { slaAutoCloseDays: opts.tenantSettings?.slaAutoCloseDays ?? 15 },
        },
      ]),
    })),
  };

  const config = {
    get: vi.fn((key: string) => {
      switch (key) {
        case 'SLA_BATCH_SIZE':
          return 200;
        case 'SLA_APPROACHING_THRESHOLD_PERCENT':
          return opts.thresholdPercent ?? 0.25;
        default:
          return undefined;
      }
    }),
  };

  const events = { emit: vi.fn() };

  // Stub de BusinessHoursService — devuelve opts BA constantes para
  // cualquier tenant. Los tests existentes usan tiempos dentro del
  // horario hábil BA (viernes 11:30 hora local), así que el cálculo
  // en horas hábiles coincide con el wallclock para esos casos.
  const businessHours = {
    getOptsForTenant: vi.fn().mockResolvedValue({
      timezone: 'America/Argentina/Buenos_Aires',
      dayStart: { hour: 7, minute: 0 },
      dayEnd: { hour: 18, minute: 0 },
    }),
    optsFromSettings: vi.fn().mockReturnValue({
      timezone: 'America/Argentina/Buenos_Aires',
      dayStart: { hour: 7, minute: 0 },
      dayEnd: { hour: 18, minute: 0 },
    }),
  };

  const service = new SlaCheckerService(
    ticketModel as never,
    areaModel as never,
    tenantModel as never,
    config as never,
    events as never,
    businessHours as never,
  );

  return { service, ticketModel, areaModel, tenantModel, events };
}

describe('SlaCheckerService', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  describe('approaching', () => {
    it('emite SlaApproaching cuando queda ≤ 25% del SLA total y marca el flag', async () => {
      // Prioridad alta = 4h SLA. Now a 30 min del deadline = 12.5% restante.
      const now = new Date('2026-05-08T14:30:00Z');
      const ticket = buildTicket({
        slaDeadline: new Date('2026-05-08T15:00:00Z'),
        prioridad: 'alta',
      });
      const { service, events, ticketModel } = buildHarness({
        approachingCandidates: [ticket],
      });

      const result = await service.tick(now);

      expect(result.approachingEmitted).toBe(1);
      expect(ticketModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ slaApproachingNotifiedAt: null }),
        expect.objectContaining({ $set: { slaApproachingNotifiedAt: now } }),
        expect.anything(),
      );
      const emit = events.emit.mock.calls.find((c) => c[0] === 'SlaApproaching');
      expect(emit).toBeDefined();
      expect(emit?.[1]).toMatchObject({
        ticketId: ticket._id.toString(),
        prioridad: 'alta',
        remainingMinutes: 30,
      });
    });

    it('no emite si remainingMs/totalMs > threshold', async () => {
      // 3h restantes de un SLA de 4h = 75% restante. Lejos del umbral.
      const now = new Date('2026-05-08T12:00:00Z');
      const ticket = buildTicket({
        slaDeadline: new Date('2026-05-08T15:00:00Z'),
        prioridad: 'alta',
      });
      const { service, events } = buildHarness({ approachingCandidates: [ticket] });

      const result = await service.tick(now);
      expect(result.approachingEmitted).toBe(0);
      expect(events.emit).not.toHaveBeenCalledWith('SlaApproaching', expect.anything());
    });

    it('no emite si findOneAndUpdate pierde la carrera (otro tick ya marcó el flag)', async () => {
      const now = new Date('2026-05-08T14:55:00Z');
      const ticket = buildTicket({
        slaDeadline: new Date('2026-05-08T15:00:00Z'),
        prioridad: 'alta',
      });
      const { service, events } = buildHarness({
        approachingCandidates: [ticket],
        findOneAndUpdateLoses: true,
      });

      const result = await service.tick(now);
      expect(result.approachingEmitted).toBe(0);
      const slaEmits = events.emit.mock.calls.filter((c) => c[0] === 'SlaApproaching');
      expect(slaEmits).toHaveLength(0);
    });
  });

  describe('breach', () => {
    it('emite SlaBreach con leaderIds del área cuando deadline ya pasó', async () => {
      const now = new Date('2026-05-08T16:00:00Z');
      const leader = new Types.ObjectId();
      const ticket = buildTicket({
        slaDeadline: new Date('2026-05-08T15:00:00Z'),
        prioridad: 'media',
      });
      const { service, events } = buildHarness({
        breachCandidates: [ticket],
        areaLeaders: [leader],
      });

      const result = await service.tick(now);

      expect(result.breachEmitted).toBe(1);
      const emit = events.emit.mock.calls.find((c) => c[0] === 'SlaBreach');
      expect(emit?.[1]).toMatchObject({
        leaderIds: [leader.toString()],
        overdueMinutes: 60,
      });
    });
  });

  describe('auto-close', () => {
    it('marca closedDefinitivelyAt y emite TicketClosedDefinitively cuando resolvedAt es más viejo que slaAutoCloseDays', async () => {
      const now = new Date('2026-05-08T12:00:00Z');
      // 16 días atrás > 15 de gracia.
      const resolvedAt = new Date('2026-04-22T12:00:00Z');
      const ticket = buildTicket({
        estado: 'cerrado',
        resolvedAt,
        slaDeadline: null,
      });
      const { service, events, ticketModel } = buildHarness({
        closeCandidates: [ticket],
        tenantSettings: { slaAutoCloseDays: 15 },
      });

      const result = await service.tick(now);

      expect(result.definitivelyClosed).toBe(1);
      expect(ticketModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ closedDefinitivelyAt: null }),
        expect.objectContaining({ $set: { closedDefinitivelyAt: now } }),
        expect.anything(),
      );
      const emit = events.emit.mock.calls.find((c) => c[0] === 'TicketClosedDefinitively');
      expect(emit?.[1]).toMatchObject({
        ticketId: ticket._id.toString(),
        cerradoOriginalmenteAt: resolvedAt.toISOString(),
      });
    });

    it('no toca tickets cerrados dentro de la gracia', async () => {
      const now = new Date('2026-05-08T12:00:00Z');
      const { service, events } = buildHarness({
        closeCandidates: [], // la query ya filtra por cutoff; simulamos el filtro de Mongo.
        tenantSettings: { slaAutoCloseDays: 15 },
      });

      const result = await service.tick(now);
      expect(result.definitivelyClosed).toBe(0);
      expect(events.emit).not.toHaveBeenCalledWith('TicketClosedDefinitively', expect.anything());
    });
  });
});
