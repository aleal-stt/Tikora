import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type {
  Notification as NotificationResponse,
  NotificationEventType,
  NotificationListResponse,
} from '@tikora/core';
import { Model, QueryFilter, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Notification, NotificationDocument } from '../schemas/notification.schema';

interface ListParams {
  cursor?: string;
  limit: number;
  read?: boolean;
  type?: NotificationEventType;
}

interface CreateInput {
  tenantId: Types.ObjectId;
  recipientId: Types.ObjectId;
  type: NotificationEventType;
  ticketId: Types.ObjectId | null;
  payload: Record<string, unknown>;
}

const MAX_PAGE_SIZE = 100;

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notificationModel: Model<NotificationDocument>,
  ) {}

  /** Inserta una notificación. Lo invoca el listener de eventos. */
  async create(input: CreateInput): Promise<NotificationDocument> {
    return this.notificationModel.create({
      tenantId: input.tenantId,
      recipientId: input.recipientId,
      type: input.type,
      ticketId: input.ticketId,
      payload: input.payload,
      read: false,
      readAt: null,
    });
  }

  /**
   * Variante batch — útil cuando un evento tiene múltiples recipients
   * (`TicketClassified` notifica al solicitante + cada agente del área).
   */
  async createMany(inputs: CreateInput[]): Promise<NotificationDocument[]> {
    if (inputs.length === 0) return [];
    return this.notificationModel.insertMany(
      inputs.map((i) => ({
        tenantId: i.tenantId,
        recipientId: i.recipientId,
        type: i.type,
        ticketId: i.ticketId,
        payload: i.payload,
        read: false,
        readAt: null,
      })),
    ) as unknown as Promise<NotificationDocument[]>;
  }

  async listForCaller(
    caller: AuthenticatedUser,
    params: ListParams,
  ): Promise<NotificationListResponse> {
    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const filter: QueryFilter<NotificationDocument> = {
      tenantId: new Types.ObjectId(caller.tenantId),
      recipientId: new Types.ObjectId(caller.userId),
    };
    if (params.read !== undefined) filter.read = params.read;
    if (params.type) filter.type = params.type;
    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }

    const docs = await this.notificationModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];

    return {
      items: page.map((d) => this.toResponse(d)),
      nextCursor: hasMore && last ? this.encodeCursor(last._id) : null,
    };
  }

  async unreadCount(caller: AuthenticatedUser): Promise<number> {
    return this.notificationModel
      .countDocuments({
        tenantId: new Types.ObjectId(caller.tenantId),
        recipientId: new Types.ObjectId(caller.userId),
        read: false,
      })
      .exec();
  }

  async markRead(caller: AuthenticatedUser, id: string): Promise<NotificationResponse> {
    const objectId = this.toObjectId(id);
    const updated = await this.notificationModel
      .findOneAndUpdate(
        {
          _id: objectId,
          tenantId: new Types.ObjectId(caller.tenantId),
          recipientId: new Types.ObjectId(caller.userId),
        },
        { $set: { read: true, readAt: new Date() } },
        { new: true },
      )
      .exec();
    if (!updated) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOTIFICATION_NOT_FOUND',
        'No se encontró la notificación.',
      );
    }
    return this.toResponse(updated);
  }

  async markAllRead(caller: AuthenticatedUser): Promise<{ updated: number }> {
    const result = await this.notificationModel
      .updateMany(
        {
          tenantId: new Types.ObjectId(caller.tenantId),
          recipientId: new Types.ObjectId(caller.userId),
          read: false,
        },
        { $set: { read: true, readAt: new Date() } },
      )
      .exec();
    return { updated: result.modifiedCount };
  }

  // -------- helpers --------

  private toObjectId(id: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOTIFICATION_NOT_FOUND',
        'No se encontró la notificación.',
      );
    }
  }

  private encodeCursor(id: Types.ObjectId): string {
    return Buffer.from(id.toHexString()).toString('base64url');
  }

  private decodeCursor(cursor: string): Types.ObjectId {
    try {
      const hex = Buffer.from(cursor, 'base64url').toString('utf8');
      return new Types.ObjectId(hex);
    } catch {
      throw new ApiException(
        HttpStatus.BAD_REQUEST,
        'CURSOR_INVALID',
        'El cursor de paginación no es válido.',
      );
    }
  }

  private toResponse(doc: NotificationDocument): NotificationResponse {
    return {
      id: doc._id.toString(),
      recipientId: doc.recipientId.toString(),
      type: doc.type as NotificationEventType,
      ticketId: doc.ticketId ? doc.ticketId.toString() : null,
      payload: doc.payload ?? {},
      read: doc.read,
      readAt: doc.readAt ? doc.readAt.toISOString() : null,
      createdAt: doc.createdAt.toISOString(),
    };
  }
}
