import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Model, Types } from 'mongoose';
import { getModelToken } from '@nestjs/mongoose';
import { AppModule } from '../../app/app.module';
import { KbDocument, KbDocumentDocument } from '../schemas/kb-document.schema';
import { KbIndexingQueueService } from '../services/kb-indexing-queue.service';

/**
 * Comando de re-indexación masiva de la KB de un tenant.
 *
 *   pnpm exec nx run back:reindex-kb -- --tenantId <id> [--dry-run]
 *
 * Itera todos los documentos **activos** del tenant (la versión vigente
 * de cada documento lógico) y encola un job de indexación para cada uno.
 * El processor genera nuevos chunks/embeddings y al terminar swapea el
 * `active` — durante la corrida la KB sigue siendo consultable contra los
 * chunks actuales.
 *
 * Casos de uso típicos (ver `tikora-embeddings.md` §12.1):
 * - Cambio de modelo de embeddings.
 * - Cambio de parámetros de chunking.
 * - Sospecha de corrupción del índice.
 *
 * Con `--dry-run` solo lista lo que haría, sin tocar la cola.
 */

interface ParsedArgs {
  tenantId: string;
  dryRun: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  let tenantId: string | undefined;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--tenantId') {
      tenantId = argv[++i];
    } else if (arg?.startsWith('--tenantId=')) {
      tenantId = arg.slice('--tenantId='.length);
    } else if (arg === '--dry-run') {
      dryRun = true;
    }
  }
  if (!tenantId) {
    throw new Error('Falta argumento obligatorio --tenantId <id>');
  }
  return { tenantId, dryRun };
}

async function main(): Promise<void> {
  const logger = new Logger('reindex-kb');
  const args = parseArgs(process.argv.slice(2));
  logger.log(`Iniciando reindex-kb tenantId=${args.tenantId} dryRun=${args.dryRun}`);

  // `createApplicationContext` levanta el contenedor de DI sin abrir el
  // server HTTP — es lo correcto para scripts CLI que solo necesitan los
  // providers (`KbIndexerService`, `KbIndexingQueueService`, modelos).
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: false,
  });

  try {
    const documentModel = app.get<Model<KbDocumentDocument>>(getModelToken(KbDocument.name));
    const queue = app.get(KbIndexingQueueService);

    const tenantOid = new Types.ObjectId(args.tenantId);
    const docs = await documentModel
      .find({ tenantId: tenantOid, active: true, deletedAt: null })
      .sort({ _id: 1 })
      .exec();

    logger.log(`Documentos activos a reindexar: ${docs.length}`);

    let enqueued = 0;
    for (const doc of docs) {
      const payload = {
        tenantId: args.tenantId,
        documentId: doc._id.toString(),
        parentDocumentId: doc.parentDocumentId.toString(),
        version: doc.version,
      };
      if (args.dryRun) {
        logger.log(
          `[dry-run] encolaría documentId=${payload.documentId} parent=${payload.parentDocumentId} v${payload.version}`,
        );
      } else {
        await queue.enqueue(payload);
        enqueued++;
        logger.log(
          `Encolado documentId=${payload.documentId} parent=${payload.parentDocumentId} v${payload.version}`,
        );
      }
    }

    logger.log(
      args.dryRun
        ? `dry-run completo: ${docs.length} documentos serían encolados.`
        : `Reindex disparado para ${enqueued} documentos.`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  // Output directo a stderr — el comando se invoca como CLI standalone,
  // sin Logger de Nest disponible si el bootstrap falla antes.
  process.stderr.write((err instanceof Error ? err.stack ?? err.message : String(err)) + '\n');
  process.exit(1);
});
