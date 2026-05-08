import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { Env } from '../../config/env.schema';
import { EMBEDDING_PROVIDER, EmbeddingProvider } from '../embeddings/embedding-provider';
import { KbChunk, KbChunkDocument } from '../schemas/kb-chunk.schema';
import { KbDocument, KbDocumentDocument } from '../schemas/kb-document.schema';

export interface KbSearchHit {
  chunkId: string;
  documentId: string;
  parentDocumentId: string;
  documentVersion: number;
  position: number;
  content: string;
  score: number;
  documentTitle: string;
  scope: 'global' | 'area';
}

export interface KbSearchParams {
  tenantId: string;
  /** Área del ticket. Solo chunks `scope:'global'` o que pertenezcan a esta área entran. */
  areaId: string;
  /** Texto de la consulta (típicamente `asunto + '\n\n' + cuerpo` del ticket). */
  query: string;
  /** Top-k a devolver. Default 5 (`tikora-embeddings.md` §9.5). */
  limit?: number;
  /** Score mínimo (cosine, 0-1). Default = `UMBRAL_RELEVANCIA_KB`. */
  threshold?: number;
}

const SNIPPET_CHARS = 280;

/**
 * Búsqueda semántica sobre `kb_chunks` con Atlas Vector Search. Es el
 * pivote del flujo RAG: dado un ticket, devuelve los chunks relevantes
 * de la KB ordenados por score.
 *
 * Reglas inviolables (`tikora-embeddings.md` §9.3):
 *
 * - **`tenantId`**: filtro obligatorio. Sin él, una query expone chunks
 *   de otros tenants — bug de seguridad crítico.
 * - **`active: true`**: filtro obligatorio. Sin él, las búsquedas
 *   incluyen versiones obsoletas y la auto-respuesta cita info vieja.
 * - **scope/areaIds**: el chunk se considera relevante si `scope:'global'`
 *   o si `scope:'area'` y el área del ticket está en `areaIds`.
 *
 * Devuelve solo los hits que **superan el `threshold`** — el caller no
 * tiene que filtrar de nuevo. Si nada lo supera, devuelve `[]`, que el
 * pipeline de auto-respuesta interpreta como "sin match → escalar".
 */
@Injectable()
export class KbSearchService {
  private readonly logger = new Logger(KbSearchService.name);

  constructor(
    @InjectModel(KbChunk.name) private readonly chunkModel: Model<KbChunkDocument>,
    @InjectModel(KbDocument.name)
    private readonly documentModel: Model<KbDocumentDocument>,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    private readonly config: ConfigService<Env, true>,
  ) {}

  async search(params: KbSearchParams): Promise<KbSearchHit[]> {
    const limit = params.limit ?? 5;
    const threshold: number =
      params.threshold ?? this.config.get('UMBRAL_RELEVANCIA_KB', { infer: true });
    const indexName = this.config.get('MONGODB_VECTOR_INDEX_NAME', { infer: true });

    if (!params.query || params.query.trim().length === 0) {
      return [];
    }

    const tenantOid = new Types.ObjectId(params.tenantId);
    const areaOid = new Types.ObjectId(params.areaId);

    const queryVector = await this.embeddings.embedQuery(params.query);

    const pipeline = [
      {
        $vectorSearch: {
          index: indexName,
          path: 'embedding',
          queryVector,
          numCandidates: limit * 20,
          limit,
          filter: {
            tenantId: { $eq: tenantOid },
            active: { $eq: true },
            $or: [{ scope: { $eq: 'global' } }, { areaIds: { $in: [areaOid] } }],
          },
        },
      },
      {
        $project: {
          content: 1,
          documentId: 1,
          parentDocumentId: 1,
          documentVersion: 1,
          position: 1,
          scope: 1,
          score: { $meta: 'vectorSearchScore' },
        },
      },
    ];

    interface RawHit {
      _id: Types.ObjectId;
      content: string;
      documentId: Types.ObjectId;
      parentDocumentId: Types.ObjectId;
      documentVersion: number;
      position: number;
      scope: 'global' | 'area';
      score: number;
    }

    let raw: RawHit[];
    try {
      raw = (await this.chunkModel.aggregate(pipeline).exec()) as RawHit[];
    } catch (err) {
      // Atlas devuelve errores específicos cuando el índice no existe o
      // está en mantenimiento. No los propagamos al caller — caemos a
      // "sin match" para que el flujo de auto-respuesta escale al área
      // sin afectar la creación del ticket.
      this.logger.error(
        `Vector search falló (índice ${indexName}): ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return [];
    }

    if (raw.length === 0) {
      return [];
    }

    // Filtrar por umbral. Si el top score no llega, abortamos el match
    // — escalada normal.
    const above = raw.filter((r) => r.score >= threshold);
    if (above.length === 0) {
      this.logger.debug(
        `Vector search sin match: top score ${
          raw[0]?.score?.toFixed(3) ?? 'n/a'
        } < umbral ${threshold}`,
      );
      return [];
    }

    // Resolver títulos de documentos en una sola query — el LLM y el
    // panel de "Sugerencia IA" del front los muestran al usuario.
    const docIds = Array.from(new Set(above.map((r) => r.documentId.toString()))).map(
      (id) => new Types.ObjectId(id),
    );
    const docs = await this.documentModel
      .find({ _id: { $in: docIds }, tenantId: tenantOid })
      .select({ _id: 1, title: 1 })
      .lean()
      .exec();
    const titleByDoc = new Map(docs.map((d) => [d._id.toString(), d.title]));

    return above.map((r) => ({
      chunkId: r._id.toString(),
      documentId: r.documentId.toString(),
      parentDocumentId: r.parentDocumentId.toString(),
      documentVersion: r.documentVersion,
      position: r.position,
      content: r.content,
      score: r.score,
      documentTitle: titleByDoc.get(r.documentId.toString()) ?? '(documento)',
      scope: r.scope,
    }));
  }

  /**
   * Helper para producir el `contentSnippet` que se persiste en
   * `AiResponse.sourceChunks` y se muestra en el panel de sugerencia
   * del front. ≤280 chars para no inflar el payload.
   */
  static snippet(content: string): string {
    if (content.length <= SNIPPET_CHARS) return content;
    const sliced = content.slice(0, SNIPPET_CHARS);
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > 0 ? sliced.slice(0, lastSpace) : sliced) + '…';
  }
}
