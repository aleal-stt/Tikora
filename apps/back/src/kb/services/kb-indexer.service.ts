import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { chunkMarkdown } from '../chunking/chunker';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../embeddings/embedding-provider';
import { KB_DOCUMENT_EVENTS, KbDocumentReindexedEvent } from '../events/kb-document-events';
import { KbChunk, KbChunkDocument } from '../schemas/kb-chunk.schema';
import { KbDocument, KbDocumentDocument } from '../schemas/kb-document.schema';

/**
 * Servicio puro de indexación. Encapsula la pipeline:
 *
 *   1. Cargar el `KbDocument`.
 *   2. Chunkearlo respetando límites semánticos (`chunker.ts`).
 *   3. Generar embeddings de cada chunk (`EmbeddingProvider`).
 *   4. Persistir los `KbChunk` con `active:false`.
 *   5. Hacer el swap atómico: nueva versión + sus chunks → `active:true`,
 *      versión anterior + sus chunks → `active:false`.
 *
 * Idempotencia: el índice único `{tenantId, documentId, position}` impide
 * duplicar chunks si el job se reintenta. Antes de persistir borramos los
 * chunks de la misma `documentId` (defensa para reintentos en los que el
 * primer intento falló a mitad de inserción).
 *
 * Ver `tikora-embeddings.md` §6.1 y §12.2.
 */
@Injectable()
export class KbIndexerService {
  private readonly logger = new Logger(KbIndexerService.name);

  constructor(
    @InjectModel(KbDocument.name)
    private readonly documentModel: Model<KbDocumentDocument>,
    @InjectModel(KbChunk.name) private readonly chunkModel: Model<KbChunkDocument>,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly events: EventEmitter2,
  ) {}

  async indexDocumentVersion(params: {
    tenantId: string;
    documentId: string;
    parentDocumentId: string;
    version: number;
  }): Promise<{ chunksCreated: number }> {
    const tenantOid = new Types.ObjectId(params.tenantId);
    const docOid = new Types.ObjectId(params.documentId);
    const parentOid = new Types.ObjectId(params.parentDocumentId);

    const doc = await this.documentModel.findOne({ _id: docOid, tenantId: tenantOid }).exec();
    if (!doc) {
      this.logger.warn(
        `indexDocumentVersion: documento ${params.documentId} no encontrado para tenant ${params.tenantId} — skip.`,
      );
      return { chunksCreated: 0 };
    }
    if (doc.version !== params.version) {
      // Job stale: alguien promovió otra versión mientras este job esperaba
      // en cola. Mejor abortar que sobrescribir.
      this.logger.warn(
        `indexDocumentVersion: versión esperada ${params.version} pero el doc tiene ${doc.version} — skip.`,
      );
      return { chunksCreated: 0 };
    }
    if (doc.deletedAt) {
      this.logger.warn(
        `indexDocumentVersion: documento ${params.documentId} fue soft-deleted — skip.`,
      );
      return { chunksCreated: 0 };
    }

    // Asegurar que el modelo está cargado antes de empezar (cold start).
    await this.embeddings.init();

    const start = Date.now();
    const chunkPieces = await chunkMarkdown(doc.content, {
      countTokens: (t) => this.embeddings.countTokens(t),
    });

    if (chunkPieces.length === 0) {
      // Documento vacío o solo whitespace tras parsing. Activamos el doc
      // igual (no rompemos el ciclo) y emitimos el evento — el módulo
      // simplemente no contribuye chunks al índice.
      await this.swapActiveVersion({
        tenantId: tenantOid,
        parentDocumentId: parentOid,
        newDocumentId: docOid,
      });
      this.emitReindexed(params, 0, Date.now() - start);
      return { chunksCreated: 0 };
    }

    // Embeber en lote — el provider ya parte por su propio batch interno.
    const vectors = await this.embeddings.embedPassages(chunkPieces.map((p) => p.content));
    if (vectors.length !== chunkPieces.length) {
      throw new Error(
        `EmbeddingProvider devolvió ${vectors.length} vectores para ${chunkPieces.length} chunks`,
      );
    }

    // Borramos cualquier chunk pre-existente de esta versión específica
    // (defensa para reintento parcial). No tocamos chunks de otras
    // versiones — ese es el job del swap.
    await this.chunkModel.deleteMany({ tenantId: tenantOid, documentId: docOid }).exec();

    const docs = chunkPieces.map((piece, i) => {
      const embedding = vectors[i];
      if (!embedding) {
        // Ya validamos `vectors.length === chunkPieces.length` arriba; esto
        // es defensa estática para satisfacer al compilador y al lint.
        throw new Error(`Embedding faltante para chunk position=${piece.position}`);
      }
      return {
        tenantId: tenantOid,
        documentId: docOid,
        parentDocumentId: parentOid,
        documentVersion: doc.version,
        position: piece.position,
        content: piece.content,
        embedding,
        scope: doc.scope,
        areaIds: doc.areaIds,
        active: false,
        tokensCount: piece.tokensCount,
      };
    });

    await this.chunkModel.insertMany(docs, { ordered: true });

    await this.swapActiveVersion({
      tenantId: tenantOid,
      parentDocumentId: parentOid,
      newDocumentId: docOid,
    });

    this.emitReindexed(params, docs.length, Date.now() - start);
    return { chunksCreated: docs.length };
  }

