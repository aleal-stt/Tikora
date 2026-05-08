import { HttpStatus } from '@nestjs/common';
import { Types } from 'mongoose';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { FeedbackService } from './feedback.service';

const TENANT = new Types.ObjectId();
const AREA = new Types.ObjectId();

function asAdmin(): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT.toString(),
    role: 'admin',
    areaIds: [],
  };
}

function asAgentOf(areaId: Types.ObjectId): AuthenticatedUser {
  return {
    userId: new Types.ObjectId().toString(),
    tenantId: TENANT.toString(),
    role: 'agente',
    areaIds: [areaId.toString()],
  };
}

function buildTicket(overrides: Partial<Record<string, unknown>> = {}) {
  const doc = {
    _id: new Types.ObjectId(),
    tenantId: TENANT,
    areaId: AREA as Types.ObjectId | null,
    classificationFeedbackId: null as Types.ObjectId | null,
    save: vi.fn(),
    ...overrides,
  };
  doc.save = vi.fn().mockResolvedValue(doc);
  return doc;
}

interface HarnessOpts {
  ticket?: ReturnType<typeof buildTicket> | null;
  classification?: { _id: Types.ObjectId } | null;
  existingFeedback?: { _id: Types.ObjectId } | null;
  areaExists?: boolean;
}

function buildHarness(opts: HarnessOpts = {}) {
  const ticketModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.ticket === undefined ? buildTicket() : opts.ticket),
    })),
  };

  const classificationModel = {
    findOne: vi.fn(() => ({
      sort: vi.fn().mockReturnThis(),
      exec: vi
        .fn()
        .mockResolvedValue(
          opts.classification === undefined ? { _id: new Types.ObjectId() } : opts.classification,
        ),
    })),
  };

  const areaModel = {
    findOne: vi.fn(() => ({
      exec: vi
        .fn()
        .mockResolvedValue(opts.areaExists === false ? null : { _id: new Types.ObjectId() }),
    })),
  };

  const feedbackModel = {
    findOne: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue(opts.existingFeedback ?? null),
    })),
    findOneAndUpdate: vi.fn(() => ({
      exec: vi.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        tenantId: TENANT,
        ticketId: opts.ticket?._id ?? new Types.ObjectId(),
        classificationId: opts.classification?._id ?? new Types.ObjectId(),
        authorId: new Types.ObjectId(),
        veredicto: 'correcta',
        areaCorrectaId: null,
        prioridadCorrecta: null,
        comentario: null,
        createdAt: new Date('2026-05-08T12:00:00Z'),
      }),
    })),
  };

  const service = new FeedbackService(
    feedbackModel as never,
    ticketModel as never,
    classificationModel as never,
    areaModel as never,
  );
  return { service, ticketModel, feedbackModel, areaModel };
}

describe('FeedbackService', () => {
  describe('upsertForTicket', () => {
    it('admin puede dejar feedback "correcta" y se persiste el id en el ticket', async () => {
      const ticket = buildTicket();
      const { service, feedbackModel, ticketModel: _ticketModel } = buildHarness({ ticket });
      void _ticketModel;
      const result = await service.upsertForTicket(asAdmin(), ticket._id.toString(), {
        veredicto: 'correcta',
      });
      expect(result.veredicto).toBe('correcta');
      expect(feedbackModel.findOneAndUpdate).toHaveBeenCalled();
      expect(ticket.save).toHaveBeenCalled();
      expect(ticket.classificationFeedbackId).not.toBeNull();
    });

    it('rechaza area_incorrecta sin areaCorrectaId', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ticket });
      const err = await service
        .upsertForTicket(asAdmin(), ticket._id.toString(), {
          veredicto: 'area_incorrecta',
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('rechaza si el área correctiva no existe', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ticket, areaExists: false });
      const err = await service
        .upsertForTicket(asAdmin(), ticket._id.toString(), {
          veredicto: 'area_incorrecta',
          areaCorrectaId: new Types.ObjectId().toString(),
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.BAD_REQUEST);
    });

    it('rechaza si el ticket no fue clasificado', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ticket, classification: null });
      const err = await service
        .upsertForTicket(asAdmin(), ticket._id.toString(), { veredicto: 'correcta' })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.CONFLICT);
    });

    it('AGE de otra área recibe 403', async () => {
      const ticket = buildTicket({ areaId: AREA });
      const { service } = buildHarness({ ticket });
      const err = await service
        .upsertForTicket(asAgentOf(new Types.ObjectId()), ticket._id.toString(), {
          veredicto: 'correcta',
        })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ApiException);
      expect((err as ApiException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    });
  });

  describe('getForTicket', () => {
    it('devuelve null cuando no hay feedback', async () => {
      const ticket = buildTicket();
      const { service } = buildHarness({ ticket, existingFeedback: null });
      const result = await service.getForTicket(asAdmin(), ticket._id.toString());
      expect(result).toBeNull();
    });
  });
});
