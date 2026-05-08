import { HttpStatus, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import type {
  CreateKbDocument,
  KbDocument as KbDocumentResponse,
  KbDocumentListItem,
  KbDocumentListResponse,
  UpdateKbDocument,
} from '@tikora/core';
import { Model, Types } from 'mongoose';
import type { AuthenticatedUser } from '../../auth/types/auth.types';
import { ApiException } from '../../common/exceptions/api.exception';
import { Area, AreaDocument } from '../../areas/schemas/area.schema';
import {
  KB_DOCUMENT_EVENTS,
  KbDocumentCreatedEvent,
  KbDocumentDeletedEvent,
  KbDocumentUpdatedEvent,
} from '../events/kb-document-events';
import { KbChunk, KbChunkDocument } from '../schemas/kb-chunk.schema';
import { KbDocument, KbDocumentDocument } from '../schemas/kb-document.schema';
import { KbIndexingQueueService } from './kb-indexing-queue.service';

interface ListParams {
  cursor?: string;
  limit: number;
  scope?: 'global' | 'area';
  areaId?: string[];
}

const MAX_PAGE_SIZE = 100;

/**
 * Servicio CRUD del módulo `kb`. Reglas de visibilidad y mutación:
 *
 * - **Lectura**: LID ve documentos globales + los de áreas que lidera.
 *   ADM ve todo del tenant. Los soft-deleted están excluidos por defecto.
 * - **Creación**: LID solo `scope:'area'` con áreas que lidera. ADM
 *   cualquier scope.
 * - **Edición**: misma regla que creación, además el documento debe ser
 *   visible para el caller.
 * - **Borrado**: misma regla que edición. Es soft delete — todas las
 *   versiones del documento lógico (`parentDocumentId`) quedan inactivas.
 * - **Activar versión**: solo ADM (rollback manual).
 *
 * Match con `tikora-api.md` §9.
 */
@Injectable()
export class KbService {
  constructor(
    @InjectModel(KbDocument.name)
    private readonly documentModel: Model<KbDocumentDocument>,
    @InjectModel(KbChunk.name) private readonly chunkModel: Model<KbChunkDocument>,
    @InjectModel(Area.name) private readonly areaModel: Model<AreaDocument>,
    private readonly indexingQueue: KbIndexingQueueService,
    private readonly events: EventEmitter2,
  ) {}

  // -------- API pública --------

  async listForCaller(
    caller: AuthenticatedUser,
    params: ListParams,
  ): Promise<KbDocumentListResponse> {
    this.assertReaderRole(caller);
    const limit = Math.min(Math.max(params.limit, 1), MAX_PAGE_SIZE);
    const tenantOid = new Types.ObjectId(caller.tenantId);
    const filter: Record<string, unknown> = {
      tenantId: tenantOid,
      active: true,
      deletedAt: null,
    };

    if (params.scope) {
      filter.scope = params.scope;
    }

    if (caller.role === 'lider') {
      // LID: globales + áreas que lidera. Si pide un filtro `areaId`, lo
      // intersectamos con sus áreas para no permitir leer áreas ajenas.
      const myAreas = caller.areaIds.map((id) => new Types.ObjectId(id));
      const requestedAreas = params.areaId
        ?.map((id) => new Types.ObjectId(id))
        .filter((oid) => caller.areaIds.includes(oid.toString()));
      const allowedAreas = requestedAreas ?? myAreas;
      filter.$or = [{ scope: 'global' }, { scope: 'area', areaIds: { $in: allowedAreas } }];
    } else if (params.areaId && params.areaId.length > 0) {
      filter.areaIds = { $in: params.areaId.map((id) => new Types.ObjectId(id)) };
    }

    if (params.cursor) {
      filter._id = { $lt: this.decodeCursor(params.cursor) };
    }

    const docs = await this.documentModel
      .find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .exec();
    const hasMore = docs.length > limit;
    const page = docs.slice(0, limit);
    const last = page[page.length - 1];
    const nextCursor = hasMore && last ? this.encodeCursor(last._id) : null;

    return {
      items: page.map((d) => this.toListItem(d)),
      nextCursor,
    };
  }

  async getByIdForCaller(caller: AuthenticatedUser, id: string): Promise<KbDocumentResponse> {
    this.assertReaderRole(caller);
    const doc = await this.findOrFail(caller.tenantId, id);
    this.assertCanRead(caller, doc);
    return this.toResponse(doc);
  }

  async create(caller: AuthenticatedUser, dto: CreateKbDocument): Promise<KbDocumentResponse> {
    this.assertWriterRole(caller);
    if (dto.scope === 'global' && caller.role !== 'admin') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_GLOBAL_REQUIRES_ADMIN',
        'Solo un administrador puede crear documentos globales.',
      );
    }
    if (dto.scope === 'area') {
      await this.assertAreasExistAndAllowedForCaller(caller, dto.areaIds);
    }

    const tenantOid = new Types.ObjectId(caller.tenantId);
    const callerOid = new Types.ObjectId(caller.userId);

    // Insertamos primero el doc para obtener su _id, después lo seteamos
    // como `parentDocumentId` (la v1 es padre de sí misma). Insert seguido
    // de update — no transaccional pero idempotente: si el job de
    // indexación corre antes, lee el doc con `parentDocumentId` ya seteado
    // (si no, reintenta).
    const inserted = await this.documentModel.create({
      tenantId: tenantOid,
      title: dto.title,
      content: dto.content,
      scope: dto.scope,
      areaIds: dto.areaIds.map((id) => new Types.ObjectId(id)),
      version: 1,
      active: false,
      uploadedBy: callerOid,
      parentDocumentId: new Types.ObjectId(), // placeholder, se actualiza al instante
      deletedAt: null,
    });
    inserted.parentDocumentId = inserted._id as Types.ObjectId;
    await inserted.save();

    await this.indexingQueue.enqueue({
      tenantId: caller.tenantId,
      documentId: inserted._id.toString(),
      parentDocumentId: inserted._id.toString(),
      version: 1,
    });

    this.events.emit(KB_DOCUMENT_EVENTS.KbDocumentCreated, {
      tenantId: caller.tenantId,
      documentId: inserted._id.toString(),
      parentDocumentId: inserted._id.toString(),
      version: 1,
      scope: dto.scope,
      uploadedBy: caller.userId,
    } satisfies KbDocumentCreatedEvent);

    return this.toResponse(inserted);
  }

  async update(
    caller: AuthenticatedUser,
    id: string,
    dto: UpdateKbDocument,
  ): Promise<KbDocumentResponse> {
    this.assertWriterRole(caller);
    const current = await this.findOrFail(caller.tenantId, id);
    this.assertCanEdit(caller, current);

    if (current.scope === 'area') {
      // El UpdateKbDocument no permite cambiar scope, pero sí editar
      // areaIds — validamos que las nuevas también estén permitidas.
      const newAreaIds = dto.areaIds ?? current.areaIds.map((a) => a.toString());
      await this.assertAreasExistAndAllowedForCaller(caller, newAreaIds);
    } else if (dto.areaIds && dto.areaIds.length > 0) {
      // Documento global: prohibido enviarle areaIds.
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'KB_GLOBAL_HAS_NO_AREAS',
        'Un documento global no puede tener áreas asignadas.',
      );
    }

    // Crear nueva versión con `active:false`. El processor hará el swap
    // al terminar de embeber.
    const nextVersion = current.version + 1;
    const tenantOid = new Types.ObjectId(caller.tenantId);
    const newDoc = await this.documentModel.create({
      tenantId: tenantOid,
      title: dto.title,
      content: dto.content,
      scope: current.scope,
      areaIds: (dto.areaIds ?? current.areaIds.map((a) => a.toString())).map(
        (s) => new Types.ObjectId(s),
      ),
      version: nextVersion,
      active: false,
      uploadedBy: new Types.ObjectId(caller.userId),
      parentDocumentId: current.parentDocumentId,
      deletedAt: null,
    });

    await this.indexingQueue.enqueue({
      tenantId: caller.tenantId,
      documentId: newDoc._id.toString(),
      parentDocumentId: current.parentDocumentId.toString(),
      version: nextVersion,
    });

    this.events.emit(KB_DOCUMENT_EVENTS.KbDocumentUpdated, {
      tenantId: caller.tenantId,
      documentId: newDoc._id.toString(),
      parentDocumentId: current.parentDocumentId.toString(),
      version: nextVersion,
      uploadedBy: caller.userId,
    } satisfies KbDocumentUpdatedEvent);

    return this.toResponse(newDoc);
  }

  async softDelete(caller: AuthenticatedUser, id: string): Promise<void> {
    this.assertWriterRole(caller);
    const doc = await this.findOrFail(caller.tenantId, id);
    this.assertCanEdit(caller, doc);

    const tenantOid = new Types.ObjectId(caller.tenantId);
    const now = new Date();

    await this.documentModel
      .updateMany(
        {
          tenantId: tenantOid,
          parentDocumentId: doc.parentDocumentId,
          deletedAt: null,
        },
        { $set: { active: false, deletedAt: now } },
      )
      .exec();

    await this.chunkModel
      .updateMany(
        { tenantId: tenantOid, parentDocumentId: doc.parentDocumentId },
        { $set: { active: false } },
      )
      .exec();

    this.events.emit(KB_DOCUMENT_EVENTS.KbDocumentDeleted, {
      tenantId: caller.tenantId,
      documentId: doc._id.toString(),
      parentDocumentId: doc.parentDocumentId.toString(),
      deletedBy: caller.userId,
    } satisfies KbDocumentDeletedEvent);
  }

  async listVersionsForCaller(
    caller: AuthenticatedUser,
    id: string,
  ): Promise<KbDocumentListItem[]> {
    this.assertReaderRole(caller);
    const doc = await this.findOrFail(caller.tenantId, id);
    this.assertCanRead(caller, doc);

    const versions = await this.documentModel
      .find({
        tenantId: new Types.ObjectId(caller.tenantId),
        parentDocumentId: doc.parentDocumentId,
      })
      .sort({ version: -1 })
      .exec();

    return versions.map((d) => this.toListItem(d));
  }

  async activateVersion(
    caller: AuthenticatedUser,
    id: string,
    version: number,
  ): Promise<KbDocumentResponse> {
    if (caller.role !== 'admin') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_ROLLBACK_REQUIRES_ADMIN',
        'Solo un administrador puede activar una versión anterior.',
      );
    }
    const doc = await this.findOrFail(caller.tenantId, id);
    if (doc.deletedAt) {
      throw new ApiException(
        HttpStatus.CONFLICT,
        'KB_DOCUMENT_DELETED',
        'El documento está borrado y no se puede activar una versión.',
      );
    }

    const target = await this.documentModel
      .findOne({
        tenantId: new Types.ObjectId(caller.tenantId),
        parentDocumentId: doc.parentDocumentId,
        version,
      })
      .exec();

    if (!target) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'KB_VERSION_NOT_FOUND',
        `No existe la versión ${version} de este documento.`,
      );
    }

    const tenantOid = new Types.ObjectId(caller.tenantId);

    // Misma estrategia que `KbIndexerService.swapActiveVersion`: primero
    // desactivamos las demás, después activamos la elegida.
    await this.documentModel
      .updateMany(
        {
          tenantId: tenantOid,
          parentDocumentId: doc.parentDocumentId,
          _id: { $ne: target._id },
        },
        { $set: { active: false } },
      )
      .exec();
    await this.chunkModel
      .updateMany(
        {
          tenantId: tenantOid,
          parentDocumentId: doc.parentDocumentId,
          documentId: { $ne: target._id },
        },
        { $set: { active: false } },
      )
      .exec();
    await this.documentModel
      .updateOne({ _id: target._id, tenantId: tenantOid }, { $set: { active: true } })
      .exec();
    await this.chunkModel
      .updateMany({ tenantId: tenantOid, documentId: target._id }, { $set: { active: true } })
      .exec();

    const refreshed = await this.documentModel.findById(target._id).exec();
    if (!refreshed) {
      // No debería ocurrir: acabamos de leer el doc en el mismo request.
      // Si la lectura post-update falla, propagamos un error genérico
      // antes que devolver un response inconsistente.
      throw new ApiException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        'KB_REFRESH_FAILED',
        'No se pudo releer el documento tras activar la versión.',
      );
    }
    return this.toResponse(refreshed);
  }

  // -------- helpers --------

  private async findOrFail(tenantId: string, id: string): Promise<KbDocumentDocument> {
    const oid = this.toObjectId(id, 'KB_DOCUMENT_ID_INVALID');
    const doc = await this.documentModel
      .findOne({ _id: oid, tenantId: new Types.ObjectId(tenantId) })
      .exec();
    if (!doc) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'KB_DOCUMENT_NOT_FOUND',
        'Documento no encontrado.',
      );
    }
    return doc;
  }

  private assertReaderRole(caller: AuthenticatedUser): void {
    if (caller.role !== 'lider' && caller.role !== 'admin') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_FORBIDDEN',
        'No tenés permisos para acceder a la base de conocimiento.',
      );
    }
  }

  private assertWriterRole(caller: AuthenticatedUser): void {
    this.assertReaderRole(caller);
  }

  private assertCanRead(caller: AuthenticatedUser, doc: KbDocumentDocument): void {
    if (doc.deletedAt) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'KB_DOCUMENT_NOT_FOUND',
        'Documento no encontrado.',
      );
    }
    if (caller.role === 'admin') return;
    if (doc.scope === 'global') return;
    const callerAreas = new Set(caller.areaIds);
    const intersect = doc.areaIds.some((a) => callerAreas.has(a.toString()));
    if (!intersect) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_FORBIDDEN',
        'No tenés acceso a este documento.',
      );
    }
  }

  private assertCanEdit(caller: AuthenticatedUser, doc: KbDocumentDocument): void {
    if (doc.deletedAt) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'KB_DOCUMENT_NOT_FOUND',
        'Documento no encontrado.',
      );
    }
    if (caller.role === 'admin') return;
    // LID: solo puede editar documentos `scope:'area'` cuyas áreas estén
    // entre las que lidera. Documentos globales son siempre solo-ADM.
    if (doc.scope === 'global') {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_GLOBAL_REQUIRES_ADMIN',
        'Solo un administrador puede modificar documentos globales.',
      );
    }
    const callerAreas = new Set(caller.areaIds);
    const allowed = doc.areaIds.every((a) => callerAreas.has(a.toString()));
    if (!allowed) {
      throw new ApiException(
        HttpStatus.FORBIDDEN,
        'KB_FORBIDDEN',
        'No tenés permisos para editar este documento.',
      );
    }
  }

  private async assertAreasExistAndAllowedForCaller(
    caller: AuthenticatedUser,
    areaIds: string[],
  ): Promise<void> {
    if (areaIds.length === 0) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'KB_AREA_REQUIRED',
        'Documentos con scope área requieren al menos un área.',
      );
    }

    const oids = areaIds.map((id) => this.toObjectId(id, 'KB_AREA_ID_INVALID'));
    const found = await this.areaModel
      .find({
        _id: { $in: oids },
        tenantId: new Types.ObjectId(caller.tenantId),
        active: true,
      })
      .select('_id')
      .lean()
      .exec();

    if (found.length !== oids.length) {
      throw new ApiException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'KB_AREA_NOT_FOUND',
        'Una o más áreas indicadas no existen o están inactivas.',
      );
    }

    if (caller.role === 'lider') {
      const callerAreas = new Set(caller.areaIds);
      const allowed = areaIds.every((id) => callerAreas.has(id));
      if (!allowed) {
        throw new ApiException(
          HttpStatus.FORBIDDEN,
          'KB_FORBIDDEN',
          'Solo podés crear/editar documentos en áreas que liderás.',
        );
      }
    }
  }

  private toObjectId(id: string, errorCode: string): Types.ObjectId {
    try {
      return new Types.ObjectId(id);
    } catch {
      throw new ApiException(HttpStatus.BAD_REQUEST, errorCode, 'ID inválido.');
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

  private toResponse(doc: KbDocumentDocument): KbDocumentResponse {
    return {
      id: doc._id.toString(),
      parentDocumentId: doc.parentDocumentId.toString(),
      title: doc.title,
      content: doc.content,
      scope: doc.scope,
      areaIds: doc.areaIds.map((a) => a.toString()),
      version: doc.version,
      active: doc.active,
      uploadedBy: doc.uploadedBy.toString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }

  private toListItem(doc: KbDocumentDocument): KbDocumentListItem {
    return {
      id: doc._id.toString(),
      parentDocumentId: doc.parentDocumentId.toString(),
      title: doc.title,
      scope: doc.scope,
      areaIds: doc.areaIds.map((a) => a.toString()),
      version: doc.version,
      active: doc.active,
      uploadedBy: doc.uploadedBy.toString(),
      createdAt: doc.createdAt.toISOString(),
      updatedAt: doc.updatedAt.toISOString(),
    };
  }
}