  /**
   * Swap atómico-por-bulk de la versión activa de un documento lógico.
   * No usamos transacciones distribuidas (Atlas las soporta pero agregan
   * latencia y requieren replica set en local) — el orden de operaciones
   * es: primero desactivar lo viejo, después activar lo nuevo. Si el
   * proceso muere entre ambos, queda un período breve sin versión activa
   * (las búsquedas devuelven vacío — comportamiento aceptable).
   */
  private async swapActiveVersion(params: {
    tenantId: Types.ObjectId;
    parentDocumentId: Types.ObjectId;
    newDocumentId: Types.ObjectId;
  }): Promise<void> {
    // 1. Marcar como inactivos todos los documentos previos del mismo
    //    parentDocumentId (excepto el nuevo).
    await this.documentModel
      .updateMany(
        {
          tenantId: params.tenantId,
          parentDocumentId: params.parentDocumentId,
          _id: { $ne: params.newDocumentId },
        },
        { $set: { active: false } },
      )
      .exec();

    // 2. Marcar inactivos los chunks de las versiones previas.
    await this.chunkModel
      .updateMany(
        {
          tenantId: params.tenantId,
          parentDocumentId: params.parentDocumentId,
          documentId: { $ne: params.newDocumentId },
        },
        { $set: { active: false } },
      )
      .exec();

    // 3. Activar el nuevo documento + sus chunks.
    await this.documentModel
      .updateOne(
        { _id: params.newDocumentId, tenantId: params.tenantId },
        { $set: { active: true } },
      )
      .exec();
    await this.chunkModel
      .updateMany(
        { tenantId: params.tenantId, documentId: params.newDocumentId },
        { $set: { active: true } },
      )
      .exec();
  }

  private emitReindexed(
    params: { tenantId: string; documentId: string; parentDocumentId: string; version: number },
    chunksCreated: number,
    durationMs: number,
  ): void {
    this.events.emit(KB_DOCUMENT_EVENTS.KbDocumentReindexed, {
      tenantId: params.tenantId,
      documentId: params.documentId,
      parentDocumentId: params.parentDocumentId,
      version: params.version,
      chunksCreated,
      durationMs,
    } satisfies KbDocumentReindexedEvent);
    this.logger.log(
      `Indexación KB completada documentId=${params.documentId} version=${params.version} chunks=${chunksCreated} durationMs=${durationMs}`,
    );
  }
}
