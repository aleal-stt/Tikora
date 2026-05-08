import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  ClassificationFeedback as ClassificationFeedbackDto,
  CreateClassificationFeedback,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import {
  Classification,
  ClassificationDocument,
} from '../../classification/schemas/classification.schema';
import { ApiException } from '../../common/exceptions/api.exception';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import {
  ClassificationFeedback,
  ClassificationFeedbackDocument,
} from '../schemas/classification-feedback.schema';

/**
 * Endpoints de feedback estructurado sobre la clasificación IA.
 *
 * Reglas (`tikora-data-model.md` §3.14, `tikora-api.md` §14):
 *
 * - Un único feedback por ticket — se sobreescribe si ya existía.
 * - Solo AGE/LID/ADM del área del ticket pueden enviarlo. La validación
 *   de área la hace el caller (`assertCanFeedback`).
 * - Si veredicto !== `correcta`, los campos correctivos son obligatorios
 *   (lo valida Zod). Acá rechazamos también si el área correctiva no
 *   existe en el tenant.
 * - El feedback **no** modifica la clasificación original (clasificaciones
 *   son inmutables) ni cambia el área del ticket — eso queda como decisión
 *   manual de un líder vía `PATCH /tickets/:id/area`. Solo persistimos.
 */
@Injectable()
export class FeedbackService {
  private readonly logger = new Logger(FeedbackService.name);

  constructor(
    @InjectModel(ClassificationFeedback.name)
    private readonly feedbackModel: Model<ClassificationFeedbackDocument>,
    @InjectModel(Ticket.name) private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Classification.name)
    private readonly classificationModel: Model<ClassificationDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
  ) {}

  async upsertForTicket(
    caller: AuthenticatedUser,
    ticketId: string,
    input: CreateClassificationFeedback,
  ): Promise<ClassificationFeedbackDto> {
    const tenantOid = new Types.ObjectId(caller.tenantId);
    const ticket = await this.findTicketOrFail(tenantOid, ticketId);
    this.assertCanFeedback(caller, ticket);

    // El ticket tiene que haber sido clasificado para que tenga sentido
    // dar feedback. Buscamos la clasificación más reciente del ticket.
    const classification = await this.classificationModel
      .findOne({ tenantId: tenantOid, ticketId: ticket._id })
      .sort({ createdAt: -1 })
      .exec();
    if (!classification) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'CLASSIFICATION_NOT_FOUND',
        'El ticket todavía no fue clasificado.',
      );
    }

    // Validar consistencia del área correctiva, si aplica.
    let areaCorrectaOid: Types.ObjectId | null = null;
    if (input.veredicto === 'area_incorrecta' || input.veredicto === 'ambas_incorrectas') {
      if (!input.areaCorrectaId) {
        // Defensa — Zod ya lo valida, pero mantenemos el invariante.
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'FEEDBACK_INVALID',
          'Indicá el área correcta cuando el veredicto marca el área como incorrecta.',
        );
      }
      const areaOid = this.toObjectId(input.areaCorrectaId, 'AREA_NOT_FOUND');
      const area = await this.areaModel
        .findOne({ _id: areaOid, tenantId: tenantOid, active: true })
        .exec();
      if (!area) {
        throw new ApiException(
          HttpStatus.BAD_REQUEST,
          'AREA_NOT_FOUND',
          'El área correctiva no existe o está inactiva.',
        );
      }
      areaCorrectaOid = area._id;
    }

    const prioridadCorrecta =
      input.veredicto === 'prioridad_incorrecta' || input.veredicto === 'ambas_incorrectas'
        ? input.prioridadCorrecta ?? null
        : null;

    const comentario = input.comentario?.trim() ? input.comentario.trim() : null;

    // Upsert: ya existía → sobrescribe; primera vez → crea. El índice
    // único `{tenantId, ticketId}` evita duplicados.
    const updated = await this.feedbackModel
      .findOneAndUpdate(
        { tenantId: tenantOid, ticketId: ticket._id },
        {
          $set: {
            tenantId: tenantOid,
            ticketId: ticket._id,
            classificationId: classification._id,
            authorId: new Types.ObjectId(caller.userId),
            veredicto: input.veredicto,
            areaCorrectaId: areaCorrectaOid,
            prioridadCorrecta,
            comentario,
          },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!updated) {
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'FEEDBACK_UPSERT_FAILED',
        'No pudimos guardar el feedback.',
      );
    }

    // Espejar el id en el ticket — el front lo usa para saber si ya hay
    // feedback sin tener que ejecutar el GET separado.
    if (
      !ticket.classificationFeedbackId ||
      ticket.classificationFeedbackId.toString() !== updated._id.toString()
    ) {
      ticket.classificationFeedbackId = updated._id;
      await ticket.save();
    }

    return this.toResponse(updated);
  }

  async getForTicket(
    caller: AuthenticatedUser,
    ticketId: string,
  ): Promise<ClassificationFeedbackDto | null> {
    const tenantOid = new Types.ObjectId(caller.tenantId);
    const ticket = await this.findTicketOrFail(tenantOid, ticketId);
    this.assertCanFeedback(caller, ticket);

    const fb = await this.feedbackModel
      .findOne({ tenantId: tenantOid, ticketId: ticket._id })
      .exec();
    return fb ? this.toResponse(fb) : null;
  }

  // -------- internos --------

  private toResponse(doc: ClassificationFeedbackDocument): ClassificationFeedbackDto {
    return {
      id: doc._id.toString(),
      ticketId: doc.ticketId.toString(),
      classificationId: doc.classificationId.toString(),
      authorId: doc.authorId.toString(),
      veredicto: doc.veredicto,
      areaCorrectaId: doc.areaCorrectaId?.toString() ?? null,
      prioridadCorrecta: doc.prioridadCorrecta,
      comentario: doc.comentario,
      createdAt: doc.createdAt.toISOString(),
    };
  }

  /**
   * Permite feedback al admin siempre, y a agentes/líderes solo de
   * tickets cuya área esté en `caller.areaIds`. Sin área asignada
   * (caso `requiere_revision_clasificacion`), el feedback es solo de
   * admins/líderes — un agente sin área no debería marcarlo.
   */
  private assertCanFeedback(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (caller.role === 'agente' || caller.role === 'lider') {
      if (!ticket.areaId) {
        if (caller.role === 'lider') return; // líder puede tocar tickets en revisión
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'FEEDBACK_FORBIDDEN',
          'El ticket todavía no tiene área asignada.',
        );
      }
      const areas = new Set(caller.areaIds);
      if (areas.has(ticket.areaId.toString())) return;
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'FEEDBACK_FORBIDDEN',
      'No tenés permisos para registrar feedback en este ticket.',
    );
  }

  private async findTicketOrFail(tenantId: Types.ObjectId, id: string): Promise<TicketDocument> {
    const oid = this.toObjectId(id, 'TICKET_NOT_FOUND');
    const t = await this.ticketModel.findOne({ _id: oid, tenantId }).exec();
    if (!t) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return t;
  }

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
    }
  }
}
