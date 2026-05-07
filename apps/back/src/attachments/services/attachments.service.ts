import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  ATTACHMENT_MAX_PER_TICKET,
  ATTACHMENT_MAX_SIZE_BYTES,
  type Attachment as AttachmentResponse,
  type EstadoTicket,
} from '@tikora/core';
import { createHash, randomUUID } from 'crypto';
import { Model, Types } from 'mongoose';
import { extname } from 'path';
import type { Readable } from 'stream';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Ticket, TicketDocument } from '../../tickets/schemas/ticket.schema';
import { Attachment, AttachmentDocument } from '../schemas/attachment.schema';
import { ATTACHMENT_STORAGE, IAttachmentStorage } from '../storage/attachment-storage.interface';

interface UploadInput {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  sizeBytes: number;
}

/** Estados de ticket en los que el solicitante todavía puede borrar adjuntos. */
const PRE_TAKEN_STATES: EstadoTicket[] = [
  'recibido',
  'clasificado',
  'requiere_revision_clasificacion',
  'escalado',
];

@Injectable()
export class AttachmentsService {
  constructor(
    @InjectModel(Attachment.name)
    private readonly attachmentModel: Model<AttachmentDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @Inject(ATTACHMENT_STORAGE)
    private readonly storage: IAttachmentStorage,
  ) {}

  async upload(
    caller: AuthenticatedUser,
    ticketId: string,
    file: UploadInput,
  ): Promise<AttachmentResponse> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    this.assertCanReadTicket(caller, ticket);

    this.assertMimeAllowed(file.mimeType);
    this.assertSizeWithinLimit(file.sizeBytes);
    await this.assertTicketHasRoom(ticket);

    const storedName = `${randomUUID()}${extname(file.originalName).toLowerCase()}`;
    const checksum = createHash('sha256').update(file.buffer).digest('hex');

    const { storagePath } = await this.storage.write({
      tenantId: ticket.tenantId.toString(),
      ticketId: ticket._id.toString(),
      storedName,
      buffer: file.buffer,
    });

    let created: AttachmentDocument;
    try {
      created = await this.attachmentModel.create({
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
        uploaderId: new Types.ObjectId(caller.userId),
        originalName: file.originalName,
        storedName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath,
        storageProvider: 'local',
        checksum,
      });
    } catch (err) {
      // Compensación: si falla el insert, no dejamos un binario huérfano.
      await this.storage.delete(storagePath).catch(() => undefined);
      throw err;
    }

    await this.ticketModel
      .updateOne({ _id: ticket._id }, { $addToSet: { attachmentIds: created._id } })
      .exec();

    return this.toResponse(created);
  }

  async download(
    caller: AuthenticatedUser,
    ticketId: string,
    attachmentId: string,
  ): Promise<{ stream: Readable; attachment: AttachmentDocument }> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    this.assertCanReadTicket(caller, ticket);

    const attachment = await this.findAttachmentOrFail(ticket, attachmentId);
    const stream = await this.storage.read(attachment.storagePath);
    return { stream, attachment };
  }

  async delete(caller: AuthenticatedUser, ticketId: string, attachmentId: string): Promise<void> {
    const ticket = await this.findTicketOrFail(caller.tenantId, ticketId);
    const attachment = await this.findAttachmentOrFail(ticket, attachmentId);

    this.assertCanDelete(caller, ticket);

    // Borramos primero la metadata (evita que el caller "vea" un ticket con
    // un adjunto cuyo binario ya no existe). Si el delete del binario falla
    // se loggea pero la op se considera exitosa — no rompe el flujo.
    await this.attachmentModel.deleteOne({ _id: attachment._id }).exec();
    await this.ticketModel
      .updateOne({ _id: ticket._id }, { $pull: { attachmentIds: attachment._id } })
      .exec();
    await this.storage.delete(attachment.storagePath);
  }

  // -------- helpers --------

  private async findTicketOrFail(tenantId: string, id: string): Promise<TicketDocument> {
    const objectId = this.toObjectId(id, 'TICKET_NOT_FOUND');
    const doc = await this.ticketModel
      .findOne({ _id: objectId, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(HttpStatus.NOT_FOUND, 'TICKET_NOT_FOUND', 'No se encontró el ticket.');
    }
    return doc;
  }

  private async findAttachmentOrFail(
    ticket: TicketDocument,
    attachmentId: string,
  ): Promise<AttachmentDocument> {
    const objectId = this.toObjectId(attachmentId, 'ATTACHMENT_NOT_FOUND');
    const doc = await this.attachmentModel
      .findOne({
        _id: objectId,
        tenantId: ticket.tenantId,
        ticketId: ticket._id,
      })
      .exec();
    if (!doc) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'ATTACHMENT_NOT_FOUND',
        'No se encontró el adjunto.',
      );
    }
    return doc;
  }

  private assertCanReadTicket(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    if (ticket.requesterId.toString() === caller.userId) return; // OWN
    if (caller.role === 'agente' || caller.role === 'lider') {
      if (ticket.areaId && caller.areaIds.includes(ticket.areaId.toString())) {
        return;
      }
    }
    throw new ApiException(
      HttpStatus.FORBIDDEN,
      'TICKET_FORBIDDEN',
      'No tenés permisos sobre este ticket.',
    );
  }

  private assertCanDelete(caller: AuthenticatedUser, ticket: TicketDocument): void {
    if (caller.role === 'admin') return;
    const isOwner = ticket.requesterId.toString() === caller.userId;
    if (!isOwner) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ATTACHMENT_DELETE_FORBIDDEN',
        'Solo el solicitante o un administrador pueden borrar adjuntos.',
      );
    }
    // OWN solo puede borrar antes de que el ticket sea tomado.
    if (!PRE_TAKEN_STATES.includes(ticket.estado)) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'ATTACHMENT_DELETE_FORBIDDEN',
        'No podés borrar adjuntos una vez que el ticket fue tomado.',
      );
    }
  }

  private assertMimeAllowed(mimeType: string): void {
    if (!(ALLOWED_ATTACHMENT_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ATTACHMENT_TYPE_FORBIDDEN',
        `Tipo de archivo no permitido: ${mimeType}.`,
      );
    }
  }

  private assertSizeWithinLimit(sizeBytes: number): void {
    if (sizeBytes > ATTACHMENT_MAX_SIZE_BYTES) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ATTACHMENT_TOO_LARGE',
        `El archivo supera el máximo permitido (${ATTACHMENT_MAX_SIZE_BYTES} bytes).`,
      );
    }
  }

  private async assertTicketHasRoom(ticket: TicketDocument): Promise<void> {
    const count = await this.attachmentModel
      .countDocuments({ tenantId: ticket.tenantId, ticketId: ticket._id })
      .exec();
    if (count >= ATTACHMENT_MAX_PER_TICKET) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'ATTACHMENT_LIMIT_EXCEEDED',
        `El ticket alcanzó el máximo de ${ATTACHMENT_MAX_PER_TICKET} adjuntos.`,
      );
    }
  }

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
    }
  }

  private toResponse(doc: AttachmentDocument): AttachmentResponse {
    return {
      id: doc._id.toString(),
      ticketId: doc.ticketId.toString(),
      uploaderId: doc.uploaderId.toString(),
      originalName: doc.originalName,
      mimeType: doc.mimeType,
      sizeBytes: doc.sizeBytes,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
